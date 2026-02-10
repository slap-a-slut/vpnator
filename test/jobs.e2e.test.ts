import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { buildApp } from '../src/app';
import {
  cancelJobResponseSchema,
  enqueueJobResponseSchema,
  jobLogsResponseSchema,
  jobStatusResponseSchema,
} from '../src/modules/jobs/job.http';
import { serverResponseSchema } from '../src/modules/servers/server.http';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';
import { waitForJobCompletion } from './jobs';

describe('Jobs API', () => {
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

  it('install returns jobId and job progresses to completion', async () => {
    const app = await appPromise;

    const serverRes = await withAuth(request(app.server).post('/servers'))
      .send({
        host: 'jobs-install.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);
    const server = serverResponseSchema.parse(serverRes.body);

    const installRes = await withAuth(request(app.server).post(`/servers/${server.id}/install`))
      .send({})
      .expect(202);
    const installJob = enqueueJobResponseSchema.parse(installRes.body);

    const initialStatusRes = await withAuth(request(app.server).get(`/jobs/${installJob.jobId}`)).expect(
      200,
    );
    const initialStatus = jobStatusResponseSchema.parse(initialStatusRes.body);
    expect(['QUEUED', 'ACTIVE']).toContain(initialStatus.status);

    const completedStatus = await waitForJobCompletion(app, installJob.jobId);
    expect(completedStatus.status).toBe('COMPLETED');
    expect(completedStatus.progress).toBe(100);

    const logsRes = await withAuth(
      request(app.server).get(`/jobs/${installJob.jobId}/logs`).query({ tail: 200 }),
    ).expect(200);
    const logs = jobLogsResponseSchema.parse(logsRes.body);

    expect(logs.jobId).toBe(installJob.jobId);
    expect(logs.lines.length).toBeGreaterThan(0);
  });

  it('cancels queued job and completes with canceled result', async () => {
    const app = await appPromise;

    const serverRes = await withAuth(request(app.server).post('/servers'))
      .send({
        host: 'jobs-cancel.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);
    const server = serverResponseSchema.parse(serverRes.body);

    const installRes = await withAuth(request(app.server).post(`/servers/${server.id}/install`))
      .send({})
      .expect(202);
    const installJob = enqueueJobResponseSchema.parse(installRes.body);

    const cancelRes = await withAuth(
      request(app.server).post(`/jobs/${installJob.jobId}/cancel`),
    ).expect(200);
    const cancelResponse = cancelJobResponseSchema.parse(cancelRes.body);
    expect(cancelResponse.jobId).toBe(installJob.jobId);

    const completedStatus = await waitForJobCompletion(app, installJob.jobId);
    expect(completedStatus.status).toBe('COMPLETED');
    expect(completedStatus.result).toMatchObject({
      canceled: true,
    });
  });
});
