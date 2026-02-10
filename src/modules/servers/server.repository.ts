import type { Prisma, PrismaClient, Server } from '@prisma/client';

import type { CreateServerDto, UpdateServerDto } from './server.dto';

export class ServerRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public create(data: CreateServerDto): Promise<Server> {
    const prismaData: Prisma.ServerCreateInput = {
      host: data.host,
      sshUser: data.sshUser,
      sshSecret: { connect: { id: data.sshSecretId } },
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.lastError !== undefined ? { lastError: data.lastError } : {}),
    };

    return this.prisma.server.create({ data: prismaData });
  }

  public findById(id: string): Promise<Server | null> {
    return this.prisma.server.findUnique({ where: { id } });
  }

  public findMany(): Promise<Server[]> {
    return this.prisma.server.findMany({ orderBy: { createdAt: 'desc' } });
  }

  public updateById(id: string, data: UpdateServerDto): Promise<Server> {
    const prismaData: Prisma.ServerUpdateInput = {
      ...(data.host !== undefined ? { host: data.host } : {}),
      ...(data.sshUser !== undefined ? { sshUser: data.sshUser } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.lastError !== undefined ? { lastError: data.lastError } : {}),
      ...(data.sshSecretId !== undefined
        ? { sshSecret: { connect: { id: data.sshSecretId } } }
        : {}),
    };

    return this.prisma.server.update({ where: { id }, data: prismaData });
  }

  public deleteById(id: string): Promise<Server> {
    return this.prisma.server.delete({ where: { id } });
  }
}
