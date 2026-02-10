import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface ErrorResponse {
  code: string;
  message: string;
  details?: unknown;
}

export const errorResponseSchema = {
  type: 'object',
  required: ['code', 'message'],
  additionalProperties: false,
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    details: {},
  },
} as const;

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  public constructor(params: {
    code: string;
    message: string;
    statusCode: number;
    details?: unknown;
  }) {
    super(params.message);
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.details = params.details;
  }
}

export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    const body: ErrorResponse = {
      code: 'NOT_FOUND',
      message: 'Route not found',
      details: { method: request.method, url: request.url },
    };

    void reply.status(404).send(body);
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      const body: ErrorResponse = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      void reply.status(error.statusCode).send(body);
      return;
    }

    if (error.validation) {
      const body: ErrorResponse = {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.validation,
      };
      void reply.status(400).send(body);
      return;
    }

    request.log.error({ err: error }, 'Unhandled error');

    const body: ErrorResponse = {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal Server Error',
    };
    void reply.status(500).send(body);
  });
}
