import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rename, stat } from 'node:fs/promises';
import https from 'node:https';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const runtimeDir = join(__dirname, '..', 'backend', 'runtime');
const bundledWindowsNodePath = join(runtimeDir, 'node.exe');
const nodeVersion = process.env.XRAY_DESKTOP_NODE_VERSION?.trim() || 'latest-v20.x';

function getWindowsArch() {
  if (process.arch === 'x64') return 'x64';
  if (process.arch === 'arm64') return 'arm64';
  throw new Error(`Unsupported Windows arch for bundled Node.js: ${process.arch}`);
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function downloadFile(url, destination, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const statusCode = response.statusCode ?? 0;

      if (
        statusCode >= 300 &&
        statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();

        if (redirectsLeft === 0) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }

        const nextUrl = new URL(response.headers.location, url).toString();
        resolve(downloadFile(nextUrl, destination, redirectsLeft - 1));
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download ${url}: HTTP ${statusCode}`));
        return;
      }

      const fileStream = createWriteStream(destination);
      pipeline(response, fileStream).then(resolve, reject);
    });

    request.on('error', reject);
  });
}

async function main() {
  if (process.platform !== 'win32') {
    console.log(`Skipping Windows runtime download on ${process.platform}`);
    return;
  }

  await mkdir(runtimeDir, { recursive: true });

  if (await pathExists(bundledWindowsNodePath)) {
    console.log(`Bundled Windows Node.js already present: ${bundledWindowsNodePath}`);
    return;
  }

  const windowsArch = getWindowsArch();
  const downloadUrl = `https://nodejs.org/download/release/${nodeVersion}/win-${windowsArch}/node.exe`;
  const tempPath = `${bundledWindowsNodePath}.download`;

  console.log(`Downloading bundled Windows Node.js from ${downloadUrl}`);
  await downloadFile(downloadUrl, tempPath);
  await rename(tempPath, bundledWindowsNodePath);
  await chmod(bundledWindowsNodePath, 0o755).catch(() => {});

  console.log(`Saved bundled Windows Node.js to ${bundledWindowsNodePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
