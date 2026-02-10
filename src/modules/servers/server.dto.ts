import { ServerStatus } from '@prisma/client';
import { z } from 'zod';

export const serverIdSchema = z.string().uuid();
export const serverStatusSchema = z.nativeEnum(ServerStatus);

export const createServerDtoSchema = z
  .object({
    host: z.string().min(1),
    sshUser: z.string().min(1),
    sshSecretId: z.string().uuid(),
    status: serverStatusSchema.optional(),
    lastError: z.string().min(1).nullable().optional(),
  })
  .strict();

export type CreateServerDto = z.infer<typeof createServerDtoSchema>;

export const updateServerDtoSchema = z
  .object({
    host: z.string().min(1).optional(),
    sshUser: z.string().min(1).optional(),
    sshSecretId: z.string().uuid().optional(),
    status: serverStatusSchema.optional(),
    lastError: z.string().min(1).nullable().optional(),
  })
  .strict();

export type UpdateServerDto = z.infer<typeof updateServerDtoSchema>;
