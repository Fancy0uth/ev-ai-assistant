import { randomUUID } from 'node:crypto';
import type { AgentMessage, AgentSession } from '@ev/contracts';
import { ApiError } from '../../http/api-error';
import type { AgentProvider } from './provider';
import type { AgentListQuery, AgentMessagePair, AgentRepository } from './repository';

export interface AgentListResult<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface AgentSendMessageResult extends AgentMessagePair {}

interface CreateAgentSessionInput {
  title: string;
}

interface SendAgentMessageInput {
  content: string;
}

interface AgentServiceOptions {
  provider?: AgentProvider;
  now?: () => Date;
  createId?: () => string;
}

export interface AgentService {
  createSession(ownerId: string, input: CreateAgentSessionInput): AgentSession;
  listSessions(ownerId: string, query: AgentListQuery): AgentListResult<AgentSession>;
  listMessages(
    ownerId: string,
    sessionId: string,
    query: AgentListQuery,
  ): AgentListResult<AgentMessage>;
  sendMessage(
    ownerId: string,
    sessionId: string,
    input: SendAgentMessageInput,
  ): Promise<AgentSendMessageResult>;
}

function sessionNotFound(): ApiError {
  return new ApiError(404, 'AGENT_SESSION_NOT_FOUND', 'Agent 会话不存在');
}

function providerUnavailable(): ApiError {
  return new ApiError(503, 'AGENT_PROVIDER_UNAVAILABLE', 'Agent 服务暂不可用');
}

function validProviderContent(content: unknown): content is string {
  return (
    typeof content === 'string' &&
    content.length >= 1 &&
    content.length <= 8000 &&
    content.trim().length > 0
  );
}

function toListResult<T>(page: { items: T[]; total: number }, query: AgentListQuery): AgentListResult<T> {
  return {
    items: page.items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      totalPages: Math.ceil(page.total / query.pageSize),
    },
  };
}

export function createAgentService(
  repository: AgentRepository,
  options: AgentServiceOptions = {},
): AgentService {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;

  return {
    createSession(ownerId, input) {
      const timestamp = now().toISOString();
      return repository.createSession({
        id: createId(),
        ownerId,
        title: input.title,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    },

    listSessions(ownerId, query) {
      return toListResult(repository.listSessions(ownerId, query), query);
    },

    listMessages(ownerId, sessionId, query) {
      if (!repository.findSession(ownerId, sessionId)) throw sessionNotFound();
      return toListResult(repository.listMessages(ownerId, sessionId, query), query);
    },

    async sendMessage(ownerId, sessionId, input) {
      const session = repository.findSession(ownerId, sessionId);
      if (!session) throw sessionNotFound();

      const timestamp = now().toISOString();
      const candidateUserMessage: AgentMessage & { role: 'USER' } = {
        id: createId(),
        sessionId,
        role: 'USER',
        content: input.content,
        createdAt: timestamp,
      };
      if (!options.provider) {
        throw new ApiError(
          503,
          'AGENT_PROVIDER_NOT_CONFIGURED',
          'Agent Provider 尚未配置',
        );
      }
      const history = repository.listMessageHistory(ownerId, sessionId);

      let assistantContent: string;
      try {
        assistantContent = await options.provider.generate({
          session,
          history,
          candidateUserMessage,
        });
      } catch {
        throw providerUnavailable();
      }
      if (!validProviderContent(assistantContent)) throw providerUnavailable();

      const persisted = repository.appendMessagePair(
        ownerId,
        sessionId,
        {
          userMessage: candidateUserMessage,
          assistantMessage: {
            id: createId(),
            sessionId,
            role: 'ASSISTANT',
            content: assistantContent,
            createdAt: timestamp,
          },
        },
        timestamp,
      );
      if (!persisted) throw sessionNotFound();
      return persisted;
    },
  };
}
