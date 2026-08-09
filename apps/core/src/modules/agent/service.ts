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

function messageTimestamps(now: Date, previousUpdatedAt: string): {
  userCreatedAt: string;
  assistantCreatedAt: string;
} {
  const userMilliseconds = Math.max(now.getTime(), new Date(previousUpdatedAt).getTime() + 1);
  const userCreatedAt = new Date(userMilliseconds);
  const assistantCreatedAt = new Date(userMilliseconds + 1);
  return {
    userCreatedAt: userCreatedAt.toISOString(),
    assistantCreatedAt: assistantCreatedAt.toISOString(),
  };
}

export function createAgentService(
  repository: AgentRepository,
  options: AgentServiceOptions = {},
): AgentService {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const sendLocks = new Map<string, Promise<void>>();

  async function serializeSend<T>(
    ownerId: string,
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = `${ownerId}:${sessionId}`;
    const previous = sendLocks.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    sendLocks.set(key, current);
    await previous;

    try {
      return await operation();
    } finally {
      release?.();
      if (sendLocks.get(key) === current) sendLocks.delete(key);
    }
  }

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
      return serializeSend(ownerId, sessionId, async () => {
        const session = repository.findSession(ownerId, sessionId);
        if (!session) throw sessionNotFound();

        const timestamps = messageTimestamps(now(), session.updatedAt);
        const candidateUserMessage: AgentMessage & { role: 'USER' } = {
          id: createId(),
          sessionId,
          role: 'USER',
          content: input.content,
          createdAt: timestamps.userCreatedAt,
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
              createdAt: timestamps.assistantCreatedAt,
            },
          },
          timestamps.assistantCreatedAt,
        );
        if (!persisted) throw sessionNotFound();
        return persisted;
      });
    },
  };
}
