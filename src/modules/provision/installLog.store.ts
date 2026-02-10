import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { env } from '../../lib/env';

export interface InstallLogStore {
  append(serverId: string, message: string): Promise<void>;
  tail(serverId: string, lineLimit: number): Promise<string[]>;
}

export class FileInstallLogStore implements InstallLogStore {
  private readonly baseDir: string;

  public constructor(baseDir = env.INSTALL_LOG_DIR) {
    this.baseDir = resolve(baseDir);
  }

  public async append(serverId: string, message: string): Promise<void> {
    const line = `${new Date().toISOString()} ${message}\n`;
    await mkdir(this.baseDir, { recursive: true });
    await appendFile(this.logPath(serverId), line, 'utf8');
  }

  public async tail(serverId: string, lineLimit: number): Promise<string[]> {
    const path = this.logPath(serverId);
    try {
      const content = await readFile(path, 'utf8');
      const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
      return lines.slice(-lineLimit);
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }

  private logPath(serverId: string): string {
    return resolve(this.baseDir, `${serverId}.log`);
  }
}

export class NoopInstallLogStore implements InstallLogStore {
  public append(_serverId: string, _message: string): Promise<void> {
    return Promise.resolve();
  }

  public tail(_serverId: string, _lineLimit: number): Promise<string[]> {
    return Promise.resolve([]);
  }
}

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return 'code' in error && (error as { code?: string }).code === 'ENOENT';
}
