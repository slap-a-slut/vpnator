import { ServerStatus, type PrismaClient } from '@prisma/client';

import { env } from '../../lib/env';
import { AppError } from '../../lib/errors';
import type { InstallLogStore } from '../provision/installLog.store';
import { FileInstallLogStore } from '../provision/installLog.store';
import { InstallService } from '../provision/install.service';
import type { ProvisionLogger } from '../provision/provision.service';
import { ProvisionService } from '../provision/provision.service';
import { RepairService } from '../provision/repair.service';
import { SecretRepository } from '../provision/secret.repository';
import { ServerRepository } from '../servers/server.repository';
import { UserRepository } from '../users/user.repository';
import { XrayInstanceRepository } from '../xray/xrayInstance.repository';
import type { JobProcessorContext, ServerJobData, ServerJobProcessor } from './job.types';

class JobInstallLogStore implements InstallLogStore {
  public constructor(private readonly context: JobProcessorContext) {}

  public append(serverId: string, message: string): Promise<void> {
    return this.context.appendLog('INFO', `[server:${serverId}] ${message}`);
  }

  public tail(_serverId: string, _lineLimit: number): Promise<string[]> {
    return Promise.resolve([]);
  }
}

class CompositeInstallLogStore implements InstallLogStore {
  public constructor(private readonly stores: InstallLogStore[]) {}

  public async append(serverId: string, message: string): Promise<void> {
    for (const store of this.stores) {
      await store.append(serverId, message);
    }
  }

  public async tail(serverId: string, lineLimit: number): Promise<string[]> {
    const lines = await Promise.all(this.stores.map((store) => store.tail(serverId, lineLimit)));
    return lines.flat().slice(-lineLimit);
  }
}

interface ServerJobProcessorOptions {
  prisma: PrismaClient;
  logger: ProvisionLogger;
  dryRun?: boolean;
}

export class DefaultServerJobProcessor implements ServerJobProcessor {
  private readonly serverRepository: ServerRepository;
  private readonly userRepository: UserRepository;
  private readonly secretRepository: SecretRepository;
  private readonly xrayInstanceRepository: XrayInstanceRepository;
  private readonly provisionService: ProvisionService;
  private readonly dryRun: boolean;

  public constructor(private readonly options: ServerJobProcessorOptions) {
    this.serverRepository = new ServerRepository(options.prisma);
    this.userRepository = new UserRepository(options.prisma);
    this.secretRepository = new SecretRepository(options.prisma);
    this.xrayInstanceRepository = new XrayInstanceRepository(options.prisma);
    this.provisionService = new ProvisionService({
      serverRepository: this.serverRepository,
      secretRepository: this.secretRepository,
      logger: options.logger,
    });
    this.dryRun = options.dryRun ?? env.PROVISION_DRY_RUN;
  }

  public async process(data: ServerJobData, context: JobProcessorContext): Promise<unknown> {
    await this.throwIfCancelled(context, 'before start');

    await context.appendLog(
      'INFO',
      `Job started: type=${data.type} serverId=${data.serverId} dryRun=${this.dryRun}`,
    );

    await context.setProgress(5);

    try {
      switch (data.type) {
        case 'install':
          return await this.processInstall(data.serverId, context);
        case 'repair':
          return await this.processRepair(data.serverId, context);
      }
    } catch (error) {
      const appError = toAppError(error);
      await context.appendLog(
        'ERROR',
        `Job failed: type=${data.type} serverId=${data.serverId} code=${appError.code} message=${appError.message}`,
      );
      throw appError;
    }
  }

