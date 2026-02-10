import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';

import { env } from '../lib/env';

export const prisma = new PrismaClient({
  datasources: {
    db: { url: env.DATABASE_URL },
  },
});

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export const prismaPlugin = fp((app) => {
  app.decorate('prisma', prisma);

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});
