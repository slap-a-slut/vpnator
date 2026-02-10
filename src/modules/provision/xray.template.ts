import {
  XRAY_API_HOST,
  XRAY_API_INBOUND_TAG,
  XRAY_API_PORT,
  XRAY_MAIN_INBOUND_TAG,
} from '../xray/xray.constants';

interface RenderXrayConfigParams {
  listenPort: number;
  realityPrivateKey: string;
  serverName: string;
  dest: string;
  shortIds: string[];
  clients: { id: string; email?: string }[];
}

export function renderXrayDockerCompose(): string {
  return `services:
  xray:
    image: ghcr.io/xtls/xray-core:latest
    container_name: xray
    restart: unless-stopped
    network_mode: host
    volumes:
      - /opt/xray-cp/config.json:/etc/xray/config.json:ro
      - /var/log/xray:/var/log/xray
    command: run -c /etc/xray/config.json
`;
}

export function renderXrayConfig(params: RenderXrayConfigParams): string {
  const config = {
    api: {
      tag: XRAY_API_INBOUND_TAG,
      services: ['HandlerService'],
    },
    log: {
      access: '/var/log/xray/access.log',
      error: '/var/log/xray/error.log',
      loglevel: 'warning',
    },
    routing: {
      rules: [
        {
          type: 'field',
          inboundTag: [XRAY_API_INBOUND_TAG],
          outboundTag: XRAY_API_INBOUND_TAG,
        },
      ],
    },
    inbounds: [
      {
        tag: XRAY_MAIN_INBOUND_TAG,
        listen: '0.0.0.0',
        port: params.listenPort,
        protocol: 'vless',
        settings: {
          clients: params.clients.map((client) => ({
            id: client.id,
            email: client.email ?? client.id,
          })),
          decryption: 'none',
        },
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            show: false,
            dest: params.dest,
            xver: 0,
            serverNames: [params.serverName],
            privateKey: params.realityPrivateKey,
            shortIds: params.shortIds,
          },
        },
      },
      {
        tag: XRAY_API_INBOUND_TAG,
        listen: XRAY_API_HOST,
        port: XRAY_API_PORT,
        protocol: 'dokodemo-door',
        settings: {
          address: XRAY_API_HOST,
        },
      },
    ],
    outbounds: [
      {
        protocol: 'freedom',
        settings: {},
      },
    ],
  };

  return `${JSON.stringify(config, null, 2)}\n`;
}
