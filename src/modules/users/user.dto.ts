import { z } from 'zod';

export const userIdSchema = z.string().uuid();

export const createUserDtoSchema = z
  .object({
    serverId: z.string().uuid(),
    name: z.string().min(1).nullable().optional(),
    uuid: z.string().uuid().optional(),
    enabled: z.boolean().default(true),
  })
  .strict();

export type CreateUserDto = z.infer<typeof createUserDtoSchema>;

export const updateUserDtoSchema = z
  .object({
    serverId: z.string().uuid().optional(),
    name: z.string().min(1).nullable().optional(),
    uuid: z.string().uuid().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type UpdateUserDto = z.infer<typeof updateUserDtoSchema>;
