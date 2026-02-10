import { spawn } from 'node:child_process';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import type pino from 'pino';

import { ensureAgentDirectories, resolveAgentPaths, type AgentPaths } from '../appPaths';
import { XrayBinaryManager } from '../binary/binaryManager';
import { AgentError, formatAgentError } from '../errors';
import { createAgentLogger } from '../logger';
import { importShareToken } from '../services/importService';
import { AgentStateStore } from '../state/agentStateStore';
import { buildXrayConfigFromVlessLink } from '../xray/configBuilder';
import { XrayProcessManager } from '../xray/processManager';

export interface AgentCoreOptions {
  paths?: AgentPaths;
  logger?: pino.Logger;
  stateStore?: AgentStateStore;
  processManager?: XrayProcessManager;
  binaryManager?: XrayBinaryManager;
  startupTimeoutMs?: number;
  supervisorEntryPath?: string;
}

export interface AgentStatus {
  connected: boolean;
  running: boolean;
  pid: number | null;
  supervisorPid: number | null;
  lastError: string | null;
  imported: boolean;
  proxyEnabled: boolean;
  logsPath: string;
  agentLogPath: string;
  xrayLogPath: string;
}

export class AgentCore {
  private readonly paths: AgentPaths;
  private readonly logger: pino.Logger;
  private readonly stateStore: AgentStateStore;
  private readonly processManager: XrayProcessManager;
  private readonly binaryManager: XrayBinaryManager;
  private readonly startupTimeoutMs: number;
  private readonly supervisorEntryPath: string;
  private initialized = false;

  public constructor(options: AgentCoreOptions = {}) {
    this.paths = options.paths ?? resolveAgentPaths();
    this.logger = options.logger ?? createAgentLogger(this.paths.agentLogFile);
    this.stateStore = options.stateStore ?? new AgentStateStore(this.paths.stateFile);
    this.processManager = options.processManager ?? new XrayProcessManager();
    this.binaryManager =
      options.binaryManager ??
      new XrayBinaryManager({
        binDir: this.paths.binDir,
        binaryPath: this.paths.xrayBinaryFile,
        logger: this.logger,
      });
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
    this.supervisorEntryPath = options.supervisorEntryPath ?? defaultSupervisorEntryPath();
  }

  public getPaths(): AgentPaths {
    return this.paths;
  }

  public async importToken(baseUrl: string, token: string): Promise<void> {
    await this.ensureInitialized();

    try {
      const imported = await importShareToken(baseUrl, token);

      await this.stateStore.update((state) => {
        const next = {
          ...state,
          imported,
          updatedAt: new Date().toISOString(),
        };
        delete next.lastError;
        return next;
      });

      this.logger.info(
        {
          serverId: imported.serverId,
          baseUrl: imported.baseUrl,
        },
        'config imported',
      );
    } catch (error) {
      await this.recordError(error);
      throw error;
    }
  }

