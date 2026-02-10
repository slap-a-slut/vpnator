import { z } from 'zod';

export const xrayInstanceIdSchema = z.string().uuid();

const portSchema = z.coerce.number().int().min(1).max(65535);

export const createXrayInstanceDtoSchema = z
  .object({
    serverId: z.string().uuid(),
    listenPort: portSchema,
    realityPrivateKey: z.string().min(1),
    realityPublicKey: z.string().min(1),
    serverName: z.string().min(1),
    dest: z.string().min(1),
    shortIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type CreateXrayInstanceDto = z.infer<typeof createXrayInstanceDtoSchema>;

export const updateXrayInstanceDtoSchema = z
  .object({
    listenPort: portSchema.optional(),
    realityPrivateKey: z.string().min(1).optional(),
    realityPublicKey: z.string().min(1).optional(),
    serverName: z.string().min(1).optional(),
    dest: z.string().min(1).optional(),
    shortIds: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

export type UpdateXrayInstanceDto = z.infer<typeof updateXrayInstanceDtoSchema>;
