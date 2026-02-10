import type { ZodType } from 'zod';
import { z } from 'zod';

import { AppError } from './errors';

export function parseOrThrow<TOutput>(schema: ZodType<TOutput>, data: unknown): TOutput {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;

  throw new AppError({
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message: 'Request validation failed',
    details: parsed.error.flatten(),
  });
}

export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new AppError({
    code: 'INTERNAL_SERVER_ERROR',
    statusCode: 500,
    message,
    details: { value },
  });
}

export const uuidSchema = z.string().uuid();