  public async connect(): Promise<AgentStatus> {
    await this.ensureInitialized();

    try {
      const state = await this.stateStore.read();
      if (!state.imported) {
        throw new Error(
          'No imported config found. Run: agent import --token <token> --base-url <url>',
        );
      }

      if (state.supervisor?.pid && this.processManager.isRunning(state.supervisor.pid)) {
        return this.status();
      }

      const binary = await this.binaryManager.ensureBinary();
      const xrayConfig = buildXrayConfigFromVlessLink(state.imported.vlessLink);
      await writeFile(this.paths.xrayConfigFile, `${JSON.stringify(xrayConfig, null, 2)}\n`, 'utf8');

      if (process.platform !== 'win32') {
        await chmod(this.paths.xrayConfigFile, 0o600);
      }

      const supervisor = spawn(
        process.execPath,
        [
          this.supervisorEntryPath,
          '--binary',
          binary,
          '--config',
          this.paths.xrayConfigFile,
          '--state-file',
          this.paths.stateFile,
          '--xray-log',
          this.paths.xrayLogFile,
          '--startup-timeout',
          String(this.startupTimeoutMs),
          '--max-restarts',
          '3',
          '--backoff',
          '1000,2000,4000',
          '--host',
          '127.0.0.1',
          '--port',
          '1080',
        ],
        {
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
        },
      );

      const supervisorPid = supervisor.pid;
      if (!supervisorPid || supervisorPid <= 0) {
        throw new AgentError({
          code: 'STARTUP_FAILED',
          message: 'Failed to start supervisor process',
        });
      }

      supervisor.unref();

      await this.stateStore.update((current) => {
        const next = {
          ...current,
          supervisor: {
            pid: supervisorPid,
            startedAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };
        delete next.process;
        delete next.lastError;
        return next;
      });

      try {
        await this.waitForHealthyStartup(supervisorPid);
      } catch (error) {
        if (this.processManager.isRunning(supervisorPid)) {
          await this.processManager.stop(supervisorPid);
        }

        await this.stateStore.update((current) => {
          const next = {
            ...current,
            lastError: toErrorMessage(error),
            updatedAt: new Date().toISOString(),
          };
          delete next.process;
          delete next.supervisor;
          return next;
        });

        throw error;
      }

      const connectedState = await this.stateStore.read();
      const pid = connectedState.process?.pid ?? null;
      this.logger.info({ pid, supervisorPid }, 'xray supervisor started');
      return this.status();
    } catch (error) {
      await this.recordError(error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    await this.ensureInitialized();

    try {
      const state = await this.stateStore.read();
      const supervisorPid = state.supervisor?.pid;
      const processPid = state.process?.pid;

      if (supervisorPid && this.processManager.isRunning(supervisorPid)) {
        await this.processManager.stop(supervisorPid);
      }

      if (processPid && this.processManager.isRunning(processPid)) {
        await this.processManager.stop(processPid);
      }

      await this.stateStore.update((current) => {
        const next = { ...current, updatedAt: new Date().toISOString() };
        delete next.process;
        delete next.supervisor;
        delete next.lastError;
        return next;
      });

      this.logger.info({ processPid, supervisorPid }, 'xray process disconnected');
    } catch (error) {
      await this.recordError(error);
      throw error;
    }
  }

  public async status(): Promise<AgentStatus> {
    await this.ensureInitialized();

    const state = await this.stateStore.read();
    const processPid = state.process?.pid;
    const supervisorPid = state.supervisor?.pid;

    const running = processPid ? this.processManager.isRunning(processPid) : false;
    const supervisorRunning = supervisorPid ? this.processManager.isRunning(supervisorPid) : false;

    return {
      connected: running,
      running,
      pid: running && typeof processPid === 'number' ? processPid : null,
      supervisorPid:
        supervisorRunning && typeof supervisorPid === 'number' ? supervisorPid : null,
      lastError: state.lastError ?? null,
      imported: Boolean(state.imported),
      proxyEnabled: state.proxy?.enabled ?? false,
      logsPath: this.paths.logsDir,
      agentLogPath: this.paths.agentLogFile,
      xrayLogPath: this.paths.xrayLogFile,
    };
  }

  private async waitForHealthyStartup(supervisorPid: number): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;

    while (Date.now() < deadline) {
      const state = await this.stateStore.read();

      if (state.lastError?.startsWith('STARTUP_FAILED')) {
        throw new AgentError({
          code: 'STARTUP_FAILED',
          message: state.lastError,
        });
      }

      const processPid = state.process?.pid;
      if (processPid && this.processManager.isRunning(processPid)) {
        return;
      }

      if (!this.processManager.isRunning(supervisorPid)) {
        throw new AgentError({
          code: 'STARTUP_FAILED',
          message: state.lastError ?? 'Supervisor exited during startup',
        });
      }

      await sleep(200);
    }

    throw new AgentError({
      code: 'STARTUP_FAILED',
      message: 'SOCKS port 127.0.0.1:1080 was not ready within 10s',
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await ensureAgentDirectories(this.paths);
    this.initialized = true;
  }

  private async recordError(error: unknown): Promise<void> {
    const message = toErrorMessage(error);
    this.logger.error({ error: message }, 'agent core command failed');
    await this.stateStore.update((state) => ({
      ...state,
      lastError: message,
      updatedAt: new Date().toISOString(),
    }));
  }
}

function defaultSupervisorEntryPath(): string {
  return join(__dirname, '..', 'supervisorEntry.js');
}

function toErrorMessage(error: unknown): string {
  if (error instanceof AgentError) return formatAgentError(error);
  if (error instanceof Error) return error.message;
  return String(error);
}
