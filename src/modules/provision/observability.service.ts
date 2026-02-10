import type { Server, ServerStatus } from '@prisma/client';

import { env } from '../../lib/env';
import { AppError } from '../../lib/errors';
import type { ServerRepository } from '../servers/server.repository';
import type { XrayInstanceRepository } from '../xray/xrayInstance.repository';
import type { InstallLogStore } from './installLog.store';
import { sanitizeLogLines } from './logSanitizer';
import type { ProvisionCommandResult, ProvisionLogger, RunCommandOptions } from './provision.service';

const DEFAULT_TAIL = 200;
const MIN_TAIL = 1;
const MAX_TAIL = 1000;

export type ServerLogType = 'install' | 'xray';

export interface ServerLogsResult {
  type: ServerLogType;
  tail: number;
  lines: string[];
}

export interface ServerHealthResult {
  status: ServerStatus;
  checks: {
    ssh: boolean;
    docker: boolean;
    xrayContainer: boolean;
    portListening: boolean;
  };
}

interface CommandExecutor {
  runCommand(
    serverId: string,
    command: string,
    options?: RunCommandOptions,
  ): Promise<ProvisionCommandResult>;
}

interface ObservabilityServiceOptions {
  serverRepository: ServerRepository;
  xrayInstanceRepository: XrayInstanceRepository;
  commandExecutor: CommandExecutor;
  installLogStore: InstallLogStore;
  logger: ProvisionLogger;
  dryRun?: boolean;
}

export class ObservabilityService {
  private readonly dryRun: boolean;

  public constructor(private readonly options: ObservabilityServiceOptions) {
    this.dryRun = options.dryRun ?? env.PROVISION_DRY_RUN;
  }

  public async getServerLogs(input: {
    serverId: string;
    type: ServerLogType;
    tail?: number;
  }): Promise<ServerLogsResult> {
    const server = await this.options.serverRepository.findById(input.serverId);
    if (!server) {
      throw new AppError({
        code: 'SERVER_NOT_FOUND',
        statusCode: 404,
        message: 'Server not found',
        details: { serverId: input.serverId },
      });
    }

    const tail = this.clampTail(input.tail ?? DEFAULT_TAIL);

    if (input.type === 'install') {
      const lines = await this.options.installLogStore.tail(server.id, tail);
      return {
        type: 'install',
        tail,
        lines: sanitizeLogLines(lines),
      };
    }

    if (this.dryRun) {
      return {
        type: 'xray',
        tail,
        lines: [`[DRY_RUN] skipped remote read: /var/log/xray/error.log, /var/log/xray/access.log`],
      };
    }

    const result = await this.options.commandExecutor.runCommand(
      server.id,
      this.asRoot(
        server,
        `for file in /var/log/xray/error.log /var/log/xray/access.log; do
  echo "===== $file ====="
  if [ -f "$file" ]; then
    tail -n ${tail} "$file"
  else
    echo "MISSING"
  fi
done`,
      ),
      {
        logLabel: 'Observability: read xray logs',
      },
    );

    if (result.exitCode !== 0) {
      throw new AppError({
        code: 'COMMAND_FAILED',
        statusCode: 502,
        message: 'Failed to read xray logs',
        details: {
          exitCode: result.exitCode,
        },
      });
    }

    const merged = mergeStdoutStderr(result);
    const lines = sanitizeLogLines(splitLines(merged));

    return {
      type: 'xray',
      tail,
      lines,
    };
  }

  public async getServerHealth(serverId: string): Promise<ServerHealthResult> {
    const server = await this.options.serverRepository.findById(serverId);
    if (!server) {
      throw new AppError({
        code: 'SERVER_NOT_FOUND',
        statusCode: 404,
        message: 'Server not found',
        details: { serverId },
      });
    }

    const xrayInstance = await this.options.xrayInstanceRepository.findLatestByServerId(serverId);

    if (this.dryRun) {
      const hasXray = xrayInstance !== null;
      return {
        status: server.status,
        checks: {
          ssh: true,
          docker: true,
          xrayContainer: hasXray,
          portListening: hasXray,
        },
      };
    }

    const ssh = await this.checkCommand(
      server.id,
      this.asUser('uname -a >/dev/null 2>&1'),
      'Observability: health check ssh',
    );

    const docker = await this.checkCommand(
      server.id,
      this.asUser('command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1'),
      'Observability: health check docker',
    );

    const xrayContainer = await this.checkCommand(
      server.id,
      this.asRoot(
        server,
        "command -v docker >/dev/null 2>&1 && docker ps --filter name=^xray$ --filter status=running --format '{{.Names}}' | grep -Fx xray >/dev/null 2>&1",
      ),
      'Observability: health check xray container',
    );

    const portListening =
      xrayInstance === null
        ? false
        : await this.checkCommand(
            server.id,
            this.asRoot(
              server,
              `command -v ss >/dev/null 2>&1 && ss -lntp 2>/dev/null | grep -E '[:.]${xrayInstance.listenPort}\\b' >/dev/null 2>&1`,
            ),
            'Observability: health check port listening',
          );

    return {
      status: server.status,
      checks: {
        ssh,
        docker,
        xrayContainer,
        portListening,
      },
    };
  }

  private clampTail(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_TAIL;
    const normalized = Math.trunc(value);
    if (normalized < MIN_TAIL) return MIN_TAIL;
    if (normalized > MAX_TAIL) return MAX_TAIL;
    return normalized;
  }

  private async checkCommand(serverId: string, command: string, logLabel: string): Promise<boolean> {
    try {
      const result = await this.options.commandExecutor.runCommand(serverId, command, {
        logLabel,
      });
      return result.exitCode === 0;
    } catch (error) {
      this.options.logger.info(
        {
          serverId,
          logLabel,
          reason: error instanceof Error ? error.message : 'unknown',
        },
        'Health check command failed',
      );
      return false;
    }
  }

  private asUser(script: string): string {
    return `bash -lc ${shellQuote(script)}`;
  }

  private asRoot(server: Server, script: string): string {
    const prefix = server.sshUser === 'root' ? '' : 'sudo ';
    return `${prefix}bash -lc ${shellQuote(script)}`;
  }
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function mergeStdoutStderr(result: ProvisionCommandResult): string {
  const parts = [result.stdout.trim(), result.stderr.trim()].filter((part) => part.length > 0);
  return parts.join('\n');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
