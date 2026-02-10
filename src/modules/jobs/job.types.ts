export type ServerJobType = 'install' | 'repair';

export type JobStatus = 'QUEUED' | 'ACTIVE' | 'COMPLETED' | 'FAILED';

export type JobLogLevelValue = 'INFO' | 'WARN' | 'ERROR';

export interface ServerJobData {
  type: ServerJobType;
  serverId: string;
  lockToken: string;
}

export interface JobState {
  id: string;
  status: JobStatus;
  progress: number;
  result?: unknown;
  error?: string;
}

export interface JobLogLine {
  level: JobLogLevelValue;
  message: string;
  ts: string;
}

export interface JobProcessorContext {
  jobId: string;
  setProgress(progress: number): Promise<void>;
  appendLog(level: JobLogLevelValue, message: string): Promise<void>;
  isCancelled(): Promise<boolean>;
}

export interface ServerJobProcessor {
  process(data: ServerJobData, context: JobProcessorContext): Promise<unknown>;
}

export interface JobsRegistry {
  enqueueInstall(serverId: string): Promise<{ jobId: string }>;
  enqueueRepair(serverId: string): Promise<{ jobId: string }>;
  cancel(jobId: string): Promise<{ jobId: string; status: JobStatus; cancelRequested: true }>;
  getJob(jobId: string): Promise<JobState>;
  getLogs(jobId: string, tail: number): Promise<JobLogLine[]>;
  close(): Promise<void>;
}
