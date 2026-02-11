import type { Prisma, PrismaClient } from '@prisma/client';

import { AppError } from '../../lib/errors';
import { parseOrThrow } from '../../lib/validation';
import {
  adminExportResponseSchema,
  type AdminExportResponse,
} from './adminExport.http';

interface ImportResult {
  secrets: number;
  servers: number;
  users: number;
  xrayInstances: number;
  shareTokens: number;
}

export class AdminExportService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async buildExportPayload(): Promise<AdminExportResponse> {
    const [secrets, servers, users, xrayInstances, shareTokens, auditRows] = await Promise.all([
      this.prisma.secret.findMany(),
      this.prisma.server.findMany(),
      this.prisma.user.findMany(),
      this.prisma.xrayInstance.findMany(),
      this.prisma.shareToken.findMany(),
      this.prisma.auditEvent.findMany({
        select: {
          action: true,
          entityType: true,
          ts: true,
        },
      }),
    ]);

    const actionCounts = aggregateCounts(auditRows.map((row) => row.action));
    const entityTypeCounts = aggregateCounts(auditRows.map((row) => row.entityType));
    const latestTs = auditRows.reduce<Date | null>((current, row) => {
      if (!current) return row.ts;
      return row.ts > current ? row.ts : current;
    }, null);

    return parseOrThrow(adminExportResponseSchema, {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        secrets: secrets.map((item) => ({
          id: item.id,
          type: item.type,
          ciphertext: item.ciphertext,
          createdAt: item.createdAt.toISOString(),
        })),
        servers: servers.map((item) => ({
          id: item.id,
          host: item.host,
          sshUser: item.sshUser,
          sshSecretId: item.sshSecretId,
          status: item.status,
          lastError: item.lastError,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        users: users.map((item) => ({
          id: item.id,
          serverId: item.serverId,
          name: item.name,
          uuid: item.uuid,
          enabled: item.enabled,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        xrayInstances: xrayInstances.map((item) => ({
          id: item.id,
          serverId: item.serverId,
          listenPort: item.listenPort,
          realityPrivateKey: item.realityPrivateKey,
          realityPublicKey: item.realityPublicKey,
          serverName: item.serverName,
          dest: item.dest,
          fingerprint: item.fingerprint,
          shortIds: item.shortIds,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        })),
        shareTokens: shareTokens.map((item) => ({
          id: item.id,
          userId: item.userId,
          tokenHash: item.tokenHash,
          expiresAt: item.expiresAt.toISOString(),
          usedAt: item.usedAt ? item.usedAt.toISOString() : null,
          createdAt: item.createdAt.toISOString(),
        })),
      },
      auditSummary: {
        totalEvents: auditRows.length,
        byAction: actionCounts,
        byEntityType: entityTypeCounts,
        latestTs: latestTs ? latestTs.toISOString() : null,
      },
    });
  }

  public async importPayload(rawPayload: unknown): Promise<ImportResult> {
    const payload = parseOrThrow(adminExportResponseSchema, rawPayload);

    await this.assertTargetIsEmpty();

    const counts: ImportResult = {
      secrets: payload.data.secrets.length,
      servers: payload.data.servers.length,
      users: payload.data.users.length,
      xrayInstances: payload.data.xrayInstances.length,
      shareTokens: payload.data.shareTokens.length,
    };

    await this.prisma.$transaction(async (tx) => {
      await this.importSecrets(tx, payload);
      await this.importServers(tx, payload);
      await this.importUsers(tx, payload);
      await this.importXrayInstances(tx, payload);
      await this.importShareTokens(tx, payload);
    });

    return counts;
  }

  private async assertTargetIsEmpty(): Promise<void> {
    const [secrets, servers, users, xrayInstances, shareTokens] = await Promise.all([
      this.prisma.secret.count(),
      this.prisma.server.count(),
      this.prisma.user.count(),
      this.prisma.xrayInstance.count(),
      this.prisma.shareToken.count(),
    ]);

    const hasAnyData =
      secrets > 0 || servers > 0 || users > 0 || xrayInstances > 0 || shareTokens > 0;

    if (!hasAnyData) return;

    throw new AppError({
      code: 'IMPORT_TARGET_NOT_EMPTY',
      statusCode: 400,
      message: 'Import requires an empty target database',
      details: {
        secrets,
        servers,
        users,
        xrayInstances,
        shareTokens,
      },
    });
  }

  private async importSecrets(
    tx: Prisma.TransactionClient,
    payload: AdminExportResponse,
  ): Promise<void> {
    if (payload.data.secrets.length === 0) return;

    await tx.secret.createMany({
      data: payload.data.secrets.map((item) => ({
        id: item.id,
        type: item.type,
        ciphertext: item.ciphertext,
        createdAt: new Date(item.createdAt),
      })),
    });
  }

  private async importServers(
    tx: Prisma.TransactionClient,
    payload: AdminExportResponse,
  ): Promise<void> {
    if (payload.data.servers.length === 0) return;

    await tx.server.createMany({
      data: payload.data.servers.map((item) => ({
        id: item.id,
        host: item.host,
        sshUser: item.sshUser,
        sshSecretId: item.sshSecretId,
        status: item.status,
        lastError: item.lastError,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
      })),
    });
  }

  private async importUsers(
    tx: Prisma.TransactionClient,
    payload: AdminExportResponse,
  ): Promise<void> {
    if (payload.data.users.length === 0) return;

    await tx.user.createMany({
      data: payload.data.users.map((item) => ({
        id: item.id,
        serverId: item.serverId,
        name: item.name,
        uuid: item.uuid,
        enabled: item.enabled,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
      })),
    });
  }

  private async importXrayInstances(
    tx: Prisma.TransactionClient,
    payload: AdminExportResponse,
  ): Promise<void> {
    if (payload.data.xrayInstances.length === 0) return;

    await tx.xrayInstance.createMany({
      data: payload.data.xrayInstances.map((item) => ({
        id: item.id,
        serverId: item.serverId,
        listenPort: item.listenPort,
        realityPrivateKey: item.realityPrivateKey,
        realityPublicKey: item.realityPublicKey,
        serverName: item.serverName,
        dest: item.dest,
        fingerprint: item.fingerprint,
        shortIds: item.shortIds,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
      })),
    });
  }

  private async importShareTokens(
    tx: Prisma.TransactionClient,
    payload: AdminExportResponse,
  ): Promise<void> {
    if (payload.data.shareTokens.length === 0) return;

    await tx.shareToken.createMany({
      data: payload.data.shareTokens.map((item) => ({
        id: item.id,
        userId: item.userId,
        tokenHash: item.tokenHash,
        expiresAt: new Date(item.expiresAt),
        usedAt: item.usedAt ? new Date(item.usedAt) : null,
        createdAt: new Date(item.createdAt),
      })),
    });
  }
}

function aggregateCounts(values: string[]): { name: string; count: number }[] {
  const map = new Map<string, number>();

  for (const value of values) {
    const current = map.get(value) ?? 0;
    map.set(value, current + 1);
  }

  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => ({ name, count }));
}
