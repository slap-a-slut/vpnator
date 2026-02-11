import { randomUUID } from 'node:crypto';

import type { JobLogLevel, SecretType, ServerStatus } from '@prisma/client';
import { ServerStatus as ServerStatusEnum } from '@prisma/client';

interface SecretRow {
  id: string;
  type: SecretType;
  ciphertext: string;
  createdAt: Date;
}

interface ServerRow {
  id: string;
  host: string;
  sshUser: string;
  sshSecretId: string;
  status: ServerStatus;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface UserRow {
  id: string;
  serverId: string;
  name: string | null;
  uuid: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ShareTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

interface XrayInstanceRow {
  id: string;
  serverId: string;
  listenPort: number;
  realityPrivateKey: string;
  realityPublicKey: string;
  serverName: string;
  dest: string;
  fingerprint: string;
  shortIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface JobLogRow {
  id: string;
  jobId: string;
  level: JobLogLevel;
  message: string;
  ts: Date;
}

interface AuditEventRow {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  meta: unknown;
  ts: Date;
}

export interface FakePrismaData {
  secrets: Map<string, SecretRow>;
  servers: Map<string, ServerRow>;
  users: Map<string, UserRow>;
  shareTokens: Map<string, ShareTokenRow>;
  xrayInstances: Map<string, XrayInstanceRow>;
  jobLogs: Map<string, JobLogRow>;
  auditEvents: Map<string, AuditEventRow>;
}

interface CreateArgs<TData> {
  data: TData;
}

interface FindUniqueArgs {
  where: { id: string };
}

interface FindManyArgs<TWhere = unknown> {
  where?: TWhere;
}

interface UpdateArgs<TData> {
  where: { id: string };
  data: TData;
}

interface DeleteArgs {
  where: { id: string };
}

interface ConnectById {
  connect: { id: string };
}

interface SecretCreateInput {
  id?: string;
  type: SecretType;
  ciphertext: string;
  createdAt?: Date;
}

interface SecretUpdateInput {
  type?: SecretType;
  ciphertext?: string;
}

interface ServerCreateInput {
  id?: string;
  host: string;
  sshUser: string;
  sshSecretId?: string;
  sshSecret?: ConnectById;
  status?: ServerStatus;
  lastError?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ServerUpdateInput {
  host?: string;
  sshUser?: string;
  sshSecretId?: string;
  sshSecret?: ConnectById;
  status?: ServerStatus;
  lastError?: string | null;
}

interface UserCreateInput {
  id?: string;
  serverId?: string;
  server?: ConnectById;
  name?: string | null;
  uuid?: string;
  enabled?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface UserFindManyWhere {
  serverId?: string;
}

interface UserUpdateInput {
  serverId?: string;
  server?: ConnectById;
  name?: string | null;
  uuid?: string;
  enabled?: boolean;
}

interface ShareTokenCreateInput {
  id?: string;
  userId?: string;
  user?: ConnectById;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
  createdAt?: Date;
}

interface ShareTokenFindUniqueArgs {
  where: { id?: string; tokenHash?: string };
  include?: {
    user?: {
      select?: {
        id?: boolean;
        serverId?: boolean;
        uuid?: boolean;
      };
    };
  };
}

interface ShareTokenFindManyWhere {
  userId?: string;
}

interface ShareTokenUpdateInput {
  tokenHash?: string;
  expiresAt?: Date;
  usedAt?: Date | null;
}

interface ShareTokenUpdateManyWhere {
  id?: string;
  usedAt?: Date | null;
  expiresAt?: {
    gt?: Date;
  };
}

interface ShareTokenUpdateManyArgs {
  where: ShareTokenUpdateManyWhere;
  data: {
    usedAt?: Date | null;
  };
}

interface XrayInstanceCreateInput {
  id?: string;
  serverId?: string;
  server?: ConnectById;
  listenPort: number;
  realityPrivateKey: string;
  realityPublicKey: string;
  serverName: string;
  dest: string;
  fingerprint?: string;
  shortIds: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

interface XrayInstanceFindFirstArgs {
  where?: {
    serverId?: string;
  };
  orderBy?: {
    createdAt?: 'asc' | 'desc';
    updatedAt?: 'asc' | 'desc';
  }[];
}

interface XrayInstanceFindManyArgs {
  where?: {
    serverId?: string;
  };
  orderBy?: {
    createdAt?: 'asc' | 'desc';
    updatedAt?: 'asc' | 'desc';
  };
}

interface XrayInstanceUpdateInput {
  listenPort?: number;
  realityPrivateKey?: string;
  realityPublicKey?: string;
  serverName?: string;
  dest?: string;
  fingerprint?: string;
  shortIds?: string[];
}

interface JobLogCreateInput {
  id?: string;
  jobId: string;
  level: JobLogLevel;
  message: string;
  ts?: Date;
}

interface JobLogFindManyWhere {
  jobId?: string;
}

interface JobLogFindManyOrderBy {
  ts?: 'asc' | 'desc';
}

interface JobLogFindManyArgs {
  where?: JobLogFindManyWhere;
  orderBy?: JobLogFindManyOrderBy;
  take?: number;
}

interface AuditEventCreateInput {
  id?: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  meta?: unknown;
  ts?: Date;
}

interface AuditEventFindManyWhere {
  entityId?: string;
}

interface AuditEventFindManyOrderBy {
  ts?: 'asc' | 'desc';
}

interface AuditEventFindManyArgs {
  where?: AuditEventFindManyWhere;
  orderBy?: AuditEventFindManyOrderBy;
  take?: number;
}

export function createFakePrisma() {
  const data: FakePrismaData = {
    secrets: new Map(),
    servers: new Map(),
    users: new Map(),
    shareTokens: new Map(),
    xrayInstances: new Map(),
    jobLogs: new Map(),
    auditEvents: new Map(),
  };

  const prisma = {
    secret: {
      create: ({ data: input }: CreateArgs<SecretCreateInput>) => {
        const now = new Date();
        const id = input.id ?? randomUUID();
        const row: SecretRow = {
          id,
          type: input.type,
          ciphertext: input.ciphertext,
          createdAt: input.createdAt ?? now,
        };
        data.secrets.set(id, row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: FindUniqueArgs) => {
        return Promise.resolve(data.secrets.get(where.id) ?? null);
      },
      findMany: () => {
        const result = [...data.secrets.values()].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
        return Promise.resolve(result);
      },
      update: ({ where, data: input }: UpdateArgs<SecretUpdateInput>) => {
        const existing = data.secrets.get(where.id);
        if (!existing) throw new Error('Record not found');

        if (input.type !== undefined) existing.type = input.type;
        if (input.ciphertext !== undefined) existing.ciphertext = input.ciphertext;

        data.secrets.set(where.id, existing);
        return Promise.resolve(existing);
      },
      delete: ({ where }: DeleteArgs) => {
        const existing = data.secrets.get(where.id);
        if (!existing) throw new Error('Record not found');
        data.secrets.delete(where.id);
        return Promise.resolve(existing);
      },
      count: () => Promise.resolve(data.secrets.size),
    },

    server: {
      create: ({ data: input }: CreateArgs<ServerCreateInput>) => {
        const now = new Date();
        const id = input.id ?? randomUUID();

        const sshSecretId: string | undefined = input.sshSecretId ?? input.sshSecret?.connect.id;

        if (!sshSecretId) throw new Error('sshSecretId is required');
        if (!data.secrets.has(sshSecretId)) throw new Error('Secret not found');

        const row: ServerRow = {
          id,
          host: input.host,
          sshUser: input.sshUser,
          sshSecretId,
          status: input.status ?? ServerStatusEnum.NEW,
          lastError: input.lastError ?? null,
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
        };
        data.servers.set(id, row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: FindUniqueArgs) => {
        return Promise.resolve(data.servers.get(where.id) ?? null);
      },
      findMany: () => {
        const result = [...data.servers.values()].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
        return Promise.resolve(result);
      },
      update: ({ where, data: input }: UpdateArgs<ServerUpdateInput>) => {
        const existing = data.servers.get(where.id);
        if (!existing) throw new Error('Record not found');

        if (input.host !== undefined) existing.host = input.host;
        if (input.sshUser !== undefined) existing.sshUser = input.sshUser;
        if (input.sshSecretId !== undefined) existing.sshSecretId = input.sshSecretId;
        if (input.sshSecret?.connect.id) existing.sshSecretId = input.sshSecret.connect.id;
        if (input.status !== undefined) existing.status = input.status;
        if (input.lastError !== undefined) existing.lastError = input.lastError;

        existing.updatedAt = new Date();
        data.servers.set(where.id, existing);
        return Promise.resolve(existing);
      },
      delete: ({ where }: DeleteArgs) => {
        const existing = data.servers.get(where.id);
        if (!existing) throw new Error('Record not found');
        data.servers.delete(where.id);
        return Promise.resolve(existing);
      },
      count: () => Promise.resolve(data.servers.size),
    },

    user: {
      create: ({ data: input }: CreateArgs<UserCreateInput>) => {
        const now = new Date();
        const id = input.id ?? randomUUID();

        const serverId: string | undefined = input.serverId ?? input.server?.connect.id;
        if (!serverId) throw new Error('serverId is required');
        if (!data.servers.has(serverId)) throw new Error('Server not found');

        const row: UserRow = {
          id,
          serverId,
          name: input.name ?? null,
          uuid: input.uuid ?? randomUUID(),
          enabled: input.enabled ?? true,
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
        };

        data.users.set(id, row);
        return Promise.resolve(row);
      },
      findUnique: ({ where }: FindUniqueArgs) => {
        return Promise.resolve(data.users.get(where.id) ?? null);
      },
      findMany: ({ where }: FindManyArgs<UserFindManyWhere> = {}) => {
        const serverId = where?.serverId;
        const result = [...data.users.values()]
          .filter((u) => (serverId ? u.serverId === serverId : true))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return Promise.resolve(result);
      },
      update: ({ where, data: input }: UpdateArgs<UserUpdateInput>) => {
        const existing = data.users.get(where.id);
        if (!existing) throw new Error('Record not found');

        if (input.serverId) existing.serverId = input.serverId;
        if (input.server?.connect.id) existing.serverId = input.server.connect.id;
        if (input.name !== undefined) existing.name = input.name;
        if (input.uuid !== undefined) existing.uuid = input.uuid;
        if (input.enabled !== undefined) existing.enabled = input.enabled;

        existing.updatedAt = new Date();
        data.users.set(where.id, existing);
        return Promise.resolve(existing);
      },
      delete: ({ where }: DeleteArgs) => {
        const existing = data.users.get(where.id);
        if (!existing) throw new Error('Record not found');
        data.users.delete(where.id);
        return Promise.resolve(existing);
      },
      count: () => Promise.resolve(data.users.size),
    },

    shareToken: {
      create: ({ data: input }: CreateArgs<ShareTokenCreateInput>) => {
        const now = new Date();
        const id = input.id ?? randomUUID();
        const userId: string | undefined = input.userId ?? input.user?.connect.id;
        if (!userId) throw new Error('userId is required');
        if (!data.users.has(userId)) throw new Error('User not found');

        const row: ShareTokenRow = {
          id,
          userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          usedAt: input.usedAt ?? null,
          createdAt: input.createdAt ?? now,
        };

        data.shareTokens.set(id, row);
        return Promise.resolve(row);
      },
      findUnique: ({ where, include }: ShareTokenFindUniqueArgs) => {
        let row: ShareTokenRow | undefined;
        if (where.id) row = data.shareTokens.get(where.id);
        if (!row && where.tokenHash) {
          row = [...data.shareTokens.values()].find((item) => item.tokenHash === where.tokenHash);
        }
        if (!row) return Promise.resolve(null);

        if (include?.user) {
          const user = data.users.get(row.userId);
          if (!user) throw new Error('User not found');
          return Promise.resolve({
            ...row,
            user: {
              id: user.id,
              serverId: user.serverId,
              uuid: user.uuid,
            },
          });
        }

        return Promise.resolve(row);
      },
      findMany: ({ where }: FindManyArgs<ShareTokenFindManyWhere> = {}) => {
        const userId = where?.userId;
        const result = [...data.shareTokens.values()]
          .filter((item) => (userId ? item.userId === userId : true))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return Promise.resolve(result);
      },
      update: ({ where, data: input }: UpdateArgs<ShareTokenUpdateInput>) => {
        const existing = data.shareTokens.get(where.id);
        if (!existing) throw new Error('Record not found');

        if (input.tokenHash !== undefined) existing.tokenHash = input.tokenHash;
        if (input.expiresAt !== undefined) existing.expiresAt = input.expiresAt;
        if (input.usedAt !== undefined) existing.usedAt = input.usedAt;

        data.shareTokens.set(where.id, existing);
        return Promise.resolve(existing);
      },
      updateMany: ({ where, data: updateData }: ShareTokenUpdateManyArgs) => {
        let updatedCount = 0;
        for (const [id, item] of data.shareTokens.entries()) {
          if (where.id && item.id !== where.id) continue;
          if (where.usedAt !== undefined && item.usedAt !== where.usedAt) continue;
          if (where.expiresAt?.gt && !(item.expiresAt > where.expiresAt.gt)) continue;

          const updated: ShareTokenRow = { ...item };
          if (updateData.usedAt !== undefined) updated.usedAt = updateData.usedAt;
          data.shareTokens.set(id, updated);
          updatedCount += 1;
        }
        return Promise.resolve({ count: updatedCount });
      },
      delete: ({ where }: DeleteArgs) => {
        const existing = data.shareTokens.get(where.id);
        if (!existing) throw new Error('Record not found');
        data.shareTokens.delete(where.id);
        return Promise.resolve(existing);
      },
    },

    xrayInstance: {
      create: ({ data: input }: CreateArgs<XrayInstanceCreateInput>) => {
        const now = new Date();
        const id = input.id ?? randomUUID();
        const serverId: string | undefined = input.serverId ?? input.server?.connect.id;
        if (!serverId) throw new Error('serverId is required');
        if (!data.servers.has(serverId)) throw new Error('Server not found');

        const row: XrayInstanceRow = {
          id,
          serverId,
          listenPort: input.listenPort,
          realityPrivateKey: input.realityPrivateKey,
          realityPublicKey: input.realityPublicKey,
          serverName: input.serverName,
          dest: input.dest,
          fingerprint: input.fingerprint ?? 'chrome',
          shortIds: [...input.shortIds],
          createdAt: input.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
        };

        data.xrayInstances.set(id, row);
        return Promise.resolve(row);
      },
      findFirst: ({ where, orderBy }: XrayInstanceFindFirstArgs) => {
        let rows = [...data.xrayInstances.values()];
        if (where?.serverId) rows = rows.filter((row) => row.serverId === where.serverId);

        if (orderBy && orderBy.length > 0) {
          rows.sort((a, b) => {
            for (const field of orderBy) {
              if (field.updatedAt) {
                const diff = a.updatedAt.getTime() - b.updatedAt.getTime();
                if (diff !== 0) return field.updatedAt === 'asc' ? diff : -diff;
              }
              if (field.createdAt) {
                const diff = a.createdAt.getTime() - b.createdAt.getTime();
                if (diff !== 0) return field.createdAt === 'asc' ? diff : -diff;
              }
            }
            return 0;
          });
        }

        return Promise.resolve(rows[0] ?? null);
      },
      findMany: ({ where, orderBy }: XrayInstanceFindManyArgs = {}) => {
        let rows = [...data.xrayInstances.values()];
        if (where?.serverId) rows = rows.filter((row) => row.serverId === where.serverId);

        if (orderBy?.updatedAt) {
          rows.sort((left, right) => {
            const diff = left.updatedAt.getTime() - right.updatedAt.getTime();
            return orderBy.updatedAt === 'asc' ? diff : -diff;
          });
        } else if (orderBy?.createdAt) {
          rows.sort((left, right) => {
            const diff = left.createdAt.getTime() - right.createdAt.getTime();
            return orderBy.createdAt === 'asc' ? diff : -diff;
          });
        }

        return Promise.resolve(rows);
      },
      update: ({ where, data: input }: UpdateArgs<XrayInstanceUpdateInput>) => {
        const existing = data.xrayInstances.get(where.id);
        if (!existing) throw new Error('Record not found');

        if (input.listenPort !== undefined) existing.listenPort = input.listenPort;
        if (input.realityPrivateKey !== undefined) existing.realityPrivateKey = input.realityPrivateKey;
        if (input.realityPublicKey !== undefined) existing.realityPublicKey = input.realityPublicKey;
        if (input.serverName !== undefined) existing.serverName = input.serverName;
        if (input.dest !== undefined) existing.dest = input.dest;
        if (input.fingerprint !== undefined) existing.fingerprint = input.fingerprint;
        if (input.shortIds !== undefined) existing.shortIds = [...input.shortIds];

        existing.updatedAt = new Date();
        data.xrayInstances.set(where.id, existing);
        return Promise.resolve(existing);
      },
      count: () => Promise.resolve(data.xrayInstances.size),
    },

    jobLog: {
      create: ({ data: input }: CreateArgs<JobLogCreateInput>) => {
        const id = input.id ?? randomUUID();
        const row: JobLogRow = {
          id,
          jobId: input.jobId,
          level: input.level,
          message: input.message,
          ts: input.ts ?? new Date(),
        };

        data.jobLogs.set(id, row);
        return Promise.resolve(row);
      },
      findMany: ({ where, orderBy, take }: JobLogFindManyArgs = {}) => {
        let rows = [...data.jobLogs.values()];

        if (where?.jobId) {
          rows = rows.filter((row) => row.jobId === where.jobId);
        }

        if (orderBy?.ts) {
          rows.sort((left, right) => {
            const diff = left.ts.getTime() - right.ts.getTime();
            return orderBy.ts === 'asc' ? diff : -diff;
          });
        }

        if (typeof take === 'number') {
          rows = rows.slice(0, Math.max(0, take));
        }

        return Promise.resolve(rows);
      },
    },

    auditEvent: {
      create: ({ data: input }: CreateArgs<AuditEventCreateInput>) => {
        const id = input.id ?? randomUUID();
        const row: AuditEventRow = {
          id,
          actor: input.actor,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          meta: input.meta ?? null,
          ts: input.ts ?? new Date(),
        };

        data.auditEvents.set(id, row);
        return Promise.resolve(row);
      },
      findMany: ({ where, orderBy, take }: AuditEventFindManyArgs = {}) => {
        let rows = [...data.auditEvents.values()];

        if (where?.entityId) {
          rows = rows.filter((row) => row.entityId === where.entityId);
        }

        if (orderBy?.ts) {
          rows.sort((left, right) => {
            const diff = left.ts.getTime() - right.ts.getTime();
            return orderBy.ts === 'asc' ? diff : -diff;
          });
        }

        if (typeof take === 'number') {
          rows = rows.slice(0, Math.max(0, take));
        }

        return Promise.resolve(rows);
      },
    },

    $disconnect: () => Promise.resolve(),
  };

  return { prisma, data };
}
