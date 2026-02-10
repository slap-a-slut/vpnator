import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';
import { ServerStatus } from '@prisma/client';

import { buildApp } from '../src/app';
import { hashShareToken } from '../src/lib/crypto';
import { serverResponseSchema } from '../src/modules/servers/server.http';
import { shareConsumeResponseSchema } from '../src/modules/share/share.http';
import { createUserShareResponseSchema, userResponseSchema } from '../src/modules/users/user.http';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';

describe('Share token API', () => {
  const { prisma, data } = createFakePrisma();
  const appPromise = buildApp({ prisma: prisma as unknown as PrismaClient, swaggerEnabled: false });

  beforeAll(async () => {
    const app = await appPromise;
    await app.ready();
  });

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  async function createUser() {
    const app = await appPromise;

    const serverRes = await withAuth(
      request(app.server).post('/servers'),
    )
      .send({
        host: 'share.example.com',
        sshUser: 'ubuntu',
        sshAuth: { type: 'SSH_PASSWORD', value: 'pass' },
      })
      .expect(201);

    const server = serverResponseSchema.parse(serverRes.body);

    const userRes = await withAuth(
      request(app.server).post(`/servers/${server.id}/users`),
    )
      .send({})
      .expect(201);
    const user = userResponseSchema.parse(userRes.body);

    return { app, server, user };
  }

  function makeServerReady(serverId: string) {
    const server = data.servers.get(serverId);
    if (!server) throw new Error('server not found in fake prisma');

    server.status = ServerStatus.READY;
    server.updatedAt = new Date();
    data.servers.set(serverId, server);

    const xrayInstanceId = randomUUID();
    data.xrayInstances.set(xrayInstanceId, {
      id: xrayInstanceId,
      serverId,
      listenPort: 443,
      realityPrivateKey: 'private_key',
      realityPublicKey: 'public_key',
      serverName: 'cdn.example.com',
      dest: 'example.com:443',
      shortIds: ['abcd1234'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it('issues one-time token and allows first consume', async () => {
    const { app, user, server } = await createUser();
    makeServerReady(server.id);

    const issueRes = await withAuth(request(app.server).post(`/users/${user.id}/share`))
      .send({})
      .expect(201);
    const issue = createUserShareResponseSchema.parse(issueRes.body);

    expect(issue.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(new Date(issue.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const storedToken = [...data.shareTokens.values()].find((item) => item.userId === user.id);
    if (!storedToken) throw new Error('share token not stored');

    expect(storedToken.tokenHash).toBe(hashShareToken(issue.token));
    expect(storedToken.tokenHash).not.toBe(issue.token);
    expect(storedToken.usedAt).toBeNull();

    const consumeRes = await withAuth(request(app.server).get(`/share/${issue.token}`)).expect(200);
    const consumed = shareConsumeResponseSchema.parse(consumeRes.body);

    expect(consumed).toMatchObject({
      userId: user.id,
      serverId: user.serverId,
    });
    expect(consumed.vlessLink).toBe(
      `vless://${user.uuid}@${server.host}:443?security=reality&sni=cdn.example.com&fp=chrome&pbk=public_key&sid=abcd1234&type=tcp#XrayUser`,
    );
  });

  it('returns TOKEN_USED on second consume', async () => {
    const { app, user, server } = await createUser();
    makeServerReady(server.id);

    const issueRes = await withAuth(request(app.server).post(`/users/${user.id}/share`))
      .send({})
      .expect(201);
    const issue = createUserShareResponseSchema.parse(issueRes.body);

    await withAuth(request(app.server).get(`/share/${issue.token}`)).expect(200);

    const second = await withAuth(request(app.server).get(`/share/${issue.token}`)).expect(410);
    expect(second.body).toMatchObject({
      code: 'TOKEN_USED',
    });
  });

  it('returns TOKEN_EXPIRED for expired token', async () => {
    const { app, user } = await createUser();

    const issueRes = await withAuth(
      request(app.server).post(`/users/${user.id}/share`),
    )
      .send({ ttlMinutes: 1 })
      .expect(201);
    const issue = createUserShareResponseSchema.parse(issueRes.body);

    const tokenHash = hashShareToken(issue.token);
    const storedToken = [...data.shareTokens.values()].find((item) => item.tokenHash === tokenHash);
    if (!storedToken) throw new Error('share token not stored');
    storedToken.expiresAt = new Date(Date.now() - 1000);
    data.shareTokens.set(storedToken.id, storedToken);

    const expired = await withAuth(request(app.server).get(`/share/${issue.token}`)).expect(410);
    expect(expired.body).toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
  });
});
