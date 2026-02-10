import type { AuditEvent, Prisma, PrismaClient } from '@prisma/client';

export interface CreateAuditEventInput {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  meta?: Prisma.InputJsonValue;
}

interface FindAuditEventsParams {
  entityId?: string;
  limit: number;
}

export class AuditEventRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public create(input: CreateAuditEventInput): Promise<AuditEvent> {
    const data: Prisma.AuditEventCreateInput = {
      actor: input.actor,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      ...(input.meta !== undefined ? { meta: input.meta } : {}),
    };

    return this.prisma.auditEvent.create({ data });
  }

  public findRecent(params: FindAuditEventsParams): Promise<AuditEvent[]> {
    return this.prisma.auditEvent.findMany({
      ...(params.entityId ? { where: { entityId: params.entityId } } : {}),
      orderBy: { ts: 'desc' },
      take: params.limit,
    });
  }
}
