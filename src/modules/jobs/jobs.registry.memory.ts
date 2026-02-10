import { randomUUID } from 'node:crypto';

import { AppError } from '../../lib/errors';
import type {
  JobLogLevelValue,
  JobStatus,
  JobState,
  JobsRegistry,
  ServerJobData,
  ServerJobProcessor,
} from './job.types';

const SERVER_LOCK_TTL_MS = 15 * 60 * 1000;

interface InMemoryJobEntry {
  id: string;
  data: ServerJobData;
  status: JobState['status'];
  progress: number;
  result?: unknown;
  error?: string;
  logs: { level: JobLogLevelValue; message: string; ts: string }[];
}

interface InMemoryJobsRegistryOptions {
  processor: ServerJobProcessor;
  jobStartDelayMs?: number;
}

export class InMemoryJobsRegistry implements JobsRegistry {
  private readonly jobs = new Map<string, InMemoryJobEntry>();
  private readonly serverLocks = new Map<
    string,
    {
      token: string;
      expiresAt: number;
    }
  >();
  private readonly cancelledJobs = new Set<string>();
  private readonly jobStartDelayMs: number;

  public constructor(private readonly options: InMemoryJobsRegistryOptions) {
    this.jobStartDelayMs = options.jobStartDelayMs ?? 25;
  }

  public enqueueInstall(serverId: string): Promise<{ jobId: string }> {
    return this.enqueue({ type: 'install', serverId });
  }

  public enqueueRepair(serverId: string): Promise<{ jobId: string }> {
    return this.enqueue({ type: 'repair', serverId });
  }

  public async cancel(jobId: string): Promise<{ jobId: string; status: JobStatus; cancelRequested: true }> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new AppError({
        code: 'JOB_NOT_FOUND',
        statusCode: 404,
        message: 'Job not found',
        details: { jobId },
      });
    }

    this.cancelledJobs.add(jobId);
    await this.appendLog(jobId, 'WARN', 'Cancellation requested');

    if (job.status === 'QUEUED') {
      job.status = 'COMPLETED';
      job.progress = 100;
      job.result = {
        canceled: true,
        reason: 'Cancellation requested before execution',
      };
      this.releaseServerLock(job.data.serverId, job.data.lockToken);
      await this.appendLog(jobId, 'INFO', 'Job cancelled before execution');
    }

    return {
      jobId,
      status: job.status,
      cancelRequested: true,
    };
  }

  public getJob(jobId: string): Promise<JobState> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return Promise.reject(
        new AppError({
          code: 'JOB_NOT_FOUND',
          statusCode: 404,
          message: 'Job not found',
          details: { jobId },
        }),
      );
    }

    return Promise.resolve({
      id: job.id,
      status: job.status,
      progress: job.progress,
      ...(job.result !== undefined ? { result: job.result } : {}),
      ...(job.error !== undefined ? { error: job.error } : {}),
    });
  }

  public getLogs(jobId: string, tail: number) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return Promise.reject(
        new AppError({
          code: 'JOB_NOT_FOUND',
          statusCode: 404,
          message: 'Job not found',
          details: { jobId },
        }),
      );
    }

    return Promise.resolve(job.logs.slice(-tail));
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }

  private async enqueue(data: Omit<ServerJobData, 'lockToken'>): Promise<{ jobId: string }> {
    const jobId = randomUUID();
    const lockToken = jobId;
    this.acquireServerLock(data.serverId, lockToken);

    const entry: InMemoryJobEntry = {
      id: jobId,
      data: {
        ...data,
        lockToken,
      },
      status: 'QUEUED',
      progress: 0,
      logs: [],
    };
    this.jobs.set(jobId, entry);

    await this.appendLog(jobId, 'INFO', `Job queued: type=${data.type} serverId=${data.serverId}`);

    setTimeout(() => {
      void this.run(jobId);
    }, this.jobStartDelayMs);

    return { jobId };
  }

  private async run(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    if (this.cancelledJobs.has(jobId) && job.status === 'COMPLETED') {
      return;
    }

    job.status = 'ACTIVE';
    job.progress = Math.max(job.progress, 5);

    try {
      const result = await this.options.processor.process(job.data, {
        jobId,
        setProgress: (progress) => {
          const current = this.jobs.get(jobId);
          if (!current) return Promise.resolve();
          current.progress = normalizeProgress(progress);
          return Promise.resolve();
        },
        appendLog: (level, message) => this.appendLog(jobId, level, message),
        isCancelled: () => Promise.resolve(this.cancelledJobs.has(jobId)),
      });

      job.status = 'COMPLETED';
      job.progress = 100;
      job.result = result;
      await this.appendLog(jobId, 'INFO', 'Job completed successfully');
    } catch (error) {
      const isCancelled =
        error instanceof AppError && error.code === 'JOB_CANCELLED';

      if (isCancelled) {
        job.status = 'COMPLETED';
        job.progress = 100;
        job.result = {
          canceled: true,
          reason: error.message,
        };
        await this.appendLog(jobId, 'WARN', `Job cancelled: ${error.message}`);
      } else {
        job.status = 'FAILED';
        job.progress = 100;
        job.error = error instanceof Error ? error.message : 'Unknown error';
        await this.appendLog(jobId, 'ERROR', `Job failed: ${job.error}`);
      }
    } finally {
      this.releaseServerLock(job.data.serverId, job.data.lockToken);
      this.cancelledJobs.delete(jobId);
    }
  }

  private appendLog(jobId: string, level: JobLogLevelValue, message: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return Promise.resolve();

    job.logs.push({
      level,
      message,
      ts: new Date().toISOString(),
    });

    return Promise.resolve();
  }

  private acquireServerLock(serverId: string, token: string): void {
    this.cleanupExpiredLock(serverId);
    const key = serverLockKey(serverId);
    const existing = this.serverLocks.get(key);
    if (existing) {
      throw new AppError({
        code: 'SERVER_BUSY',
        statusCode: 409,
        message: 'Server is busy with another operation',
        details: { serverId },
      });
    }

    this.serverLocks.set(key, {
      token,
      expiresAt: Date.now() + SERVER_LOCK_TTL_MS,
    });
  }

  private releaseServerLock(serverId: string, token: string): void {
    const key = serverLockKey(serverId);
    const existing = this.serverLocks.get(key);
    if (!existing) return;
    if (existing.token !== token) return;
    this.serverLocks.delete(key);
  }

  private cleanupExpiredLock(serverId: string): void {
    const key = serverLockKey(serverId);
    const existing = this.serverLocks.get(key);
    if (!existing) return;
    if (existing.expiresAt > Date.now()) return;
    this.serverLocks.delete(key);
  }
}

function serverLockKey(serverId: string): string {
  return `lock:server:${serverId}`;
}

function normalizeProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  const rounded = Math.round(progress);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}
