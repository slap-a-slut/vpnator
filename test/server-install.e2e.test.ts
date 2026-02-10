import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { buildApp } from '../src/app';
import { enqueueJobResponseSchema, jobLogsResponseSchema } from '../src/modules/jobs/job.http';
import { serverResponseSchema, serverStatusResponseSchema } from '../src/modules/servers/server.http';
import { userResponseSchema } from '../src/modules/users/user.http';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';
import { getJobStatus, waitForJobCompletion } from './jobs';

describe('Server install API', () => {
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

  it('queues install job, completes and returns status/meta', async () => {
    const app = await appPromise;

    const serverRes = await withAuth(
      request(app.server).post('/servers'),
    )
      .send({
        host: 'xray-install.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);

    const server = serverResponseSchema.parse(serverRes.body);

    await withAuth(
      request(app.server).post(`/servers/${server.id}/users`),
    )
      .send({ name: 'Install User' })
      .expect(201)
      .then((res) => userResponseSchema.parse(res.body));

    const installRes = await withAuth(
      request(app.server).post(`/servers/${server.id}/install`),
    )
      .send({})
      .expect(202);
    const enqueue = enqueueJobResponseSchema.parse(installRes.body);

    const immediate = await getJobStatus(app, enqueue.jobId);
    expect(['QUEUED', 'ACTIVE', 'COMPLETED']).toContain(immediate.status);

    const completedJob = await waitForJobCompletion(app, enqueue.jobId);
    expect(completedJob.status).toBe('COMPLETED');

    const statusRes = await withAuth(request(app.server).get(`/servers/${server.id}/status`)).expect(
      200,
    );
    const status = serverStatusResponseSchema.parse(statusRes.body);

    expect(status.status).toBe('READY');
    expect(status.xrayInstance).not.toBeNull();
    expect(status.xrayInstance?.listenPort).toBe(443);

    const secondInstallRes = await withAuth(
      request(app.server).post(`/servers/${server.id}/install`),
    )
      .send({})
      .expect(202);
    const secondEnqueue = enqueueJobResponseSchema.parse(secondInstallRes.body);
    const secondCompletedJob = await waitForJobCompletion(app, secondEnqueue.jobId);
    expect(secondCompletedJob.status).toBe('COMPLETED');
    expect(secondCompletedJob.result).toMatchObject({
      alreadyInstalled: true,
    });

    const secondLogsRes = await withAuth(
      request(app.server).get(`/jobs/${secondEnqueue.jobId}/logs`).query({ tail: 200 }),
    ).expect(200);
    const secondLogs = jobLogsResponseSchema.parse(secondLogsRes.body);
    expect(
      secondLogs.lines.some((line) => line.message.toLowerCase().includes('already installed')),
    ).toBe(true);

    const secondStatusRes = await withAuth(request(app.server).get(`/servers/${server.id}/status`)).expect(
      200,
    );
    const secondStatus = serverStatusResponseSchema.parse(secondStatusRes.body);
    expect(secondStatus.xrayInstance?.id).toBe(status.xrayInstance?.id);
  });

  it('returns SERVER_BUSY for parallel install attempts on the same server', async () => {
    const app = await appPromise;

    const serverRes = await withAuth(request(app.server).post('/servers'))
      .send({
        host: 'xray-install-lock.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);
    const server = serverResponseSchema.parse(serverRes.body);

    const firstPromise = withAuth(request(app.server).post(`/servers/${server.id}/install`)).send({});
    const secondPromise = withAuth(request(app.server).post(`/servers/${server.id}/install`)).send({});

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    const responses = [first, second];

    const accepted = responses.find((response) => response.statusCode === 202);
    const rejected = responses.find((response) => response.statusCode === 409);

    expect(accepted).toBeDefined();
    expect(rejected).toBeDefined();
    expect(rejected?.body).toMatchObject({
      code: 'SERVER_BUSY',
    });

    if (!accepted) {
      throw new Error('Expected one install request to be accepted');
    }

    const queuedJob = enqueueJobResponseSchema.parse(accepted.body);
    const completedJob = await waitForJobCompletion(app, queuedJob.jobId);
    expect(completedJob.status).toBe('COMPLETED');
  });
});
