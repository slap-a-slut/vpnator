import { SecretType, ServerStatus } from '@prisma/client';

import { prisma } from '../src/db/prisma';
import { encryptSecret } from '../src/lib/crypto';

async function main() {
  const secretsCount = await prisma.secret.count();
  const serversCount = await prisma.server.count();
  const usersCount = await prisma.user.count();

  if (secretsCount > 0 || serversCount > 0 || usersCount > 0) {
    return;
  }

  const secret = await prisma.secret.create({
    data: {
      type: SecretType.SSH_PASSWORD,
      ciphertext: encryptSecret('CHANGE_ME'),
    },
  });

  const server = await prisma.server.create({
    data: {
      host: '127.0.0.1',
      sshUser: 'root',
      sshSecretId: secret.id,
      status: ServerStatus.NEW,
    },
  });

  const user = await prisma.user.create({
    data: {
      serverId: server.id,
      enabled: true,
    },
  });

  console.log('Seed completed:', { serverId: server.id, userId: user.id });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
