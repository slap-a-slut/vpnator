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
  required: ['userId', 'serverId', 'vlessLink', 'meta'],
  additionalProperties: false,
  properties: {
    userId: { type: 'string', format: 'uuid' },
    serverId: { type: 'string', format: 'uuid' },
    vlessLink: { type: 'string', pattern: '^vless://' },
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
