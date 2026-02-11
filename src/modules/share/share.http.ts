import { z } from 'zod';

const base64UrlTokenPattern = /^[A-Za-z0-9_-]+$/;

export const shareTokenParamsSchema = z
  .object({
    token: z.string().min(1).regex(base64UrlTokenPattern, 'Token must be base64url'),
  })
  .strict();

export type ShareTokenParams = z.infer<typeof shareTokenParamsSchema>;

export const shareConsumeResponseSchema = z
  .object({
    userId: z.string().uuid(),
    serverId: z.string().uuid(),
    vlessLink: z.string().startsWith('vless://'),
    server: z
      .object({
        host: z.string().min(1),
        port: z.coerce.number().int().min(1).max(65535),
      })
      .strict(),
    reality: z
      .object({
        publicKey: z.string().min(1),
        serverName: z.string().min(1),
        fingerprint: z.string().min(1),
        shortId: z.string().min(1),
        dest: z.string().min(1),
      })
      .strict(),
    user: z
      .object({
        uuid: z.string().uuid(),
      })
      .strict(),
    meta: z
      .object({
        tokenId: z.string().uuid(),
        expiresAt: z.string().datetime(),
        usedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();

export type ShareConsumeResponse = z.infer<typeof shareConsumeResponseSchema>;

export const shareTokenParamsJsonSchema = {
  type: 'object',
  required: ['token'],
  additionalProperties: false,
  properties: {
    token: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
  },
} as const;

export const shareConsumeResponseJsonSchema = {
  type: 'object',
  required: ['userId', 'serverId', 'vlessLink', 'server', 'reality', 'user', 'meta'],
  additionalProperties: false,
  properties: {
    userId: { type: 'string', format: 'uuid' },
    serverId: { type: 'string', format: 'uuid' },
    vlessLink: { type: 'string', pattern: '^vless://' },
    server: {
      type: 'object',
      required: ['host', 'port'],
      additionalProperties: false,
      properties: {
        host: { type: 'string' },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
      },
    },
    reality: {
      type: 'object',
      required: ['publicKey', 'serverName', 'fingerprint', 'shortId', 'dest'],
      additionalProperties: false,
      properties: {
        publicKey: { type: 'string' },
        serverName: { type: 'string' },
        fingerprint: { type: 'string' },
        shortId: { type: 'string' },
        dest: { type: 'string' },
      },
    },
    user: {
      type: 'object',
      required: ['uuid'],
      additionalProperties: false,
      properties: {
        uuid: { type: 'string', format: 'uuid' },
      },
    },
    meta: {
      type: 'object',
      required: ['tokenId', 'expiresAt', 'usedAt'],
      additionalProperties: false,
      properties: {
        tokenId: { type: 'string', format: 'uuid' },
        expiresAt: { type: 'string', format: 'date-time' },
        usedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
} as const;
