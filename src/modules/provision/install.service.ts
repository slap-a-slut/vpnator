import { randomBytes } from 'node:crypto';

import { ServerStatus, type Server, type XrayInstance } from '@prisma/client';

import { randomBase64Url } from '../../lib/crypto';
import { env } from '../../lib/env';
import { AppError } from '../../lib/errors';
import { parseOrThrow } from '../../lib/validation';
import type { ServerRepository } from '../servers/server.repository';
import type { UserRepository } from '../users/user.repository';
import { createXrayInstanceDtoSchema } from '../xray/xrayInstance.dto';
import type { XrayInstanceRepository } from '../xray/xrayInstance.repository';
import { NoopInstallLogStore } from './installLog.store';
import type { InstallLogStore } from './installLog.store';
import type { ProvisionCommandResult, ProvisionLogger, RunCommandOptions } from './provision.service';
import { renderXrayConfig, renderXrayDockerCompose } from './xray.template';

const DEFAULT_LISTEN_PORT = 443;
const DEFAULT_DEST = 'example.com:443';
const DEFAULT_FINGERPRINT = 'chrome';
const SUPPORTED_OS_IDS = new Set(['ubuntu', 'debian']);

interface CommandExecutor {
  runCommand(
    serverId: string,
    command: string,
    options?: RunCommandOptions,
  ): Promise<ProvisionCommandResult>;
}

interface InstallCommandOptions {
  label: string;
  includeStderrInError?: boolean;
  dryRunStdout?: string;
}

interface InstallRuntimeConfig {
  listenPort: number;
  realityPrivateKey: string;
  realityPublicKey: string;
  serverName: string;
  dest: string;
  fingerprint: string;
  shortIds: string[];
}

export interface InstallServerResult {
  status: ServerStatus;
  lastError: string | null;
  xrayInstance: XrayInstance | null;
}

interface InstallServiceOptions {
  serverRepository: ServerRepository;
  userRepository: UserRepository;
  xrayInstanceRepository: XrayInstanceRepository;
  commandExecutor: CommandExecutor;
  installLogStore?: InstallLogStore;
  logger: ProvisionLogger;
  dryRun?: boolean;
  isCancelled?: () => Promise<boolean>;
}

export class InstallService {
  private readonly dryRun: boolean;
  private readonly installLogStore: InstallLogStore;

  public constructor(private readonly options: InstallServiceOptions) {
    this.dryRun = options.dryRun ?? env.PROVISION_DRY_RUN;
    this.installLogStore = options.installLogStore ?? new NoopInstallLogStore();
  }

  public async installServer(serverId: string): Promise<InstallServerResult> {
    const server = await this.options.serverRepository.findById(serverId);
    if (!server) {
      throw new AppError({
        code: 'SERVER_NOT_FOUND',
        statusCode: 404,
        message: 'Server not found',
        details: { serverId },
      });
    }

    await this.throwIfCancelled(serverId, 'before install');
    await this.appendInstallLog(serverId, `INSTALL start statusBefore=${server.status}`);

    await this.options.serverRepository.updateById(serverId, {
      status: ServerStatus.INSTALLING,
      lastError: null,
    });

    try {
      const users = await this.options.userRepository.findManyByServerId(serverId);
      const clients = users.filter((user) => user.enabled).map((user) => ({ id: user.uuid }));

      const existingInstance = await this.options.xrayInstanceRepository.findLatestByServerId(serverId);

      await this.ensureSupportedOs(server);
      await this.installDockerAndCompose(server);
      await this.prepareDirectories(server);
      const runtimeConfig = await this.buildRuntimeConfig(server, existingInstance);

      const composeContent = renderXrayDockerCompose();
      const configContent = renderXrayConfig({
        listenPort: runtimeConfig.listenPort,
        realityPrivateKey: runtimeConfig.realityPrivateKey,
        serverName: runtimeConfig.serverName,
        dest: runtimeConfig.dest,
        shortIds: runtimeConfig.shortIds,
        clients,
      });

      await this.uploadFile(server, '/opt/xray-cp/docker-compose.yml', composeContent, {
        mode: '0644',
        label: 'Upload docker-compose.yml',
        sensitive: false,
      });
      await this.uploadFile(server, '/opt/xray-cp/config.json', configContent, {
        mode: '0600',
        label: 'Upload config.json',
        sensitive: true,
      });

      await this.executeChecked(
        server.id,
        this.asRoot(server, 'docker compose -f /opt/xray-cp/docker-compose.yml up -d'),
        {
          label: 'docker compose up -d',
        },
      );

      await this.openPort(server, runtimeConfig.listenPort);

      const xrayInstance = await this.options.xrayInstanceRepository.upsertLatestByServerId(serverId, {
        listenPort: runtimeConfig.listenPort,
        realityPrivateKey: runtimeConfig.realityPrivateKey,
        realityPublicKey: runtimeConfig.realityPublicKey,
        serverName: runtimeConfig.serverName,
        dest: runtimeConfig.dest,
        fingerprint: runtimeConfig.fingerprint,
        shortIds: runtimeConfig.shortIds,
      });

      const updatedServer = await this.options.serverRepository.updateById(serverId, {
        status: ServerStatus.READY,
        lastError: null,
      });

      await this.appendInstallLog(serverId, 'INSTALL completed status=READY');

      return {
        status: updatedServer.status,
        lastError: updatedServer.lastError,
        xrayInstance,
      };
    } catch (error) {
      const appError = this.toInstallError(error);

      if (appError.code === 'JOB_CANCELLED') {
        await this.options.serverRepository.updateById(serverId, {
          status: server.status,
          lastError: server.lastError,
        });

        await this.appendInstallLog(serverId, 'INSTALL cancelled');
        throw appError;
      }

      await this.options.serverRepository.updateById(serverId, {
        status: ServerStatus.ERROR,
        lastError: appError.message,
      });

      await this.appendInstallLog(serverId, `INSTALL failed: ${appError.message}`);

      throw appError;
    }
  }

