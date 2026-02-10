import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { Queue, type Job, type JobsOptions, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { env } from '../../lib/env';
import { AppError } from '../../lib/errors';
import type { ProvisionLogger } from '../provision/provision.service';
import { JobLogRepository } from './jobLog.repository';
import type {
  JobStatus,
  JobState,
  JobsRegistry,
  ServerJobData,
  ServerJobProcessor,
  ServerJobType,
} from './job.types';

const SERVER_JOBS_QUEUE = 'server-operations';
const SERVER_LOCK_TTL_MS = 15 * 60 * 1000;
const CANCELLATION_KEY_TTL_SECONDS = 24 * 60 * 60;

interface BullMqJobsRegistryOptions {
  prisma: PrismaClient;
  logger: ProvisionLogger;
  processor: ServerJobProcessor;
  redisUrl?: string;
  runWorker?: boolean;
}

export class BullMqJobsRegistry implements JobsRegistry {
  private readonly queueConnection: IORedis;
  private readonly workerConnection: IORedis;
  private readonly queue: Queue<ServerJobData>;
  private readonly logRepository: JobLogRepository;
  private readonly worker: Worker<ServerJobData> | null;

  public constructor(private readonly options: BullMqJobsRegistryOptions) {
    const redisUrl = options.redisUrl ?? env.REDIS_URL;
    this.queueConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
    });
    this.workerConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue<ServerJobData>(SERVER_JOBS_QUEUE, {
      connection: this.queueConnection,
    });
    this.logRepository = new JobLogRepository(options.prisma);

    this.worker =
      options.runWorker === false
        ? null
        : new Worker<ServerJobData>(
            SERVER_JOBS_QUEUE,
            async (job) => {
              const jobId = getJobId(job);
              const lockToken = job.data.lockToken;

              try {
                if (await this.isCancellationRequested(jobId)) {
                  await this.logRepository.create({
                    jobId,
                    level: 'WARN',
                    message: 'Job cancelled before execution',
                  });
                  return {
                    canceled: true,
                    reason: 'Cancellation requested before execution',
                  };
                }

                return await this.options.processor.process(job.data, {
                  jobId,
                  setProgress: (progress) => job.updateProgress(normalizeProgress(progress)),
                  appendLog: (level, message) => this.logRepository.create({ jobId, level, message }),
                  isCancelled: () => this.isCancellationRequested(jobId),
                });
              } catch (error) {
                if (isCancelledError(error)) {
                  await this.logRepository.create({
                    jobId,
                    level: 'WARN',
                    message: `Job cancelled: ${error.message}`,
                  });
                  return {
                    canceled: true,
                    reason: error.message,
                  };
                }

                throw error;
              } finally {
                await this.releaseServerLock(job.data.serverId, lockToken);
                await this.clearCancellation(jobId);
              }
            },
            {
              connection: this.workerConnection,
              concurrency: 1,
            },
          );

    this.worker?.on('error', (error) => {
      this.options.logger.info(
        {
          error: error.message,
        },
        'BullMQ worker error',
      );
    });
  }

  public async enqueueInstall(serverId: string): Promise<{ jobId: string }> {
    return this.enqueue('install', serverId);
  }

  public async enqueueRepair(serverId: string): Promise<{ jobId: string }> {
    return this.enqueue('repair', serverId);
  }

  public async cancel(jobId: string): Promise<{ jobId: string; status: JobStatus; cancelRequested: true }> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new AppError({
        code: 'JOB_NOT_FOUND',
        statusCode: 404,
        message: 'Job not found',
        details: { jobId },
      });
    }

    await this.requestCancellation(jobId);
    await this.logRepository.create({
      jobId,
      level: 'WARN',
      message: 'Cancellation requested',
    });

    const state = await job.getState();
    return {
      jobId,
      status: mapBullMqState(state),
      cancelRequested: true,
    };
  }

  public async getJob(jobId: string): Promise<JobState> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new AppError({
        code: 'JOB_NOT_FOUND',
        statusCode: 404,
        message: 'Job not found',
        details: { jobId },
      });
    }

    const state = await job.getState();
    const status = mapBullMqState(state);
    const progress = normalizeProgress(asNumber(job.progress));

    return {
      id: jobId,
      status,
      progress,
      ...(job.returnvalue !== undefined ? { result: job.returnvalue } : {}),
      ...(job.failedReason ? { error: job.failedReason } : {}),
    };
  }

  public getLogs(jobId: string, tail: number) {
    return this.getLogsWithValidation(jobId, tail);
  }

  public async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    await this.workerConnection.quit();
    await this.queueConnection.quit();
  }

  private async enqueue(type: ServerJobType, serverId: string): Promise<{ jobId: string }> {
    const jobId = randomUUID();
    const lockToken = jobId;
    await this.acquireServerLock(serverId, lockToken);

    const data: ServerJobData = { type, serverId, lockToken };

    const options: JobsOptions = {
      jobId,
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 24 * 3600, count: 500 },
    };

    try {
      await this.queue.add(type, data, options);
      await this.logRepository.create({
        jobId,
        level: 'INFO',
        message: `Job queued: type=${type} serverId=${serverId}`,
      });
    } catch (error) {
      await this.releaseServerLock(serverId, lockToken);
      throw error;
    }

    return { jobId };
  }

  private async getLogsWithValidation(jobId: string, tail: number) {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      throw new AppError({
        code: 'JOB_NOT_FOUND',
        statusCode: 404,
        message: 'Job not found',
        details: { jobId },
      });
    }

    return this.logRepository.tail(jobId, tail);
  }

  private async acquireServerLock(serverId: string, token: string): Promise<void> {
    const result = await this.queueConnection.set(
      serverLockKey(serverId),
      token,
      'PX',
      SERVER_LOCK_TTL_MS,
      'NX',
    );

    if (result === 'OK') return;

    throw new AppError({
      code: 'SERVER_BUSY',
      statusCode: 409,
      message: 'Server is busy with another operation',
      details: { serverId },
    });
  }

  private async releaseServerLock(serverId: string, token: string): Promise<void> {
    const script = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

    await this.queueConnection.eval(script, 1, serverLockKey(serverId), token);
  }

  private requestCancellation(jobId: string): Promise<'OK'> {
    return this.queueConnection.set(
      jobCancellationKey(jobId),
      '1',
      'EX',
      CANCELLATION_KEY_TTL_SECONDS,
    );
  }

  private async clearCancellation(jobId: string): Promise<void> {
    await this.queueConnection.del(jobCancellationKey(jobId));
  }

  private async isCancellationRequested(jobId: string): Promise<boolean> {
    const value = await this.queueConnection.get(jobCancellationKey(jobId));
    return value === '1';
  }
}

function getJobId(job: Job<ServerJobData>): string {
  if (typeof job.id === 'string' && job.id.length > 0) return job.id;
  if (typeof job.id === 'number') return String(job.id);
  return randomUUID();
}

function mapBullMqState(state: string): JobState['status'] {
  switch (state) {
    case 'active':
      return 'ACTIVE';
    case 'completed':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED';
    case 'waiting':
    case 'delayed':
    case 'paused':
    case 'prioritized':
    case 'waiting-children':
    default:
      return 'QUEUED';
  }
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function normalizeProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  const rounded = Math.round(progress);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

function serverLockKey(serverId: string): string {
  return `lock:server:${serverId}`;
}

function jobCancellationKey(jobId: string): string {
  return `job:cancel:${jobId}`;
}

function isCancelledError(error: unknown): error is AppError {
  return error instanceof AppError && error.code === 'JOB_CANCELLED';
}
