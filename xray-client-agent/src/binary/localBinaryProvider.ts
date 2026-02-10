import { access, copyFile } from 'node:fs/promises';

import type { BinaryProvider, BinaryProviderResult, BinaryRequest } from './binaryProvider';

export class LocalBinaryProvider implements BinaryProvider {
  public constructor(
    private readonly sourcePath: string,
    private readonly sourceLabel: string,
  ) {}

  public async provide(request: BinaryRequest): Promise<BinaryProviderResult | null> {
    const exists = await pathExists(this.sourcePath);
    if (!exists) return null;

    if (this.sourcePath !== request.targetPath) {
      await copyFile(this.sourcePath, request.targetPath);
    }

    return {
      binaryPath: request.targetPath,
      source: this.sourceLabel,
    };
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
