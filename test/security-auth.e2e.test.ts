import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { PrismaClient } from '@prisma/client';

import { buildApp } from '../src/app';
import { withAuth } from './auth';
import { createFakePrisma } from './fakePrisma';

describe('API key auth', () => {
  const versionResponseSchema = z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
  });

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

  it('allows GET /health without auth', async () => {
    const app = await appPromise;

    const response = await request(app.server).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('allows GET /version without auth', async () => {
    const app = await appPromise;

    const body = versionResponseSchema.parse(
      (await request(app.server).get('/version').expect(200)).body,
    );
    expect(body.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  });

  it('allows GET /share/:token without auth', async () => {
    const app = await appPromise;
    const response = await request(app.server).get('/share/invalid-token').expect(404);
    expect(response.body).toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  it('rejects non-health endpoint without auth', async () => {
    const app = await appPromise;

    const response = await request(app.server).get('/servers').expect(401);
    expect(response.body).toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('allows request with valid API key', async () => {
    const app = await appPromise;

    await withAuth(request(app.server).get('/servers')).expect(200);
  });
});
