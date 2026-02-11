import { z } from 'zod';

const uuidSchema = z.string().uuid();
const datetimeSchema = z.string().datetime();

const shortIdSchema = z.string().regex(/^[0-9a-fA-F]{8,32}$/);
const fingerprintSchema = z.enum(['chrome', 'firefox', 'safari', 'edge', 'ios', 'android']);

export const vlessLinkSchema = z.string().superRefine((value, context) => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'vlessLink must be a valid URL',
    });
    return;
  }

  if (parsed.protocol !== 'vless:') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'vlessLink protocol must be vless://',
    });
  }

  if (!parsed.username) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'vlessLink must include user UUID',
    });
  } else {
    const uuidResult = uuidSchema.safeParse(parsed.username);
    if (!uuidResult.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'vlessLink user UUID is invalid',
      });
    }
  }

  if (!parsed.hostname) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'vlessLink must include host',
    });
  }

  const port = Number(parsed.port);
  if (!parsed.port || !Number.isInteger(port) || port < 1 || port > 65535) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'vlessLink must include valid port',
    });
  }

  const requiredParams = ['security', 'sni', 'fp', 'pbk', 'sid', 'type'] as const;
  for (const key of requiredParams) {
    if (!parsed.searchParams.get(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `vlessLink is missing query param ${key}`,
      });
    }
  }

  if (parsed.searchParams.get('security') !== 'reality') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'vlessLink security must be reality',
    });
  }

  const fingerprint = parsed.searchParams.get('fp');
  if (!fingerprint || !fingerprintSchema.safeParse(fingerprint).success) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'vlessLink fp must be a supported fingerprint',
    });
  }

  if (parsed.searchParams.get('type') !== 'tcp') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'vlessLink type must be tcp',
    });
  }

  const sid = parsed.searchParams.get('sid');
  if (sid) {
    const sidResult = shortIdSchema.safeParse(sid);
    if (!sidResult.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'vlessLink sid must be 8-32 hex chars',
      });
    }
  }

  if (parsed.hash !== '#XrayUser') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'vlessLink fragment must be #XrayUser',
    });
  }
});

export const sharePayloadSchema = z
  .object({
    userId: uuidSchema,
    serverId: uuidSchema,
    vlessLink: vlessLinkSchema,
    server: z
      .object({
        host: z.string().min(1),
        port: z.number().int().min(1).max(65535),
      })
      .strict(),
    reality: z
      .object({
        publicKey: z.string().min(1),
        serverName: z.string().min(1),
        fingerprint: z.string().min(1),
        shortId: shortIdSchema,
        dest: z.string().min(1),
      })
      .strict(),
    user: z
      .object({
        uuid: uuidSchema,
      })
      .strict(),
    meta: z
      .object({
        tokenId: uuidSchema,
        expiresAt: datetimeSchema,
        usedAt: datetimeSchema,
      })
      .strict(),
  })
  .strict();

export type SharePayload = z.infer<typeof sharePayloadSchema>;
