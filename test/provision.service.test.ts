import { EventEmitter } from 'node:events';

import { SecretType, ServerStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '@prisma/client';
import type { ConnectConfig } from 'ssh2';

import { encryptSecret } from '../src/lib/crypto';
import type { AppError } from '../src/lib/errors';
import { SecretRepository } from '../src/modules/provision/secret.repository';
import {
  type ProvisionLogger,
  ProvisionService,
  type SshClientLike,
  type SshExecStream,
} from '../src/modules/provision/provision.service';
import { ServerRepository } from '../src/modules/servers/server.repository';
import { createFakePrisma } from './fakePrisma';

interface MockSshError extends Error {
  code?: string;
  level?: string;
}

interface MockSshScenario {
  connectError?: MockSshError;
  skipReady?: boolean;
  execError?: MockSshError;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  hangCommand?: boolean;
  expectedCommand?: string;
}

class MockSshStream extends EventEmitter implements SshExecStream {
  public readonly stderr = new EventEmitter();
}

class MockSshClient extends EventEmitter implements SshClientLike {
  public constructor(
    private readonly scenario: MockSshScenario,
    private readonly captureConfig: (config: ConnectConfig) => void,
  ) {
    super();
  }

  public connect(config: ConnectConfig): this {
    this.captureConfig(config);

    if (this.scenario.skipReady) return this;

    queueMicrotask(() => {
      if (this.scenario.connectError) {
        this.emit('error', this.scenario.connectError);
        return;
      }
      this.emit('ready');
    });

    return this;
  }

  public exec(
    command: string,
    callback: (error: MockSshError | undefined, stream: SshExecStream) => void,
  ): void {
    if (this.scenario.expectedCommand && this.scenario.expectedCommand !== command) {
      const mismatch = createMockSshError(`Unexpected command: ${command}`);
      callback(mismatch, new MockSshStream());
      return;
    }

    queueMicrotask(() => {
      if (this.scenario.execError) {
        callback(this.scenario.execError, new MockSshStream());
        return;
      }

      const stream = new MockSshStream();
      callback(undefined, stream);

      if (this.scenario.stdout) {
        stream.emit('data', Buffer.from(this.scenario.stdout, 'utf8'));
      }

      if (this.scenario.stderr) {
        stream.stderr.emit('data', Buffer.from(this.scenario.stderr, 'utf8'));
      }

      if (!this.scenario.hangCommand) {
        stream.emit('close', this.scenario.exitCode ?? 0);
      }
    });
  }

  public end(): void {
    this.emit('end');
  }
}

function createMockSshError(
  message: string,
  params: { code?: string; level?: string } = {},
): MockSshError {
  const error = new Error(message) as MockSshError;
  if (params.code) error.code = params.code;
  if (params.level) error.level = params.level;
  return error;
}

function createMockFactory(scenarios: MockSshScenario[]) {
  const capturedConfigs: ConnectConfig[] = [];

  const factory = () => {
    const scenario = scenarios.shift();
    if (!scenario) throw new Error('No mock ssh scenario available');

    return new MockSshClient(scenario, (config) => {
      capturedConfigs.push(config);
    });
  };

  return { factory, capturedConfigs };
}

async function setupService(params: {
  secretType: SecretType;
  secretValue: string;
  scenarios: MockSshScenario[];
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  networkRetryDelaysMs?: number[];
}) {
  const { prisma } = createFakePrisma();
  const prismaClient = prisma as unknown as PrismaClient;
  const secretRepository = new SecretRepository(prismaClient);
  const serverRepository = new ServerRepository(prismaClient);
  const logger: ProvisionLogger = { info: () => undefined };

  const secret = await secretRepository.create({
    type: params.secretType,
    ciphertext: encryptSecret(params.secretValue),
  });

  const server = await serverRepository.create({
    host: '127.0.0.1',
    sshUser: 'root',
    sshSecretId: secret.id,
    status: ServerStatus.NEW,
  });

  const { factory, capturedConfigs } = createMockFactory(params.scenarios);

  const service = new ProvisionService({
    serverRepository,
    secretRepository,
    logger,
    createSshClient: factory,
    connectTimeoutMs: params.connectTimeoutMs,
    commandTimeoutMs: params.commandTimeoutMs,
    networkRetryDelaysMs: params.networkRetryDelaysMs ?? [],
  });

  return { service, server, capturedConfigs };
}

function getErrorCode(error: unknown): string | undefined {
  const typed = error as AppError | undefined;
  return typed?.code;
}

describe('ProvisionService', () => {
  it('runs command with password auth', async () => {
    const { service, server, capturedConfigs } = await setupService({
      secretType: SecretType.SSH_PASSWORD,
      secretValue: 'password-123',
      scenarios: [{ stdout: 'ok', stderr: '', exitCode: 0 }],
    });

    const result = await service.runCommand(server.id, 'echo ok');

    expect(result).toEqual({ stdout: 'ok', stderr: '', exitCode: 0 });
    expect(capturedConfigs).toHaveLength(1);
    expect(capturedConfigs[0]?.password).toBe('password-123');
    expect(capturedConfigs[0]?.privateKey).toBeUndefined();
  });

  it('runs command with private key auth', async () => {
    const privateKey = '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----';
    const { service, server, capturedConfigs } = await setupService({
      secretType: SecretType.SSH_KEY,
      secretValue: privateKey,
      scenarios: [{ stdout: 'whoami', stderr: '', exitCode: 0 }],
    });

    const result = await service.runCommand(server.id, 'whoami');

    expect(result.exitCode).toBe(0);
    expect(capturedConfigs).toHaveLength(1);
    expect(capturedConfigs[0]?.privateKey).toBe(privateKey);
    expect(capturedConfigs[0]?.password).toBeUndefined();
  });

  it('testConnection runs uname and id', async () => {
    const { service, server } = await setupService({
      secretType: SecretType.SSH_PASSWORD,
      secretValue: 'pw',
      scenarios: [
        { expectedCommand: 'uname -a', stdout: 'Linux host', exitCode: 0 },
        { expectedCommand: 'id', stdout: 'uid=0(root)', exitCode: 0 },
      ],
    });

    const result = await service.testConnection(server.id);
    expect(result).toEqual({ ok: true });
  });

  it('maps auth failure to AUTH_FAILED', async () => {
    const { service, server } = await setupService({
      secretType: SecretType.SSH_PASSWORD,
      secretValue: 'pw',
      scenarios: [
        {
          connectError: createMockSshError('All configured authentication methods failed', {
            level: 'client-authentication',
          }),
        },
      ],
    });

    await expect(service.runCommand(server.id, 'id')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('maps host unreachable to HOST_UNREACHABLE', async () => {
    const { service, server } = await setupService({
      secretType: SecretType.SSH_PASSWORD,
      secretValue: 'pw',
      scenarios: [
        {
          connectError: createMockSshError('getaddrinfo ENOTFOUND', { code: 'ENOTFOUND' }),
        },
      ],
    });

    await expect(service.runCommand(server.id, 'id')).rejects.toMatchObject({
      code: 'HOST_UNREACHABLE',
    });
  });

  it('maps command timeout to TIMEOUT', async () => {
    const { service, server } = await setupService({
      secretType: SecretType.SSH_PASSWORD,
      secretValue: 'pw',
      scenarios: [{ hangCommand: true }],
      commandTimeoutMs: 20,
    });

    await expect(service.runCommand(server.id, 'sleep 120')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('maps non-zero command in testConnection to COMMAND_FAILED', async () => {
    const { service, server } = await setupService({
      secretType: SecretType.SSH_PASSWORD,
      secretValue: 'pw',
      scenarios: [{ expectedCommand: 'uname -a', stderr: 'failed', exitCode: 1 }],
    });

    await expect(service.testConnection(server.id)).rejects.toMatchObject({ code: 'COMMAND_FAILED' });
  });

  it('maps connect timeout to TIMEOUT', async () => {
    const { service, server } = await setupService({
      secretType: SecretType.SSH_PASSWORD,
      secretValue: 'pw',
      scenarios: [{ skipReady: true }],
      connectTimeoutMs: 20,
    });

    await expect(service.runCommand(server.id, 'id')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('maps unknown ssh error to COMMAND_FAILED', async () => {
    const { service, server } = await setupService({
      secretType: SecretType.SSH_PASSWORD,
      secretValue: 'pw',
      scenarios: [{ execError: createMockSshError('Unexpected failure') }],
    });

    try {
      await service.runCommand(server.id, 'id');
    } catch (error) {
      expect(getErrorCode(error)).toBe('COMMAND_FAILED');
      return;
    }

    throw new Error('Expected COMMAND_FAILED error');
  });

  it('retries network errors with backoff and succeeds', async () => {
    const { service, server, capturedConfigs } = await setupService({
      secretType: SecretType.SSH_PASSWORD,
      secretValue: 'pw',
      scenarios: [
        { connectError: createMockSshError('getaddrinfo ENOTFOUND', { code: 'ENOTFOUND' }) },
        { connectError: createMockSshError('connect ETIMEDOUT', { code: 'ETIMEDOUT' }) },
        { stdout: 'ok', stderr: '', exitCode: 0 },
      ],
      networkRetryDelaysMs: [1, 1, 1],
    });

    const result = await service.runCommand(server.id, 'echo ok');
    expect(result).toEqual({ stdout: 'ok', stderr: '', exitCode: 0 });
    expect(capturedConfigs).toHaveLength(3);
  });

  it('does not retry AUTH_FAILED errors', async () => {
    const { service, server, capturedConfigs } = await setupService({
      secretType: SecretType.SSH_PASSWORD,
      secretValue: 'pw',
      scenarios: [
        {
          connectError: createMockSshError('All configured authentication methods failed', {
            level: 'client-authentication',
          }),
        },
      ],
      networkRetryDelaysMs: [1, 1, 1],
    });

    await expect(service.runCommand(server.id, 'id')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(capturedConfigs).toHaveLength(1);
  });
});
