import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

const semverSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    'APP_VERSION must be a valid semver value',
  );

function readVersionFromPackageJson(): string | null {
  const packageJsonCandidates = [join(process.cwd(), 'package.json'), join(__dirname, '..', '..', 'package.json')];

  for (const packageJsonPath of packageJsonCandidates) {
    try {
      const raw = readFileSync(packageJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version !== 'string') continue;
      return parsed.version;
    } catch {
      continue;
    }
  }

  return null;
}

function resolveAppVersion(): string {
  const explicit = process.env.APP_VERSION?.trim();
  if (explicit) {
    return semverSchema.parse(explicit);
  }

  const packageJsonVersion = readVersionFromPackageJson();
  if (packageJsonVersion) {
    return semverSchema.parse(packageJsonVersion);
  }

  throw new Error('Unable to resolve app version. Set APP_VERSION or provide package.json version');
}

export const appVersion = resolveAppVersion();
