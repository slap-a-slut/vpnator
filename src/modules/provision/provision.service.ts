import { Client } from 'ssh2';
import { SecretType } from '@prisma/client';
import type { ConnectConfig } from 'ssh2';

import { decryptSecret } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import type { SecretRepository } from './secret.repository';
import type { ServerRepository } from '../servers/server.repository';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const DEFAULT_NETWORK_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

interface SshError extends Error {
  code?: string;
  level?: string;
}

export interface SshExecStream {
  on(event: 'data', listener: (data: Buffer | string) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;
  stderr: {
    on(event: 'data', listener: (data: Buffer | string) => void): unknown;
  };
}

export interface SshClientLike {
  on(event: 'ready', listener: () => void): this;
  on(event: 'error', listener: (error: SshError) => void): this;
  connect(config: ConnectConfig): this;
  exec(command: string, callback: (error: SshError | undefined, stream: SshExecStream) => void): void;
  end(): void;
}

export interface ProvisionLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn?: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface ProvisionCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunCommandOptions {
  logLabel?: string;
  isCancelled?: () => Promise<boolean>;
}

interface ProvisionServiceOptions {
  serverRepository: ServerRepository;
  secretRepository: SecretRepository;
  logger: ProvisionLogger;
  createSshClient?: () => SshClientLike;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  networkRetryDelaysMs?: number[];
}

export class ProvisionService {
  private readonly createSshClient: () => SshClientLike;
  private readonly connectTimeoutMs: number;
  private readonly commandTimeoutMs: number;
  private readonly networkRetryDelaysMs: number[];

  public constructor(private readonly options: ProvisionServiceOptions) {
    this.createSshClient = options.createSshClient ?? (() => new Client());
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.networkRetryDelaysMs = options.networkRetryDelaysMs ?? [...DEFAULT_NETWORK_RETRY_DELAYS_MS];
  }

  public async testConnection(serverId: string): Promise<{ ok: true }> {
    const first = await this.runCommand(serverId, 'uname -a');
    this.assertCommandSuccess('uname -a', first);

    const second = await this.runCommand(serverId, 'id');
    this.assertCommandSuccess('id', second);

    return { ok: true };
  }

  public async runCommand(
    serverId: string,
    command: string,
    options: RunCommandOptions = {},
  ): Promise<ProvisionCommandResult> {
    const logCommand = options.logLabel ?? command;
    this.options.logger.info(
      {
        serverId,
        command: logCommand,
      },
      'Executing SSH command',
    );

    const connectConfig = await this.getConnectConfig(serverId);

    for (let attempt = 0; ; attempt += 1) {
      await this.throwIfCancelled(options.isCancelled);

      try {
        return await this.executeSshCommand(connectConfig, command);
      } catch (error) {
        const appError = this.toAppError(error);
        if (!this.isRetryableNetworkError(appError)) {
          throw appError;
        }

        const delayMs = this.networkRetryDelaysMs[attempt];
        if (delayMs === undefined) {
          throw appError;
        }

        const retryLogger = this.options.logger.warn ?? this.options.logger.info;
        retryLogger(
          {
            serverId,
            command: logCommand,
            code: appError.code,
            attempt: attempt + 1,
            retryInMs: delayMs,
          },
          'SSH command failed, retrying',
        );

        await this.waitBeforeRetry(delayMs, options.isCancelled);
      }
    }
  }

  private async getConnectConfig(serverId: string): Promise<ConnectConfig> {
    const server = await this.options.serverRepository.findById(serverId);
    if (!server) {
      throw new AppError({
        code: 'SERVER_NOT_FOUND',
        statusCode: 404,
        message: 'Server not found',
        details: { serverId },
      });
    }

    const secret = await this.options.secretRepository.findById(server.sshSecretId);
    if (!secret) {
      throw new AppError({
        code: 'SECRET_NOT_FOUND',
        statusCode: 404,
        message: 'SSH secret not found',
        details: { secretId: server.sshSecretId },
      });
    }

    let decryptedSecret: string;
    try {
      decryptedSecret = decryptSecret(secret.ciphertext);
    } catch {
      throw new AppError({
        code: 'SECRET_DECRYPT_FAILED',
        statusCode: 500,
        message: 'Failed to decrypt SSH secret',
      });
    }

    if (secret.type === SecretType.SSH_PASSWORD) {
      return {
        host: server.host,
        username: server.sshUser,
        password: decryptedSecret,
        readyTimeout: this.connectTimeoutMs,
      };
    }

    if (secret.type === SecretType.SSH_KEY) {
      return {
        host: server.host,
        username: server.sshUser,
        privateKey: decryptedSecret,
        readyTimeout: this.connectTimeoutMs,
      };
    }

    throw new AppError({
      code: 'AUTH_FAILED',
      statusCode: 502,
      message: 'Unsupported SSH auth type',
    });
  }

