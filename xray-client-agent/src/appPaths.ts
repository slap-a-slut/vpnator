import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import envPaths from 'env-paths';

export interface AgentPaths {
  dataDir: string;
  runtimeDir: string;
  logsDir: string;
  binDir: string;
  stateFile: string;
  xrayConfigFile: string;
  xrayBinaryFile: string;
  agentLogFile: string;
  xrayLogFile: string;
}

export function resolveAgentPaths(): AgentPaths {
  const app = envPaths('xray-client-agent', { suffix: '' });
  const dataDir = app.data;
  const runtimeDir = join(dataDir, 'runtime');
  const logsDir = join(dataDir, 'logs');
  const binDir = join(dataDir, 'bin');
  const binaryName = process.platform === 'win32' ? 'xray.exe' : 'xray';

  return {
    dataDir,
    runtimeDir,
    logsDir,
    binDir,
    stateFile: join(dataDir, 'state.json'),
    xrayConfigFile: join(runtimeDir, 'config.json'),
    xrayBinaryFile: join(binDir, binaryName),
    agentLogFile: join(logsDir, 'agent.log'),
    xrayLogFile: join(logsDir, 'xray.log'),
  };
}

export async function ensureAgentDirectories(paths: AgentPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.dataDir, { recursive: true }),
    mkdir(paths.runtimeDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.binDir, { recursive: true }),
  ]);
}
