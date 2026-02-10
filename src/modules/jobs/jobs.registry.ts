import type { PrismaClient } from '@prisma/client';

import { env } from '../../lib/env';
import type { ProvisionLogger } from '../provision/provision.service';
import { DefaultServerJobProcessor } from './job.processor';
import type { JobsRegistry } from './job.types';
import { BullMqJobsRegistry } from './jobs.registry.bullmq';
import { InMemoryJobsRegistry } from './jobs.registry.memory';

interface CreateJobsRegistryOptions {
  prisma: PrismaClient;
  logger: ProvisionLogger;
  runWorker?: boolean;
}

export function createJobsRegistry(options: CreateJobsRegistryOptions): JobsRegistry {
  const processor = new DefaultServerJobProcessor({
    prisma: options.prisma,
    logger: options.logger,
  });

  if (env.NODE_ENV === 'test') {
    return new InMemoryJobsRegistry({
      processor,
    });
  }

  return new BullMqJobsRegistry({
    prisma: options.prisma,
    logger: options.logger,
    processor,
    ...(options.runWorker !== undefined ? { runWorker: options.runWorker } : {}),
  });
}
