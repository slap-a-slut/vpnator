import type { FastifyInstance } from 'fastify';

import { adminModule } from './admin';
import { auditModule } from './audit';
import { jobsModule } from './jobs';
import { serversModule } from './servers';
import { provisionModule } from './provision';
import { shareModule } from './share';
import { usersModule } from './users';
import { xrayModule } from './xray';

export async function registerModules(app: FastifyInstance) {
  await app.register(adminModule, { prefix: '/admin' });
  await app.register(auditModule, { prefix: '/audit' });
  await app.register(shareModule);
  await app.register(jobsModule, { prefix: '/jobs' });
  await app.register(usersModule, { prefix: '/users' });
  await app.register(serversModule, { prefix: '/servers' });
  await app.register(provisionModule, { prefix: '/provision' });
  await app.register(xrayModule, { prefix: '/xray' });
}
