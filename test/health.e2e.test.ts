import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../src/app';

describe('public metadata endpoints', () => {
  const versionResponseSchema = z.object({
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
  });

  const appPromise = buildApp();

  beforeAll(async () => {
    const app = await appPromise;
    await app.ready();
  });

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  it('GET /health returns 200', async () => {
    const app = await appPromise;

    const res = await request(app.server).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /version returns semver', async () => {
    const app = await appPromise;

    const body = versionResponseSchema.parse((await request(app.server).get('/version').expect(200)).body);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  });
});
