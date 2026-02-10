import type { Prisma, PrismaClient, XrayInstance } from '@prisma/client';

import type { CreateXrayInstanceDto, UpdateXrayInstanceDto } from './xrayInstance.dto';

export class XrayInstanceRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public create(data: CreateXrayInstanceDto): Promise<XrayInstance> {
    const prismaData: Prisma.XrayInstanceCreateInput = {
      server: { connect: { id: data.serverId } },
      listenPort: data.listenPort,
      realityPrivateKey: data.realityPrivateKey,
      realityPublicKey: data.realityPublicKey,
      serverName: data.serverName,
      dest: data.dest,
      shortIds: data.shortIds,
    };

    return this.prisma.xrayInstance.create({ data: prismaData });
  }

  public findLatestByServerId(serverId: string): Promise<XrayInstance | null> {
    return this.prisma.xrayInstance.findFirst({
      where: { serverId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  public updateById(id: string, data: UpdateXrayInstanceDto): Promise<XrayInstance> {
    const prismaData: Prisma.XrayInstanceUpdateInput = {
      ...(data.listenPort !== undefined ? { listenPort: data.listenPort } : {}),
      ...(data.realityPrivateKey !== undefined
        ? { realityPrivateKey: data.realityPrivateKey }
        : {}),
      ...(data.realityPublicKey !== undefined ? { realityPublicKey: data.realityPublicKey } : {}),
      ...(data.serverName !== undefined ? { serverName: data.serverName } : {}),
      ...(data.dest !== undefined ? { dest: data.dest } : {}),
      ...(data.shortIds !== undefined ? { shortIds: data.shortIds } : {}),
    };

    return this.prisma.xrayInstance.update({ where: { id }, data: prismaData });
  }

  public async upsertLatestByServerId(
    serverId: string,
    data: Omit<CreateXrayInstanceDto, 'serverId'>,
  ): Promise<XrayInstance> {
    const existing = await this.findLatestByServerId(serverId);
    if (!existing) {
      return this.create({ serverId, ...data });
    }

    return this.updateById(existing.id, data);
  }
}
