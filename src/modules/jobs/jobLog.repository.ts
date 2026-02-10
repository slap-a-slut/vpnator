import { JobLogLevel, type PrismaClient } from '@prisma/client';

import type { JobLogLevelValue } from './job.types';

interface CreateJobLogParams {
  jobId: string;
  level: JobLogLevelValue;
  message: string;
}

export class JobLogRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async create(params: CreateJobLogParams) {
    await this.prisma.jobLog.create({
      data: {
        jobId: params.jobId,
        level: toPrismaJobLogLevel(params.level),
        message: params.message,
      },
    });
  }

  public async tail(jobId: string, tail: number) {
    const rows = await this.prisma.jobLog.findMany({
      where: { jobId },
      orderBy: { ts: 'desc' },
      take: tail,
    });

    return rows.reverse().map((row) => ({
      level: fromPrismaJobLogLevel(row.level),
      message: row.message,
      ts: row.ts.toISOString(),
    }));
  }
}

function toPrismaJobLogLevel(level: JobLogLevelValue): JobLogLevel {
  switch (level) {
    case 'INFO':
      return JobLogLevel.INFO;
    case 'WARN':
      return JobLogLevel.WARN;
    case 'ERROR':
      return JobLogLevel.ERROR;
  }
}

function fromPrismaJobLogLevel(level: JobLogLevel): JobLogLevelValue {
  switch (level) {
    case JobLogLevel.INFO:
      return 'INFO';
    case JobLogLevel.WARN:
      return 'WARN';
    case JobLogLevel.ERROR:
      return 'ERROR';
  }
}
