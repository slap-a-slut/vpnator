import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

function parseCommaSeparatedList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const booleanFromEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return value;
  }, z.boolean().default(defaultValue));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ROLE: z.enum(['api', 'worker']).default('api'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ADMIN_API_KEYS: z
    .string()
    .transform(parseCommaSeparatedList)
    .refine((items) => items.length > 0, {
      message: 'ADMIN_API_KEYS must contain at least one key',
    }),
  CORS_ORIGINS: z.string().default('').transform(parseCommaSeparatedList),
  SWAGGER_ENABLED: booleanFromEnv(true),
  PROVISION_DRY_RUN: booleanFromEnv(false),
  INSTALL_LOG_DIR: z.string().min(1).default('var/install-logs'),
  XRAY_STORE_MODE: z.enum(['file', 'grpc']).default('file'),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  MASTER_KEY: z
    .string()
    .min(1)
    .transform((value) => value.trim())
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      message: 'MASTER_KEY must be base64-encoded 32 bytes',
    }),
  TOKEN_SALT: z.string().min(1),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must start with postgresql:// or postgres://',
    ),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

export const env: Env = parsed.data;
