import type { Prisma, PrismaClient, User } from '@prisma/client';

import type { CreateUserDto, UpdateUserDto } from './user.dto';

export class UserRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public create(data: CreateUserDto): Promise<User> {
    const prismaData: Prisma.UserCreateInput = {
      server: { connect: { id: data.serverId } },
      enabled: data.enabled,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.uuid !== undefined ? { uuid: data.uuid } : {}),
    };

    return this.prisma.user.create({ data: prismaData });
  }

  public findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  public findManyByServerId(serverId: string): Promise<User[]> {
    return this.prisma.user.findMany({ where: { serverId }, orderBy: { createdAt: 'desc' } });
  }

  public updateById(id: string, data: UpdateUserDto): Promise<User> {
    const prismaData: Prisma.UserUpdateInput = {
      ...(data.serverId !== undefined ? { server: { connect: { id: data.serverId } } } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.uuid !== undefined ? { uuid: data.uuid } : {}),
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    };

    return this.prisma.user.update({ where: { id }, data: prismaData });
  }

  public deleteById(id: string): Promise<User> {
    return this.prisma.user.delete({ where: { id } });
  }
}
