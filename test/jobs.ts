import request from 'supertest';

import type { FastifyInstance } from 'fastify';

import { jobStatusResponseSchema } from '../src/modules/jobs/job.http';
import { withAuth } from './auth';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function getJobStatus(app: FastifyInstance, jobId: string) {
  const response = await withAuth(request(app.server).get(`/jobs/${jobId}`)).expect(200);
  return jobStatusResponseSchema.parse(response.body);
}

export async function waitForJobCompletion(
  app: FastifyInstance,
  jobId: string,
  options: { maxAttempts?: number; delayMs?: number } = {},
) {
  const maxAttempts = options.maxAttempts ?? 120;
  const delayMs = options.delayMs ?? 25;

  for (let index = 0; index < maxAttempts; index += 1) {
    const status = await getJobStatus(app, jobId);
    if (status.status === 'COMPLETED' || status.status === 'FAILED') {
      return status;
    }
    await sleep(delayMs);
  }

  throw new Error(`Timed out waiting job completion: ${jobId}`);
}
