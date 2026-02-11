import { ServerStatus } from '@prisma/client';
import { z } from 'zod';

import type { FastifyInstance } from 'fastify';

import { AuditEventRepository, getActorIdFromRequest } from '../audit';
import { AppError, errorResponseSchema } from '../../lib/errors';
import { parseOrThrow, uuidSchema } from '../../lib/validation';
import { ServerRepository } from '../servers/server.repository';
import { ShareTokenRepository } from '../share/shareToken.repository';
import { XrayInstanceRepository } from '../xray/xrayInstance.repository';
import { updateUserDtoSchema } from './user.dto';
import {
  createUserShareBodyJsonSchema,
  createUserShareBodySchema,
  createUserShareResponseJsonSchema,
  buildVlessRealityLink,
  toCreateUserShareResponse,
  patchUserBodyJsonSchema,
  patchUserBodySchema,
  toUserConfigResponse,
  toUserResponse,
  userConfigResponseJsonSchema,
  userParamsJsonSchema,
  userResponseJsonSchema,
} from './user.http';
import { UserRepository } from './user.repository';

export * from './user.dto';
export * from './user.http';
export * from './user.repository';

const userIdParamsSchema = z.object({ id: uuidSchema }).strict();

export function usersModule(app: FastifyInstance) {
  const auditEventRepository = new AuditEventRepository(app.prisma);
  const userRepository = new UserRepository(app.prisma);
  const serverRepository = new ServerRepository(app.prisma);
  const xrayInstanceRepository = new XrayInstanceRepository(app.prisma);
  const shareTokenRepository = new ShareTokenRepository(app.prisma);

  app.get(
    '/:id/config',
    {
      schema: {
        tags: ['users', 'xray'],
        summary: 'Get user VLESS+REALITY config',
        params: userParamsJsonSchema,
        response: {
          200: userConfigResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = parseOrThrow(userIdParamsSchema, request.params);

      const user = await userRepository.findById(id);
      if (!user) {
        throw new AppError({
          code: 'USER_NOT_FOUND',
          statusCode: 404,
          message: 'User not found',
          details: { id },
        });
      }

      const server = await serverRepository.findById(user.serverId);
      if (!server) {
        throw new AppError({
          code: 'SERVER_NOT_FOUND',
          statusCode: 404,
          message: 'Server not found',
          details: { id: user.serverId },
        });
      }

      const xrayInstance = await xrayInstanceRepository.findLatestByServerId(server.id);
      if (server.status !== ServerStatus.READY || !xrayInstance) {
        throw new AppError({
          code: 'NOT_READY',
          statusCode: 409,
          message: 'Server is not ready to provide user config',
          details: { serverId: server.id, status: server.status },
        });
      }

      const shortId = xrayInstance.shortIds[0];
      if (!shortId) {
        throw new AppError({
          code: 'NOT_READY',
          statusCode: 409,
          message: 'Server is not ready to provide user config',
          details: { serverId: server.id, reason: 'shortIds is empty' },
        });
      }

      const vlessLink = buildVlessRealityLink({
        userUuid: user.uuid,
        host: server.host,
        port: xrayInstance.listenPort,
        serverName: xrayInstance.serverName,
        fingerprint: xrayInstance.fingerprint,
        publicKey: xrayInstance.realityPublicKey,
        shortId,
      });

      return toUserConfigResponse({
        vlessLink,
        server: {
          host: server.host,
          port: xrayInstance.listenPort,
        },
        reality: {
          publicKey: xrayInstance.realityPublicKey,
          serverName: xrayInstance.serverName,
          fingerprint: xrayInstance.fingerprint,
          shortId,
          dest: xrayInstance.dest,
        },
        user: {
          uuid: user.uuid,
        },
      });
    },
  );

  app.post(
    '/:id/share',
    {
      schema: {
        tags: ['users', 'share'],
        summary: 'Create one-time share token for user',
        params: userParamsJsonSchema,
        body: createUserShareBodyJsonSchema,
        response: {
          201: createUserShareResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = getActorIdFromRequest(request);
      const { id } = parseOrThrow(userIdParamsSchema, request.params);
      const body = parseOrThrow(createUserShareBodySchema, request.body ?? {});
      const ttlMinutes = body.ttlMinutes ?? 30;

      const user = await userRepository.findById(id);
      if (!user) {
        throw new AppError({
          code: 'USER_NOT_FOUND',
          statusCode: 404,
          message: 'User not found',
          details: { id },
        });
      }

      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
      const { token, shareToken } = await shareTokenRepository.createOneTimeToken({ userId: id, expiresAt });
      await auditEventRepository.create({
        actor,
        action: 'SHARE_CREATE',
        entityType: 'SHARE_TOKEN',
        entityId: shareToken.id,
        meta: {
          userId: id,
          expiresAt: shareToken.expiresAt.toISOString(),
        },
      });

      const responseBody = toCreateUserShareResponse({ token, expiresAt });
      void reply.status(201).send(responseBody);
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: ['users'],
        summary: 'Update user',
        params: userParamsJsonSchema,
        body: patchUserBodyJsonSchema,
        response: {
          200: userResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const actor = getActorIdFromRequest(request);
      const { id } = parseOrThrow(userIdParamsSchema, request.params);
      const body = parseOrThrow(patchUserBodySchema, request.body);

      const user = await userRepository.findById(id);
      if (!user) {
        throw new AppError({
          code: 'USER_NOT_FOUND',
          statusCode: 404,
          message: 'User not found',
          details: { id },
        });
      }

      const userDto = parseOrThrow(updateUserDtoSchema, {
        enabled: body.enabled,
        name: body.name,
      });

      const updated = await userRepository.updateById(id, userDto);
      if (body.enabled === false && updated.enabled === false) {
        await app.xrayClientStore.removeUser(updated.serverId, updated.uuid);
      }

      const action =
        body.enabled === false && updated.enabled === false
          ? 'USER_DISABLE'
          : body.enabled === true && updated.enabled === true
            ? 'USER_ENABLE'
            : 'USER_UPDATE';

      await auditEventRepository.create({
        actor,
        action,
        entityType: 'USER',
        entityId: updated.id,
        meta: {
          serverId: updated.serverId,
          ...(body.name !== undefined ? { name: updated.name } : {}),
          ...(body.enabled !== undefined ? { enabled: updated.enabled } : {}),
        },
      });

      return toUserResponse(updated);
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['users'],
        summary: 'Delete user',
        params: userParamsJsonSchema,
        response: {
          204: { type: 'null' },
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = getActorIdFromRequest(request);
      const { id } = parseOrThrow(userIdParamsSchema, request.params);

      const user = await userRepository.findById(id);
      if (!user) {
        throw new AppError({
          code: 'USER_NOT_FOUND',
          statusCode: 404,
          message: 'User not found',
          details: { id },
        });
      }

      await userRepository.deleteById(id);
      await auditEventRepository.create({
        actor,
        action: 'USER_DELETE',
        entityType: 'USER',
        entityId: id,
        meta: {
          serverId: user.serverId,
        },
      });
      void reply.status(204).send();
    },
  );
}
