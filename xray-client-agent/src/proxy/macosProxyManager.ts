import { runCommand } from '../util/exec';

import type { ProxyManager, ProxyResult } from './proxyManager';

export class MacOsProxyManager implements ProxyManager {
  public async enable(host: string, port: number): Promise<ProxyResult> {
    const services = await this.getServices();

    for (const service of services) {
      const commands: string[][] = [
        ['-setwebproxy', service, host, String(port)],
        ['-setsecurewebproxy', service, host, String(port)],
        ['-setwebproxystate', service, 'on'],
        ['-setsecurewebproxystate', service, 'on'],
      ];

      for (const args of commands) {
        const result = await runCommand('networksetup', args);
        if (result.exitCode !== 0) {
          return this.permissionHelp(
            service,
            `Failed to enable proxy for network service "${service}"`,
            host,
            port,
          );
        }
      }
    }

    return {
      applied: true,
      method: 'macos-networksetup',
      message: `System proxy enabled for ${services.length} network service(s)`,
    };
  }

  public async disable(): Promise<ProxyResult> {
    const services = await this.getServices();

    for (const service of services) {
      const commands: string[][] = [
        ['-setwebproxystate', service, 'off'],
        ['-setsecurewebproxystate', service, 'off'],
      ];

      for (const args of commands) {
        const result = await runCommand('networksetup', args);
        if (result.exitCode !== 0) {
          return {
            applied: false,
            method: 'macos-networksetup',
            message: `Failed to disable proxy for network service "${service}"`,
            instructions: [
              `sudo networksetup -setwebproxystate "${service}" off`,
              `sudo networksetup -setsecurewebproxystate "${service}" off`,
            ],
          };
        }
      }
    }

    return {
      applied: true,
      method: 'macos-networksetup',
      message: `System proxy disabled for ${services.length} network service(s)`,
    };
  }

  private async getServices(): Promise<string[]> {
    const result = await runCommand('networksetup', ['-listallnetworkservices']);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'Failed to list macOS network services');
    }

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.startsWith('An asterisk'))
      .filter((line) => !line.startsWith('*'));
  }

  private permissionHelp(
    service: string,
    message: string,
    host: string,
    port: number,
  ): ProxyResult {
    return {
      applied: false,
      method: 'macos-networksetup',
      message,
      instructions: [
        `sudo networksetup -setwebproxy "${service}" ${host} ${port}`,
        `sudo networksetup -setsecurewebproxy "${service}" ${host} ${port}`,
        `sudo networksetup -setwebproxystate "${service}" on`,
        `sudo networksetup -setsecurewebproxystate "${service}" on`,
      ],
    };
  }
}
