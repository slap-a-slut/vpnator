const LOG_REDACTIONS: { pattern: RegExp; replace: string }[] = [
  {
    pattern: /(-----BEGIN [^-]+-----)[\s\S]*?(-----END [^-]+-----)/g,
    replace: '$1[REDACTED]$2',
  },
  {
    pattern:
      /("?(?:password|passwd|secret|token|privateKey|private_key|ciphertext|master_key|token_salt|sshAuth)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    replace: '$1[REDACTED]',
  },
  {
    pattern: /(Private key:\s*)\S+/gi,
    replace: '$1[REDACTED]',
  },
  {
    pattern: /(Bearer\s+)[A-Za-z0-9._-]+/gi,
    replace: '$1[REDACTED]',
  },
];

export function sanitizeLogText(input: string): string {
  return LOG_REDACTIONS.reduce((acc, rule) => acc.replace(rule.pattern, rule.replace), input);
}

export function sanitizeLogLines(lines: string[]): string[] {
  return lines.map((line) => sanitizeLogText(line));
}
