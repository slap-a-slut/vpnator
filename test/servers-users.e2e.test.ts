import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { buildApp } from '../src/app';
import { decryptSecret } from '../src/lib/crypto';
import { serverResponseSchema } from '../src/modules/servers/server.http';
import { userResponseSchema } from '../src/modules/users/user.http';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';

describe('Servers & Users API', () => {
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

  it('creates server', async () => {
    const app = await appPromise;

    const res = await withAuth(
      request(app.server).post('/servers'),
    )
      .send({
        host: 'example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);

    const server = serverResponseSchema.parse(res.body);

    expect(server).toMatchObject({
      host: 'example.com',
      sshUser: 'root',
      status: 'NEW',
      lastError: null,
    });

    expect(data.secrets.size).toBe(1);
    const storedCiphertext = [...data.secrets.values()][0]?.ciphertext;
    if (!storedCiphertext) throw new Error('secret not stored');
    expect(storedCiphertext).not.toBe('secret');
    expect(decryptSecret(storedCiphertext)).toBe('secret');
  });

  it('creates user on server', async () => {
    const app = await appPromise;

    const serverRes = await withAuth(
      request(app.server).post('/servers'),
    )
      .send({
        host: 'srv-1.example.com',
        sshUser: 'ubuntu',
        sshAuth: { type: 'SSH_KEY', value: 'ssh-rsa AAA...' },
      })
      .expect(201);

    const server = serverResponseSchema.parse(serverRes.body);
    const serverId = server.id;

    const userRes = await withAuth(
      request(app.server).post(`/servers/${serverId}/users`),
    )
      .send({ name: 'Alice' })
      .expect(201);

    const user = userResponseSchema.parse(userRes.body);

    expect(user).toMatchObject({
      serverId,
      name: 'Alice',
      enabled: true,
    });
  });

  it('disables user', async () => {
    const app = await appPromise;

    const serverRes = await withAuth(
      request(app.server).post('/servers'),
    )
      .send({
        host: 'srv-2.example.com',
        sshUser: 'ubuntu',
        sshAuth: { type: 'SSH_PASSWORD', value: 'pass' },
      })
      .expect(201);

    const server = serverResponseSchema.parse(serverRes.body);
    const serverId = server.id;

    const userRes = await withAuth(
      request(app.server).post(`/servers/${serverId}/users`),
    )
      .send({})
      .expect(201);

    const user = userResponseSchema.parse(userRes.body);
    const userId = user.id;

    const patched = await withAuth(
      request(app.server).patch(`/users/${userId}`),
    )
      .send({ enabled: false })
      .expect(200);

    const patchedUser = userResponseSchema.parse(patched.body);

    expect(patchedUser).toMatchObject({
      id: userId,
      serverId,
      enabled: false,
    });
  });
});
