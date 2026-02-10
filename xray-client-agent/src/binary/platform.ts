import { AgentError } from '../errors';

export type XrayTargetId =
  | 'windows-x64'
  | 'windows-arm64'
  | 'macos-x64'
  | 'macos-arm64'
  | 'linux-x64'
  | 'linux-arm64';

export interface XrayPlatformTarget {
  id: XrayTargetId;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  binaryName: string;
  artifactFileName: string;
  shaEnvName: string;
}

export function resolveXrayPlatformTarget(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
): XrayPlatformTarget {
  if (platform === 'win32' && arch === 'x64') {
    return {
      id: 'windows-x64',
      platform,
      arch,
      binaryName: 'xray.exe',
      artifactFileName: 'xray-windows-x64.exe',
      shaEnvName: 'XRAY_CORE_SHA256_WINDOWS_X64',
    };
  }

  if (platform === 'win32' && arch === 'arm64') {
    return {
      id: 'windows-arm64',
      platform,
      arch,
      binaryName: 'xray.exe',
      artifactFileName: 'xray-windows-arm64.exe',
      shaEnvName: 'XRAY_CORE_SHA256_WINDOWS_ARM64',
    };
  }

  if (platform === 'darwin' && arch === 'x64') {
    return {
      id: 'macos-x64',
      platform,
      arch,
      binaryName: 'xray',
      artifactFileName: 'xray-macos-x64',
      shaEnvName: 'XRAY_CORE_SHA256_MACOS_X64',
    };
  }

  if (platform === 'darwin' && arch === 'arm64') {
    return {
      id: 'macos-arm64',
      platform,
      arch,
      binaryName: 'xray',
      artifactFileName: 'xray-macos-arm64',
      shaEnvName: 'XRAY_CORE_SHA256_MACOS_ARM64',
    };
  }

  if (platform === 'linux' && arch === 'x64') {
    return {
      id: 'linux-x64',
      platform,
      arch,
      binaryName: 'xray',
      artifactFileName: 'xray-linux-x64',
      shaEnvName: 'XRAY_CORE_SHA256_LINUX_X64',
    };
  }

  if (platform === 'linux' && arch === 'arm64') {
    return {
      id: 'linux-arm64',
      platform,
      arch,
      binaryName: 'xray',
      artifactFileName: 'xray-linux-arm64',
      shaEnvName: 'XRAY_CORE_SHA256_LINUX_ARM64',
    };
  }

  throw new AgentError({
    code: 'XRAY_UNSUPPORTED_PLATFORM',
    message: `Unsupported platform for xray-core: ${platform}/${arch}`,
    details: {
      platform,
      arch,
    },
  });
}