  public async getServerStatus(serverId: string): Promise<InstallServerResult> {
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
    return {
      status: server.status,
      lastError: server.lastError,
      xrayInstance,
    };
  }

  private async buildRuntimeConfig(
    server: Server,
    existing: XrayInstance | null,
  ): Promise<InstallRuntimeConfig> {
    if (existing) {
      return {
        listenPort: existing.listenPort,
        realityPrivateKey: existing.realityPrivateKey,
        realityPublicKey: existing.realityPublicKey,
        serverName: existing.serverName,
        dest: existing.dest,
        fingerprint: existing.fingerprint,
        shortIds: existing.shortIds,
      };
    }

    const keyPair = await this.generateRealityKeyPair(server);
    const shortIds = this.generateShortIds();

    return parseOrThrow(createXrayInstanceDtoSchema, {
      serverId: server.id,
      listenPort: DEFAULT_LISTEN_PORT,
      realityPrivateKey: keyPair.privateKey,
      realityPublicKey: keyPair.publicKey,
      serverName: server.host,
      dest: DEFAULT_DEST,
      fingerprint: DEFAULT_FINGERPRINT,
      shortIds,
    });
  }

  private async ensureSupportedOs(server: Server) {
    const detectOsResult = await this.executeChecked(
      server.id,
      this.asUser('source /etc/os-release && printf "%s" "$ID"'),
      {
        label: 'Detect OS',
        dryRunStdout: 'ubuntu',
      },
    );

    const osId = detectOsResult.stdout.trim().toLowerCase();
    if (!SUPPORTED_OS_IDS.has(osId)) {
      throw new AppError({
        code: 'COMMAND_FAILED',
        statusCode: 502,
        message: `Unsupported OS: ${osId || 'unknown'}`,
      });
    }
  }

  private async installDockerAndCompose(server: Server) {
    const script = `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    OS_ID="$(
      . /etc/os-release
      echo "$ID"
    )"
    curl -fsSL "https://download.docker.com/linux/\${OS_ID}/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  ARCH="$(dpkg --print-architecture)"
  CODENAME="$(
    . /etc/os-release
    echo "$VERSION_CODENAME"
  )"
  OS_ID="$(
    . /etc/os-release
    echo "$ID"
  )"
  echo "deb [arch=\${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/\${OS_ID} \${CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker-compose-plugin
fi
systemctl enable --now docker >/dev/null 2>&1 || true
`;

    await this.executeChecked(server.id, this.asRoot(server, script), {
      label: 'Install Docker and Compose plugin',
    });
  }

  private async prepareDirectories(server: Server) {
    const script = 'mkdir -p /opt/xray-cp /var/log/xray';
    await this.executeChecked(server.id, this.asRoot(server, script), {
      label: 'Create /opt/xray-cp and /var/log/xray',
    });
  }

  private async uploadFile(
    server: Server,
    remotePath: string,
    content: string,
    options: { mode: string; label: string; sensitive: boolean },
  ) {
    const writeScript = `${this.buildWriteFileScript(remotePath, content)}
chmod ${options.mode} ${remotePath}
`;

    await this.executeChecked(server.id, this.asRoot(server, writeScript), {
      label: options.label,
      includeStderrInError: !options.sensitive,
    });
  }

  private buildWriteFileScript(remotePath: string, content: string): string {
    const delimiter = `XRAY_CP_${randomBytes(6).toString('hex')}`;
    const normalizedContent = content.endsWith('\n') ? content : `${content}\n`;
    return `cat > ${remotePath} <<'${delimiter}'
${normalizedContent}${delimiter}
`;
  }

