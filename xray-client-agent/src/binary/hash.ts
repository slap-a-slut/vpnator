import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

import { AgentError } from '../errors';

export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk: Buffer | string) => {
      hash.update(chunk);
    });
    stream.once('error', reject);
    stream.once('end', () => {
      resolve(hash.digest('hex'));
    });
  });
}

export async function assertFileSha256(filePath: string, expectedSha256: string): Promise<void> {
  const normalizedExpected = normalizeSha256(expectedSha256);
  if (normalizedExpected.length !== 64 || /[^a-f0-9]/.test(normalizedExpected)) {
    throw new AgentError({
      code: 'XRAY_HASH_MISMATCH',
      message: 'Invalid expected SHA256 value',
      details: {
        expectedSha256,
      },
    });
  }

  const actual = await computeFileSha256(filePath);
  if (actual !== normalizedExpected) {
    throw new AgentError({
      code: 'XRAY_HASH_MISMATCH',
      message: 'Downloaded xray-core checksum mismatch',
      details: {
        expected: normalizedExpected,
        actual,
      },
    });
  }
}

function normalizeSha256(input: string): string {
  return input.trim().toLowerCase();
}
