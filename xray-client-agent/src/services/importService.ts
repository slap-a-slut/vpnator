import { sharePayloadSchema } from '../contracts/compatibility';
import type { ImportedSharePayload } from '../types';

export async function importShareToken(
  baseUrl: string,
  token: string,
): Promise<ImportedSharePayload> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const requestUrl = `${normalizedBaseUrl}/share/${encodeURIComponent(token)}`;

  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(
      `Import failed: HTTP ${response.status} ${response.statusText}${
        bodyText ? ` - ${bodyText}` : ''
      }`,
    );
  }

  const payload = sharePayloadSchema.parse(await response.json());

  return {
    userId: payload.userId,
    serverId: payload.serverId,
    vlessLink: payload.vlessLink,
    meta: payload.meta,
    importedAt: new Date().toISOString(),
    baseUrl: normalizedBaseUrl,
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) throw new Error('base-url is required');

  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('base-url must use http or https');
  }

  const normalized = `${parsed.origin}${parsed.pathname}`.replace(/\/$/, '');
  return normalized;
}
