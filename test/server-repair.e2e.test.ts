import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { buildApp } from '../src/app';
import { enqueueJobResponseSchema } from '../src/modules/jobs/job.http';
import {
  serverResponseSchema,
  serverStatusResponseSchema,
} from '../src/modules/servers/server.http';
import { userResponseSchema } from '../src/modules/users/user.http';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';
import { waitForJobCompletion } from './jobs';

describe('POST /servers/:id/repair', () => {
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

  it('queues repair job and updates server status', async () => {
    const app = await appPromise;

    const serverRes = await withAuth(
      request(app.server).post('/servers'),
    )
      .send({
        host: 'repair-api.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);
    const server = serverResponseSchema.parse(serverRes.body);

    await withAuth(
      request(app.server).post(`/servers/${server.id}/users`),
    )
      .send({ name: 'Repair API User' })
      .expect(201)
      .then((res) => userResponseSchema.parse(res.body));

    const repairRes = await withAuth(
      request(app.server).post(`/servers/${server.id}/repair`),
    )
      .send({})
      .expect(202);
    const repairEnqueue = enqueueJobResponseSchema.parse(repairRes.body);
    const repairJob = await waitForJobCompletion(app, repairEnqueue.jobId);

    expect(repairJob.status).toBe('COMPLETED');
    expect(repairJob.result).toMatchObject({
      type: 'repair',
      serverId: server.id,
      statusBefore: 'NEW',
      statusAfter: 'READY',
    });

    const statusRes = await withAuth(request(app.server).get(`/servers/${server.id}/status`)).expect(
      200,
    );
    const status = serverStatusResponseSchema.parse(statusRes.body);

    expect(status.status).toBe('READY');
    expect(status.xrayInstance).not.toBeNull();
  });
});
