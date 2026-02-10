import { writeFile } from 'node:fs/promises';

import { AgentError } from '../errors';

import type { BinaryProvider, BinaryProviderResult, BinaryRequest } from './binaryProvider';

export class HttpBinaryProvider implements BinaryProvider {
  public constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  public async provide(request: BinaryRequest): Promise<BinaryProviderResult | null> {
    const normalizedBaseUrl = this.baseUrl.trim().replace(/\/$/, '');
    if (normalizedBaseUrl.length === 0) return null;

    const artifactUrl = `${normalizedBaseUrl}/${request.target.artifactFileName}`;

    let response: Response;
    try {
      response = await this.fetchFn(artifactUrl, {
        method: 'GET',
      });
    } catch (error) {
      throw new AgentError({
        code: 'XRAY_DOWNLOAD_FAILED',
        message: 'Failed to download xray-core binary',
        details: {
          url: artifactUrl,
          reason: error instanceof Error ? error.message : 'network error',
        },
      });
    }

    if (!response.ok) {
      throw new AgentError({
        code: 'XRAY_DOWNLOAD_FAILED',
        message: `Failed to download xray-core binary: HTTP ${response.status}`,
        details: {
          url: artifactUrl,
          status: response.status,
          statusText: response.statusText,
        },
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    await writeFile(request.targetPath, data);

    return {
      binaryPath: request.targetPath,
      source: artifactUrl,
    };
  }
}
