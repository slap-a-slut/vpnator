import { randomBytes } from 'node:crypto';

import { ServerStatus, type Server, type XrayInstance } from '@prisma/client';

import { randomBase64Url, sha256Hex } from '../../lib/crypto';
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

interface RepairCommandOptions {
  label: string;
  includeStderrInError?: boolean;
  dryRunStdout?: string;
}

interface RepairRuntimeConfig {
  listenPort: number;
  realityPrivateKey: string;
  realityPublicKey: string;
  serverName: string;
  dest: string;
  fingerprint: string;
  shortIds: string[];
}

export interface RepairServerResult {
  actions: string[];
  statusBefore: ServerStatus;
  statusAfter: ServerStatus;
}

interface RepairServiceOptions {
  serverRepository: ServerRepository;
  userRepository: UserRepository;
  xrayInstanceRepository: XrayInstanceRepository;
  commandExecutor: CommandExecutor;
  installLogStore?: InstallLogStore;
  logger: ProvisionLogger;
  dryRun?: boolean;
  isCancelled?: () => Promise<boolean>;
}

export class RepairService {
  private readonly dryRun: boolean;
  private readonly installLogStore: InstallLogStore;

  public constructor(private readonly options: RepairServiceOptions) {
    this.dryRun = options.dryRun ?? env.PROVISION_DRY_RUN;
    this.installLogStore = options.installLogStore ?? new NoopInstallLogStore();
  }

