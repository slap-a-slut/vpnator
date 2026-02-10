import type { PrismaClient } from '@prisma/client';

import { env } from '../../lib/env';
import { SecretRepository } from '../provision/secret.repository';
import type { ProvisionLogger } from '../provision/provision.service';
import { ProvisionService } from '../provision/provision.service';
import { ServerRepository } from '../servers/server.repository';
import { UserRepository } from '../users/user.repository';
import type { XrayClientStore } from './clientStore';
import { FileConfigStore } from './fileConfigStore';
import { XrayGrpcApiStore } from './xrayGrpcApiStore';
import { XrayInstanceRepository } from './xrayInstance.repository';

interface CreateXrayClientStoreOptions {
  prisma: PrismaClient;
  logger: ProvisionLogger;
  dryRun?: boolean;
  mode?: 'file' | 'grpc';
}

export function createXrayClientStore(options: CreateXrayClientStoreOptions): XrayClientStore {
  const serverRepository = new ServerRepository(options.prisma);
  const userRepository = new UserRepository(options.prisma);
  const xrayInstanceRepository = new XrayInstanceRepository(options.prisma);
  const secretRepository = new SecretRepository(options.prisma);
  const provisionService = new ProvisionService({
    serverRepository,
    secretRepository,
    logger: options.logger,
  });

  const fileStore = new FileConfigStore({
    serverRepository,
    userRepository,
    xrayInstanceRepository,
    commandExecutor: provisionService,
    logger: options.logger,
    dryRun: options.dryRun ?? env.PROVISION_DRY_RUN,
  });

  const mode = options.mode ?? env.XRAY_STORE_MODE;
  if (mode === 'grpc') {
    return new XrayGrpcApiStore({
      serverRepository,
      userRepository,
      xrayInstanceRepository,
      commandExecutor: provisionService,
      fallbackStore: fileStore,
      logger: options.logger,
      dryRun: options.dryRun ?? env.PROVISION_DRY_RUN,
    });
  }

  return fileStore;
}
