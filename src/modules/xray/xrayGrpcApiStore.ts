import { randomBytes } from 'node:crypto';

import { ServerStatus, type Server } from '@prisma/client';

import { env } from '../../lib/env';
import { AppError } from '../../lib/errors';
import type {
  ProvisionCommandResult,
  ProvisionLogger,
  RunCommandOptions,
} from '../provision/provision.service';
import type { ServerRepository } from '../servers/server.repository';
import type { UserRepository } from '../users/user.repository';
import type { XrayClientStore } from './clientStore';
import {
  XRAY_API_HOST,
  XRAY_API_PORT,
  XRAY_MAIN_INBOUND_TAG,
} from './xray.constants';
import type { XrayInstanceRepository } from './xrayInstance.repository';

interface CommandExecutor {
  runCommand(
    serverId: string,
    command: string,
    options?: RunCommandOptions,
  ): Promise<ProvisionCommandResult>;
}

interface XrayGrpcApiStoreOptions {
  serverRepository: ServerRepository;
  userRepository: UserRepository;
  xrayInstanceRepository: XrayInstanceRepository;
  commandExecutor: CommandExecutor;
  fallbackStore: XrayClientStore;
  logger: ProvisionLogger;
  dryRun: boolean;
  apiHost?: string;
  apiPort?: number;
  inboundTag?: string;
}

type StoreAction = 'sync' | 'addUser' | 'removeUser';

export class XrayGrpcApiStore implements XrayClientStore {
  private readonly dryRun: boolean;
  private readonly apiHost: string;
  private readonly apiPort: number;
  private readonly inboundTag: string;

  public constructor(private readonly options: XrayGrpcApiStoreOptions) {
    this.dryRun = options.dryRun ?? env.PROVISION_DRY_RUN;
    this.apiHost = options.apiHost ?? XRAY_API_HOST;
    this.apiPort = options.apiPort ?? XRAY_API_PORT;
    this.inboundTag = options.inboundTag ?? XRAY_MAIN_INBOUND_TAG;
  }

  public async sync(serverId: string): Promise<void> {
    const server = await this.getServerForStoreOperation(serverId);
    if (!server) return;

    await this.withGrpcFallback(
      serverId,
      'sync',
      () => this.syncViaGrpc(server),
      () => this.options.fallbackStore.sync(serverId),
    );
  }

  public async addUser(serverId: string, userUuid: string): Promise<void> {
    const server = await this.getServerForStoreOperation(serverId);
    if (!server) return;

    await this.withGrpcFallback(
      serverId,
      'addUser',
      () => this.addUserViaGrpc(server, userUuid),
      () => this.options.fallbackStore.addUser(serverId, userUuid),
    );
  }

  public async removeUser(serverId: string, userUuid: string): Promise<void> {
    const server = await this.getServerForStoreOperation(serverId);
    if (!server) return;

    await this.withGrpcFallback(
      serverId,
      'removeUser',
      () => this.removeUserViaGrpc(server, userUuid),
      () => this.options.fallbackStore.removeUser(serverId, userUuid),
    );
  }

  private async syncViaGrpc(server: Server): Promise<void> {
    await this.ensureGrpcHealthy(server);

    const [dbUsers, remoteUsers] = await Promise.all([
      this.options.userRepository.findManyByServerId(server.id),
      this.listInboundUsers(server),
    ]);

    const expectedUsers = new Set(
      dbUsers
        .filter((user) => user.enabled)
        .map((user) => user.uuid)
        .sort((left, right) => left.localeCompare(right)),
    );

    for (const userUuid of expectedUsers) {
      if (remoteUsers.has(userUuid)) continue;
      await this.addUserViaGrpc(server, userUuid, false);
    }

    for (const remoteUser of remoteUsers) {
      if (expectedUsers.has(remoteUser)) continue;
      await this.removeUserViaGrpc(server, remoteUser, false);
    }
  }

  private async addUserViaGrpc(
    server: Server,
    userUuid: string,
    includeHealthCheck = true,
  ): Promise<void> {
    if (includeHealthCheck) {
      await this.ensureGrpcHealthy(server);
    }

    const payload = JSON.stringify(
      {
        inbounds: [
          {
            tag: this.inboundTag,
            protocol: 'vless',
            settings: {
              clients: [
                {
                  id: userUuid,
                  email: userUuid,
                },
              ],
              decryption: 'none',
            },
          },
        ],
      },
      null,
      2,
    );

    const command = this.asRoot(
      server,
      `${this.buildAduScript(payload)}
docker exec xray xray api adu --server=${this.apiServerAddress()} /tmp/xray-adu.json
status=$?
docker exec xray sh -lc 'rm -f /tmp/xray-adu.json' >/dev/null 2>&1 || true
exit $status`,
    );

    await this.executeChecked(server.id, command, 'Xray gRPC: add user');
  }

  private async removeUserViaGrpc(
    server: Server,
    userUuid: string,
    includeHealthCheck = true,
  ): Promise<void> {
    if (includeHealthCheck) {
      await this.ensureGrpcHealthy(server);
    }

    const command = this.asRoot(
      server,
      `docker exec xray xray api rmu --server=${this.apiServerAddress()} -tag=${shellArg(this.inboundTag)} ${shellArg(userUuid)}`,
    );

    await this.executeChecked(server.id, command, 'Xray gRPC: remove user');
  }

