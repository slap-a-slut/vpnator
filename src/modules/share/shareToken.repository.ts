import type { Prisma, PrismaClient, ShareToken } from '@prisma/client';

import { generateShareTokenPlaintext, hashShareToken } from '../../lib/crypto';

import type { CreateShareTokenDto, UpdateShareTokenDto } from './shareToken.dto';

interface ShareTokenWithUser extends ShareToken {
  user: {
    id: string;
    serverId: string;
    uuid: string;
  };
}

export class ShareTokenRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async createOneTimeToken(params: { userId: string; expiresAt: Date }) {
    const token = generateShareTokenPlaintext();
    const tokenHash = hashShareToken(token);

    const shareToken = await this.prisma.shareToken.create({
      data: {
        user: { connect: { id: params.userId } },
        tokenHash,
        expiresAt: params.expiresAt,
        usedAt: null,
      },
    });

    return { token, shareToken };
  }

  public create(data: CreateShareTokenDto): Promise<ShareToken> {
    const prismaData: Prisma.ShareTokenCreateInput = {
      user: { connect: { id: data.userId } },
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
    };

    return this.prisma.shareToken.create({ data: prismaData });
  }

  public findById(id: string): Promise<ShareToken | null> {
    return this.prisma.shareToken.findUnique({ where: { id } });
  }

  public findByTokenHash(tokenHash: string): Promise<ShareToken | null> {
    return this.prisma.shareToken.findUnique({ where: { tokenHash } });
  }

  public findByTokenHashWithUser(tokenHash: string): Promise<ShareTokenWithUser | null> {
    return this.prisma.shareToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: { id: true, serverId: true, uuid: true },
        },
      },
    }) as Promise<ShareTokenWithUser | null>;
  }

  public findManyByUserId(userId: string): Promise<ShareToken[]> {
    return this.prisma.shareToken.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  public updateById(id: string, data: UpdateShareTokenDto): Promise<ShareToken> {
    const prismaData: Prisma.ShareTokenUpdateInput = {
      ...(data.tokenHash !== undefined ? { tokenHash: data.tokenHash } : {}),
      ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
      ...(data.usedAt !== undefined ? { usedAt: data.usedAt } : {}),
    };

    return this.prisma.shareToken.update({ where: { id }, data: prismaData });
  }

  public async markUsedIfAvailable(id: string, now: Date): Promise<boolean> {
    const result = await this.prisma.shareToken.updateMany({
      where: {
        id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    return result.count === 1;
  }

  public deleteById(id: string): Promise<ShareToken> {
    return this.prisma.shareToken.delete({ where: { id } });
  }
}
