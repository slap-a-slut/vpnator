import { SecretType } from '@prisma/client';
import { z } from 'zod';

export const secretIdSchema = z.string().uuid();
export const secretTypeSchema = z.nativeEnum(SecretType);

export const createSecretDtoSchema = z
  .object({
    type: secretTypeSchema,
    ciphertext: z.string().min(1),
  })
  .strict();

export type CreateSecretDto = z.infer<typeof createSecretDtoSchema>;

export const updateSecretDtoSchema = z
  .object({
    type: secretTypeSchema.optional(),
    ciphertext: z.string().min(1).optional(),
  })
  .strict();

export type UpdateSecretDto = z.infer<typeof updateSecretDtoSchema>;