  public async repairServer(serverId: string): Promise<RepairServerResult> {
    const server = await this.options.serverRepository.findById(serverId);
    if (!server) {
      throw new AppError({
        code: 'SERVER_NOT_FOUND',
        statusCode: 404,
        message: 'Server not found',
        details: { serverId },
      });
    }

    const statusBefore = server.status;
    const actions: string[] = [];
    await this.throwIfCancelled(serverId, 'before repair');
    await this.appendInstallLog(serverId, `REPAIR start statusBefore=${server.status}`);

    await this.options.serverRepository.updateById(serverId, {
      status: ServerStatus.INSTALLING,
      lastError: null,
    });

    try {
      await this.ensureSupportedOs(server);

      let dockerInstalled = await this.checkDockerInstalled(server);
      if (!dockerInstalled) {
        actions.push('Install Docker and Compose plugin');
        await this.installDockerAndCompose(server);
        dockerInstalled = true;
      }

      const users = await this.options.userRepository.findManyByServerId(serverId);
      const clients = users
        .filter((user) => user.enabled)
        .map((user) => ({ id: user.uuid }))
        .sort((left, right) => left.id.localeCompare(right.id));

      const existingInstance = await this.options.xrayInstanceRepository.findLatestByServerId(serverId);
      const runtimeConfig = await this.buildRuntimeConfig(server, existingInstance);

      const expectedCompose = renderXrayDockerCompose();
      const expectedConfig = renderXrayConfig({
        listenPort: runtimeConfig.listenPort,
        realityPrivateKey: runtimeConfig.realityPrivateKey,
        serverName: runtimeConfig.serverName,
        dest: runtimeConfig.dest,
        shortIds: runtimeConfig.shortIds,
        clients,
      });

      const expectedComposeHash = sha256Hex(expectedCompose).toLowerCase();
      const expectedConfigHash = sha256Hex(expectedConfig).toLowerCase();

      const remoteComposeHash = await this.readRemoteFileHash(
        server,
        '/opt/xray-cp/docker-compose.yml',
        'Repair: read docker-compose hash',
      );
      const remoteConfigHash = await this.readRemoteFileHash(
        server,
        '/opt/xray-cp/config.json',
        'Repair: read config hash',
      );

      const composeNeedsUpdate = remoteComposeHash?.toLowerCase() !== expectedComposeHash;
      const configNeedsUpdate = remoteConfigHash?.toLowerCase() !== expectedConfigHash;

      if (composeNeedsUpdate) {
        actions.push('Recreate docker-compose.yml');
        await this.uploadFile(server, '/opt/xray-cp/docker-compose.yml', expectedCompose, {
          mode: '0644',
          label: 'Repair: write docker-compose.yml',
          sensitive: false,
        });
      }

      if (configNeedsUpdate) {
        actions.push('Regenerate config.json to match users');
        await this.uploadFile(server, '/opt/xray-cp/config.json', expectedConfig, {
          mode: '0600',
          label: 'Repair: write config.json',
          sensitive: true,
        });
      }

      const xrayRunning = await this.checkXrayRunning(server);
      if (!xrayRunning) {
        actions.push('Start xray container');
        await this.composeUp(server, false, 'Repair: docker compose up -d');
      } else if (composeNeedsUpdate || configNeedsUpdate) {
        actions.push('Restart xray container to apply configuration');
        await this.composeUp(server, true, 'Repair: docker compose up -d --force-recreate');
      }

      const listeningBefore = await this.checkPortListening(
        server,
        runtimeConfig.listenPort,
        'Repair: check port listening',
        'NO',
      );
      if (!listeningBefore) {
        actions.push('Restart xray container because port is not listening');
        await this.restartXray(server, 'Repair: restart xray because port not listening');
      }

      const listeningAfter = await this.checkPortListening(
        server,
        runtimeConfig.listenPort,
        'Repair: verify port listening',
        'YES',
      );
      if (!listeningAfter) {
        throw new AppError({
          code: 'REPAIR_FAILED',
          statusCode: 502,
          message: 'XRAY port is not listening after repair',
          details: {
            port: runtimeConfig.listenPort,
          },
        });
      }

      const externalProbe = await this.checkExternalProbe(server, runtimeConfig.listenPort);
      if (externalProbe === 'SKIP') {
        actions.push('External reachability probe skipped');
      } else if (externalProbe === 'NO') {
        actions.push('External reachability probe failed (optional)');
      }

      await this.options.xrayInstanceRepository.upsertLatestByServerId(serverId, {
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

      if (actions.length === 0) {
        actions.push('No repair actions required');
      }

      await this.appendInstallLog(serverId, `REPAIR completed status=READY actions=${actions.length}`);

      return {
        actions,
        statusBefore,
        statusAfter: updatedServer.status,
      };
    } catch (error) {
      const appError = this.toRepairError(error);

      if (appError.code === 'JOB_CANCELLED') {
        await this.options.serverRepository.updateById(serverId, {
          status: statusBefore,
          lastError: server.lastError,
        });

        await this.appendInstallLog(serverId, 'REPAIR cancelled');
        throw appError;
      }

      await this.options.serverRepository.updateById(serverId, {
        status: ServerStatus.ERROR,
        lastError: appError.message,
      });

      await this.appendInstallLog(serverId, `REPAIR failed: ${appError.message}`);

      throw appError;
    }
  }

  private async buildRuntimeConfig(
    server: Server,
    existing: XrayInstance | null,
  ): Promise<RepairRuntimeConfig> {
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
    const result = await this.executeChecked(
      server.id,
      this.asUser('source /etc/os-release && printf "%s" "$ID"'),
      {
        label: 'Repair: detect OS',
        dryRunStdout: 'ubuntu',
      },
    );

    const osId = result.stdout.trim().toLowerCase();
    if (!SUPPORTED_OS_IDS.has(osId)) {
      throw new AppError({
        code: 'COMMAND_FAILED',
        statusCode: 502,
        message: `Unsupported OS: ${osId || 'unknown'}`,
      });
    }
  }

  private async checkDockerInstalled(server: Server): Promise<boolean> {
    const result = await this.executeChecked(
      server.id,
      this.asUser(
        'if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then echo YES; else echo NO; fi',
      ),
      {
        label: 'Repair: check Docker and Compose',
        dryRunStdout: 'NO',
      },
    );

    return this.isYes(result.stdout);
  }

  private async readRemoteFileHash(
    server: Server,
    remotePath: string,
    label: string,
  ): Promise<string | null> {
    const result = await this.executeChecked(
      server.id,
      this.asRoot(
        server,
        `if [ -f ${remotePath} ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum ${remotePath} | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 ${remotePath} | awk '{print $2}'
  else
    echo UNAVAILABLE
  fi
else
  echo MISSING
fi`,
      ),
      {
        label,
        dryRunStdout: 'MISSING',
      },
    );

    const value = result.stdout.trim();
    if (value === 'MISSING' || value === 'UNAVAILABLE' || value.length === 0) {
      return null;
    }

    return value;
  }

  private async checkXrayRunning(server: Server): Promise<boolean> {
    const result = await this.executeChecked(
      server.id,
      this.asRoot(
        server,
        "if command -v docker >/dev/null 2>&1 && docker ps --filter name=^xray$ --filter status=running --format '{{.Names}}' | grep -Fx xray >/dev/null 2>&1; then echo YES; else echo NO; fi",
      ),
      {
        label: 'Repair: check xray container running',
        dryRunStdout: 'NO',
      },
    );

    return this.isYes(result.stdout);
  }

  private async checkPortListening(
    server: Server,
    port: number,
    label: string,
    dryRunStdout: string,
  ): Promise<boolean> {
    const result = await this.executeChecked(
      server.id,
      this.asRoot(
        server,
        `if command -v ss >/dev/null 2>&1 && ss -lntp 2>/dev/null | grep -E '[:.]${port}\\b' >/dev/null 2>&1; then echo YES; else echo NO; fi`,
      ),
      {
        label,
        dryRunStdout,
      },
    );

    return this.isYes(result.stdout);
  }

  private async checkExternalProbe(server: Server, port: number): Promise<'YES' | 'NO' | 'SKIP'> {
    const result = await this.executeChecked(
      server.id,
      this.asUser(
        `if command -v nc >/dev/null 2>&1; then
  if nc -z -w 3 ${shellQuote(server.host)} ${port} >/dev/null 2>&1; then echo YES; else echo NO; fi
else
  echo SKIP
fi`,
      ),
      {
        label: 'Repair: probe external reachability',
        dryRunStdout: 'SKIP',
      },
    );

    const indicator = result.stdout.trim().toUpperCase();
    if (indicator === 'YES' || indicator === 'NO') {
      return indicator;
    }

    return 'SKIP';
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
      label: 'Repair: install Docker and Compose plugin',
    });
  }