  private async processInstall(serverId: string, context: JobProcessorContext) {
    await context.setProgress(15);
    await context.appendLog('INFO', `Install started for serverId=${serverId}`);

    const server = await this.serverRepository.findById(serverId);
    if (!server) {
      throw new AppError({
        code: 'SERVER_NOT_FOUND',
        statusCode: 404,
        message: 'Server not found',
        details: { serverId },
      });
    }

    await this.throwIfCancelled(context, 'before install');

    if (server.status === ServerStatus.READY) {
      await context.appendLog(
        'INFO',
        `Server ${serverId} already installed. Running repair validation`,
      );

      const repairService = new RepairService({
        serverRepository: this.serverRepository,
        userRepository: this.userRepository,
        xrayInstanceRepository: this.xrayInstanceRepository,
        commandExecutor: this.provisionService,
        installLogStore: this.createInstallLogStore(context),
        logger: this.options.logger,
        dryRun: this.dryRun,
        isCancelled: () => context.isCancelled(),
      });

      const repairResult = await repairService.repairServer(serverId);
      const refreshedServer = await this.serverRepository.findById(serverId);
      const refreshedXrayInstance = await this.xrayInstanceRepository.findLatestByServerId(serverId);
      if (!refreshedServer) {
        throw new AppError({
          code: 'SERVER_NOT_FOUND',
          statusCode: 404,
          message: 'Server not found',
          details: { serverId },
        });
      }

      await context.setProgress(100);
      await context.appendLog('INFO', `Install finished for serverId=${serverId} status=${refreshedServer.status}`);

      return {
        type: 'install',
        serverId,
        status: refreshedServer.status,
        lastError: refreshedServer.lastError,
        xrayInstanceId: refreshedXrayInstance?.id ?? null,
        alreadyInstalled: true,
        repairActions: repairResult.actions,
      };
    }

    const installService = new InstallService({
      serverRepository: this.serverRepository,
      userRepository: this.userRepository,
      xrayInstanceRepository: this.xrayInstanceRepository,
      commandExecutor: this.provisionService,
      installLogStore: this.createInstallLogStore(context),
      logger: this.options.logger,
      dryRun: this.dryRun,
      isCancelled: () => context.isCancelled(),
    });

    const result = await installService.installServer(serverId);

    await context.setProgress(100);
    await context.appendLog(
      'INFO',
      `Install finished for serverId=${serverId} status=${result.status}`,
    );

    return {
      type: 'install',
      serverId,
      status: result.status,
      lastError: result.lastError,
      xrayInstanceId: result.xrayInstance?.id ?? null,
    };
  }

  private async processRepair(serverId: string, context: JobProcessorContext) {
    await context.setProgress(15);
    await context.appendLog('INFO', `Repair started for serverId=${serverId}`);

    await this.throwIfCancelled(context, 'before repair');

    const repairService = new RepairService({
      serverRepository: this.serverRepository,
      userRepository: this.userRepository,
      xrayInstanceRepository: this.xrayInstanceRepository,
      commandExecutor: this.provisionService,
      installLogStore: this.createInstallLogStore(context),
      logger: this.options.logger,
      dryRun: this.dryRun,
      isCancelled: () => context.isCancelled(),
    });

    const result = await repairService.repairServer(serverId);

    await context.setProgress(100);
    await context.appendLog(
      'INFO',
      `Repair finished for serverId=${serverId} statusAfter=${result.statusAfter}`,
    );

    return {
      type: 'repair',
      serverId,
      statusBefore: result.statusBefore,
      statusAfter: result.statusAfter,
      actions: result.actions,
    };
  }

  private createInstallLogStore(context: JobProcessorContext): InstallLogStore {
    return new CompositeInstallLogStore([
      new FileInstallLogStore(),
      new JobInstallLogStore(context),
    ]);
  }

  private async throwIfCancelled(context: JobProcessorContext, stage: string): Promise<void> {
    const cancelled = await context.isCancelled();
    if (!cancelled) return;

    throw new AppError({
      code: 'JOB_CANCELLED',
      statusCode: 409,
      message: `Job cancelled (${stage})`,
    });
  }
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof Error) {
    return new AppError({
      code: 'JOB_FAILED',
      statusCode: 500,
      message: error.message,
    });
  }

  return new AppError({
    code: 'JOB_FAILED',
    statusCode: 500,
    message: 'Background job failed',
  });
}
