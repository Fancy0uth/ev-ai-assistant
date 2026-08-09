import {
  agentCapabilityResponseSchema,
  agentMessageListQuerySchema,
  agentMessageListResponseSchema,
  agentSendMessageResponseSchema,
  agentSessionListQuerySchema,
  agentSessionListResponseSchema,
  agentSessionPathParamsSchema,
  agentSessionResponseSchema,
  createAgentSessionSchema,
  sendAgentMessageSchema,
} from '@ev/contracts';
import type { FastifyInstance } from 'fastify';
import { parseRequestInput } from '../../http/validation';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { AgentProvider } from './provider';
import type { AgentService } from './service';

interface AgentRouteOptions {
  authService: AuthService;
  agentService: AgentService;
  agentProvider?: AgentProvider;
}

export async function registerAgentRoutes(
  app: FastifyInstance,
  options: AgentRouteOptions,
): Promise<void> {
  const { authService, agentService, agentProvider } = options;
  const authGuard = createAuthGuard(authService);

  app.get('/v1/agent/capabilities', { preHandler: authGuard }, async (request) => {
    authenticatedOwnerId(request);
    return agentCapabilityResponseSchema.parse({
      data: {
        items: [
          {
            key: 'CONVERSATION',
            label: '对话',
            availability: agentProvider ? 'READY' : 'NOT_CONFIGURED',
            description: '连接 Agent Provider 后可以进行对话。',
          },
        ],
      },
    });
  });

  app.get('/v1/agent/sessions', { preHandler: authGuard }, async (request) => {
    const ownerId = authenticatedOwnerId(request);
    const query = parseRequestInput(
      agentSessionListQuerySchema,
      request.query,
      'Agent 会话查询参数不符合要求',
    );
    return agentSessionListResponseSchema.parse({
      data: agentService.listSessions(ownerId, query),
    });
  });

  app.post('/v1/agent/sessions', { preHandler: authGuard }, async (request, reply) => {
    const ownerId = authenticatedOwnerId(request);
    const input = parseRequestInput(
      createAgentSessionSchema,
      request.body,
      'Agent 会话信息不符合要求',
    );
    const session = agentService.createSession(ownerId, input);
    return reply.status(201).send(agentSessionResponseSchema.parse({ data: session }));
  });

  app.get('/v1/agent/sessions/:id/messages', { preHandler: authGuard }, async (request) => {
    const ownerId = authenticatedOwnerId(request);
    const { id } = parseRequestInput(
      agentSessionPathParamsSchema,
      request.params,
      'Agent 会话路径参数不符合要求',
    );
    const query = parseRequestInput(
      agentMessageListQuerySchema,
      request.query,
      'Agent 消息查询参数不符合要求',
    );
    return agentMessageListResponseSchema.parse({
      data: agentService.listMessages(ownerId, id, query),
    });
  });

  app.post('/v1/agent/sessions/:id/messages', { preHandler: authGuard }, async (request, reply) => {
    const ownerId = authenticatedOwnerId(request);
    const { id } = parseRequestInput(
      agentSessionPathParamsSchema,
      request.params,
      'Agent 会话路径参数不符合要求',
    );
    const input = parseRequestInput(
      sendAgentMessageSchema,
      request.body,
      'Agent 消息信息不符合要求',
    );
    const messages = await agentService.sendMessage(ownerId, id, input);
    return reply.status(201).send(agentSendMessageResponseSchema.parse({ data: messages }));
  });
}
