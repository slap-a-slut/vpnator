import type { FastifyInstance } from 'fastify';

import { errorResponseSchema } from '../../lib/errors';
import { parseOrThrow } from '../../lib/validation';
import {
  auditListQueryJsonSchema,
  auditListQuerySchema,
  auditListResponseJsonSchema,
  toAuditListResponse,
} from './audit.http';
import { AuditEventRepository } from './audit.repository';

export * from './audit.http';
export * from './audit.repository';
export * from './audit.actor';

export function auditModule(app: FastifyInstance) {
  const auditEventRepository = new AuditEventRepository(app.prisma);

  app.get(
    '/',
    {
      schema: {
        tags: ['audit'],
        summary: 'List audit events',
        querystring: auditListQueryJsonSchema,
        response: {
          200: auditListResponseJsonSchema,
          400: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const query = parseOrThrow(auditListQuerySchema, request.query);
      const events = await auditEventRepository.findRecent(
        query.entityId
          ? {
              entityId: query.entityId,
              limit: query.limit,
            }
          : {
              limit: query.limit,
            },
      );

      return toAuditListResponse({ events });
    },
  );
}
