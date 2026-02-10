import type { ProxyManager } from './proxyManager';
import { LinuxProxyManager } from './linuxProxyManager';
import { MacOsProxyManager } from './macosProxyManager';
import { WindowsProxyManager } from './windowsProxyManager';

export function createProxyManager(platform: NodeJS.Platform = process.platform): ProxyManager {
  if (platform === 'win32') return new WindowsProxyManager();
  if (platform === 'darwin') return new MacOsProxyManager();
  return new LinuxProxyManager();
}
