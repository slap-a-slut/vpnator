import type { FastifyRequest } from 'fastify';

import { AppError } from '../../lib/errors';

export function getActorIdFromRequest(request: FastifyRequest): string {
  if (!request.actorId) {
    throw new AppError({
      code: 'UNAUTHORIZED',
      statusCode: 401,
      message: 'Missing request actor',
      details: {
        method: request.method,
        route: request.url,
      },
    });
  }

  return request.actorId;
}
