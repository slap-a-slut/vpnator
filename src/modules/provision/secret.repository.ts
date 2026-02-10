import type { Prisma, PrismaClient, Secret } from '@prisma/client';

import type { CreateSecretDto, UpdateSecretDto } from './secret.dto';

export class SecretRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public create(data: CreateSecretDto): Promise<Secret> {
    return this.prisma.secret.create({ data });
  }

  public findById(id: string): Promise<Secret | null> {
    return this.prisma.secret.findUnique({ where: { id } });
  }

  public findMany(): Promise<Secret[]> {
    return this.prisma.secret.findMany({ orderBy: { createdAt: 'desc' } });
  }

  public updateById(id: string, data: UpdateSecretDto): Promise<Secret> {
    const prismaData: Prisma.SecretUpdateInput = {
      ...(data.type !== undefined ? { type: data.type } : {}),
      ...(data.ciphertext !== undefined ? { ciphertext: data.ciphertext } : {}),
    };

    return this.prisma.secret.update({ where: { id }, data: prismaData });
  }

  public deleteById(id: string): Promise<Secret> {
    return this.prisma.secret.delete({ where: { id } });
  }
}
