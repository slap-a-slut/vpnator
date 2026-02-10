import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentError } from '../src/errors';
import { assertFileSha256 } from '../src/binary/hash';

const tempPaths: string[] = [];

afterEach(async () => {
  while (tempPaths.length > 0) {
    const path = tempPaths.pop();
    if (!path) continue;
    await rm(path, { recursive: true, force: true });
  }
});

describe('assertFileSha256', () => {
  it('passes for matching sha256', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xray-agent-hash-'));
    tempPaths.push(dir);

    const filePath = join(dir, 'xray.bin');
    const payload = Buffer.from('hello-xray-agent', 'utf8');
    await writeFile(filePath, payload);

    const expected = createHash('sha256').update(payload).digest('hex');
    await expect(assertFileSha256(filePath, expected)).resolves.toBeUndefined();
  });

  it('throws XRAY_HASH_MISMATCH for invalid hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'xray-agent-hash-'));
    tempPaths.push(dir);

    const filePath = join(dir, 'xray.bin');
    await writeFile(filePath, Buffer.from('payload', 'utf8'));

    await expect(assertFileSha256(filePath, '0'.repeat(64))).rejects.toMatchObject({
      code: 'XRAY_HASH_MISMATCH',
    } satisfies Partial<AgentError>);
  });
});
