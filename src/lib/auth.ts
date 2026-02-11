import { timingSafeEqual } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import { AppError } from './errors';

function isPublicRoute(request: FastifyRequest): boolean {
  if (request.method !== 'GET') return false;
  const path = request.url.split('?')[0] ?? request.url;
  return path === '/health' || path === '/version' || path.startsWith('/share/');
}

function extractBearerToken(authorizationHeader: string): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  if (!match?.[1]) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

function findMatchingApiKey(candidate: string, apiKeys: string[]): string | null {
  const candidateBuffer = Buffer.from(candidate);

  for (const apiKey of apiKeys) {
    const apiKeyBuffer = Buffer.from(apiKey);
    if (apiKeyBuffer.length !== candidateBuffer.length) continue;
    if (timingSafeEqual(apiKeyBuffer, candidateBuffer)) return apiKey;
  }

  return null;
}

function toActorId(apiKey: string): string {
  return `adminKey:${apiKey.slice(0, 6)}`;
}

export function createAdminApiKeyGuard(apiKeys: string[]) {
  return function adminApiKeyGuard(request: FastifyRequest): string | undefined {
    if (isPublicRoute(request)) return undefined;

    const authorizationHeader = request.headers.authorization;
    if (typeof authorizationHeader !== 'string') {
      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: 'Missing Authorization header',
        details: { method: request.method, route: request.url, reason: 'MISSING_BEARER' },
      });
    }

    const token = extractBearerToken(authorizationHeader);
    if (!token) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: 'Invalid Authorization header format',
        details: { method: request.method, route: request.url, reason: 'INVALID_BEARER_FORMAT' },
      });
    }

    const matchingApiKey = findMatchingApiKey(token, apiKeys);
    if (!matchingApiKey) {
      throw new AppError({
        code: 'UNAUTHORIZED',
        statusCode: 401,
        message: 'Invalid API key',
        details: { method: request.method, route: request.url, reason: 'INVALID_API_KEY' },
      });
    }

    return toActorId(matchingApiKey);
  };
}
