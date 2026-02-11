import type { Server, XrayInstance } from '@prisma/client';
import { SecretType, ServerStatus } from '@prisma/client';
import { z } from 'zod';

const hostnameRegex = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const shortIdRegex = /^[0-9a-fA-F]{8,32}$/;

export const createServerBodySchema = z
  .object({
    host: z.string().min(1),
    sshUser: z.string().min(1),
    sshAuth: z
      .object({
        type: z.nativeEnum(SecretType),
        value: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type CreateServerBody = z.infer<typeof createServerBodySchema>;

export const serverResponseSchema = z
  .object({
    id: z.string().uuid(),
    host: z.string().min(1),
    sshUser: z.string().min(1),
    sshSecretId: z.string().uuid(),
    status: z.nativeEnum(ServerStatus),
    lastError: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type ServerResponse = z.infer<typeof serverResponseSchema>;

export const serverListResponseSchema = z.array(serverResponseSchema);

export const xrayInstanceMetaSchema = z
  .object({
    id: z.string().uuid(),
    listenPort: z.coerce.number().int().min(1).max(65535),
    realityPublicKey: z.string().min(1),
    serverName: z.string().min(1),
    dest: z.string().min(1),
    fingerprint: z.string().min(1),
    shortIds: z.array(z.string().min(1)),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type XrayInstanceMeta = z.infer<typeof xrayInstanceMetaSchema>;

export const xrayDisguiseFingerprintSchema = z.enum([
  'chrome',
  'firefox',
  'safari',
  'edge',
  'ios',
  'android',
]);

export const patchServerDisguiseBodySchema = z
  .object({
    serverName: z.string().min(3).max(253).regex(hostnameRegex),
    dest: z.string().min(1).max(255).optional(),
    fingerprint: xrayDisguiseFingerprintSchema.default('chrome'),
    shortIds: z.array(z.string().regex(shortIdRegex)).min(1).max(16).optional(),
  })
  .strict();

export type PatchServerDisguiseBody = z.infer<typeof patchServerDisguiseBodySchema>;

export const serverDisguiseUpdateResponseSchema = z
  .object({
    jobId: z.string().uuid(),
    xrayInstance: xrayInstanceMetaSchema,
  })
  .strict();

export type ServerDisguiseUpdateResponse = z.infer<typeof serverDisguiseUpdateResponseSchema>;

export const serverStatusResponseSchema = z
  .object({
    status: z.nativeEnum(ServerStatus),
    lastError: z.string().nullable(),
    xrayInstance: xrayInstanceMetaSchema.nullable(),
  })
  .strict();

export type ServerStatusResponse = z.infer<typeof serverStatusResponseSchema>;

export const serverRepairResponseSchema = z
  .object({
    actions: z.array(z.string().min(1)),
    statusBefore: z.nativeEnum(ServerStatus),
    statusAfter: z.nativeEnum(ServerStatus),
  })
  .strict();

export type ServerRepairResponse = z.infer<typeof serverRepairResponseSchema>;

export const serverLogsQuerySchema = z
  .object({
    type: z.enum(['install', 'xray']),
    tail: z.coerce.number().int().min(1).max(1000).default(200),
  })
  .strict();

export type ServerLogsQuery = z.infer<typeof serverLogsQuerySchema>;

export const serverLogsResponseSchema = z
  .object({
    type: z.enum(['install', 'xray']),
    tail: z.coerce.number().int().min(1).max(1000),
    lines: z.array(z.string()),
  })
  .strict();

export type ServerLogsResponse = z.infer<typeof serverLogsResponseSchema>;

export const serverHealthResponseSchema = z
  .object({
    status: z.nativeEnum(ServerStatus),
    checks: z
      .object({
        ssh: z.boolean(),
        docker: z.boolean(),
        xrayContainer: z.boolean(),
        portListening: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type ServerHealthResponse = z.infer<typeof serverHealthResponseSchema>;

export const createServerBodyJsonSchema = {
  type: 'object',
  required: ['host', 'sshUser', 'sshAuth'],
  additionalProperties: false,
  properties: {
    host: { type: 'string', minLength: 1 },
    sshUser: { type: 'string', minLength: 1 },
    sshAuth: {
      type: 'object',
      required: ['type', 'value'],
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['SSH_KEY', 'SSH_PASSWORD'] },
        value: { type: 'string', minLength: 1 },
      },
    },
  },
} as const;

export const serverParamsJsonSchema = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

export const serverResponseJsonSchema = {
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
} as const;

export const serverListResponseJsonSchema = {
  type: 'array',
  items: serverResponseJsonSchema,
} as const;

export const xrayInstanceMetaJsonSchema = {
  type: 'object',
  required: [
    'id',
    'listenPort',
    'realityPublicKey',
    'serverName',
    'dest',
    'fingerprint',
    'shortIds',
    'createdAt',
    'updatedAt',
  ],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    listenPort: { type: 'integer', minimum: 1, maximum: 65535 },
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
} as const;

export const serverStatusResponseJsonSchema = {
  type: 'object',
  required: ['status', 'lastError', 'xrayInstance'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['NEW', 'INSTALLING', 'READY', 'ERROR'] },
    lastError: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    xrayInstance: {
      anyOf: [xrayInstanceMetaJsonSchema, { type: 'null' }],
    },
  },
} as const;

export const patchServerDisguiseBodyJsonSchema = {
  type: 'object',
  required: ['serverName'],
  additionalProperties: false,
  properties: {
    serverName: {
      type: 'string',
      minLength: 3,
      maxLength: 253,
      pattern: hostnameRegex.source,
    },
    dest: {
      type: 'string',
      minLength: 1,
      maxLength: 255,
    },
    fingerprint: {
      type: 'string',
      enum: ['chrome', 'firefox', 'safari', 'edge', 'ios', 'android'],
      default: 'chrome',
    },
    shortIds: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      items: {
        type: 'string',
        pattern: shortIdRegex.source,
      },
    },
  },
} as const;

export const serverDisguiseUpdateResponseJsonSchema = {
  type: 'object',
  required: ['jobId', 'xrayInstance'],
  additionalProperties: false,
  properties: {
    jobId: { type: 'string', format: 'uuid' },
    xrayInstance: xrayInstanceMetaJsonSchema,
  },
} as const;

export const serverRepairResponseJsonSchema = {
  type: 'object',
  required: ['actions', 'statusBefore', 'statusAfter'],
  additionalProperties: false,
  properties: {
    actions: {
      type: 'array',
      items: { type: 'string' },
    },
    statusBefore: { type: 'string', enum: ['NEW', 'INSTALLING', 'READY', 'ERROR'] },
    statusAfter: { type: 'string', enum: ['NEW', 'INSTALLING', 'READY', 'ERROR'] },
  },
} as const;

export const serverLogsQueryJsonSchema = {
  type: 'object',
  required: ['type'],
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['install', 'xray'] },
    tail: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
  },
} as const;

export const serverLogsResponseJsonSchema = {
  type: 'object',
  required: ['type', 'tail', 'lines'],
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['install', 'xray'] },
    tail: { type: 'integer', minimum: 1, maximum: 1000 },
    lines: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const;

export const serverHealthResponseJsonSchema = {
  type: 'object',
  required: ['status', 'checks'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['NEW', 'INSTALLING', 'READY', 'ERROR'] },
    checks: {
      type: 'object',
      required: ['ssh', 'docker', 'xrayContainer', 'portListening'],
      additionalProperties: false,
      properties: {
        ssh: { type: 'boolean' },
        docker: { type: 'boolean' },
        xrayContainer: { type: 'boolean' },
        portListening: { type: 'boolean' },
      },
    },
  },
} as const;

export function toServerResponse(server: Server): ServerResponse {
  return serverResponseSchema.parse({
    id: server.id,
    host: server.host,
    sshUser: server.sshUser,
    sshSecretId: server.sshSecretId,
    status: server.status,
    lastError: server.lastError ?? null,
    createdAt: server.createdAt.toISOString(),
    updatedAt: server.updatedAt.toISOString(),
  });
}

function toXrayInstanceMeta(xrayInstance: XrayInstance): XrayInstanceMeta {
  return xrayInstanceMetaSchema.parse({
    id: xrayInstance.id,
    listenPort: xrayInstance.listenPort,
    realityPublicKey: xrayInstance.realityPublicKey,
    serverName: xrayInstance.serverName,
    dest: xrayInstance.dest,
    fingerprint: xrayInstance.fingerprint,
    shortIds: xrayInstance.shortIds,
    createdAt: xrayInstance.createdAt.toISOString(),
    updatedAt: xrayInstance.updatedAt.toISOString(),
  });
}

export function toServerStatusResponse(input: {
  status: ServerStatus;
  lastError: string | null;
  xrayInstance: XrayInstance | null;
}): ServerStatusResponse {
  return serverStatusResponseSchema.parse({
    status: input.status,
    lastError: input.lastError ?? null,
    xrayInstance: input.xrayInstance ? toXrayInstanceMeta(input.xrayInstance) : null,
  });
}

export function toServerDisguiseUpdateResponse(input: {
  jobId: string;
  xrayInstance: XrayInstance;
}): ServerDisguiseUpdateResponse {
  return serverDisguiseUpdateResponseSchema.parse({
    jobId: input.jobId,
    xrayInstance: toXrayInstanceMeta(input.xrayInstance),
  });
}

export function toServerRepairResponse(input: {
  actions: string[];
  statusBefore: ServerStatus;
  statusAfter: ServerStatus;
}): ServerRepairResponse {
  return serverRepairResponseSchema.parse({
    actions: input.actions,
    statusBefore: input.statusBefore,
    statusAfter: input.statusAfter,
  });
}

export function toServerLogsResponse(input: {
  type: 'install' | 'xray';
  tail: number;
  lines: string[];
}): ServerLogsResponse {
  return serverLogsResponseSchema.parse({
    type: input.type,
    tail: input.tail,
    lines: input.lines,
  });
}

export function toServerHealthResponse(input: {
  status: ServerStatus;
  checks: {
    ssh: boolean;
    docker: boolean;
    xrayContainer: boolean;
    portListening: boolean;
  };
}): ServerHealthResponse {
  return serverHealthResponseSchema.parse({
    status: input.status,
    checks: input.checks,
  });
}
