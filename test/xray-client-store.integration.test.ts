import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { buildApp } from '../src/app';
import type { XrayClientStore } from '../src/modules/xray';
import { serverResponseSchema } from '../src/modules/servers/server.http';
import { userResponseSchema } from '../src/modules/users/user.http';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';

describe('XrayClientStore integration hooks', () => {
  const { prisma } = createFakePrisma();
  const syncMock = vi.fn(() => Promise.resolve());
  const addUserMock = vi.fn(() => Promise.resolve());
  const removeUserMock = vi.fn(() => Promise.resolve());

  const xrayClientStore: XrayClientStore = {
    sync: syncMock,
    addUser: addUserMock,
    removeUser: removeUserMock,
  };

  const appPromise = buildApp({
    prisma: prisma as unknown as PrismaClient,
    swaggerEnabled: false,
    xrayClientStore,
  });

  beforeAll(async () => {
    const app = await appPromise;
    await app.ready();
  });

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  it('calls addUser after creating user on server', async () => {
    const app = await appPromise;

    const serverRes = await withAuth(
      request(app.server).post('/servers'),
    )
      .send({
        host: 'store-hook.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);

    const server = serverResponseSchema.parse(serverRes.body);

    const userRes = await withAuth(
      request(app.server).post(`/servers/${server.id}/users`),
    )
      .send({ name: 'Store User' })
      .expect(201);

    const user = userResponseSchema.parse(userRes.body);

    expect(addUserMock).toHaveBeenCalledTimes(1);
    expect(addUserMock).toHaveBeenCalledWith(server.id, user.uuid);
  });

  it('calls removeUser when user is disabled', async () => {
    const app = await appPromise;

    const serverRes = await withAuth(
      request(app.server).post('/servers'),
    )
      .send({
        host: 'store-disable.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);
    const server = serverResponseSchema.parse(serverRes.body);

    const userRes = await withAuth(
      request(app.server).post(`/servers/${server.id}/users`),
    )
      .send({ name: 'Disable User' })
      .expect(201);
    const user = userResponseSchema.parse(userRes.body);

    await withAuth(
      request(app.server).patch(`/users/${user.id}`),
    )
      .send({ enabled: false })
      .expect(200);

    expect(removeUserMock).toHaveBeenCalledTimes(1);
    expect(removeUserMock).toHaveBeenCalledWith(server.id, user.uuid);
  });
});
