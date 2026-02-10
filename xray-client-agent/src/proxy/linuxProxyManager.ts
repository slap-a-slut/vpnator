import type { ProxyManager, ProxyResult } from './proxyManager';

export class LinuxProxyManager implements ProxyManager {
  public enable(_host: string, _port: number): Promise<ProxyResult> {
    return Promise.resolve({
      applied: false,
      method: 'linux-manual',
      message: 'Automatic proxy setup is not implemented for Linux desktop variants',
      instructions: [
        'GNOME example: gsettings set org.gnome.system.proxy mode manual',
        'GNOME example: gsettings set org.gnome.system.proxy.socks host 127.0.0.1',
        'GNOME example: gsettings set org.gnome.system.proxy.socks port 1080',
        'KDE: configure SOCKS5 127.0.0.1:1080 in System Settings > Network > Proxy',
      ],
    });
  }

  public disable(): Promise<ProxyResult> {
    return Promise.resolve({
      applied: false,
      method: 'linux-manual',
      message: 'Disable proxy manually for your desktop environment',
      instructions: [
        'GNOME example: gsettings set org.gnome.system.proxy mode none',
        'KDE: set Proxy mode to None in System Settings > Network > Proxy',
      ],
    });
  }
}
