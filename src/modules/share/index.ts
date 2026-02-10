import { ServerStatus } from '@prisma/client';

import type { FastifyInstance } from 'fastify';

import { AuditEventRepository, getActorIdFromRequest } from '../audit';
import { ServerRepository } from '../servers/server.repository';
import { buildVlessRealityLink } from '../users/user.http';
import { XrayInstanceRepository } from '../xray/xrayInstance.repository';
import { hashShareToken } from '../../lib/crypto';
import { AppError, errorResponseSchema } from '../../lib/errors';
import { parseOrThrow } from '../../lib/validation';
import { appVersion } from '../../lib/version';

import {
  shareConsumeResponseJsonSchema,
  shareConsumeResponseSchema,
  shareTokenParamsJsonSchema,
  shareTokenParamsSchema,
} from './share.http';
import { ShareTokenRepository } from './shareToken.repository';

export * from './share.http';
export * from './shareToken.dto';
export * from './shareToken.repository';

const healthResponseSchema = {
  type: 'object',
  required: ['status'],
  additionalProperties: false,
  properties: {
    status: { type: 'string' },
  },
} as const;

const versionResponseSchema = {
  type: 'object',
  required: ['version'],
  additionalProperties: false,
  properties: {
    version: { type: 'string' },
  },
} as const;

export function shareModule(app: FastifyInstance) {
  const auditEventRepository = new AuditEventRepository(app.prisma);
  const serverRepository = new ServerRepository(app.prisma);
  const shareTokenRepository = new ShareTokenRepository(app.prisma);
  const xrayInstanceRepository = new XrayInstanceRepository(app.prisma);

  app.get(
    '/health',
    {
      schema: {
        tags: ['share'],
        summary: 'Health check',
        response: {
          200: healthResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    () => {
      return { status: 'ok' };
    },
  );

  app.get(
    '/version',
    {
      schema: {
        tags: ['share'],
        summary: 'Service version',
        response: {
          200: versionResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    () => {
      return { version: appVersion };
    },
  );

  app.get(
    '/share/:token',
    {
      schema: {
        tags: ['share'],
        summary: 'Consume one-time share token',
        params: shareTokenParamsJsonSchema,
        response: {
          200: shareConsumeResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          410: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const actor = getActorIdFromRequest(request);
      const { token } = parseOrThrow(shareTokenParamsSchema, request.params);
      const tokenHash = hashShareToken(token);
      const now = new Date();

      const shareToken = await shareTokenRepository.findByTokenHashWithUser(tokenHash);
      if (!shareToken) {
        throw new AppError({
          code: 'TOKEN_INVALID',
          statusCode: 404,
          message: 'Share token is invalid',
        });
      }

      if (shareToken.usedAt) {
        throw new AppError({
          code: 'TOKEN_USED',
          statusCode: 410,
          message: 'Share token already used',
          details: { tokenId: shareToken.id },
        });
      }

      if (shareToken.expiresAt <= now) {
        throw new AppError({
          code: 'TOKEN_EXPIRED',
          statusCode: 410,
          message: 'Share token is expired',
          details: { tokenId: shareToken.id, expiresAt: shareToken.expiresAt.toISOString() },
        });
      }

      const server = await serverRepository.findById(shareToken.user.serverId);
      if (!server) {
        throw new AppError({
          code: 'SERVER_NOT_FOUND',
          statusCode: 404,
          message: 'Server not found',
          details: { id: shareToken.user.serverId },
        });
      }

      const xrayInstance = await xrayInstanceRepository.findLatestByServerId(server.id);
      if (server.status !== ServerStatus.READY || !xrayInstance) {
        throw new AppError({
          code: 'NOT_READY',
          statusCode: 409,
          message: 'Server is not ready to provide share config',
          details: { serverId: server.id, status: server.status },
        });
      }

      const shortId = xrayInstance.shortIds[0];
      if (!shortId) {
        throw new AppError({
          code: 'NOT_READY',
          statusCode: 409,
          message: 'Server is not ready to provide share config',
          details: { serverId: server.id, reason: 'shortIds is empty' },
        });
      }

      const vlessLink = buildVlessRealityLink({
        userUuid: shareToken.user.uuid,
        host: server.host,
        port: xrayInstance.listenPort,
        serverName: xrayInstance.serverName,
        publicKey: xrayInstance.realityPublicKey,
        shortId,
      });

      const consumed = await shareTokenRepository.markUsedIfAvailable(shareToken.id, now);
      if (!consumed) {
        throw new AppError({
          code: 'TOKEN_USED',
          statusCode: 410,
          message: 'Share token already used',
          details: { tokenId: shareToken.id },
        });
      }

      await auditEventRepository.create({
        actor,
        action: 'SHARE_CONSUME',
        entityType: 'SHARE_TOKEN',
        entityId: shareToken.id,
        meta: {
          userId: shareToken.userId,
          serverId: shareToken.user.serverId,
        },
      });

      return shareConsumeResponseSchema.parse({
        userId: shareToken.userId,
        serverId: shareToken.user.serverId,
        vlessLink,
        meta: {
          tokenId: shareToken.id,
          expiresAt: shareToken.expiresAt.toISOString(),
          usedAt: now.toISOString(),
        },
      });
    },
  );
}
