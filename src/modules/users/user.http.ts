import type { User } from '@prisma/client';
import { z } from 'zod';

export const createServerUserBodySchema = z
  .object({
    name: z.string().min(1).optional(),
  })
  .strict();

export type CreateServerUserBody = z.infer<typeof createServerUserBodySchema>;

export const patchUserBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => value.enabled !== undefined || value.name !== undefined, {
    message: 'At least one field must be provided',
  });

export type PatchUserBody = z.infer<typeof patchUserBodySchema>;

export const userResponseSchema = z
  .object({
    id: z.string().uuid(),
    serverId: z.string().uuid(),
    name: z.string().nullable(),
    uuid: z.string().uuid(),
    enabled: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type UserResponse = z.infer<typeof userResponseSchema>;

export const createUserShareBodySchema = z
  .object({
    ttlMinutes: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 60)
      .default(30),
  })
  .partial()
  .strict();

export type CreateUserShareBody = z.infer<typeof createUserShareBodySchema>;

export const createUserShareResponseSchema = z
  .object({
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type CreateUserShareResponse = z.infer<typeof createUserShareResponseSchema>;

export const userConfigResponseSchema = z
  .object({
    vlessLink: z.string().min(1),
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
        shortId: z.string().min(1),
        dest: z.string().min(1),
      })
      .strict(),
    user: z
      .object({
        uuid: z.string().uuid(),
      })
      .strict(),
  })
  .strict();

export type UserConfigResponse = z.infer<typeof userConfigResponseSchema>;

export const createServerUserBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
  },
} as const;

export const patchUserBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    name: { type: 'string', minLength: 1 },
  },
  anyOf: [{ required: ['enabled'] }, { required: ['name'] }],
} as const;

export const userParamsJsonSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

export const userResponseJsonSchema = {
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
} as const;

export const createUserShareBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ttlMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
  },
} as const;

export const createUserShareResponseJsonSchema = {
  type: 'object',
  required: ['token', 'expiresAt'],
  additionalProperties: false,
  properties: {
    token: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const userConfigResponseJsonSchema = {
  type: 'object',
  required: ['vlessLink', 'server', 'reality', 'user'],
  additionalProperties: false,
  properties: {
    vlessLink: { type: 'string' },
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
      required: ['publicKey', 'serverName', 'shortId', 'dest'],
      additionalProperties: false,
      properties: {
        publicKey: { type: 'string' },
        serverName: { type: 'string' },
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
  },
} as const;

export function toUserResponse(user: User): UserResponse {
  return userResponseSchema.parse({
    id: user.id,
    serverId: user.serverId,
    name: user.name ?? null,
    uuid: user.uuid,
    enabled: user.enabled,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  });
}

export function toCreateUserShareResponse(input: {
  token: string;
  expiresAt: Date;
}): CreateUserShareResponse {
  return createUserShareResponseSchema.parse({
    token: input.token,
    expiresAt: input.expiresAt.toISOString(),
  });
}

export function toUserConfigResponse(input: {
  vlessLink: string;
  server: {
    host: string;
    port: number;
  };
  reality: {
    publicKey: string;
    serverName: string;
    shortId: string;
    dest: string;
  };
  user: {
    uuid: string;
  };
}): UserConfigResponse {
  return userConfigResponseSchema.parse(input);
}

export function buildVlessRealityLink(input: {
  userUuid: string;
  host: string;
  port: number;
  serverName: string;
  publicKey: string;
  shortId: string;
}): string {
  const query = new URLSearchParams({
    security: 'reality',
    sni: input.serverName,
    fp: 'chrome',
    pbk: input.publicKey,
    sid: input.shortId,
    type: 'tcp',
  });

  return `vless://${input.userUuid}@${input.host}:${input.port}?${query.toString()}#XrayUser`;
}