  private async uploadFile(
    server: Server,
    remotePath: string,
    content: string,
    options: { mode: string; label: string; sensitive: boolean },
  ) {
    const script = `${this.buildWriteFileScript(remotePath, content)}
chmod ${options.mode} ${remotePath}
`;

    await this.executeChecked(server.id, this.asRoot(server, script), {
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

  private async composeUp(server: Server, forceRecreate: boolean, label: string) {
    const command = forceRecreate
      ? 'docker compose -f /opt/xray-cp/docker-compose.yml up -d --force-recreate xray'
      : 'docker compose -f /opt/xray-cp/docker-compose.yml up -d';

    await this.executeChecked(server.id, this.asRoot(server, command), {
      label,
    });
  }

  private async restartXray(server: Server, label: string) {
    await this.executeChecked(
      server.id,
      this.asRoot(server, 'docker compose -f /opt/xray-cp/docker-compose.yml restart xray'),
      {
        label,
      },
    );
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
        label: 'Repair: generate REALITY keypair',
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

  private isYes(value: string): boolean {
    return value.trim().toUpperCase() === 'YES';
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
    options: RepairCommandOptions,
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
    options: RepairCommandOptions,
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

    await this.appendInstallLog(serverId, `REPAIR cancelled at stage: ${stage}`);

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

  private toRepairError(error: unknown): AppError {
    if (error instanceof AppError) return error;

    if (error instanceof Error) {
      return new AppError({
        code: 'REPAIR_FAILED',
        statusCode: 502,
        message: error.message,
      });
    }

    return new AppError({
      code: 'REPAIR_FAILED',
      statusCode: 502,
      message: 'Repair failed',
    });
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
