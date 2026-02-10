import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import { vlessLinkSchema, sharePayloadSchema } from '../xray-client-agent/src/contracts/compatibility';
import { buildApp } from '../src/app';
import { enqueueJobResponseSchema } from '../src/modules/jobs/job.http';
import { serverResponseSchema, serverStatusResponseSchema } from '../src/modules/servers/server.http';
import {
  createUserShareResponseSchema,
  userConfigResponseSchema,
  userResponseSchema,
} from '../src/modules/users/user.http';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';
import { waitForJobCompletion } from './jobs';

describe('E2E dry-run flow', () => {
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

  it('create server -> install -> create user -> share -> consume -> user config', async () => {
    const app = await appPromise;

    const createServerResponse = await withAuth(request(app.server).post('/servers'))
      .send({
        host: 'e2e-dry-run.example.com',
        sshUser: 'root',
        sshAuth: { type: 'SSH_PASSWORD', value: 'secret' },
      })
      .expect(201);
    const server = serverResponseSchema.parse(createServerResponse.body);

    const installResponse = await withAuth(request(app.server).post(`/servers/${server.id}/install`))
      .send({})
      .expect(202);
    const installJob = enqueueJobResponseSchema.parse(installResponse.body);

    const completedInstallJob = await waitForJobCompletion(app, installJob.jobId);
    expect(completedInstallJob.status).toBe('COMPLETED');

    const serverStatusResponse = await withAuth(request(app.server).get(`/servers/${server.id}/status`)).expect(
      200,
    );
    const serverStatus = serverStatusResponseSchema.parse(serverStatusResponse.body);
    expect(serverStatus.status).toBe('READY');
    expect(serverStatus.xrayInstance).not.toBeNull();

    const createUserResponse = await withAuth(request(app.server).post(`/servers/${server.id}/users`))
      .send({ name: 'E2E User' })
      .expect(201);
    const user = userResponseSchema.parse(createUserResponse.body);

    const shareTokenResponse = await withAuth(request(app.server).post(`/users/${user.id}/share`))
      .send({})
      .expect(201);
    const shareToken = createUserShareResponseSchema.parse(shareTokenResponse.body);

    const consumeShareResponse = await withAuth(request(app.server).get(`/share/${shareToken.token}`)).expect(
      200,
    );
    const sharePayload = sharePayloadSchema.parse(consumeShareResponse.body);
    expect(sharePayload.userId).toBe(user.id);
    expect(sharePayload.serverId).toBe(server.id);

    const userConfigHttpResponse = await withAuth(request(app.server).get(`/users/${user.id}/config`)).expect(
      200,
    );
    const userConfig = userConfigResponseSchema.parse(userConfigHttpResponse.body);
    vlessLinkSchema.parse(userConfig.vlessLink);
  });
});
