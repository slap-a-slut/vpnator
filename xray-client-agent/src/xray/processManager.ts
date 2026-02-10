import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

interface StartProcessParams {
  binary: string;
  args: string[];
  options: SpawnOptions;
}

interface ProcessManagerOptions {
  spawnFn?: SpawnFn;
  killFn?: typeof process.kill;
  isRunningFn?: (pid: number) => boolean;
  sleepFn?: (ms: number) => Promise<void>;
  waitForStartMs?: number;
  stopTimeoutMs?: number;
  pollIntervalMs?: number;
}

export class XrayProcessManager {
  private readonly spawnFn: SpawnFn;
  private readonly killFn: typeof process.kill;
  private readonly isRunningFn: (pid: number) => boolean;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly waitForStartMs: number;
  private readonly stopTimeoutMs: number;
  private readonly pollIntervalMs: number;

  public constructor(options: ProcessManagerOptions = {}) {
    this.spawnFn =
      options.spawnFn ??
      ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
    this.killFn = options.killFn ?? process.kill.bind(process);
    this.isRunningFn = options.isRunningFn ?? defaultIsRunning;
    this.sleepFn = options.sleepFn ?? sleep;
    this.waitForStartMs = options.waitForStartMs ?? 1500;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5000;
    this.pollIntervalMs = options.pollIntervalMs ?? 100;
  }

  public async start(params: StartProcessParams): Promise<number> {
    const child = this.spawnFn(params.binary, params.args, params.options);
    const pid = child.pid;

    if (!pid || pid <= 0) {
      throw new Error('Failed to spawn xray-core process');
    }

    await this.waitForStart(child, pid);
    child.unref();

    return pid;
  }

  public async stop(pid: number): Promise<void> {
    if (!this.isRunning(pid)) return;

    this.safeKill(pid, 'SIGTERM');

    const stopDeadline = Date.now() + this.stopTimeoutMs;
    while (Date.now() < stopDeadline) {
      if (!this.isRunning(pid)) return;
      await this.sleepFn(this.pollIntervalMs);
    }

    this.safeKill(pid, 'SIGKILL');

    const killDeadline = Date.now() + this.pollIntervalMs * 5;
    while (Date.now() < killDeadline) {
      if (!this.isRunning(pid)) return;
      await this.sleepFn(this.pollIntervalMs);
    }

    throw new Error(`Failed to stop process ${pid}`);
  }

  public isRunning(pid: number): boolean {
    return this.isRunningFn(pid);
  }

  private async waitForStart(child: ChildProcess, pid: number): Promise<void> {
    let spawnError: unknown = null;

    const onError = (error: Error) => {
      spawnError = error;
    };

    child.once('error', onError);

    const deadline = Date.now() + this.waitForStartMs;
    while (Date.now() < deadline) {
      if (spawnError !== null) {
        child.off('error', onError);
        const reason = spawnError instanceof Error ? spawnError.message : 'unknown spawn error';
        throw new Error(`Failed to start xray-core: ${reason}`);
      }

      if (this.isRunning(pid)) {
        child.off('error', onError);
        return;
      }

      await this.sleepFn(this.pollIntervalMs);
    }

    child.off('error', onError);
    throw new Error('xray-core process did not become ready in time');
  }

  private safeKill(pid: number, signal: NodeJS.Signals): void {
    try {
      this.killFn(pid, signal);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ESRCH') return;
      throw error;
    }
  }
}

function defaultIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
