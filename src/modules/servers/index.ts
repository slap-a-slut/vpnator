import { randomUUID } from 'node:crypto';

import { ServerStatus } from '@prisma/client';
import { z } from 'zod';

import type { FastifyInstance } from 'fastify';

import { getActorIdFromRequest, AuditEventRepository } from '../audit';
import { AppError, errorResponseSchema } from '../../lib/errors';
import { encryptSecret } from '../../lib/crypto';
import { parseOrThrow, uuidSchema } from '../../lib/validation';
import { enqueueJobResponseJsonSchema, toEnqueueJobResponse } from '../jobs/job.http';
import { createSecretDtoSchema } from '../provision/secret.dto';
import { sshTestResponseJsonSchema, sshTestResponseSchema } from '../provision/provision.http';
import { FileInstallLogStore } from '../provision/installLog.store';
import { SecretRepository } from '../provision/secret.repository';
import { InstallService } from '../provision/install.service';
import { ObservabilityService } from '../provision/observability.service';
import { ProvisionService } from '../provision/provision.service';
import { createUserDtoSchema } from '../users/user.dto';
import { UserRepository } from '../users/user.repository';
import {
  createServerBodyJsonSchema,
  createServerBodySchema,
  patchServerDisguiseBodyJsonSchema,
  patchServerDisguiseBodySchema,
  serverListResponseJsonSchema,
  serverDisguiseUpdateResponseJsonSchema,
  serverLogsQueryJsonSchema,
  serverLogsQuerySchema,
  serverLogsResponseJsonSchema,
  serverParamsJsonSchema,
  serverResponseJsonSchema,
  serverHealthResponseJsonSchema,
  serverStatusResponseJsonSchema,
  toServerHealthResponse,
  toServerLogsResponse,
  toServerDisguiseUpdateResponse,
  toServerResponse,
  toServerStatusResponse,
} from './server.http';
import { createServerDtoSchema } from './server.dto';
import { ServerRepository } from './server.repository';
import {
  createServerUserBodyJsonSchema,
  createServerUserBodySchema,
  toUserResponse,
  userResponseJsonSchema,
} from '../users/user.http';
import { XrayInstanceRepository } from '../xray/xrayInstance.repository';

export * from './server.dto';
export * from './server.http';
export * from './server.repository';

const serverIdParamsSchema = z.object({ id: uuidSchema }).strict();