  private executeSshCommand(connectConfig: ConnectConfig, command: string): Promise<ProvisionCommandResult> {
    return new Promise((resolve, reject) => {
      const sshClient = this.createSshClient();
      let settled = false;
      let connectTimer: NodeJS.Timeout | undefined;
      let commandTimer: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (connectTimer) clearTimeout(connectTimer);
        if (commandTimer) clearTimeout(commandTimer);
      };

      const fail = (error: AppError) => {
        if (settled) return;
        settled = true;
        cleanup();
        sshClient.end();
        reject(error);
      };

      const success = (result: ProvisionCommandResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        sshClient.end();
        resolve(result);
      };

      connectTimer = setTimeout(() => {
        fail(
          new AppError({
            code: 'TIMEOUT',
            statusCode: 504,
            message: 'SSH connection timeout',
          }),
        );
      }, this.connectTimeoutMs);

      sshClient.on('error', (error) => {
        fail(this.mapSshError(error));
      });

      sshClient.on('ready', () => {
        if (connectTimer) clearTimeout(connectTimer);

        sshClient.exec(command, (execError, stream) => {
          if (execError) {
            fail(this.mapSshError(execError));
            return;
          }

          let stdout = '';
          let stderr = '';

          commandTimer = setTimeout(() => {
            fail(
              new AppError({
                code: 'TIMEOUT',
                statusCode: 504,
                message: 'SSH command timeout',
                details: { command },
              }),
            );
          }, this.commandTimeoutMs);

          stream.on('data', (chunk) => {
            stdout += this.toUtf8(chunk);
          });

          stream.stderr.on('data', (chunk) => {
            stderr += this.toUtf8(chunk);
          });

          stream.on('close', (code) => {
            success({
              stdout,
              stderr,
              exitCode: code ?? -1,
            });
          });
        });
      });

      sshClient.connect(connectConfig);
    });
  }

  private isRetryableNetworkError(error: AppError): boolean {
    if (error.code === 'AUTH_FAILED') return false;
    return error.code === 'HOST_UNREACHABLE' || error.code === 'TIMEOUT';
  }

  private toAppError(error: unknown): AppError {
    if (error instanceof AppError) return error;

    if (error instanceof Error) {
      return new AppError({
        code: 'COMMAND_FAILED',
        statusCode: 502,
        message: error.message,
      });
    }

    return new AppError({
      code: 'COMMAND_FAILED',
      statusCode: 502,
      message: 'SSH command execution failed',
    });
  }

  private async waitBeforeRetry(
    delayMs: number,
    isCancelled?: () => Promise<boolean>,
  ): Promise<void> {
    await this.throwIfCancelled(isCancelled);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });

    await this.throwIfCancelled(isCancelled);
  }

  private async throwIfCancelled(
    isCancelled?: () => Promise<boolean>,
  ): Promise<void> {
    if (!isCancelled) return;
    const cancelled = await isCancelled();
    if (!cancelled) return;

    throw new AppError({
      code: 'JOB_CANCELLED',
      statusCode: 409,
      message: 'Job cancelled',
    });
  }

  private assertCommandSuccess(command: string, result: ProvisionCommandResult) {
    if (result.exitCode !== 0) {
      throw new AppError({
        code: 'COMMAND_FAILED',
        statusCode: 502,
        message: 'SSH command failed',
        details: {
          command,
          exitCode: result.exitCode,
          stderr: result.stderr,
        },
      });
    }
  }

  private mapSshError(error: SshError): AppError {
    const message = error.message ?? 'SSH error';
    const normalizedMessage = message.toLowerCase();
    const normalizedCode = error.code?.toUpperCase();
    const normalizedLevel = error.level?.toLowerCase();

    if (
      normalizedLevel?.includes('authentication') ||
      normalizedMessage.includes('authentication') ||
      normalizedMessage.includes('all configured authentication methods failed')
    ) {
      return new AppError({
        code: 'AUTH_FAILED',
        statusCode: 502,
        message: 'SSH authentication failed',
      });
    }

    if (normalizedCode === 'ETIMEDOUT' || normalizedMessage.includes('timed out')) {
      return new AppError({
        code: 'TIMEOUT',
        statusCode: 504,
        message: 'SSH operation timeout',
      });
    }

    if (
      normalizedCode === 'ENOTFOUND' ||
      normalizedCode === 'EHOSTUNREACH' ||
      normalizedCode === 'ECONNREFUSED' ||
      normalizedCode === 'ECONNRESET'
    ) {
      return new AppError({
        code: 'HOST_UNREACHABLE',
        statusCode: 502,
        message: 'SSH host is unreachable',
      });
    }

    return new AppError({
      code: 'COMMAND_FAILED',
      statusCode: 502,
      message: 'SSH command execution failed',
      details: { reason: message },
    });
  }

  private toUtf8(chunk: Buffer | string): string {
    if (typeof chunk === 'string') return chunk;
    return chunk.toString('utf8');
  }
}
