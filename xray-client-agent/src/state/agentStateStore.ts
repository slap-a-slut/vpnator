import { access, chmod, readFile, writeFile } from 'node:fs/promises';

import type { AgentState } from '../types';

const DEFAULT_STATE_VERSION = 1 as const;

export class AgentStateStore {
  public constructor(private readonly stateFilePath: string) {}

  public async read(): Promise<AgentState> {
    const exists = await this.exists();
    if (!exists) return this.defaultState();

    const raw = await readFile(this.stateFilePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AgentState>;

    return {
      version: DEFAULT_STATE_VERSION,
      ...(parsed.imported ? { imported: parsed.imported } : {}),
      ...(parsed.process ? { process: parsed.process } : {}),
      ...(parsed.supervisor ? { supervisor: parsed.supervisor } : {}),
      ...(parsed.proxy ? { proxy: parsed.proxy } : {}),
      ...(parsed.mode === 'proxy' || parsed.mode === 'vpn' ? { mode: parsed.mode } : {}),
      ...(parsed.lastError ? { lastError: parsed.lastError } : {}),
      updatedAt:
        typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  }

  public async write(next: AgentState): Promise<void> {
    const normalized: AgentState = {
      version: DEFAULT_STATE_VERSION,
      ...(next.imported ? { imported: next.imported } : {}),
      ...(next.process ? { process: next.process } : {}),
      ...(next.supervisor ? { supervisor: next.supervisor } : {}),
      ...(next.proxy ? { proxy: next.proxy } : {}),
      ...(next.mode ? { mode: next.mode } : {}),
      ...(next.lastError ? { lastError: next.lastError } : {}),
      updatedAt: next.updatedAt,
    };

    await writeFile(this.stateFilePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    if (process.platform !== 'win32') {
      await chmod(this.stateFilePath, 0o600);
    }
  }

  public async update(mutator: (state: AgentState) => AgentState): Promise<AgentState> {
    const current = await this.read();
    const next = mutator(current);
    await this.write(next);
    return next;
  }

  private async exists(): Promise<boolean> {
    try {
      await access(this.stateFilePath);
      return true;
    } catch {
      return false;
    }
  }

  private defaultState(): AgentState {
    return {
      version: DEFAULT_STATE_VERSION,
      updatedAt: new Date().toISOString(),
    };
  }
}
