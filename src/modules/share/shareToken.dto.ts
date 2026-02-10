import { z } from 'zod';

export const shareTokenIdSchema = z.string().uuid();

export const createShareTokenDtoSchema = z
  .object({
    userId: z.string().uuid(),
    tokenHash: z.string().min(1),
    expiresAt: z.coerce.date(),
  })
  .strict();

export type CreateShareTokenDto = z.infer<typeof createShareTokenDtoSchema>;

export const updateShareTokenDtoSchema = z
  .object({
    tokenHash: z.string().min(1).optional(),
    expiresAt: z.coerce.date().optional(),
    usedAt: z.coerce.date().nullable().optional(),
  })
  .strict();

export type UpdateShareTokenDto = z.infer<typeof updateShareTokenDtoSchema>;
