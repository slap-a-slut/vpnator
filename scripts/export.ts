import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

import { AppError } from '../src/lib/errors';
import { AdminExportService } from '../src/modules/admin';

dotenv.config();

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: {
        type: 'string',
      },
    },
  });

  if (!values.out) {
    throw new AppError({
      code: 'EXPORT_OUTPUT_REQUIRED',
      statusCode: 400,
      message: 'Missing required --out argument',
      details: {
        example: 'npm run export -- --out ./export.json',
      },
    });
  }

  const outPath = resolve(process.cwd(), values.out);

  const prisma = new PrismaClient();
  try {
    const service = new AdminExportService(prisma);
    const payload = await service.buildExportPayload();

    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

    console.log(`Exported snapshot to ${outPath}`);
    console.log(
      `Counts: secrets=${payload.data.secrets.length}, servers=${payload.data.servers.length}, users=${payload.data.users.length}, xrayInstances=${payload.data.xrayInstances.length}, shareTokens=${payload.data.shareTokens.length}`,
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

  console.error('Unknown export error');
  process.exitCode = 1;
});
