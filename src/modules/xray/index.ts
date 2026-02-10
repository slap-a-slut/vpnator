import type { FastifyInstance } from 'fastify';

export * from './clientStore';
export * from './clientStore.factory';
export * from './fileConfigStore';
export * from './xray.constants';
export * from './xrayInstance.dto';
export * from './xrayInstance.repository';
export * from './xrayGrpcApiStore';

export function xrayModule(_app: FastifyInstance) {
  // TODO: add XRAY management routes/services
}
