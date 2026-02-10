import { describe, expect, it } from 'vitest';

import { AgentError } from '../src/errors';
import { resolveXrayPlatformTarget } from '../src/binary/platform';

describe('resolveXrayPlatformTarget', () => {
  it('resolves linux x64 target', () => {
    const target = resolveXrayPlatformTarget('linux', 'x64');

    expect(target).toMatchObject({
      id: 'linux-x64',
      binaryName: 'xray',
      artifactFileName: 'xray-linux-x64',
      shaEnvName: 'XRAY_CORE_SHA256_LINUX_X64',
    });
  });

  it('resolves macOS arm64 target', () => {
    const target = resolveXrayPlatformTarget('darwin', 'arm64');

    expect(target).toMatchObject({
      id: 'macos-arm64',
      binaryName: 'xray',
      artifactFileName: 'xray-macos-arm64',
      shaEnvName: 'XRAY_CORE_SHA256_MACOS_ARM64',
    });
  });

  it('throws XRAY_UNSUPPORTED_PLATFORM for unsupported tuple', () => {
    try {
      resolveXrayPlatformTarget('freebsd' as NodeJS.Platform, 'x64');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentError);
      expect((error as AgentError).code).toBe('XRAY_UNSUPPORTED_PLATFORM');
      return;
    }

    throw new Error('Expected XRAY_UNSUPPORTED_PLATFORM error');
  });
});
