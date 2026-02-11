import { SecretType, ServerStatus } from '@prisma/client';
import { z } from 'zod';

const isoDateTime = z.string().datetime();

const secretExportSchema = z
  .object({
    id: z.string().uuid(),
    type: z.nativeEnum(SecretType),
    ciphertext: z.string().min(1),
    createdAt: isoDateTime,
  })
  .strict();

const serverExportSchema = z
  .object({
    id: z.string().uuid(),
    host: z.string().min(1),
    sshUser: z.string().min(1),
    sshSecretId: z.string().uuid(),
    status: z.nativeEnum(ServerStatus),
    lastError: z.string().nullable(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();

const userExportSchema = z
  .object({
    id: z.string().uuid(),
    serverId: z.string().uuid(),
    name: z.string().nullable(),
    uuid: z.string().uuid(),
    enabled: z.boolean(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();

const xrayInstanceExportSchema = z
  .object({
    id: z.string().uuid(),
    serverId: z.string().uuid(),
    listenPort: z.coerce.number().int().min(1).max(65535),
    realityPrivateKey: z.string().min(1),
    realityPublicKey: z.string().min(1),
    serverName: z.string().min(1),
    dest: z.string().min(1),
    fingerprint: z.string().min(1).default('chrome'),
    shortIds: z.array(z.string().min(1)),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .strict();

const shareTokenExportSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    tokenHash: z.string().min(1),
    expiresAt: isoDateTime,
    usedAt: isoDateTime.nullable(),
    createdAt: isoDateTime,
  })
  .strict();

const auditSummaryBucketSchema = z
  .object({
    name: z.string().min(1),
    count: z.coerce.number().int().nonnegative(),
  })
  .strict();

const auditSummarySchema = z
  .object({
    totalEvents: z.coerce.number().int().nonnegative(),
    byAction: z.array(auditSummaryBucketSchema),
    byEntityType: z.array(auditSummaryBucketSchema),
    latestTs: isoDateTime.nullable(),
  })
  .strict();

export const adminExportResponseSchema = z
  .object({
    version: z.literal(1),
    exportedAt: isoDateTime,
    data: z
      .object({
        secrets: z.array(secretExportSchema),
        servers: z.array(serverExportSchema),
        users: z.array(userExportSchema),
        xrayInstances: z.array(xrayInstanceExportSchema),
        shareTokens: z.array(shareTokenExportSchema),
      })
      .strict(),
    auditSummary: auditSummarySchema,
  })
  .strict();

export type AdminExportResponse = z.infer<typeof adminExportResponseSchema>;

export const adminExportResponseJsonSchema = {
  type: 'object',
  required: ['version', 'exportedAt', 'data', 'auditSummary'],
  additionalProperties: false,
  properties: {
    version: { type: 'integer', const: 1 },
    exportedAt: { type: 'string', format: 'date-time' },
    data: {
      type: 'object',
      required: ['secrets', 'servers', 'users', 'xrayInstances', 'shareTokens'],
      additionalProperties: false,
      properties: {
        secrets: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'type', 'ciphertext', 'createdAt'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', format: 'uuid' },
              type: { type: 'string', enum: ['SSH_KEY', 'SSH_PASSWORD'] },
              ciphertext: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        servers: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'id',
              'host',
              'sshUser',
              'sshSecretId',
              'status',
              'lastError',
              'createdAt',
              'updatedAt',
            ],
            additionalProperties: false,
            properties: {
              id: { type: 'string', format: 'uuid' },
              host: { type: 'string' },
              sshUser: { type: 'string' },
              sshSecretId: { type: 'string', format: 'uuid' },
              status: { type: 'string', enum: ['NEW', 'INSTALLING', 'READY', 'ERROR'] },
              lastError: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        users: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'serverId', 'name', 'uuid', 'enabled', 'createdAt', 'updatedAt'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', format: 'uuid' },
              serverId: { type: 'string', format: 'uuid' },
              name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              uuid: { type: 'string', format: 'uuid' },
              enabled: { type: 'boolean' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        xrayInstances: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'id',
              'serverId',
              'listenPort',
              'realityPrivateKey',
              'realityPublicKey',
              'serverName',
              'dest',
              'shortIds',
              'createdAt',
              'updatedAt',
            ],
            additionalProperties: false,
            properties: {
              id: { type: 'string', format: 'uuid' },
              serverId: { type: 'string', format: 'uuid' },
              listenPort: { type: 'integer', minimum: 1, maximum: 65535 },
              realityPrivateKey: { type: 'string' },
              realityPublicKey: { type: 'string' },
              serverName: { type: 'string' },
              dest: { type: 'string' },
              fingerprint: { type: 'string' },
              shortIds: {
                type: 'array',
                items: { type: 'string' },
              },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        shareTokens: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'userId', 'tokenHash', 'expiresAt', 'usedAt', 'createdAt'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', format: 'uuid' },
              userId: { type: 'string', format: 'uuid' },
              tokenHash: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
              usedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    auditSummary: {
      type: 'object',
      required: ['totalEvents', 'byAction', 'byEntityType', 'latestTs'],
      additionalProperties: false,
      properties: {
        totalEvents: { type: 'integer', minimum: 0 },
        byAction: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'count'],
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              count: { type: 'integer', minimum: 0 },
            },
          },
        },
        byEntityType: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'count'],
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              count: { type: 'integer', minimum: 0 },
            },
          },
        },
        latestTs: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
      },
    },
  },
} as const;

export function toAdminExportResponse(input: unknown): AdminExportResponse {
  return adminExportResponseSchema.parse(input);
}
