import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { buildApp } from '../src/app';
import { enqueueJobResponseSchema } from '../src/modules/jobs/job.http';
import {
  serverHealthResponseSchema,
  serverLogsResponseSchema,
  serverResponseSchema,
} from '../src/modules/servers/server.http';
import { userResponseSchema } from '../src/modules/users/user.http';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';
import { waitForJobCompletion } from './jobs';

describe('Server observability API', () => {
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

  async function createServerWithUser() {
    const app = await appPromise;

    const serverRes = await withAuth(
      request(app.server).post('/servers'),
    )
      .send({
        host: 'obs.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);
    const server = serverResponseSchema.parse(serverRes.body);

    await withAuth(
      request(app.server).post(`/servers/${server.id}/users`),
    )
      .send({ name: 'Obs User' })
      .expect(201)
      .then((res) => userResponseSchema.parse(res.body));

    const installRes = await withAuth(request(app.server).post(`/servers/${server.id}/install`))
      .send({})
      .expect(202);
    const installEnqueue = enqueueJobResponseSchema.parse(installRes.body);
    await waitForJobCompletion(app, installEnqueue.jobId);

    return { app, server };
  }

  it('returns install and xray logs with tail', async () => {
    const { app, server } = await createServerWithUser();

    const installLogsRes = await withAuth(
      request(app.server).get(`/servers/${server.id}/logs`),
    )
      .query({ type: 'install', tail: 20 })
      .expect(200);
    const installLogs = serverLogsResponseSchema.parse(installLogsRes.body);

    expect(installLogs.type).toBe('install');
    expect(installLogs.tail).toBe(20);
    expect(installLogs.lines.length).toBeGreaterThan(0);

    const xrayLogsRes = await withAuth(
      request(app.server).get(`/servers/${server.id}/logs`),
    )
      .query({ type: 'xray', tail: 10 })
      .expect(200);
    const xrayLogs = serverLogsResponseSchema.parse(xrayLogsRes.body);

    expect(xrayLogs.type).toBe('xray');
    expect(xrayLogs.tail).toBe(10);
    expect(xrayLogs.lines[0]).toContain('DRY_RUN');
  });

  it('validates logs query params', async () => {
    const { app, server } = await createServerWithUser();

    await withAuth(
      request(app.server).get(`/servers/${server.id}/logs`),
    )
      .query({ type: 'xray', tail: 0 })
      .expect(400);

    await withAuth(
      request(app.server).get(`/servers/${server.id}/logs`),
    )
      .query({ type: 'unknown', tail: 10 })
      .expect(400);
  });

  it('returns server health checks', async () => {
    const { app, server } = await createServerWithUser();

    const res = await withAuth(request(app.server).get(`/servers/${server.id}/health`)).expect(200);
    const health = serverHealthResponseSchema.parse(res.body);

    expect(health.status).toBe('READY');
    expect(health.checks).toEqual({
      ssh: true,
      docker: true,
      xrayContainer: true,
      portListening: true,
    });
  });
});