  private async openPort(server: Server, port: number) {
    const script = `if command -v ufw >/dev/null 2>&1; then
  ufw allow ${port}/tcp >/dev/null 2>&1 || true
elif command -v iptables >/dev/null 2>&1; then
  iptables -C INPUT -p tcp --dport ${port} -j ACCEPT >/dev/null 2>&1 || iptables -I INPUT -p tcp --dport ${port} -j ACCEPT
fi
`;

    await this.executeChecked(server.id, this.asRoot(server, script), {
      label: `Open ${port}/tcp`,
    });
  }

  private async generateRealityKeyPair(
    server: Server,
  ): Promise<{ privateKey: string; publicKey: string }> {
    if (this.dryRun) {
      return {
        privateKey: randomBase64Url(32),
        publicKey: randomBase64Url(32),
      };
    }

    const result = await this.executeChecked(
      server.id,
      this.asRoot(server, 'docker run --rm ghcr.io/xtls/xray-core:latest xray x25519'),
      {
        label: 'Generate REALITY keypair',
      },
    );

    const output = `${result.stdout}\n${result.stderr}`;
    const privateMatch = /Private key:\s*([A-Za-z0-9_\-+/=]+)/i.exec(output);
    const publicMatch = /Public key:\s*([A-Za-z0-9_\-+/=]+)/i.exec(output);

    if (!privateMatch?.[1] || !publicMatch?.[1]) {
      throw new AppError({
        code: 'COMMAND_FAILED',
        statusCode: 502,
        message: 'Failed to parse REALITY keypair output',
      });
    }

    return {
      privateKey: privateMatch[1],
      publicKey: publicMatch[1],
    };
  }

  private generateShortIds(count = 4): string[] {
    const shortIds = new Set<string>();
    while (shortIds.size < count) {
      const raw = randomBytes(8).toString('hex');
      const len = 8 + Math.floor(Math.random() * 9);
      shortIds.add(raw.slice(0, len));
    }

    return [...shortIds];
  }

  private asUser(script: string): string {
    return `bash -lc ${shellQuote(script)}`;
  }

  private asRoot(server: Server, script: string): string {
    const prefix = server.sshUser === 'root' ? '' : 'sudo ';
    return `${prefix}bash -lc ${shellQuote(script)}`;
  }

  private async executeChecked(
    serverId: string,
    command: string,
    options: InstallCommandOptions,
  ): Promise<ProvisionCommandResult> {
    const result = await this.execute(serverId, command, options);

    if (result.exitCode !== 0) {
      await this.appendInstallLog(serverId, `STEP failed: ${options.label} exitCode=${result.exitCode}`);

      const details: Record<string, unknown> = {
        command: options.label,
        exitCode: result.exitCode,
      };

      if (options.includeStderrInError !== false) {
        const stderr = result.stderr.trim();
        if (stderr.length > 0) details.stderr = stderr.slice(0, 500);
      }

      throw new AppError({
        code: 'COMMAND_FAILED',
        statusCode: 502,
        message: 'SSH command failed',
        details,
      });
    }

    return result;
  }

  private async execute(
    serverId: string,
    command: string,
    options: InstallCommandOptions,
  ): Promise<ProvisionCommandResult> {
    await this.throwIfCancelled(serverId, options.label);

    await this.appendInstallLog(
      serverId,
      `STEP ${this.dryRun ? '[dry-run] ' : ''}${options.label}`,
    );

    if (this.dryRun) {
      this.options.logger.info(
        {
          serverId,
          command: options.label,
        },
        'Provision dry-run: skipping SSH command',
      );
      return {
        stdout: options.dryRunStdout ?? '',
        stderr: '',
        exitCode: 0,
      };
    }

    return this.options.commandExecutor.runCommand(serverId, command, {
      logLabel: options.label,
      ...(this.options.isCancelled ? { isCancelled: this.options.isCancelled } : {}),
    });
  }

  private async throwIfCancelled(serverId: string, stage: string): Promise<void> {
    if (!this.options.isCancelled) return;
    const cancelled = await this.options.isCancelled();
    if (!cancelled) return;

    await this.appendInstallLog(serverId, `INSTALL cancelled at stage: ${stage}`);

    throw new AppError({
      code: 'JOB_CANCELLED',
      statusCode: 409,
      message: 'Job cancelled',
    });
  }

  private async appendInstallLog(serverId: string, message: string): Promise<void> {
    try {
      await this.installLogStore.append(serverId, message);
    } catch (error) {
      this.options.logger.info(
        {
          serverId,
          reason: error instanceof Error ? error.message : 'unknown',
        },
        'Failed to write install log',
      );
    }
  }

  private toInstallError(error: unknown): AppError {
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
      message: 'Install failed',
    });
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
