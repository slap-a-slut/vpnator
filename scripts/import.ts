import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

import { AppError } from '../src/lib/errors';
import { AdminExportService } from '../src/modules/admin';

dotenv.config();

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      in: {
        type: 'string',
      },
    },
  });

  if (!values.in) {
    throw new AppError({
      code: 'IMPORT_INPUT_REQUIRED',
      statusCode: 400,
      message: 'Missing required --in argument',
      details: {
        example: 'npm run import -- --in ./export.json',
      },
    });
  }

  const inPath = resolve(process.cwd(), values.in);
  const rawContent = await readFile(inPath, 'utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent) as unknown;
  } catch {
    throw new AppError({
      code: 'IMPORT_INVALID_JSON',
      statusCode: 400,
      message: 'Import file is not valid JSON',
      details: { path: inPath },
    });
  }

  const prisma = new PrismaClient();
  try {
    const service = new AdminExportService(prisma);
    const result = await service.importPayload(parsed);

    console.log(`Imported snapshot from ${inPath}`);
    console.log(
      `Counts: secrets=${result.secrets}, servers=${result.servers}, users=${result.users}, xrayInstances=${result.xrayInstances}, shareTokens=${result.shareTokens}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof AppError) {
    console.error(`${error.code}: ${error.message}`);
    if (error.details) {
      console.error(JSON.stringify(error.details));
    }
    process.exitCode = 1;
    return;
  }

  if (error instanceof Error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  console.error('Unknown import error');
  process.exitCode = 1;
});