  private async ensureGrpcHealthy(server: Server): Promise<void> {
    const command = this.asRoot(
      server,
      `docker exec xray xray api inboundusercount --server=${this.apiServerAddress()} -tag=${shellArg(this.inboundTag)} --json`,
    );

    await this.executeChecked(server.id, command, 'Xray gRPC: health check');
  }

  private async listInboundUsers(server: Server): Promise<Set<string>> {
    const command = this.asRoot(
      server,
      `docker exec xray xray api inbounduser --server=${this.apiServerAddress()} -tag=${shellArg(this.inboundTag)} --json`,
    );

    const result = await this.executeChecked(server.id, command, 'Xray gRPC: list inbound users');
    const parsed = this.parseInboundUsers(result.stdout, result.stderr);
    return new Set(parsed);
  }

  private parseInboundUsers(stdout: string, stderr: string): string[] {
    const candidate = stdout.trim().length > 0 ? stdout.trim() : stderr.trim();

    if (!candidate) return [];

    let data: unknown;
    try {
      data = JSON.parse(candidate);
    } catch {
      throw new AppError({
        code: 'COMMAND_FAILED',
        statusCode: 502,
        message: 'Failed to parse xray inbound users response',
      });
    }

    if (!isRecord(data)) return [];

    const users = data.users;
    if (!Array.isArray(users)) return [];

    return users
      .map((entry) => {
        if (!isRecord(entry)) return null;
        return typeof entry.email === 'string' ? entry.email : null;
      })
      .filter((value): value is string => Boolean(value));
  }

  private async withGrpcFallback(
    serverId: string,
    action: StoreAction,
    grpcOperation: () => Promise<void>,
    fallbackOperation: () => Promise<void>,
  ): Promise<void> {
    try {
      await grpcOperation();
    } catch (error) {
      if (!this.isFallbackCandidate(error)) {
        throw error;
      }

      this.warnOrInfo(
        {
          serverId,
          action,
          reason: error.message,
        },
        'Xray gRPC unavailable. Falling back to file config store',
      );

      await fallbackOperation();
    }
  }

  private isFallbackCandidate(error: unknown): error is AppError {
    if (!(error instanceof AppError)) return false;
    return error.code === 'COMMAND_FAILED';
  }

  private async getServerForStoreOperation(serverId: string): Promise<Server | null> {
    const server = await this.options.serverRepository.findById(serverId);
    if (!server) {
      throw new AppError({
        code: 'SERVER_NOT_FOUND',
        statusCode: 404,
        message: 'Server not found',
        details: { serverId },
      });
    }

    if (server.status !== ServerStatus.READY) {
      this.options.logger.info(
        {
          serverId,
          status: server.status,
        },
        'Xray gRPC store skipped: server not ready',
      );
      return null;
    }

    const xrayInstance = await this.options.xrayInstanceRepository.findLatestByServerId(serverId);
    if (!xrayInstance) {
      this.options.logger.info(
        {
          serverId,
        },
        'Xray gRPC store skipped: xray instance not found',
      );
      return null;
    }

    return server;
  }

  private async executeChecked(
    serverId: string,
    command: string,
    label: string,
  ): Promise<ProvisionCommandResult> {
    const result = await this.execute(serverId, command, label);
    if (result.exitCode === 0) return result;

    const details: Record<string, unknown> = {
      command: label,
      exitCode: result.exitCode,
    };
    const stderr = result.stderr.trim();
    if (stderr.length > 0) details.stderr = stderr.slice(0, 500);

    throw new AppError({
      code: 'COMMAND_FAILED',
      statusCode: 502,
      message: 'Xray gRPC command failed',
      details,
    });
  }

  private async execute(
    serverId: string,
    command: string,
    label: string,
  ): Promise<ProvisionCommandResult> {
    if (this.dryRun) {
      this.options.logger.info(
        {
          serverId,
          command: label,
        },
        'Provision dry-run: skipping Xray gRPC command',
      );

      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
      };
    }

    return this.options.commandExecutor.runCommand(serverId, command, {
      logLabel: label,
    });
  }

  private apiServerAddress(): string {
    return `${this.apiHost}:${this.apiPort}`;
  }

  private buildAduScript(payload: string): string {
    const delimiter = `XRAY_CP_ADU_${randomBytes(4).toString('hex')}`;
    const normalizedPayload = payload.endsWith('\n') ? payload : `${payload}\n`;

    return `cat <<'${delimiter}' | docker exec -i xray sh -lc 'cat > /tmp/xray-adu.json'
${normalizedPayload}${delimiter}
`;
  }

  private asRoot(server: Server, script: string): string {
    const prefix = server.sshUser === 'root' ? '' : 'sudo ';
    return `${prefix}bash -lc ${shellQuote(script)}`;
  }

  private warnOrInfo(payload: Record<string, unknown>, message: string): void {
    if (typeof this.options.logger.warn === 'function') {
      this.options.logger.warn(payload, message);
      return;
    }

    this.options.logger.info(payload, message);
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function shellArg(value: string): string {
  return shellQuote(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
