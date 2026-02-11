import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { buildApp } from '../src/app';
import { serverResponseSchema } from '../src/modules/servers/server.http';
import { ServerRepository } from '../src/modules/servers/server.repository';
import { userConfigResponseSchema, userResponseSchema } from '../src/modules/users/user.http';
import { XrayInstanceRepository } from '../src/modules/xray';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';

describe('GET /users/:id/config', () => {
  const { prisma } = createFakePrisma();
  const prismaClient = prisma as unknown as PrismaClient;
  const appPromise = buildApp({ prisma: prismaClient, swaggerEnabled: false });
  const serverRepository = new ServerRepository(prismaClient);
  const xrayInstanceRepository = new XrayInstanceRepository(prismaClient);

  beforeAll(async () => {
    const app = await appPromise;
    await app.ready();
  });

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  async function createServerWithUser() {
    const app = await appPromise;

    const serverRes = await withAuth(
      request(app.server).post('/servers'),
    )
      .send({
        host: 'cfg.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);
    const server = serverResponseSchema.parse(serverRes.body);

    const userRes = await withAuth(
      request(app.server).post(`/servers/${server.id}/users`),
    )
      .send({ name: 'Config User' })
      .expect(201);
    const user = userResponseSchema.parse(userRes.body);

    return { app, server, user };
  }

  it('returns valid VLESS link for READY server', async () => {
    const { app, server, user } = await createServerWithUser();

    await serverRepository.updateById(server.id, {
      status: 'READY',
    });

    await xrayInstanceRepository.create({
      serverId: server.id,
      listenPort: 443,
      realityPrivateKey: 'private-key',
      realityPublicKey: 'public-key',
      serverName: 'sni.example.com',
      dest: 'example.com:443',
      fingerprint: 'chrome',
      shortIds: ['abcd1234', 'deadbeef'],
    });

    const res = await withAuth(request(app.server).get(`/users/${user.id}/config`)).expect(200);
    const body = userConfigResponseSchema.parse(res.body);

    expect(body).toEqual({
      vlessLink: `vless://${user.uuid}@${server.host}:443?security=reality&sni=sni.example.com&fp=chrome&pbk=public-key&sid=abcd1234&type=tcp#XrayUser`,
      server: {
        host: server.host,
        port: 443,
      },
      reality: {
        publicKey: 'public-key',
        serverName: 'sni.example.com',
        fingerprint: 'chrome',
        shortId: 'abcd1234',
        dest: 'example.com:443',
      },
      user: {
        uuid: user.uuid,
      },
    });
  });

  it.each(['NEW', 'ERROR'] as const)('returns NOT_READY when server status is %s', async (status) => {
    const { app, server, user } = await createServerWithUser();

    await serverRepository.updateById(server.id, {
      status,
    });

    const res = await withAuth(request(app.server).get(`/users/${user.id}/config`)).expect(409);
    expect(res.body).toMatchObject({
      code: 'NOT_READY',
    });
  });
});
