import { runCommand } from '../util/exec';

import type { ProxyManager, ProxyResult } from './proxyManager';

export class WindowsProxyManager implements ProxyManager {
  public async enable(host: string, port: number): Promise<ProxyResult> {
    const proxy = `${host}:${port}`;
    const result = await runCommand('netsh', ['winhttp', 'set', 'proxy', proxy]);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'Failed to set WinHTTP proxy');
    }

    return {
      applied: true,
      method: 'windows-netsh-winhttp',
      message: `WinHTTP proxy enabled (${proxy})`,
    };
  }

  public async disable(): Promise<ProxyResult> {
    const result = await runCommand('netsh', ['winhttp', 'reset', 'proxy']);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'Failed to reset WinHTTP proxy');
    }

    return {
      applied: true,
      method: 'windows-netsh-winhttp',
      message: 'WinHTTP proxy disabled',
    };
  }
}
