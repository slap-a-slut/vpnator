import { SecretType, ServerStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type {
  ProvisionCommandResult,
  ProvisionLogger,
  RunCommandOptions,
} from '../src/modules/provision';
import { SecretRepository } from '../src/modules/provision';
import { ServerRepository } from '../src/modules/servers';
import { UserRepository } from '../src/modules/users';
import {
  XrayGrpcApiStore,
  XrayInstanceRepository,
  type XrayClientStore,
} from '../src/modules/xray';
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

function ok(stdout = '', stderr = ''): Promise<ProvisionCommandResult> {
  return Promise.resolve({
    stdout,
    stderr,
    exitCode: 0,
  });
}

async function createReadyContext() {
  const { prisma } = createFakePrisma();
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
    host: 'grpc-store.example.com',
    sshUser: 'root',
    sshSecretId: secret.id,
    status: ServerStatus.READY,
  });

  await xrayInstanceRepository.create({
    serverId: server.id,
    listenPort: 443,
    realityPrivateKey: 'private-key',
    realityPublicKey: 'public-key',
    serverName: server.host,
    dest: 'example.com:443',
    shortIds: ['deadbeef'],
  });

  return {
    server,
    repositories: {
      serverRepository,
      userRepository,
      xrayInstanceRepository,
    },
  };
}

describe('XrayGrpcApiStore', () => {
  it('adds user via gRPC when API is healthy', async () => {
    const context = await createReadyContext();
    const fallbackAdd = vi.fn(() => Promise.resolve());
    const fallbackStore: XrayClientStore = {
      sync: vi.fn(() => Promise.resolve()),
      addUser: fallbackAdd,
      removeUser: vi.fn(() => Promise.resolve()),
    };

    const executor = createCommandExecutor(({ options }) => {
      if (options?.logLabel === 'Xray gRPC: health check') return ok('{"count": 0}');
      if (options?.logLabel === 'Xray gRPC: add user') return ok();
      throw new Error(`Unexpected command label: ${options?.logLabel}`);
    });

    const logger: ProvisionLogger = { info: () => undefined };
    const store = new XrayGrpcApiStore({
      ...context.repositories,
      commandExecutor: executor,
      fallbackStore,
      logger,
      dryRun: false,
    });

    await store.addUser(context.server.id, '95b8f2bd-99df-4a7d-b523-18199e87f8cb');

    expect(executor.calls.map((call) => call.options?.logLabel)).toEqual([
      'Xray gRPC: health check',
      'Xray gRPC: add user',
    ]);
    expect(fallbackAdd).not.toHaveBeenCalled();
  });

  it('falls back to file store when gRPC API is unavailable', async () => {
    const context = await createReadyContext();
    const fallbackAdd = vi.fn(() => Promise.resolve());
    const warn = vi.fn();
    const fallbackStore: XrayClientStore = {
      sync: vi.fn(() => Promise.resolve()),
      addUser: fallbackAdd,
      removeUser: vi.fn(() => Promise.resolve()),
    };

    const executor = createCommandExecutor(({ options }) => {
      if (options?.logLabel === 'Xray gRPC: health check') {
        return Promise.resolve({
          stdout: '',
          stderr: 'failed to dial 127.0.0.1:10085',
          exitCode: 1,
        });
      }

      throw new Error(`Unexpected command label: ${options?.logLabel}`);
    });

    const logger: ProvisionLogger = { info: () => undefined, warn };
    const store = new XrayGrpcApiStore({
      ...context.repositories,
      commandExecutor: executor,
      fallbackStore,
      logger,
      dryRun: false,
    });

    await store.addUser(context.server.id, 'ecbf2584-8ab8-40a6-a5e8-a3347659d284');

    expect(fallbackAdd).toHaveBeenCalledTimes(1);
    expect(fallbackAdd).toHaveBeenCalledWith(
      context.server.id,
      'ecbf2584-8ab8-40a6-a5e8-a3347659d284',
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('syncs users via gRPC add/remove without restart', async () => {
    const context = await createReadyContext();
    const fallbackSync = vi.fn(() => Promise.resolve());
    const fallbackStore: XrayClientStore = {
      sync: fallbackSync,
      addUser: vi.fn(() => Promise.resolve()),
      removeUser: vi.fn(() => Promise.resolve()),
    };

    await context.repositories.userRepository.create({
      serverId: context.server.id,
      uuid: 'f8e25a5e-bf5d-46a7-8f3a-f090d4588eca',
      enabled: true,
    });
    await context.repositories.userRepository.create({
      serverId: context.server.id,
      uuid: '7d953f41-a65d-49df-82a6-a4fa1f0e2970',
      enabled: true,
    });
    await context.repositories.userRepository.create({
      serverId: context.server.id,
      uuid: '112f0c97-0573-4bac-b8ff-2504fd9005af',
      enabled: false,
    });

    const executor = createCommandExecutor(({ options }) => {
      if (options?.logLabel === 'Xray gRPC: health check') return ok('{"count": 2}');
      if (options?.logLabel === 'Xray gRPC: list inbound users') {
        return ok(
          JSON.stringify({
            users: [
              { email: 'f8e25a5e-bf5d-46a7-8f3a-f090d4588eca' },
              { email: '18d903a4-8db8-43c8-9731-89f9b9f29e45' },
            ],
          }),
        );
      }
      if (options?.logLabel === 'Xray gRPC: add user') return ok();
      if (options?.logLabel === 'Xray gRPC: remove user') return ok();

      throw new Error(`Unexpected command label: ${options?.logLabel}`);
    });

    const logger: ProvisionLogger = { info: () => undefined };
    const store = new XrayGrpcApiStore({
      ...context.repositories,
      commandExecutor: executor,
      fallbackStore,
      logger,
      dryRun: false,
    });

    await store.sync(context.server.id);

    expect(fallbackSync).not.toHaveBeenCalled();
    expect(executor.calls.map((call) => call.options?.logLabel)).toEqual([
      'Xray gRPC: health check',
      'Xray gRPC: list inbound users',
      'Xray gRPC: add user',
      'Xray gRPC: remove user',
    ]);

    const addCall = executor.calls.find((call) => call.options?.logLabel === 'Xray gRPC: add user');
    expect(addCall?.command).toContain('7d953f41-a65d-49df-82a6-a4fa1f0e2970');

    const removeCall = executor.calls.find(
      (call) => call.options?.logLabel === 'Xray gRPC: remove user',
    );
    expect(removeCall?.command).toContain('18d903a4-8db8-43c8-9731-89f9b9f29e45');
  });
});
