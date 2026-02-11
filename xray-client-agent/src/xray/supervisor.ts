import { closeSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import { AgentError } from '../errors';
import { AgentStateStore } from '../state/agentStateStore';
import { runCommand } from '../util/exec';

export interface ReconnectLoopInstance {
  pid: number;
  stop(): Promise<void>;
  waitForExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export interface ReconnectLoopOptions {
  maxRestarts: number;
  backoffMs: number[];
  shouldStop(): boolean;
  startInstance(): Promise<ReconnectLoopInstance>;
  healthCheck(instance: ReconnectLoopInstance): Promise<boolean>;
  onRunning(pid: number): Promise<void>;
  onExit(reason: string): Promise<void>;
  onFailure(reason: string): Promise<void>;
  sleepFn(ms: number): Promise<void>;
  startupFailureReason: string;
}

export async function runReconnectLoop(options: ReconnectLoopOptions): Promise<void> {
  let restartAttempts = 0;

  while (!options.shouldStop()) {
    let instance: ReconnectLoopInstance;
    try {
      instance = await options.startInstance();
    } catch (error) {
      const reason = toErrorMessage(error, 'Failed to start xray-core');
      await options.onExit(reason);
      restartAttempts += 1;

      if (restartAttempts > options.maxRestarts) {
        await options.onFailure(reason);
        return;
      }

      await options.sleepFn(backoffForAttempt(options.backoffMs, restartAttempts));
      continue;
    }

    const healthy = await options.healthCheck(instance);
    if (!healthy) {
      await instance.stop();
      const reason = options.startupFailureReason;
      await options.onExit(reason);
      restartAttempts += 1;

      if (restartAttempts > options.maxRestarts) {
        await options.onFailure(reason);
        return;
      }

      await options.sleepFn(backoffForAttempt(options.backoffMs, restartAttempts));
      continue;
    }

    await options.onRunning(instance.pid);

    const exit = await instance.waitForExit();
    if (options.shouldStop()) return;

    const reason = `xray process exited (code=${exit.code ?? 'null'}, signal=${
      exit.signal ?? 'null'
    })`;
    await options.onExit(reason);

    restartAttempts += 1;
    if (restartAttempts > options.maxRestarts) {
      await options.onFailure(reason);
      return;
    }

    await options.sleepFn(backoffForAttempt(options.backoffMs, restartAttempts));
  }
}

interface SupervisorCliArgs {
  binary: string;
  configPath: string;
  stateFilePath: string;
  xrayLogPath: string;
  startupTimeoutMs?: number;
  maxRestarts?: number;
  backoffMs?: number[];
  host?: string;
  port?: number;
  healthMode?: 'proxy' | 'vpn';
}

export async function runSupervisorProcess(args: SupervisorCliArgs): Promise<void> {
  const stateStore = new AgentStateStore(args.stateFilePath);
  const startupTimeoutMs = args.startupTimeoutMs ?? 10_000;
  const maxRestarts = args.maxRestarts ?? 3;
  const backoffMs = args.backoffMs ?? [1_000, 2_000, 4_000];
  const host = args.host ?? '127.0.0.1';
  const port = args.port ?? 1080;
  const healthMode = args.healthMode ?? 'proxy';

  let stopRequested = false;
  let activeChild: ChildProcess | null = null;

  await stateStore.update((state) => ({
    ...state,
    supervisor: {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  }));

  const terminate = async (): Promise<void> => {
    stopRequested = true;

    const childPid = activeChild?.pid;
    if (activeChild && childPid) {
      safeKill(childPid, 'SIGTERM');
    }

    await stateStore.update((state) => {
      const next = {
        ...state,
        updatedAt: new Date().toISOString(),
      };
      delete next.process;
      delete next.supervisor;
      return next;
    });
  };

  process.once('SIGINT', () => {
    void terminate().finally(() => {
      process.exit(0);
    });
  });

  process.once('SIGTERM', () => {
    void terminate().finally(() => {
      process.exit(0);
    });
  });

  await runReconnectLoop({
    maxRestarts,
    backoffMs,
    shouldStop: () => stopRequested,
    startInstance: () => {
      const fd = openSync(args.xrayLogPath, 'a');
      const child = spawn(args.binary, ['run', '-config', args.configPath], {
        detached: false,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
      });
      closeSync(fd);

      const pid = child.pid;
      if (!pid || pid <= 0) {
        throw new AgentError({
          code: 'STARTUP_FAILED',
          message: 'Failed to spawn xray-core process',
        });
      }

      activeChild = child;

      return Promise.resolve({
        pid,
        stop: () => stopChild(child),
        waitForExit: () =>
          new Promise((resolve) => {
            child.once('exit', (code, signal) => {
              resolve({
                code,
                signal,
              });
            });
          }),
      });
    },
    startupFailureReason:
      healthMode === 'vpn'
        ? 'STARTUP_FAILED: VPN tunnel route was not ready within 10s'
        : 'STARTUP_FAILED: SOCKS port 127.0.0.1:1080 was not ready within 10s',
    healthCheck:
      healthMode === 'vpn'
        ? async () => waitForVpnRoute(startupTimeoutMs)
        : async () => waitForSocksPort(host, port, startupTimeoutMs),
    onRunning: async (pid) => {
      await stateStore.update((state) => {
        const next = {
          ...state,
          process: {
            pid,
            startedAt: new Date().toISOString(),
            binary: args.binary,
            configPath: args.configPath,
          },
          updatedAt: new Date().toISOString(),
        };
        delete next.lastError;
        return next;
      });
    },
    onExit: async (reason) => {
      await stateStore.update((state) => {
        const next = {
          ...state,
          lastError: reason,
          updatedAt: new Date().toISOString(),
        };
        delete next.process;
        return next;
      });
    },
    onFailure: async (reason) => {
      await stateStore.update((state) => {
        const next = {
          ...state,
          lastError: reason,
          updatedAt: new Date().toISOString(),
        };
        delete next.process;
        delete next.supervisor;
        return next;
      });
    },
    sleepFn: sleep,
  });

  await stateStore.update((state) => {
    const next = {
      ...state,
      updatedAt: new Date().toISOString(),
    };
    delete next.supervisor;
    return next;
  });
}

async function waitForSocksPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const ok = await tryConnect(host, port, 800);
    if (ok) return true;
    await sleep(250);
  }

  return false;
}

async function waitForVpnRoute(timeoutMs: number): Promise<boolean> {
  if (process.platform !== 'darwin') return false;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await runCommand('/usr/sbin/route', ['-n', 'get', 'default']);
    if (result.exitCode === 0 && /\binterface:\s*utun\d+\b/i.test(result.stdout)) {
      return true;
    }
    await sleep(250);
  }

  return false;
}

async function tryConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function backoffForAttempt(backoffMs: number[], attempt: number): number {
  if (backoffMs.length === 0) return 1_000;
  const index = Math.max(0, Math.min(attempt - 1, backoffMs.length - 1));
  return backoffMs[index] ?? 1_000;
}

async function stopChild(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return;

  safeKill(pid, 'SIGTERM');

  const done = await Promise.race([
    new Promise<boolean>((resolve) => {
      child.once('exit', () => resolve(true));
    }),
    sleep(1_500).then(() => false),
  ]);

  if (done) return;
  safeKill(pid, 'SIGKILL');
}

function safeKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ESRCH') return;
    throw error;
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return fallback;
}
