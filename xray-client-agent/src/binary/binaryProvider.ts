import type { XrayPlatformTarget } from './platform';

export interface BinaryRequest {
  targetPath: string;
  target: XrayPlatformTarget;
}

export interface BinaryProviderResult {
  binaryPath: string;
  source: string;
}

export interface BinaryProvider {
  provide(request: BinaryRequest): Promise<BinaryProviderResult | null>;
}
