import { z } from 'zod';

import type { JobLogLine, JobState } from './job.types';

export const enqueueJobResponseSchema = z
  .object({
    jobId: z.string().uuid(),
  })
  .strict();

export type EnqueueJobResponse = z.infer<typeof enqueueJobResponseSchema>;

export const jobStatusResponseSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED']),
    progress: z.coerce.number().int().min(0).max(100),
    result: z.unknown().optional(),
    error: z.string().optional(),
  })
  .strict();

export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;

export const jobLogsQuerySchema = z
  .object({
    tail: z.coerce.number().int().min(1).max(1000).default(200),
  })
  .strict();

export type JobLogsQuery = z.infer<typeof jobLogsQuerySchema>;

export const jobLogLineSchema = z
  .object({
    level: z.enum(['INFO', 'WARN', 'ERROR']),
    message: z.string().min(1),
    ts: z.string().datetime(),
  })
  .strict();

export const jobLogsResponseSchema = z
  .object({
    jobId: z.string().uuid(),
    lines: z.array(jobLogLineSchema),
  })
  .strict();

export type JobLogsResponse = z.infer<typeof jobLogsResponseSchema>;

export const cancelJobResponseSchema = z
  .object({
    jobId: z.string().uuid(),
    status: z.enum(['QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED']),
    cancelRequested: z.literal(true),
  })
  .strict();

export type CancelJobResponse = z.infer<typeof cancelJobResponseSchema>;

export const jobParamsJsonSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

export const enqueueJobResponseJsonSchema = {
  type: 'object',
  required: ['jobId'],
  additionalProperties: false,
  properties: {
    jobId: { type: 'string', format: 'uuid' },
  },
} as const;

export const jobStatusResponseJsonSchema = {
  type: 'object',
  required: ['id', 'status', 'progress'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED'] },
    progress: { type: 'integer', minimum: 0, maximum: 100 },
    result: {},
    error: { type: 'string' },
  },
} as const;

export const jobLogsQueryJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tail: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
  },
} as const;

export const jobLogLineJsonSchema = {
  type: 'object',
  required: ['level', 'message', 'ts'],
  additionalProperties: false,
  properties: {
    level: { type: 'string', enum: ['INFO', 'WARN', 'ERROR'] },
    message: { type: 'string' },
    ts: { type: 'string', format: 'date-time' },
  },
} as const;

export const jobLogsResponseJsonSchema = {
  type: 'object',
  required: ['jobId', 'lines'],
  additionalProperties: false,
  properties: {
    jobId: { type: 'string', format: 'uuid' },
    lines: {
      type: 'array',
      items: jobLogLineJsonSchema,
    },
  },
} as const;

export const cancelJobResponseJsonSchema = {
  type: 'object',
  required: ['jobId', 'status', 'cancelRequested'],
  additionalProperties: false,
  properties: {
    jobId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED'] },
    cancelRequested: { type: 'boolean', const: true },
  },
} as const;

export function toEnqueueJobResponse(input: { jobId: string }): EnqueueJobResponse {
  return enqueueJobResponseSchema.parse(input);
}

export function toJobStatusResponse(input: JobState): JobStatusResponse {
  return jobStatusResponseSchema.parse(input);
}

export function toJobLogsResponse(input: { jobId: string; lines: JobLogLine[] }): JobLogsResponse {
  return jobLogsResponseSchema.parse(input);
}

export function toCancelJobResponse(input: {
  jobId: string;
  status: JobState['status'];
  cancelRequested: true;
}): CancelJobResponse {
  return cancelJobResponseSchema.parse(input);
}
