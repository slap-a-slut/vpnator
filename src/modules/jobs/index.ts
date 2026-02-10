import { z } from 'zod';

import type { FastifyInstance } from 'fastify';

import { AuditEventRepository, getActorIdFromRequest } from '../audit';
import { errorResponseSchema } from '../../lib/errors';
import { parseOrThrow, uuidSchema } from '../../lib/validation';
import {
  cancelJobResponseJsonSchema,
  jobLogsQueryJsonSchema,
  jobLogsQuerySchema,
  jobLogsResponseJsonSchema,
  jobParamsJsonSchema,
  jobStatusResponseJsonSchema,
  toCancelJobResponse,
  toJobLogsResponse,
  toJobStatusResponse,
} from './job.http';

const jobParamsSchema = z.object({ id: uuidSchema }).strict();

export * from './job.http';
export * from './job.types';
export * from './jobs.registry';
export * from './jobs.registry.bullmq';
export * from './jobs.registry.memory';
export * from './jobLog.repository';

export function jobsModule(app: FastifyInstance) {
  const auditEventRepository = new AuditEventRepository(app.prisma);

  app.get(
    '/:id',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Get job status',
        params: jobParamsJsonSchema,
        response: {
          200: jobStatusResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = parseOrThrow(jobParamsSchema, request.params);
      const job = await app.jobsRegistry.getJob(id);
      return toJobStatusResponse(job);
    },
  );

  app.get(
    '/:id/logs',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Get job logs',
        params: jobParamsJsonSchema,
        querystring: jobLogsQueryJsonSchema,
        response: {
          200: jobLogsResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = parseOrThrow(jobParamsSchema, request.params);
      const query = parseOrThrow(jobLogsQuerySchema, request.query);
      const logs = await app.jobsRegistry.getLogs(id, query.tail);

      return toJobLogsResponse({
        jobId: id,
        lines: logs,
      });
    },
  );

  app.post(
    '/:id/cancel',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Request job cancellation',
        params: jobParamsJsonSchema,
        response: {
          200: cancelJobResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const actor = getActorIdFromRequest(request);
      const { id } = parseOrThrow(jobParamsSchema, request.params);
      const result = await app.jobsRegistry.cancel(id);
      await auditEventRepository.create({
        actor,
        action: 'JOB_CANCEL',
        entityType: 'JOB',
        entityId: id,
        meta: {
          status: result.status,
        },
      });
      return toCancelJobResponse(result);
    },
  );
}
