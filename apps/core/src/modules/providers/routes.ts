import {
  agentRunListResponseSchema,
  agentRunResponseSchema,
  apiErrorSchema,
  createAgentRunSchema,
  deepSeekCredentialDeleteInputSchema,
  deepSeekCredentialStatusResponseSchema,
  deepSeekCredentialWriteInputSchema,
  providerListResponseSchema,
  capabilityMatrixResponseSchema,
} from '@ev/contracts';
import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { ApiError } from '../../http/api-error';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import {
  CredentialNotConfiguredError,
  type ProviderCredentialService,
} from './credential-service';
import { SecretStoreUnavailableError } from './secret-store';
import type { ProviderService } from './service';
import type { CapabilityRegistry } from './capabilities';

interface ProviderRouteOptions {
  authService: AuthService;
  providerService: ProviderService;
  providerCredentialService: ProviderCredentialService;
  capabilityRegistry: CapabilityRegistry;
}

function rethrowCredentialError(error: unknown): never {
  if (error instanceof CredentialNotConfiguredError) {
    throw new ApiError(409, 'CREDENTIAL_NOT_CONFIGURED', '尚未配置 DeepSeek 凭据');
  }
  if (error instanceof SecretStoreUnavailableError) {
    throw new ApiError(503, 'SECRET_STORE_UNAVAILABLE', '本地密钥存储暂时不可用');
  }
  throw error;
}

export async function registerProviderRoutes(
  app: FastifyInstance,
  options: ProviderRouteOptions,
): Promise<void> {
  const authGuard = createAuthGuard(options.authService);
  const credentialRouteOptions: Pick<RouteShorthandOptions, 'errorHandler' | 'onRequest'> = {
    onRequest: authGuard,
    errorHandler(error, _request, reply) {
      if (error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
        return reply.status(400).send(
          apiErrorSchema.parse({
            error: {
              code: 'INVALID_REQUEST',
              message: '请求 JSON 格式不正确',
            },
          }),
        );
      }
      throw error;
    },
  };
  app.get('/v1/providers', { preHandler: authGuard }, async () => {
    return providerListResponseSchema.parse({ data: options.providerService.listProfiles() });
  });
  app.get('/v1/provider-capabilities', { preHandler: authGuard }, async () => {
    return capabilityMatrixResponseSchema.parse({ data: options.capabilityRegistry.list() });
  });
  app.get('/v1/providers/deepseek/credential', credentialRouteOptions, async (request) => {
    return deepSeekCredentialStatusResponseSchema.parse({
      data: options.providerCredentialService.getMetadata(authenticatedOwnerId(request)),
    });
  });
  app.put('/v1/providers/deepseek/credential', credentialRouteOptions, async (request) => {
    const ownerId = authenticatedOwnerId(request);
    const input = parseRequestInput(
      deepSeekCredentialWriteInputSchema,
      request.body,
      'DeepSeek 凭据请求不符合要求',
    );
    try {
      return deepSeekCredentialStatusResponseSchema.parse({
        data: await options.providerCredentialService.save(ownerId, input.apiKey),
      });
    } catch (error) {
      return rethrowCredentialError(error);
    }
  });
  app.delete('/v1/providers/deepseek/credential', credentialRouteOptions, async (request) => {
    const ownerId = authenticatedOwnerId(request);
    parseRequestInput(
      deepSeekCredentialDeleteInputSchema,
      request.body,
      'DeepSeek 凭据删除请求不符合要求',
    );
    options.providerCredentialService.remove(ownerId);
    return deepSeekCredentialStatusResponseSchema.parse({
      data: options.providerCredentialService.getMetadata(ownerId),
    });
  });
  app.post('/v1/providers/deepseek/connection-test', credentialRouteOptions, async (request) => {
    const ownerId = authenticatedOwnerId(request);
    try {
      await options.providerCredentialService.testConnection(ownerId);
      return deepSeekCredentialStatusResponseSchema.parse({
        data: options.providerCredentialService.getMetadata(ownerId),
      });
    } catch (error) {
      return rethrowCredentialError(error);
    }
  });
  app.get('/v1/agent-runs', { preHandler: authGuard }, async (request) => {
    return agentRunListResponseSchema.parse({
      data: options.providerService.listRuns(authenticatedOwnerId(request)),
    });
  });
  app.post('/v1/agent-runs', { preHandler: authGuard }, async (request, reply) => {
    const input = parseRequestInput(createAgentRunSchema, request.body, 'Agent Run 请求不符合要求');
    const run = await options.providerService.startRun(authenticatedOwnerId(request), input);
    return reply.status(201).send(agentRunResponseSchema.parse({ data: run }));
  });
}
