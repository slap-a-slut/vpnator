import type { FastifyInstance } from 'fastify';

export * from './secret.dto';
export * from './secret.repository';
export * from './provision.http';
export * from './provision.service';
export * from './install.service';
export * from './installLog.store';
export * from './logSanitizer';
export * from './observability.service';
export * from './repair.service';
export * from './xray.template';

export function provisionModule(_app: FastifyInstance) {
  void _app;
}
