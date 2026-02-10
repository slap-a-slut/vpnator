import { z } from 'zod';

export const sshTestResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();

export type SshTestResponse = z.infer<typeof sshTestResponseSchema>;

export const sshTestResponseJsonSchema = {
  type: 'object',
  required: ['ok'],
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', const: true },
  },
} as const;

