import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';
import { ServerStatus } from '@prisma/client';

import { buildApp } from '../src/app';
import {
  serverDisguiseUpdateResponseSchema,
  serverResponseSchema,
} from '../src/modules/servers/server.http';
import { userResponseSchema } from '../src/modules/users/user.http';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';

describe('PATCH /servers/:id/xray-disguise', () => {
  const { prisma, data } = createFakePrisma();
  const appPromise = buildApp({
    prisma: prisma as unknown as PrismaClient,
    swaggerEnabled: false,
    runJobWorker: false,
  });

  beforeAll(async () => {
    const app = await appPromise;
    await app.ready();
  });

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  async function createReadyServer() {
    const app = await appPromise;

    const serverRes = await withAuth(request(app.server).post('/servers'))
      .send({
        host: 'disguise.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);
    const server = serverResponseSchema.parse(serverRes.body);

    const userRes = await withAuth(request(app.server).post(`/servers/${server.id}/users`)).send({}).expect(201);
    userResponseSchema.parse(userRes.body);

    const serverRow = data.servers.get(server.id);
    if (!serverRow) throw new Error('server not found');
    serverRow.status = ServerStatus.READY;
    serverRow.updatedAt = new Date();
    data.servers.set(server.id, serverRow);

    const xrayId = randomUUID();
    data.xrayInstances.set(xrayId, {
      id: xrayId,
      serverId: server.id,
      listenPort: 443,
      realityPrivateKey: 'private-key',
      realityPublicKey: 'public-key',
      serverName: 'example.com',
      dest: 'example.com:443',
      fingerprint: 'chrome',
      shortIds: ['abcd1234'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { app, server };
  }

  it('updates disguise and enqueues repair job', async () => {
    const { app, server } = await createReadyServer();

    const response = await withAuth(request(app.server).patch(`/servers/${server.id}/xray-disguise`))
      .send({
        serverName: 'vk.com',
        fingerprint: 'firefox',
      })
      .expect(202);

    const body = serverDisguiseUpdateResponseSchema.parse(response.body);
    expect(body.jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body.xrayInstance.serverName).toBe('vk.com');
    expect(body.xrayInstance.dest).toBe('vk.com:443');
    expect(body.xrayInstance.fingerprint).toBe('firefox');
  });
});
