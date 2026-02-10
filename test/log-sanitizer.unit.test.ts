import { describe, expect, it } from 'vitest';

import { sanitizeLogLines, sanitizeLogText } from '../src/modules/provision/logSanitizer';

describe('log sanitizer', () => {
  it('redacts sensitive key-value fragments', () => {
    const input =
      'password=secret123 token:abc privateKey:"real-private-key" ciphertext=ENCRYPTED master_key=XYZ';
    const output = sanitizeLogText(input);

    expect(output).toContain('password=[REDACTED]');
    expect(output).toContain('token:[REDACTED]');
    expect(output).toContain('privateKey:[REDACTED]');
    expect(output).toContain('ciphertext=[REDACTED]');
    expect(output).toContain('master_key=[REDACTED]');
    expect(output).not.toContain('secret123');
    expect(output).not.toContain('real-private-key');
  });

  it('redacts pem blocks and explicit private key lines', () => {
    const input = [
      'Private key: ABCDEFGHIJ',
      '-----BEGIN PRIVATE KEY-----',
      'SOME_REAL_KEY_DATA',
      '-----END PRIVATE KEY-----',
    ].join('\n');

    const output = sanitizeLogText(input);

    expect(output).toContain('Private key: [REDACTED]');
    expect(output).toContain('-----BEGIN PRIVATE KEY-----[REDACTED]-----END PRIVATE KEY-----');
    expect(output).not.toContain('SOME_REAL_KEY_DATA');
  });

  it('sanitizes lines list', () => {
    const output = sanitizeLogLines(['token=abc', 'ok']);
    expect(output).toEqual(['token=[REDACTED]', 'ok']);
  });
});