export function serversModule(app: FastifyInstance) {
  const auditEventRepository = new AuditEventRepository(app.prisma);
  const secretRepository = new SecretRepository(app.prisma);
  const serverRepository = new ServerRepository(app.prisma);
  const userRepository = new UserRepository(app.prisma);
  const xrayInstanceRepository = new XrayInstanceRepository(app.prisma);
  const installLogStore = new FileInstallLogStore();
  const provisionService = new ProvisionService({
    serverRepository,
    secretRepository,
    logger: app.log,
  });
  const installService = new InstallService({
    serverRepository,
    userRepository,
    xrayInstanceRepository,
    commandExecutor: provisionService,
    installLogStore,
    logger: app.log,
  });
  const observabilityService = new ObservabilityService({
    serverRepository,
    xrayInstanceRepository,
    commandExecutor: provisionService,
    installLogStore,
    logger: app.log,
  });

  app.post(
    '/',
    {
      schema: {
        tags: ['servers'],
        summary: 'Create server',
        body: createServerBodyJsonSchema,
        response: {
          201: serverResponseJsonSchema,
          400: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = getActorIdFromRequest(request);
      const body = parseOrThrow(createServerBodySchema, request.body);

      const secretDto = parseOrThrow(createSecretDtoSchema, {
        type: body.sshAuth.type,
        ciphertext: encryptSecret(body.sshAuth.value),
      });

      const secret = await secretRepository.create(secretDto);

      const serverDto = parseOrThrow(createServerDtoSchema, {
        host: body.host,
        sshUser: body.sshUser,
        sshSecretId: secret.id,
        status: ServerStatus.NEW,
      });

      const server = await serverRepository.create(serverDto);
      await auditEventRepository.create({
        actor,
        action: 'SERVER_CREATE',
        entityType: 'SERVER',
        entityId: server.id,
        meta: {
          host: server.host,
          sshUser: server.sshUser,
          status: server.status,
        },
      });

      const responseBody = toServerResponse(server);
      void reply.status(201).send(responseBody);
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['servers'],
        summary: 'Get server by id',
        params: serverParamsJsonSchema,
        response: {
          200: serverResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id } = parseOrThrow(serverIdParamsSchema, request.params);

      const server = await serverRepository.findById(id);
      if (!server) {
        throw new AppError({
          code: 'SERVER_NOT_FOUND',
          statusCode: 404,
          message: 'Server not found',
          details: { id },
        });
      }

      return toServerResponse(server);
    },
  );

  app.get(
    '/',
    {
      schema: {
        tags: ['servers'],
        summary: 'List servers',
        response: {
          200: serverListResponseJsonSchema,
          500: errorResponseSchema,
        },
      },
    },
    async () => {
      const servers = await serverRepository.findMany();
      return servers.map(toServerResponse);
    },
  );

  app.patch(
    '/:id/xray-disguise',
    {
      schema: {
        tags: ['servers', 'xray'],
        summary: 'Update XRAY REALITY disguise parameters',
        params: serverParamsJsonSchema,
        body: patchServerDisguiseBodyJsonSchema,
        response: {
          202: serverDisguiseUpdateResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = getActorIdFromRequest(request);
      const { id: serverId } = parseOrThrow(serverIdParamsSchema, request.params);
      const body = parseOrThrow(patchServerDisguiseBodySchema, request.body);

      const server = await serverRepository.findById(serverId);
      if (!server) {
        throw new AppError({
          code: 'SERVER_NOT_FOUND',
          statusCode: 404,
          message: 'Server not found',
          details: { id: serverId },
        });
      }

      const xrayInstance = await xrayInstanceRepository.findLatestByServerId(serverId);
      if (!xrayInstance) {
        throw new AppError({
          code: 'NOT_READY',
          statusCode: 409,
          message: 'Server has no xray instance yet',
          details: { serverId },
        });
      }

      const normalizedServerName = body.serverName.trim().toLowerCase();
      const resolvedDest = normalizeDisguiseDest(body.dest, normalizedServerName);
      const shortIds = body.shortIds ?? xrayInstance.shortIds;

      const updatedXrayInstance = await xrayInstanceRepository.updateById(xrayInstance.id, {
        serverName: normalizedServerName,
        dest: resolvedDest,
        fingerprint: body.fingerprint,
        shortIds,
      });

      const job = await app.jobsRegistry.enqueueRepair(serverId);

      await auditEventRepository.create({
        actor,
        action: 'XRAY_DISGUISE_UPDATE',
        entityType: 'SERVER',
        entityId: serverId,
        meta: {
          jobId: job.jobId,
          serverName: normalizedServerName,
          dest: resolvedDest,
          fingerprint: body.fingerprint,
          shortIds,
        },
      });

      const responseBody = toServerDisguiseUpdateResponse({
        jobId: job.jobId,
        xrayInstance: updatedXrayInstance,
      });
      void reply.status(202).send(responseBody);
    },
  );

  app.post(
    '/:id/users',
    {
      schema: {
        tags: ['servers', 'users'],
        summary: 'Create user on server',
        params: serverParamsJsonSchema,
        body: createServerUserBodyJsonSchema,
        response: {
          201: userResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = getActorIdFromRequest(request);
      const { id: serverId } = parseOrThrow(serverIdParamsSchema, request.params);
      const body = parseOrThrow(createServerUserBodySchema, request.body);

      const server = await serverRepository.findById(serverId);
      if (!server) {
        throw new AppError({
          code: 'SERVER_NOT_FOUND',
          statusCode: 404,
          message: 'Server not found',
          details: { id: serverId },
        });
      }

      const userDto = parseOrThrow(createUserDtoSchema, {
        serverId,
        name: body.name,
        uuid: randomUUID(),
        enabled: true,
      });

      const user = await userRepository.create(userDto);
      await app.xrayClientStore.addUser(serverId, user.uuid);
      await auditEventRepository.create({
        actor,
        action: 'USER_CREATE',
        entityType: 'USER',
        entityId: user.id,
        meta: {
          serverId: user.serverId,
          enabled: user.enabled,
        },
      });

      const responseBody = toUserResponse(user);
      void reply.status(201).send(responseBody);
    },
  );

  app.post(
    '/:id/ssh-test',
    {
      schema: {
        tags: ['servers', 'provision'],
        summary: 'Test SSH connection',
        params: serverParamsJsonSchema,
        response: {
          200: sshTestResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
          502: errorResponseSchema,
          504: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const actor = getActorIdFromRequest(request);
      const { id: serverId } = parseOrThrow(serverIdParamsSchema, request.params);
      const result = await provisionService.testConnection(serverId);
      await auditEventRepository.create({
        actor,
        action: 'SSH_TEST_RUN',
        entityType: 'SERVER',
        entityId: serverId,
        meta: {
          ok: true,
        },
      });
      return sshTestResponseSchema.parse(result);
    },
  );

  app.post(
    '/:id/install',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
      schema: {
        tags: ['servers', 'provision', 'xray'],
        summary: 'Install XRAY stack on server',
        params: serverParamsJsonSchema,
        response: {
          202: enqueueJobResponseJsonSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
          502: errorResponseSchema,
          504: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = getActorIdFromRequest(request);
      const { id: serverId } = parseOrThrow(serverIdParamsSchema, request.params);
      const server = await serverRepository.findById(serverId);
      if (!server) {
        throw new AppError({
          code: 'SERVER_NOT_FOUND',
          statusCode: 404,
          message: 'Server not found',
          details: { id: serverId },
        });
      }

      const job = await app.jobsRegistry.enqueueInstall(serverId);
      await auditEventRepository.create({
        actor,
        action: 'SERVER_INSTALL',
        entityType: 'SERVER',
        entityId: serverId,
        meta: {
          jobId: job.jobId,
        },
      });
      const responseBody = toEnqueueJobResponse(job);
      void reply.status(202).send(responseBody);
    },
  );

  app.get(
    '/:id/status',
    {
      schema: {
        tags: ['servers', 'xray'],
        summary: 'Get server install status',
        params: serverParamsJsonSchema,
        response: {
          200: serverStatusResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: serverId } = parseOrThrow(serverIdParamsSchema, request.params);
      const result = await installService.getServerStatus(serverId);
      return toServerStatusResponse(result);
    },
  );

  app.get(
    '/:id/logs',
    {
      schema: {
        tags: ['servers', 'observability'],
        summary: 'Read server logs',
        params: serverParamsJsonSchema,
        querystring: serverLogsQueryJsonSchema,
        response: {
          200: serverLogsResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
          502: errorResponseSchema,
          504: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: serverId } = parseOrThrow(serverIdParamsSchema, request.params);
      const query = parseOrThrow(serverLogsQuerySchema, request.query);
      const result = await observabilityService.getServerLogs({
        serverId,
        type: query.type,
        tail: query.tail,
      });
      return toServerLogsResponse(result);
    },
  );

  app.get(
    '/:id/health',
    {
      schema: {
        tags: ['servers', 'observability'],
        summary: 'Get server runtime health checks',
        params: serverParamsJsonSchema,
        response: {
          200: serverHealthResponseJsonSchema,
          400: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
        },
      },
    },
    async (request) => {
      const { id: serverId } = parseOrThrow(serverIdParamsSchema, request.params);
      const result = await observabilityService.getServerHealth(serverId);
      return toServerHealthResponse(result);
    },
  );

  app.post(
    '/:id/repair',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
      schema: {
        tags: ['servers', 'provision', 'xray'],
        summary: 'Diagnose and repair XRAY runtime',
        params: serverParamsJsonSchema,
        response: {
          202: enqueueJobResponseJsonSchema,
          400: errorResponseSchema,
          409: errorResponseSchema,
          404: errorResponseSchema,
          500: errorResponseSchema,
          502: errorResponseSchema,
          504: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = getActorIdFromRequest(request);
      const { id: serverId } = parseOrThrow(serverIdParamsSchema, request.params);
      const server = await serverRepository.findById(serverId);
      if (!server) {
        throw new AppError({
          code: 'SERVER_NOT_FOUND',
          statusCode: 404,
          message: 'Server not found',
          details: { id: serverId },
        });
      }

      const job = await app.jobsRegistry.enqueueRepair(serverId);
      await auditEventRepository.create({
        actor,
        action: 'REPAIR_RUN',
        entityType: 'SERVER',
        entityId: serverId,
        meta: {
          jobId: job.jobId,
        },
      });
      const responseBody = toEnqueueJobResponse(job);
      void reply.status(202).send(responseBody);
    },
  );
}

function normalizeDisguiseDest(dest: string | undefined, serverName: string): string {
  const resolved = (dest ?? `${serverName}:443`).trim().toLowerCase();
  const separator = resolved.lastIndexOf(':');
  if (separator <= 0 || separator === resolved.length - 1) {
    throw new AppError({
      code: 'INVALID_DISGUISE',
      statusCode: 400,
      message: 'dest must be in format host:port',
      details: { dest: resolved },
    });
  }

  const host = resolved.slice(0, separator);
  const port = Number.parseInt(resolved.slice(separator + 1), 10);
  if (!Number.isInteger(port) || port !== 443) {
    throw new AppError({
      code: 'INVALID_DISGUISE',
      statusCode: 400,
      message: 'dest port must be 443',
      details: { dest: resolved, port: Number.isInteger(port) ? port : null },
    });
  }

  if (host !== serverName) {
    throw new AppError({
      code: 'INVALID_DISGUISE',
      statusCode: 400,
      message: 'dest host must match serverName',
      details: { serverName, destHost: host },
    });
  }

  return `${host}:${port}`;
}
