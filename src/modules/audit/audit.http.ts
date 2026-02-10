import { z } from 'zod';

import type { AuditEvent } from '@prisma/client';

export const auditListQuerySchema = z
  .object({
    entityId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;

export const auditEventResponseSchema = z
  .object({
    id: z.string().uuid(),
    actor: z.string().min(1),
    action: z.string().min(1),
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    meta: z.unknown().optional(),
    ts: z.string().datetime(),
  })
  .strict();

export const auditListResponseSchema = z
  .object({
    events: z.array(auditEventResponseSchema),
  })
  .strict();

export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

export const auditListQueryJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entityId: { type: 'string', minLength: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  },
} as const;

export const auditEventResponseJsonSchema = {
  type: 'object',
  required: ['id', 'actor', 'action', 'entityType', 'entityId', 'ts'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    actor: { type: 'string' },
    action: { type: 'string' },
    entityType: { type: 'string' },
    entityId: { type: 'string' },
    meta: {},
    ts: { type: 'string', format: 'date-time' },
  },
} as const;

export const auditListResponseJsonSchema = {
  type: 'object',
  required: ['events'],
  additionalProperties: false,
  properties: {
    events: {
      type: 'array',
      items: auditEventResponseJsonSchema,
    },
  },
} as const;

export function toAuditListResponse(input: { events: AuditEvent[] }): AuditListResponse {
  return auditListResponseSchema.parse({
    events: input.events.map((event) => ({
      id: event.id,
      actor: event.actor,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      ...(event.meta !== null ? { meta: event.meta } : {}),
      ts: event.ts.toISOString(),
    })),
  });
}
