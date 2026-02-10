import type { FastifyBaseLogger } from 'fastify';
import type { LoggerOptions } from 'pino';

import { env } from './env';

export const loggerOptions: LoggerOptions & { level: string } = {
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'request.headers.authorization',
      'headers.authorization',
      'req.body.sshAuth.value',
      'req.body.token',
      'req.body.refreshToken',
    ],
    remove: true,
  },
};

export type AppLogger = FastifyBaseLogger;
