import { chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type pino from 'pino';

import { AgentError } from '../errors';

import { assertFileSha256 } from './hash';
import type { BinaryProvider } from './binaryProvider';
import { HttpBinaryProvider } from './httpBinaryProvider';
import { LocalBinaryProvider } from './localBinaryProvider';
import { resolveXrayPlatformTarget } from './platform';

interface XrayBinaryManagerOptions {
  binDir: string;
  binaryPath: string;
  logger: pino.Logger;
  env?: NodeJS.ProcessEnv;
  providers?: BinaryProvider[];
}

export class XrayBinaryManager {
  private readonly env: NodeJS.ProcessEnv;

  public constructor(private readonly options: XrayBinaryManagerOptions) {
    this.env = options.env ?? process.env;
  }

  public async ensureBinary(): Promise<string> {
    const target = resolveXrayPlatformTarget();
    const expectedSha256 = this.env[target.shaEnvName];
    if (!expectedSha256) {
      throw new AgentError({
        code: 'XRAY_HASH_MISMATCH',
        message: `Missing expected checksum env: ${target.shaEnvName}`,
      });
    }

    const providers = this.options.providers ?? this.createDefaultProviders(target.binaryName);

    for (const provider of providers) {
      const result = await provider.provide({
        targetPath: this.options.binaryPath,
        target,
      });

      if (!result) continue;

      await assertFileSha256(result.binaryPath, expectedSha256);
      await ensureExecutable(result.binaryPath, target.platform);

      this.options.logger.info(
        {
          target: target.id,
          source: result.source,
          binaryPath: result.binaryPath,
        },
        'xray-core binary ready',
      );

      return result.binaryPath;
    }

    throw new AgentError({
      code: 'XRAY_DOWNLOAD_FAILED',
      message: 'No binary source available for xray-core',
      details: {
        hint: 'Provide XRAY_CORE_BASE_URL or place embedded asset into assets/xray/<target>/',
        target: target.id,
      },
    });
  }

  private createDefaultProviders(binaryName: string): BinaryProvider[] {
    const embeddedDir = this.env.XRAY_CORE_EMBEDDED_DIR?.trim();
    const platformTarget = resolveXrayPlatformTarget();
    const embeddedRoot =
      embeddedDir && embeddedDir.length > 0
        ? resolve(embeddedDir)
        : resolve(process.cwd(), 'assets', 'xray', platformTarget.id);

    const providers: BinaryProvider[] = [
      new LocalBinaryProvider(this.options.binaryPath, 'local-installed'),
      new LocalBinaryProvider(join(embeddedRoot, binaryName), 'local-embedded'),
    ];

    const baseUrl = this.env.XRAY_CORE_BASE_URL?.trim();
    if (baseUrl && baseUrl.length > 0) {
      providers.push(new HttpBinaryProvider(baseUrl));
    }

    return providers;
  }
}

async function ensureExecutable(binaryPath: string, platform: NodeJS.Platform): Promise<void> {
  if (platform === 'win32') return;
  await chmod(binaryPath, 0o755);
}
