import { AgentError, formatAgentError } from './errors';
import { runSupervisorProcess } from './xray/supervisor';

interface ParsedArgs {
  binary: string;
  config: string;
  stateFile: string;
  xrayLog: string;
  startupTimeout: number;
  maxRestarts: number;
  backoff: number[];
  host: string;
  port: number;
  healthMode: 'proxy' | 'vpn';
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) continue;
    values.set(key.slice(2), value);
    index += 1;
  }

  const binary = required(values, 'binary');
  const config = required(values, 'config');
  const stateFile = required(values, 'state-file');
  const xrayLog = required(values, 'xray-log');
  const startupTimeout = toNumber(required(values, 'startup-timeout'), 'startup-timeout');
  const maxRestarts = toNumber(required(values, 'max-restarts'), 'max-restarts');
  const host = values.get('host') ?? '127.0.0.1';
  const port = toNumber(values.get('port') ?? '1080', 'port');
  const rawHealthMode = (values.get('health-mode') ?? 'proxy').toLowerCase();
  const healthMode = rawHealthMode === 'vpn' ? 'vpn' : 'proxy';

  const backoff =
    values
      .get('backoff')
      ?.split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item >= 0)
      .map((item) => Math.floor(item)) ?? [1000, 2000, 4000];

  return {
    binary,
    config,
    stateFile,
    xrayLog,
    startupTimeout,
    maxRestarts,
    backoff,
    host,
    port,
    healthMode,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  await runSupervisorProcess({
    binary: args.binary,
    configPath: args.config,
    stateFilePath: args.stateFile,
    xrayLogPath: args.xrayLog,
    startupTimeoutMs: args.startupTimeout,
    maxRestarts: args.maxRestarts,
    backoffMs: args.backoff,
    host: args.host,
    port: args.port,
    healthMode: args.healthMode,
  });
}

function required(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (value && value.trim().length > 0) return value;
  throw new Error(`Missing required argument --${key}`);
}

function toNumber(value: string, key: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric argument --${key}`);
  }

  return Math.floor(parsed);
}

void main().catch((error: unknown) => {
  if (error instanceof AgentError) {
    console.error(formatAgentError(error));
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }

  process.exit(1);
});
