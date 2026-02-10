import { describe, expect, it } from 'vitest';

import { renderXrayConfig } from '../src/modules/provision/xray.template';
import {
  XRAY_API_HOST,
  XRAY_API_INBOUND_TAG,
  XRAY_API_PORT,
  XRAY_MAIN_INBOUND_TAG,
} from '../src/modules/xray';

describe('renderXrayConfig', () => {
  it('enables localhost-only API inbound and main vless tag', () => {
    const output = renderXrayConfig({
      listenPort: 443,
      realityPrivateKey: 'private-key',
      serverName: 'test.example.com',
      dest: 'example.com:443',
      shortIds: ['deadbeef'],
      clients: [{ id: 'ef5b48ca-39d1-43a4-b16d-4f70ce4ef95b' }],
    });

    const config = JSON.parse(output) as {
      api?: { tag?: string; services?: string[] };
      inbounds?: {
        tag?: string;
        listen?: string;
        port?: number;
        settings?: { clients?: { id?: string; email?: string }[] };
      }[];
    };

    expect(config.api?.tag).toBe(XRAY_API_INBOUND_TAG);
    expect(config.api?.services).toEqual(['HandlerService']);

    const apiInbound = config.inbounds?.find((item) => item.tag === XRAY_API_INBOUND_TAG);
    expect(apiInbound?.listen).toBe(XRAY_API_HOST);
    expect(apiInbound?.port).toBe(XRAY_API_PORT);

    const mainInbound = config.inbounds?.find((item) => item.tag === XRAY_MAIN_INBOUND_TAG);
    expect(mainInbound?.settings?.clients?.[0]).toEqual({
      id: 'ef5b48ca-39d1-43a4-b16d-4f70ce4ef95b',
      email: 'ef5b48ca-39d1-43a4-b16d-4f70ce4ef95b',
    });
  });
});
