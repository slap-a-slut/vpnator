import { PrismaClient } from '@prisma/client';
import pino from 'pino';

import { buildApp } from './app';
import { env } from './lib/env';
import { loggerOptions } from './lib/logger';
import { createJobsRegistry } from './modules/jobs';

async function runApi() {
  const app = await buildApp({ runJobWorker: false });

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

function runWorker() {
  const logger = pino(loggerOptions);
  const prisma = new PrismaClient({
    datasources: {
      db: { url: env.DATABASE_URL },
    },
  });

  const jobsRegistry = createJobsRegistry({
    prisma,
    logger,
    runWorker: true,
  });

  logger.info({ role: env.ROLE }, 'Worker started');

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Worker shutdown started');
    await jobsRegistry.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

async function main() {
  if (env.ROLE === 'worker') {
    runWorker();
    return;
  }

  await runApi();
}

void main();
