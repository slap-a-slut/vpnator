import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { buildApp } from '../src/app';
import { adminExportResponseSchema } from '../src/modules/admin';
import { serverResponseSchema } from '../src/modules/servers/server.http';
import { userResponseSchema } from '../src/modules/users/user.http';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';

describe('Admin export API', () => {
  const { prisma } = createFakePrisma();
  const appPromise = buildApp({ prisma: prisma as unknown as PrismaClient, swaggerEnabled: false });

  beforeAll(async () => {
    const app = await appPromise;
    await app.ready();
  });

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  it('returns export json without plaintext secrets', async () => {
    const app = await appPromise;

    const createServerResponse = await withAuth(request(app.server).post('/servers'))
      .send({
        host: 'ops-export.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'super-secret-password' },
      })
      .expect(201);
    const server = serverResponseSchema.parse(createServerResponse.body);

    const createUserResponse = await withAuth(request(app.server).post(`/servers/${server.id}/users`))
      .send({ name: 'Export User' })
      .expect(201);
    const user = userResponseSchema.parse(createUserResponse.body);

    await withAuth(request(app.server).post(`/users/${user.id}/share`)).send({ ttlMinutes: 45 }).expect(201);

    const exportResponse = await withAuth(request(app.server).get('/admin/export')).expect(200);
    const payload = adminExportResponseSchema.parse(exportResponse.body);

    expect(payload.data.servers.some((item) => item.id === server.id)).toBe(true);
    expect(payload.data.users.some((item) => item.id === user.id)).toBe(true);
    expect(payload.data.shareTokens.length).toBeGreaterThan(0);
    expect(payload.auditSummary.totalEvents).toBeGreaterThan(0);

    expect(JSON.stringify(payload)).not.toContain('super-secret-password');
  });
});
