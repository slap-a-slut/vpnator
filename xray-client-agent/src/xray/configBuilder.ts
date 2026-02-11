export interface XrayConfig {
  log: {
    loglevel: string;
  };
  dns?: {
    servers: string[];
  };
  inbounds: Record<string, unknown>[];
  outbounds: Record<string, unknown>[];
  routing: {
    domainStrategy: string;
    rules: Record<string, unknown>[];
  };
}

export type ConnectionMode = 'proxy' | 'vpn';

export interface ParsedVlessLink {
  userId: string;
  host: string;
  port: number;
  security: string;
  serverName: string;
  fingerprint: string;
  publicKey: string;
  shortId: string;
  network: string;
}

export function buildXrayConfigFromVlessLink(
  vlessLink: string,
  options: { mode?: ConnectionMode } = {},
): XrayConfig {
  const parsed = parseVlessLink(vlessLink);
  const mode = options.mode ?? 'proxy';

  if (mode === 'vpn') {
    return buildVpnConfig(parsed);
  }

  return buildProxyConfig(parsed);
}

function buildProxyConfig(parsed: ParsedVlessLink): XrayConfig {
  return {
    log: {
      loglevel: 'warning',
    },
    inbounds: [
      {
        tag: 'socks-in',
        listen: '127.0.0.1',
        port: 1080,
        protocol: 'socks',
        settings: {
          auth: 'noauth',
          udp: false,
        },
      },
    ],
    outbounds: buildOutbounds(parsed),
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        {
          type: 'field',
          ip: ['geoip:private'],
          outboundTag: 'direct',
        },
      ],
    },
  };
}

function buildVpnConfig(parsed: ParsedVlessLink): XrayConfig {
  return {
    log: {
      loglevel: 'warning',
    },
    dns: {
      servers: ['1.1.1.1', '1.0.0.1', '8.8.8.8'],
    },
    inbounds: [
      {
        tag: 'tun-in',
        protocol: 'tun',
        settings: {
          stack: 'system',
          mtu: 1500,
          autoRoute: true,
          strictRoute: true,
          address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
          dnsHijack: ['any:53'],
        },
      },
      {
        tag: 'socks-in',
        listen: '127.0.0.1',
        port: 1080,
        protocol: 'socks',
        settings: {
          auth: 'noauth',
          udp: true,
        },
      },
    ],
    outbounds: buildOutbounds(parsed),
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        {
          type: 'field',
          inboundTag: ['tun-in'],
          outboundTag: 'proxy',
        },
        {
          type: 'field',
          inboundTag: ['socks-in'],
          outboundTag: 'proxy',
        },
      ],
    },
  };
}

function buildOutbounds(parsed: ParsedVlessLink): Record<string, unknown>[] {
  return [
    {
      tag: 'proxy',
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: parsed.host,
            port: parsed.port,
            users: [
              {
                id: parsed.userId,
                encryption: 'none',
              },
            ],
          },
        ],
      },
      streamSettings: {
        network: parsed.network,
        security: parsed.security,
        realitySettings: {
          serverName: parsed.serverName,
          fingerprint: parsed.fingerprint,
          publicKey: parsed.publicKey,
          shortId: parsed.shortId,
          spiderX: '/',
        },
      },
    },
    {
      tag: 'direct',
      protocol: 'freedom',
    },
    {
      tag: 'block',
      protocol: 'blackhole',
    },
  ];
}

export function parseVlessLink(vlessLink: string): ParsedVlessLink {
  let url: URL;
  try {
    url = new URL(vlessLink);
  } catch {
    throw new Error('Invalid vless link');
  }

  if (url.protocol !== 'vless:') {
    throw new Error('Unsupported link protocol. Expected vless://');
  }

  const userId = decodeURIComponent(url.username);
  if (!userId) throw new Error('Missing user id in vless link');

  const host = url.hostname;
  if (!host) throw new Error('Missing host in vless link');

  const port = Number(url.port || '443');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Invalid port in vless link');
  }

  const security = url.searchParams.get('security') ?? 'none';
  const serverName = url.searchParams.get('sni') ?? '';
  const fingerprint = url.searchParams.get('fp') ?? 'chrome';
  const publicKey = url.searchParams.get('pbk') ?? '';
  const shortId = url.searchParams.get('sid') ?? '';
  const network = url.searchParams.get('type') ?? 'tcp';

  if (security === 'reality') {
    if (!serverName) throw new Error('Missing sni for reality link');
    if (!publicKey) throw new Error('Missing pbk for reality link');
    if (!shortId) throw new Error('Missing sid for reality link');
  }

  return {
    userId,
    host,
    port,
    security,
    serverName,
    fingerprint,
    publicKey,
    shortId,
    network,
  };
}
