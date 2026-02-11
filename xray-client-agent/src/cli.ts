#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { chmod, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { ensureAgentDirectories, resolveAgentPaths } from './appPaths';
import { XrayBinaryManager } from './binary/binaryManager';
import { AgentError, formatAgentError } from './errors';
import { createAgentLogger } from './logger';
import { createProxyManager } from './proxy/managerFactory';
import { importShareToken } from './services/importService';
import { AgentStateStore } from './state/agentStateStore';
import { tailLines } from './util/tail';
import { buildXrayConfigFromVlessLink, type ConnectionMode } from './xray/configBuilder';
import { XrayProcessManager } from './xray/processManager';
import { runSupervisorProcess } from './xray/supervisor';

interface ImportArgs {
  token: string;
  'base-url': string;
}

interface LogsArgs {
  tail: number;
  source: 'agent' | 'xray' | 'all';
}

interface SupervisorArgs {
  binary: string;
  config: string;
  'state-file': string;
  'xray-log': string;
  'startup-timeout': number;
  'max-restarts': number;
  backoff: string;
  host: string;
  port: number;
  'health-mode': ConnectionMode;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof AgentError) return formatAgentError(error);
  if (error instanceof Error) return error.message;
  return String(error);
}

async function main(): Promise<void> {
  const paths = resolveAgentPaths();
  await ensureAgentDirectories(paths);

  const logger = createAgentLogger(paths.agentLogFile);
  const stateStore = new AgentStateStore(paths.stateFile);
  const processManager = new XrayProcessManager();
  const proxyManager = createProxyManager();
  const binaryManager = new XrayBinaryManager({
    binDir: paths.binDir,
    binaryPath: paths.xrayBinaryFile,
    logger,
  });

  async function recordError(error: unknown): Promise<void> {
    const message = toErrorMessage(error);
    logger.error({ error: message }, 'command failed');

    await stateStore.update((state) => ({
      ...state,
      lastError: message,
      updatedAt: new Date().toISOString(),
    }));
  }

  async function commandImport(token: string, baseUrl: string): Promise<void> {
    const imported = await importShareToken(baseUrl, token);

    await stateStore.update((state) => {
      const next = {
        ...state,
        imported,
        updatedAt: new Date().toISOString(),
      };
      delete next.lastError;
      return next;
    });

    logger.info(
      {
        serverId: imported.serverId,
        baseUrl: imported.baseUrl,
      },
      'config imported',
    );

    console.log('Import completed successfully');
  }

  async function commandConnect(): Promise<void> {
    const state = await stateStore.read();
    if (!state.imported) {
      throw new Error('No imported config found. Run: agent import --token <token> --base-url <url>');
    }

    if (state.supervisor?.pid && processManager.isRunning(state.supervisor.pid)) {
      console.log(`Already connected (supervisor pid=${state.supervisor.pid})`);
      return;
    }

    const mode: ConnectionMode = state.mode ?? 'proxy';
    if (mode === 'vpn' && process.platform !== 'darwin') {
      throw new AgentError({
        code: 'VPN_UNSUPPORTED_PLATFORM',
        message: 'VPN mode is currently supported only on macOS',
      });
    }
    ensureVpnPrivileges(mode);
    const binary = await binaryManager.ensureBinary();
    const xrayConfig = buildXrayConfigFromVlessLink(state.imported.vlessLink, { mode });
    await writeFile(paths.xrayConfigFile, `${JSON.stringify(xrayConfig, null, 2)}\n`, 'utf8');
    if (process.platform !== 'win32') {
      await chmod(paths.xrayConfigFile, 0o600);
    }

    const currentScript = process.argv[1];
    if (!currentScript) {
      throw new AgentError({
        code: 'STARTUP_FAILED',
        message: 'Unable to determine agent CLI path for supervisor process',
      });
    }

    const supervisor = spawn(
      process.execPath,
      [
        currentScript,
        '__run-supervisor',
        '--binary',
        binary,
        '--config',
        paths.xrayConfigFile,
        '--state-file',
        paths.stateFile,
        '--xray-log',
        paths.xrayLogFile,
        '--startup-timeout',
        '10000',
        '--max-restarts',
        '3',
        '--backoff',
        '1000,2000,4000',
        '--host',
        '127.0.0.1',
        '--port',
        '1080',
        '--health-mode',
        mode,
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

    await stateStore.update((current) => {
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
      await waitForHealthyStartup({
        stateStore,
        processManager,
        supervisorPid,
        timeoutMs: 10_000,
        mode,
      });
    } catch (error) {
      if (processManager.isRunning(supervisorPid)) {
        await processManager.stop(supervisorPid);
      }

      await stateStore.update((current) => {
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

    const connectedState = await stateStore.read();
    const pid = connectedState.process?.pid ?? null;
    logger.info({ pid, supervisorPid }, 'xray supervisor started');
    console.log(
      `Connected (${mode}). xray-core is running (pid=${pid ?? 'unknown'}). SOCKS5: 127.0.0.1:1080`,
    );
  }

  async function commandDisconnect(): Promise<void> {
    const state = await stateStore.read();

    const supervisorPid = state.supervisor?.pid;
    const processPid = state.process?.pid;

    if (!supervisorPid && !processPid) {
      console.log('Already disconnected');
      return;
    }

    if (supervisorPid && processManager.isRunning(supervisorPid)) {
      await processManager.stop(supervisorPid);
    }

    if (processPid && processManager.isRunning(processPid)) {
      await processManager.stop(processPid);
    }

    await stateStore.update((current) => {
      const next = { ...current, updatedAt: new Date().toISOString() };
      delete next.process;
      delete next.supervisor;
      delete next.lastError;
      return next;
    });

    logger.info({ processPid, supervisorPid }, 'xray process disconnected');
    console.log('Disconnected');
  }

  async function commandStatus(): Promise<void> {
    const state = await stateStore.read();
    const processPid = state.process?.pid;
    const supervisorPid = state.supervisor?.pid;

    const running = processPid ? processManager.isRunning(processPid) : false;
    const supervisorRunning = supervisorPid ? processManager.isRunning(supervisorPid) : false;

    const payload = {
      running,
      pid: running ? processPid : null,
      supervisorPid: supervisorRunning ? supervisorPid : null,
      lastError: state.lastError ?? null,
      imported: Boolean(state.imported),
      proxyEnabled: state.proxy?.enabled ?? false,
      mode: state.mode ?? 'proxy',
    };

    console.log(JSON.stringify(payload, null, 2));
  }

  async function commandLogs(tail: number, source: LogsArgs['source']): Promise<void> {
    if (source === 'all') {
      const agentLines = await tailLines(paths.agentLogFile, tail);
      const xrayLines = await tailLines(paths.xrayLogFile, tail);

      console.log('[agent.log]');
      console.log(agentLines.length > 0 ? agentLines.join('\n') : 'No logs yet');
      console.log('\n[xray.log]');
      console.log(xrayLines.length > 0 ? xrayLines.join('\n') : 'No logs yet');
      return;
    }

    const filePath = source === 'xray' ? paths.xrayLogFile : paths.agentLogFile;
    const lines = await tailLines(filePath, tail);

    if (lines.length === 0) {
      console.log('No logs yet');
      return;
    }

    console.log(lines.join('\n'));
  }

  async function commandProxyOn(): Promise<void> {
    const result = await proxyManager.enable('127.0.0.1', 1080);

    await stateStore.update((state) => {
      const next = {
        ...state,
        proxy: {
          enabled: result.applied,
          method: result.method,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      };

      if (!result.applied) return next;

      delete next.lastError;
      return next;
    });

    logger.info({ method: result.method, applied: result.applied }, 'proxy-on finished');
    console.log(result.message);
    for (const line of result.instructions ?? []) {
      console.log(`- ${line}`);
    }
  }

  async function commandProxyOff(): Promise<void> {
    const result = await proxyManager.disable();

    await stateStore.update((state) => {
      const next = {
        ...state,
        proxy: {
          enabled: false,
          method: result.method,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      };

      if (!result.applied) return next;

      delete next.lastError;
      return next;
    });

    logger.info({ method: result.method, applied: result.applied }, 'proxy-off finished');
    console.log(result.message);
    for (const line of result.instructions ?? []) {
      console.log(`- ${line}`);
    }
  }

  async function commandMode(setMode: ConnectionMode): Promise<void> {
    if (setMode === 'vpn' && process.platform !== 'darwin') {
      throw new AgentError({
        code: 'VPN_UNSUPPORTED_PLATFORM',
        message: 'VPN mode is currently supported only on macOS',
      });
    }

    await stateStore.update((state) => ({
      ...state,
      mode: setMode,
      updatedAt: new Date().toISOString(),
    }));

    console.log(`Mode set to ${setMode}`);
  }

  async function commandRunSupervisor(argv: SupervisorArgs): Promise<void> {
    const backoff = parseBackoff(argv.backoff);

      await runSupervisorProcess({
        binary: argv.binary,
        configPath: argv.config,
        stateFilePath: argv['state-file'],
        xrayLogPath: argv['xray-log'],
        startupTimeoutMs: argv['startup-timeout'],
        maxRestarts: argv['max-restarts'],
        backoffMs: backoff,
        host: argv.host,
        port: argv.port,
        healthMode: argv['health-mode'],
      });
  }

  await yargs(hideBin(process.argv))
    .scriptName('agent')
    .strict()
    .command<ImportArgs>(
      'import',
      'Import remote config via one-time share token',
      (builder) =>
        builder
          .option('token', {
            type: 'string',
            demandOption: true,
            describe: 'One-time share token',
          })
          .option('base-url', {
            type: 'string',
            demandOption: true,
            describe: 'Control-plane base URL',
          }),
      async (argv) => {
        try {
          await commandImport(argv.token, argv['base-url']);
        } catch (error) {
          await recordError(error);
          throw error;
        }
      },
    )
    .command(
      'mode',
      'Set connection mode',
      (builder) =>
        builder.option('set', {
          type: 'string',
          choices: ['proxy', 'vpn'] as const,
          demandOption: true,
          describe: 'Connection mode',
        }),
      async (argv) => {
        try {
          await commandMode(argv.set);
        } catch (error) {
          await recordError(error);
          throw error;
        }
      },
    )
    .command(
      'connect',
      'Generate local config and start xray-core',
      () => undefined,
      async () => {
        try {
          await commandConnect();
        } catch (error) {
          await recordError(error);
          throw error;
        }
      },
    )
    .command(
      'disconnect',
      'Stop xray-core process',
      () => undefined,
      async () => {
        try {
          await commandDisconnect();
        } catch (error) {
          await recordError(error);
          throw error;
        }
      },
    )
    .command(
      'status',
      'Show agent status',
      () => undefined,
      async () => {
        try {
          await commandStatus();
        } catch (error) {
          await recordError(error);
          throw error;
        }
      },
    )
    .command<LogsArgs>(
      'logs',
      'Show recent logs',
      (builder) =>
        builder
          .option('tail', {
            type: 'number',
            default: 200,
            describe: 'Number of lines to show',
          })
          .option('source', {
            type: 'string',
            default: 'agent',
            choices: ['agent', 'xray', 'all'] as const,
            describe: 'Which log to show',
          }),
      async (argv) => {
        try {
          await commandLogs(argv.tail, argv.source);
        } catch (error) {
          await recordError(error);
          throw error;
        }
      },
    )
    .command(
      'proxy-on',
      'Enable system proxy to 127.0.0.1:1080',
      () => undefined,
      async () => {
        try {
          await commandProxyOn();
        } catch (error) {
          await recordError(error);
          throw error;
        }
      },
    )
    .command(
      'proxy-off',
      'Disable system proxy',
      () => undefined,
      async () => {
        try {
          await commandProxyOff();
        } catch (error) {
          await recordError(error);
          throw error;
        }
      },
    )
    .command<SupervisorArgs>(
      '__run-supervisor',
      false,
      (builder) =>
        builder
          .option('binary', { type: 'string', demandOption: true })
          .option('config', { type: 'string', demandOption: true })
          .option('state-file', { type: 'string', demandOption: true })
          .option('xray-log', { type: 'string', demandOption: true })
          .option('startup-timeout', { type: 'number', demandOption: true })
          .option('max-restarts', { type: 'number', demandOption: true })
          .option('backoff', { type: 'string', demandOption: true })
          .option('host', { type: 'string', demandOption: true })
          .option('port', { type: 'number', demandOption: true })
          .option('health-mode', {
            type: 'string',
            choices: ['proxy', 'vpn'] as const,
            demandOption: true,
          }),
      async (argv) => {
        await commandRunSupervisor(argv);
      },
    )
    .demandCommand(1)
    .fail((message: string | undefined, error: Error | undefined) => {
      const reason = message ?? toErrorMessage(error);
      if (reason) {
        console.error(reason);
      }
      process.exit(1);
    })
    .help()
    .parseAsync();
}

function parseBackoff(value: string): number[] {
  return value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .map((item) => Math.floor(item));
}

async function waitForHealthyStartup(params: {
  stateStore: AgentStateStore;
  processManager: XrayProcessManager;
  supervisorPid: number;
  timeoutMs: number;
  mode: ConnectionMode;
}): Promise<void> {
  const deadline = Date.now() + params.timeoutMs;

  while (Date.now() < deadline) {
    const state = await params.stateStore.read();

    if (state.lastError?.startsWith('STARTUP_FAILED')) {
      throw new AgentError({
        code: 'STARTUP_FAILED',
        message: state.lastError,
      });
    }

    const processPid = state.process?.pid;
    if (processPid && params.processManager.isRunning(processPid)) {
      return;
    }

    if (!params.processManager.isRunning(params.supervisorPid)) {
      throw new AgentError({
        code: 'STARTUP_FAILED',
        message: state.lastError ?? 'Supervisor exited during startup',
      });
    }

    await sleep(200);
  }

  throw new AgentError({
    code: 'STARTUP_FAILED',
    message:
      params.mode === 'vpn'
        ? 'VPN tunnel route was not ready within 10s'
        : 'SOCKS port 127.0.0.1:1080 was not ready within 10s',
  });
}

function ensureVpnPrivileges(mode: ConnectionMode): void {
  if (mode !== 'vpn') return;
  if (process.platform !== 'darwin') return;
  if (typeof process.getuid !== 'function') return;
  if (process.getuid() === 0) return;

  throw new AgentError({
    code: 'ELEVATION_REQUIRED',
    message:
      'VPN mode on macOS requires elevated privileges for TUN setup. Run with sudo or use proxy mode.',
  });
}

void main().catch((error) => {
  console.error(toErrorMessage(error));
  process.exit(1);
});
