import { ServerStatus, SecretType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';

import type { ProvisionCommandResult, ProvisionLogger, RunCommandOptions } from '../src/modules/provision';
import { RepairService, SecretRepository } from '../src/modules/provision';
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

async function createServerContext(params: {
  status?: ServerStatus;
  withXrayInstance?: boolean;
} = {}) {
  const status = params.status ?? ServerStatus.NEW;
  const withXrayInstance = params.withXrayInstance ?? true;

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
    host: 'repair.example.com',
    sshUser: 'root',
    sshSecretId: secret.id,
    status,
  });

  await userRepository.create({
    serverId: server.id,
    name: 'Repair User',
    uuid: '2e43f2ae-c925-4fba-ad3f-46d21385b4d5',
    enabled: true,
  });

  if (withXrayInstance) {
    await xrayInstanceRepository.create({
      serverId: server.id,
      listenPort: 443,
      realityPrivateKey: 'private-key',
      realityPublicKey: 'public-key',
      serverName: 'sni.repair.example.com',
      dest: 'example.com:443',
      fingerprint: 'chrome',
      shortIds: ['deadbeef'],
    });
  }

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

function ok(stdout = '', stderr = ''): Promise<ProvisionCommandResult> {
  return Promise.resolve({
    stdout,
    stderr,
    exitCode: 0,
  });
}

describe('RepairService', () => {
  it('builds actions plan and repairs runtime', async () => {
    const context = await createServerContext({ status: ServerStatus.NEW, withXrayInstance: true });
    const executor = createCommandExecutor(({ options }) => {
      const label = options?.logLabel;

      if (label === 'Repair: detect OS') return ok('ubuntu');
      if (label === 'Repair: check Docker and Compose') return ok('NO');
      if (label === 'Repair: read docker-compose hash') return ok('MISSING');
      if (label === 'Repair: read config hash') return ok('MISSING');
      if (label === 'Repair: check xray container running') return ok('NO');
      if (label === 'Repair: check port listening') return ok('NO');
      if (label === 'Repair: verify port listening') return ok('YES');
      if (label === 'Repair: probe external reachability') return ok('SKIP');

      return ok();
    });

    const service = new RepairService({
      ...context.repositories,
      commandExecutor: executor,
      logger,
      dryRun: false,
    });

    const result = await service.repairServer(context.server.id);

    expect(result).toEqual({
      actions: [
        'Install Docker and Compose plugin',
        'Recreate docker-compose.yml',
        'Regenerate config.json to match users',
        'Start xray container',
        'Restart xray container because port is not listening',
        'External reachability probe skipped',
      ],
      statusBefore: ServerStatus.NEW,
      statusAfter: ServerStatus.READY,
    });

    const serverRow = context.data.servers.get(context.server.id);
    expect(serverRow?.status).toBe(ServerStatus.READY);
    expect(serverRow?.lastError).toBeNull();
    expect(executor.calls.length).toBeGreaterThan(0);
  });

  it('supports dry-run without executing SSH', async () => {
    const context = await createServerContext({ status: ServerStatus.ERROR, withXrayInstance: false });
    const executor = createCommandExecutor(() => {
      throw new Error('SSH should not be called in dry-run');
    });

    const service = new RepairService({
      ...context.repositories,
      commandExecutor: executor,
      logger,
      dryRun: true,
    });

    const result = await service.repairServer(context.server.id);

    expect(result.statusBefore).toBe(ServerStatus.ERROR);
    expect(result.statusAfter).toBe(ServerStatus.READY);
    expect(result.actions).toContain('Install Docker and Compose plugin');
    expect(executor.calls).toHaveLength(0);
  });

  it('marks server ERROR when repair fails', async () => {
    const context = await createServerContext({ status: ServerStatus.READY, withXrayInstance: true });
    const executor = createCommandExecutor(({ options }) => {
      const label = options?.logLabel;

      if (label === 'Repair: detect OS') return ok('ubuntu');
      if (label === 'Repair: check Docker and Compose') return ok('YES');
      if (label === 'Repair: read docker-compose hash') return ok('MISSING');
      if (label === 'Repair: read config hash') return ok('MISSING');
      if (label === 'Repair: check xray container running') return ok('YES');
      if (label === 'Repair: check port listening') return ok('NO');
      if (label === 'Repair: verify port listening') return ok('NO');

      return ok();
    });

    const service = new RepairService({
      ...context.repositories,
      commandExecutor: executor,
      logger,
      dryRun: false,
    });

    await expect(service.repairServer(context.server.id)).rejects.toMatchObject({
      code: 'REPAIR_FAILED',
    });

    const serverRow = context.data.servers.get(context.server.id);
    expect(serverRow?.status).toBe(ServerStatus.ERROR);
    expect(serverRow?.lastError).toBe('XRAY port is not listening after repair');
  });
});
