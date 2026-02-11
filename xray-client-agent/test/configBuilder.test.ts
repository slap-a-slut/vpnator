import { describe, expect, it } from 'vitest';

import { buildXrayConfigFromVlessLink, parseVlessLink } from '../src/xray/configBuilder';

describe('configBuilder', () => {
  it('parses vless+reality link and builds socks5 client config', () => {
    const link =
      'vless://11111111-1111-1111-1111-111111111111@example.com:443?security=reality&sni=sni.example.com&fp=chrome&pbk=PUBLIC_KEY&sid=abcd1234&type=tcp#XrayUser';

    const parsed = parseVlessLink(link);
    expect(parsed).toMatchObject({
      userId: '11111111-1111-1111-1111-111111111111',
      host: 'example.com',
      port: 443,
      security: 'reality',
      serverName: 'sni.example.com',
      publicKey: 'PUBLIC_KEY',
      shortId: 'abcd1234',
      network: 'tcp',
    });

    const config = buildXrayConfigFromVlessLink(link);
    const inbound = config.inbounds[0]!;
    const outbound = config.outbounds[0]!;

    expect(inbound).toMatchObject({
      protocol: 'socks',
      listen: '127.0.0.1',
      port: 1080,
    });

    expect(outbound.protocol).toBe('vless');
    const streamSettings = outbound.streamSettings as Record<string, unknown>;
    const realitySettings = streamSettings.realitySettings as Record<string, unknown>;
    expect(streamSettings.security).toBe('reality');
    expect(realitySettings.serverName).toBe('sni.example.com');
    expect(realitySettings.publicKey).toBe('PUBLIC_KEY');
    expect(realitySettings.shortId).toBe('abcd1234');
  });

  it('throws on invalid vless link', () => {
    expect(() => parseVlessLink('https://example.com')).toThrowError(
      'Unsupported link protocol. Expected vless://',
    );
  });

  it('builds tun config in vpn mode', () => {
    const link =
      'vless://11111111-1111-1111-1111-111111111111@example.com:443?security=reality&sni=vk.com&fp=chrome&pbk=PUBLIC_KEY&sid=abcd1234&type=tcp#XrayUser';

    const config = buildXrayConfigFromVlessLink(link, { mode: 'vpn' });
    const tunInbound = config.inbounds.find((item) => item.tag === 'tun-in');
    expect(tunInbound).toBeDefined();
    expect(tunInbound?.protocol).toBe('tun');

    const settings = tunInbound?.settings as Record<string, unknown>;
    expect(settings.autoRoute).toBe(true);
    expect(settings.strictRoute).toBe(true);
  });
});
