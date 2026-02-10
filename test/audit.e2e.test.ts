import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { buildApp } from '../src/app';
import { auditListResponseSchema } from '../src/modules/audit/audit.http';
import { serverResponseSchema } from '../src/modules/servers/server.http';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';

describe('Audit API', () => {
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

  it('records audit event when server is created', async () => {
    const app = await appPromise;

    const createRes = await withAuth(request(app.server).post('/servers'))
      .send({
        host: 'audit-server.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);
    const server = serverResponseSchema.parse(createRes.body);

    const auditRes = await withAuth(
      request(app.server).get('/audit').query({ entityId: server.id, limit: 50 }),
    ).expect(200);
    const body = auditListResponseSchema.parse(auditRes.body);

    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events[0]).toMatchObject({
      actor: 'adminKey:test-a',
      action: 'SERVER_CREATE',
      entityType: 'SERVER',
      entityId: server.id,
    });
  });
});
