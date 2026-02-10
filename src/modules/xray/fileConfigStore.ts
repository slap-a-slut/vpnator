import { randomBytes } from 'node:crypto';

import { ServerStatus, type Server } from '@prisma/client';

import { AppError } from '../../lib/errors';
import type { UserRepository } from '../users/user.repository';
import type { ProvisionCommandResult, ProvisionLogger, RunCommandOptions } from '../provision/provision.service';
import { renderXrayConfig } from '../provision/xray.template';
import type { ServerRepository } from '../servers/server.repository';
import type { XrayClientStore } from './clientStore';
import type { XrayInstanceRepository } from './xrayInstance.repository';

interface CommandExecutor {
  runCommand(
    serverId: string,
    command: string,
    options?: RunCommandOptions,
  ): Promise<ProvisionCommandResult>;
}

interface FileConfigStoreOptions {
  serverRepository: ServerRepository;
  userRepository: UserRepository;
  xrayInstanceRepository: XrayInstanceRepository;
  commandExecutor: CommandExecutor;
  logger: ProvisionLogger;
  dryRun: boolean;
}

export class FileConfigStore implements XrayClientStore {
  public constructor(private readonly options: FileConfigStoreOptions) {}

  public async sync(serverId: string): Promise<void> {
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
        'Xray client sync skipped: server not ready',
      );
      return;
    }

    const xrayInstance = await this.options.xrayInstanceRepository.findLatestByServerId(serverId);
    if (!xrayInstance) {
      this.options.logger.info(
        {
          serverId,
        },
        'Xray client sync skipped: xray instance not found',
      );
      return;
    }

    const users = await this.options.userRepository.findManyByServerId(serverId);
    const clients = users
      .filter((user) => user.enabled)
      .map((user) => ({ id: user.uuid }))
      .sort((left, right) => left.id.localeCompare(right.id));

    const configContent = renderXrayConfig({
      listenPort: xrayInstance.listenPort,
      realityPrivateKey: xrayInstance.realityPrivateKey,
      serverName: xrayInstance.serverName,
      dest: xrayInstance.dest,
      shortIds: xrayInstance.shortIds,
      clients,
    });

    await this.writeConfig(server, configContent);
    await this.restartXray(server);
  }

  public async addUser(serverId: string, _userUuid: string): Promise<void> {
    await this.sync(serverId);
  }

  public async removeUser(serverId: string, _userUuid: string): Promise<void> {
    await this.sync(serverId);
  }

  private async writeConfig(server: Server, configContent: string): Promise<void> {
    const command = this.asRoot(
      server,
      `${this.buildWriteFileScript('/opt/xray-cp/config.json', configContent)}
chmod 0600 /opt/xray-cp/config.json`,
    );

    const result = await this.execute(server.id, command, 'Xray store: write config.json');
    this.assertCommandSuccess(result, 'Xray store: write config.json');
  }

  private async restartXray(server: Server): Promise<void> {
    const command = this.asRoot(
      server,
      'docker compose -f /opt/xray-cp/docker-compose.yml restart xray',
    );

    const result = await this.execute(server.id, command, 'Xray store: restart xray');
    this.assertCommandSuccess(result, 'Xray store: restart xray');
  }

  private async execute(
    serverId: string,
    command: string,
    label: string,
  ): Promise<ProvisionCommandResult> {
    if (this.options.dryRun) {
      this.options.logger.info(
        {
          serverId,
          command: label,
        },
        'Xray client store dry-run: skipping command',
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

  private assertCommandSuccess(result: ProvisionCommandResult, command: string) {
    if (result.exitCode === 0) return;

    throw new AppError({
      code: 'COMMAND_FAILED',
      statusCode: 502,
      message: 'Failed to apply xray client configuration',
      details: {
        command,
        exitCode: result.exitCode,
      },
    });
  }

  private buildWriteFileScript(remotePath: string, content: string): string {
    const delimiter = `XRAY_CP_${randomBytes(4).toString('hex')}`;
    const normalizedContent = content.endsWith('\n') ? content : `${content}\n`;
    return `cat > ${remotePath} <<'${delimiter}'
${normalizedContent}${delimiter}
`;
  }

  private asRoot(server: Server, script: string): string {
    const prefix = server.sshUser === 'root' ? '' : 'sudo ';
    return `${prefix}bash -lc ${shellQuote(script)}`;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
