import { ServerStatus, SecretType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { ProvisionCommandResult, ProvisionLogger, RunCommandOptions } from '../src/modules/provision';
import { InstallService, SecretRepository } from '../src/modules/provision';
import { ServerRepository } from '../src/modules/servers';
import { UserRepository } from '../src/modules/users';
import { XrayInstanceRepository } from '../src/modules/xray';
import { createFakePrisma } from './fakePrisma';

function createCommandExecutor(
  handler: (args: {
    serverId: string;
    command: string;
    options?: RunCommandOptions;
  }) => Promise<ProvisionCommandResult>,
) {
  const calls: { serverId: string; command: string; options?: RunCommandOptions }[] = [];

  return {
    calls,
    runCommand: async (serverId: string, command: string, options?: RunCommandOptions) => {
      const call = { serverId, command, options };
      calls.push(call);
      return handler(call);
    },
  };
}

const logger: ProvisionLogger = {
  info: () => undefined,
};

async function createServerContext() {
  const { prisma, data } = createFakePrisma();
  const prismaClient = prisma as unknown as PrismaClient;
  const secretRepository = new SecretRepository(prismaClient);
  const serverRepository = new ServerRepository(prismaClient);
  const userRepository = new UserRepository(prismaClient);
  const xrayInstanceRepository = new XrayInstanceRepository(prismaClient);

  const secret = await secretRepository.create({
    type: SecretType.SSH_PASSWORD,
    ciphertext: 'ciphertext',
  });

  const server = await serverRepository.create({
    host: 'install.example.com',
    sshUser: 'root',
    sshSecretId: secret.id,
    status: ServerStatus.NEW,
  });

  await userRepository.create({
    serverId: server.id,
    name: 'Alice',
    uuid: 'e7f8e06d-2942-4cb9-bca5-6d511244f6d7',
    enabled: true,
  });

  return {
    data,
    server,
    repositories: {
      serverRepository,
      userRepository,
      xrayInstanceRepository,
    },
  };
}

describe('InstallService', () => {
  it('installs in dry-run mode and remains idempotent', async () => {
    const context = await createServerContext();
    const executor = createCommandExecutor(() =>
      Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
      }),
    );

    const service = new InstallService({
      ...context.repositories,
      commandExecutor: executor,
      logger,
      dryRun: true,
    });

    const first = await service.installServer(context.server.id);
    const second = await service.installServer(context.server.id);

    expect(executor.calls).toHaveLength(0);
    expect(first.status).toBe(ServerStatus.READY);
    expect(second.status).toBe(ServerStatus.READY);
    expect(first.xrayInstance?.id).toBeDefined();
    expect(second.xrayInstance?.id).toBe(first.xrayInstance?.id);
    expect(second.xrayInstance?.realityPublicKey).toBe(first.xrayInstance?.realityPublicKey);
    expect(context.data.xrayInstances.size).toBe(1);
  });

  it('sets server status to ERROR on command failure', async () => {
    const context = await createServerContext();
    const executor = createCommandExecutor(({ options }) => {
      if (options?.logLabel === 'Detect OS') {
        return Promise.resolve({
          stdout: 'ubuntu',
          stderr: '',
          exitCode: 0,
        });
      }

      if (options?.logLabel === 'Install Docker and Compose plugin') {
        return Promise.resolve({
          stdout: '',
          stderr: 'apt failed',
          exitCode: 1,
        });
      }

      return Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    });

    const service = new InstallService({
      ...context.repositories,
      commandExecutor: executor,
      logger,
      dryRun: false,
    });

    await expect(service.installServer(context.server.id)).rejects.toMatchObject({
      code: 'COMMAND_FAILED',
    });

    const serverRow = context.data.servers.get(context.server.id);
    expect(serverRow?.status).toBe(ServerStatus.ERROR);
    expect(serverRow?.lastError).toBe('SSH command failed');
  });

  it('returns current server status with xray meta', async () => {
    const context = await createServerContext();
    const executor = createCommandExecutor(() =>
      Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
      }),
    );

    const service = new InstallService({
      ...context.repositories,
      commandExecutor: executor,
      logger,
      dryRun: true,
    });

    await service.installServer(context.server.id);
    const status = await service.getServerStatus(context.server.id);

    expect(status.status).toBe(ServerStatus.READY);
    expect(status.lastError).toBeNull();
    expect(status.xrayInstance?.serverId).toBe(context.server.id);
  });
});
