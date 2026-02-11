import { describe, expect, it } from 'vitest';

import { sharePayloadSchema, vlessLinkSchema } from '../src/contracts/compatibility';

const validVlessLink =
  'vless://11111111-1111-4111-8111-111111111111@example.com:443?security=reality&sni=sni.example.com&fp=chrome&pbk=PUBLIC_KEY&sid=abcd1234&type=tcp#XrayUser';

describe('compatibility contract', () => {
  it('accepts valid share payload', () => {
    const parsed = sharePayloadSchema.parse({
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      serverId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      vlessLink: validVlessLink,
      server: {
        host: 'example.com',
        port: 443,
      },
      reality: {
        publicKey: 'PUBLIC_KEY',
        serverName: 'sni.example.com',
        fingerprint: 'chrome',
        shortId: 'abcd1234',
        dest: 'sni.example.com:443',
      },
      user: {
        uuid: '11111111-1111-4111-8111-111111111111',
      },
      meta: {
        tokenId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        expiresAt: '2026-02-10T12:00:00.000Z',
        usedAt: '2026-02-10T11:30:00.000Z',
      },
    });

    expect(parsed.vlessLink).toBe(validVlessLink);
  });

  it('rejects payload when required fields are missing', () => {
    const result = sharePayloadSchema.safeParse({
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      serverId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      vlessLink: validVlessLink,
      server: {
        host: 'example.com',
        port: 443,
      },
      reality: {
        publicKey: 'PUBLIC_KEY',
        serverName: 'sni.example.com',
        fingerprint: 'chrome',
        shortId: 'abcd1234',
        dest: 'sni.example.com:443',
      },
      user: {
        uuid: '11111111-1111-4111-8111-111111111111',
      },
      meta: {
        expiresAt: '2026-02-10T12:00:00.000Z',
        usedAt: '2026-02-10T11:30:00.000Z',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects vless link when format is incompatible', () => {
    const result = vlessLinkSchema.safeParse(
      'vless://11111111-1111-1111-1111-111111111111@example.com?security=reality&type=tcp#XrayUser',
    );

    expect(result.success).toBe(false);
  });
});
