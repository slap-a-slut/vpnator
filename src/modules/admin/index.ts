import type { FastifyInstance } from 'fastify';

import { errorResponseSchema } from '../../lib/errors';
import {
  adminExportResponseJsonSchema,
  toAdminExportResponse,
} from './adminExport.http';
import { AdminExportService } from './adminExport.service';

export * from './adminExport.http';
export * from './adminExport.service';

export function adminModule(app: FastifyInstance) {
  const adminExportService = new AdminExportService(app.prisma);

  app.get(
    '/export',
    {
      schema: {
        tags: ['admin'],
        summary: 'Export control-plane data snapshot',
        response: {
          200: adminExportResponseJsonSchema,
          500: errorResponseSchema,
        },
      },
    },
    async () => {
      const payload = await adminExportService.buildExportPayload();
      return toAdminExportResponse(payload);
    },
  );
}
