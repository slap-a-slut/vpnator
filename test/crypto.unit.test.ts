import { describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  generateShareTokenPlaintext,
  hashShareToken,
} from '../src/lib/crypto';

describe('encryptSecret / decryptSecret', () => {
  it('round-trips plaintext', () => {
    const plaintext = 'super-secret-ssh-password';
    const ciphertext = encryptSecret(plaintext);

    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.split('.')).toHaveLength(3);
    expect(decryptSecret(ciphertext)).toBe(plaintext);
  });

  it('fails on tampered ciphertext', () => {
    const plaintext = 'hello';
    const ciphertext = encryptSecret(plaintext);

    const [ivB64, tagB64, dataB64] = ciphertext.split('.');
    if (!ivB64 || !tagB64 || !dataB64) throw new Error('invalid test data');

    const lastChar = dataB64.at(-1);
    const replacement = lastChar === 'A' ? 'B' : 'A';
    const tampered = `${ivB64}.${tagB64}.${dataB64.slice(0, -1)}${replacement}`;

    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe('share token hashing', () => {
  it('generates 32-byte base64url token', () => {
    const token = generateShareTokenPlaintext();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('hash is deterministic for same token+salt', () => {
    const token = 'token';
    const salt = 'salt';
    expect(hashShareToken(token, salt)).toBe(hashShareToken(token, salt));
  });

  it('hash differs for different salts', () => {
    const token = 'token';
    expect(hashShareToken(token, 'salt-1')).not.toBe(hashShareToken(token, 'salt-2'));
  });

  it('hash differs for different tokens', () => {
    const salt = 'salt';
    expect(hashShareToken('token-1', salt)).not.toBe(hashShareToken('token-2', salt));
  });
});
