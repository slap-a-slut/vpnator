import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { prismaPlugin } from './db/prisma';
import { createAdminApiKeyGuard } from './lib/auth';
import { registerErrorHandling } from './lib/errors';
import { env } from './lib/env';
import { loggerOptions } from './lib/logger';
import { appVersion } from './lib/version';
import { createJobsRegistry, type JobsRegistry } from './modules/jobs';
import { registerModules } from './modules';
import { createXrayClientStore, type XrayClientStore } from './modules/xray';

declare module 'fastify' {
  interface FastifyInstance {
    xrayClientStore: XrayClientStore;
    jobsRegistry: JobsRegistry;
  }

  interface FastifyRequest {
    requestStartNs?: bigint;
    actorId?: string;
  }
}

export interface BuildAppOptions {
  prisma?: PrismaClient;
  swaggerEnabled?: boolean;
  xrayClientStore?: XrayClientStore;
  jobsRegistry?: JobsRegistry;
  runJobWorker?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const adminApiKeyGuard = createAdminApiKeyGuard(env.ADMIN_API_KEYS);
  const corsAllowedOrigins = new Set(env.CORS_ORIGINS);

  const app = fastify({
    logger: loggerOptions,
    disableRequestLogging: true,
    genReqId: (req) => {
      const headerValue = req.headers['x-request-id'];
      if (typeof headerValue === 'string' && headerValue.length > 0) return headerValue;
      return randomUUID();
    },
  });

  registerErrorHandling(app);

  await app.register(helmet);

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, corsAllowedOrigins.has(origin));
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => {
      return {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
        details: {
          max: context.max,
          retryAfterSeconds: context.after,
        },
      };
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    request.requestStartNs = process.hrtime.bigint();
    void reply.header('x-request-id', request.id);
    const actorId = adminApiKeyGuard(request);
    if (actorId !== undefined) {
      request.actorId = actorId;
    }
  });

  app.addHook('onResponse', (request, reply, done) => {
    const start = request.requestStartNs;
    const latencyMs = start ? Number(process.hrtime.bigint() - start) / 1e6 : undefined;

    request.log.info(
      {
        requestId: request.id,
        route: request.routeOptions?.url ?? request.url,
        method: request.method,
        statusCode: reply.statusCode,
        latencyMs,
      },
      'request completed',
    );

    done();
  });

  if (options.prisma) {
    app.decorate('prisma', options.prisma);
    app.addHook('onClose', async () => {
      await options.prisma?.$disconnect();
    });
  } else {
    await app.register(prismaPlugin);
  }

  const xrayClientStore =
    options.xrayClientStore ??
    createXrayClientStore({
      prisma: app.prisma,
      logger: app.log,
    });
  app.decorate('xrayClientStore', xrayClientStore);

  const jobsRegistry =
    options.jobsRegistry ??
    createJobsRegistry({
      prisma: app.prisma,
      logger: app.log,
      ...(options.runJobWorker !== undefined ? { runWorker: options.runJobWorker } : {}),
    });
  app.decorate('jobsRegistry', jobsRegistry);
  app.addHook('onClose', async () => {
    await jobsRegistry.close();
  });

  const swaggerEnabled = options.swaggerEnabled ?? env.SWAGGER_ENABLED;

  if (swaggerEnabled) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'xray-control-plane',
          description: 'XRAY control plane backend API',
          version: appVersion,
        },
      },
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
      },
    });
  }

  await registerModules(app);

  return app;
}
