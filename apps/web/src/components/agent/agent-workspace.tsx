'use client';

import {
  agentCapabilityResponseSchema,
  agentMessageListResponseSchema,
  agentSendMessageResponseSchema,
  agentSessionListResponseSchema,
  agentSessionResponseSchema,
  type AgentCapability,
  type AgentMessage,
  type AgentSession,
} from '@ev/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';
import { AgentContextPanel } from './agent-context-panel';

type SessionPage = ReturnType<typeof agentSessionListResponseSchema.parse>['data'];
type MessagePage = ReturnType<typeof agentMessageListResponseSchema.parse>['data'];

interface LoadedMessages {
  sessionId: string;
  page: MessagePage;
}

function sessionPageWithPendingCreatedSession(
  page: SessionPage | null,
  pendingCreatedSession: AgentSession | null,
): SessionPage | null {
  if (
    !pendingCreatedSession ||
    (page && page.pagination.page !== 1) ||
    page?.items.some((session) => session.id === pendingCreatedSession.id)
  ) {
    return page;
  }

  const pageSize = page?.pagination.pageSize ?? 20;
  const total = (page?.pagination.total ?? 0) + 1;
  return {
    items: [pendingCreatedSession, ...(page?.items ?? [])]
      .filter((session, index, items) => items.findIndex((item) => item.id === session.id) === index)
      .slice(0, pageSize),
    pagination: {
      page: 1,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

class UntrustedMessagePageError extends Error {
  constructor() {
    super('本地 Core 返回的消息不属于当前会话，请重新加载后重试。');
    this.name = 'UntrustedMessagePageError';
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof CoreClientError) return error.message;
  if (error instanceof UntrustedMessagePageError) return error.message;
  return '本地 Core 返回了无法识别的响应，请稍后重试。';
}

function isCanonicalAuthenticationError(error: unknown): boolean {
  return (
    error instanceof CoreClientError &&
    error.status === 401 &&
    error.code === 'AUTHENTICATION_REQUIRED'
  );
}

function isMissingSessionError(error: unknown): boolean {
  return (
    error instanceof CoreClientError &&
    error.status === 404 &&
    error.code === 'AGENT_SESSION_NOT_FOUND'
  );
}

function isProviderNotConfiguredError(error: unknown): boolean {
  return (
    error instanceof CoreClientError &&
    error.status === 503 &&
    error.code === 'AGENT_PROVIDER_NOT_CONFIGURED'
  );
}

function conversationCapability(payload: unknown): AgentCapability | null {
  return agentCapabilityResponseSchema.parse(payload).data.items.find((item) => item.key === 'CONVERSATION') ?? null;
}

function isConversationReady(capability: AgentCapability | null): boolean {
  return capability?.availability === 'READY';
}

function sessionPageQuery(page: number): string {
  return `agent/sessions?page=${page}&pageSize=20`;
}

function messagePageQuery(sessionId: string): string {
  return `agent/sessions/${sessionId}/messages?page=1&pageSize=100`;
}

function messagePageForSession(payload: unknown, sessionId: string): MessagePage {
  const page = agentMessageListResponseSchema.parse(payload).data;
  if (page.items.some((message) => message.sessionId !== sessionId)) {
    throw new UntrustedMessagePageError();
  }
  return page;
}

export function AgentWorkspace() {
  const { replace } = useRouter();
  const [capability, setCapability] = useState<AgentCapability | null>(null);
  const [capabilityLoading, setCapabilityLoading] = useState(true);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [capabilityReloadKey, setCapabilityReloadKey] = useState(0);
  const [sessionPageNumber, setSessionPageNumber] = useState(1);
  const [sessionReloadKey, setSessionReloadKey] = useState(0);
  const [sessions, setSessions] = useState<SessionPage | null>(null);
  const [pendingCreatedSession, setPendingCreatedSession] = useState<AgentSession | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<AgentSession | null>(null);
  const [messages, setMessages] = useState<LoadedMessages | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [missingSessionId, setMissingSessionId] = useState<string | null>(null);
  const [messageReloadKey, setMessageReloadKey] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const capabilityRequestId = useRef(0);
  const sessionRequestId = useRef(0);
  const messageRequestId = useRef(0);
  const selectedSessionId = useRef<string | null>(null);
  const sessionsRef = useRef<SessionPage | null>(null);
  const messagesRef = useRef<LoadedMessages | null>(null);
  const sessionRequestController = useRef<AbortController | null>(null);
  const messageRequestController = useRef<AbortController | null>(null);
  const createInFlight = useRef(false);
  const sendInFlight = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusIntent = useRef<{ kind: 'input' | 'session'; sessionId: string } | null>(null);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++capabilityRequestId.current;

    void requestCore('agent/capabilities', { method: 'GET', signal: controller.signal })
      .then(conversationCapability)
      .then((nextCapability) => {
        if (controller.signal.aborted || requestId !== capabilityRequestId.current) return;
        setCapability(nextCapability);
        if (!nextCapability) setCapabilityError('本地 Core 未返回可用的对话能力。');
        setCapabilityLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestId !== capabilityRequestId.current) return;
        if (isCanonicalAuthenticationError(error)) {
          replace('/login');
          return;
        }
        setCapabilityError(errorMessage(error));
        setCapabilityLoading(false);
      });

    return () => controller.abort();
  }, [capabilityReloadKey, replace]);

  useEffect(() => {
    const controller = new AbortController();
    sessionRequestController.current?.abort();
    sessionRequestController.current = controller;
    const requestId = ++sessionRequestId.current;
    const requestedPage = sessionPageNumber;
    const keepsCurrentPage = sessionsRef.current?.pagination.page === requestedPage;
    setSessionsLoading(!keepsCurrentPage);
    setSessionsError(null);

    void requestCore(sessionPageQuery(requestedPage), { method: 'GET', signal: controller.signal })
      .then((payload) => agentSessionListResponseSchema.parse(payload).data)
      .then((page) => {
        if (controller.signal.aborted || requestId !== sessionRequestId.current) return;
        setSessions(page);
        if (requestedPage === 1 && page.pagination.page === 1) {
          setPendingCreatedSession((current) =>
            current && page.items.some((session) => session.id === current.id) ? null : current,
          );
        }
        setSessionsLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestId !== sessionRequestId.current) return;
        if (isCanonicalAuthenticationError(error)) {
          replace('/login');
          return;
        }
        setSessionsError(errorMessage(error));
        setSessionsLoading(false);
      });

    return () => {
      controller.abort();
      if (sessionRequestController.current === controller) {
        sessionRequestController.current = null;
      }
    };
  }, [replace, sessionPageNumber, sessionReloadKey]);

  useEffect(() => {
    if (!selectedSession) {
      messageRequestController.current?.abort();
      messageRequestController.current = null;
      return;
    }

    const controller = new AbortController();
    messageRequestController.current?.abort();
    messageRequestController.current = controller;
    const requestId = ++messageRequestId.current;
    const sessionId = selectedSession.id;
    const keepsCurrentMessages = messagesRef.current?.sessionId === sessionId;
    setMessagesLoading(!keepsCurrentMessages);
    setMessagesError(null);
    setMissingSessionId(null);

    void requestCore(messagePageQuery(sessionId), { method: 'GET', signal: controller.signal })
      .then((payload) => messagePageForSession(payload, sessionId))
      .then((page) => {
        if (
          controller.signal.aborted ||
          requestId !== messageRequestId.current ||
          selectedSessionId.current !== sessionId
        ) {
          return;
        }
        setMessages({ sessionId, page });
        setMessagesLoading(false);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          requestId !== messageRequestId.current ||
          selectedSessionId.current !== sessionId
        ) {
          return;
        }
        if (isCanonicalAuthenticationError(error)) {
          replace('/login');
          return;
        }
        if (isMissingSessionError(error)) {
          setMissingSessionId(sessionId);
          setMessagesError('该会话不存在，请选择其他会话。');
        } else {
          setMessagesError(errorMessage(error));
        }
        setMessagesLoading(false);
      });

    return () => controller.abort();
  }, [messageReloadKey, replace, selectedSession]);

  useEffect(() => {
    const intent = focusIntent.current;
    if (!intent || intent.sessionId !== selectedSession?.id) return;

    if (intent.kind === 'input') {
      if (
        isSending ||
        !isConversationReady(capability) ||
        inputRef.current?.disabled
      ) {
        return;
      }
      inputRef.current?.focus();
      focusIntent.current = null;
      return;
    }

    const sessionButton = sessionButtonRefs.current.get(intent.sessionId);
    if (sessionButton) {
      sessionButton.focus();
      focusIntent.current = null;
    }
  }, [capability, isSending, messages, selectedSession, sessions]);

  const selectSession = useCallback((session: AgentSession) => {
    if (selectedSessionId.current === session.id) {
      setMessageReloadKey((current) => current + 1);
      return;
    }
    selectedSessionId.current = session.id;
    setSelectedSession(session);
    setMessagesError(null);
    setMissingSessionId(null);
    setSendError(null);
  }, []);

  const retryMessages = useCallback(() => {
    setMessageReloadKey((current) => current + 1);
  }, []);

  const retryCapabilities = useCallback(() => {
    setCapabilityLoading(true);
    setCapabilityError(null);
    setCapabilityReloadKey((current) => current + 1);
  }, []);

  const retrySessions = useCallback(() => {
    setSessionReloadKey((current) => current + 1);
  }, []);

  const requestSessionPage = useCallback((page: number) => {
    if (page === sessionPageNumber) {
      setSessionReloadKey((current) => current + 1);
      return;
    }
    setSessionPageNumber(page);
  }, [sessionPageNumber]);

  const createSession = useCallback(async () => {
    if (createInFlight.current) return;
    createInFlight.current = true;
    setIsCreating(true);
    setCreateError(null);

    try {
      const payload = await requestCore('agent/sessions', { method: 'POST', body: JSON.stringify({}) });
      const createdSession = agentSessionResponseSchema.parse(payload).data;
      sessionRequestId.current += 1;
      sessionRequestController.current?.abort();
      sessionRequestController.current = null;
      focusIntent.current = {
        kind: isConversationReady(capability) ? 'input' : 'session',
        sessionId: createdSession.id,
      };
      setPendingCreatedSession(createdSession);
      requestSessionPage(1);
      selectSession(createdSession);
    } catch (error) {
      if (isCanonicalAuthenticationError(error)) {
        replace('/login');
      } else {
        setCreateError(errorMessage(error));
      }
    } finally {
      createInFlight.current = false;
      setIsCreating(false);
    }
  }, [capability, replace, requestSessionPage, selectSession]);

  const sendMessage = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const session = selectedSession;
      const content = draft.trim();
      if (
        sendInFlight.current ||
        !session ||
        missingSessionId === session.id ||
        !isConversationReady(capability) ||
        messages?.sessionId !== session.id ||
        content.length === 0 ||
        content.length > 8000
      ) {
        return;
      }

      sendInFlight.current = true;
      setIsSending(true);
      setSendError(null);
      try {
        const payload = await requestCore(`agent/sessions/${session.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ content }),
        });
        const pair = agentSendMessageResponseSchema.parse(payload).data;
        const pairMatchesSession =
          pair.userMessage.sessionId === session.id && pair.assistantMessage.sessionId === session.id;
        if (!pairMatchesSession) {
          setSendError('本地 Core 返回的消息不属于当前会话，请重新加载后重试。');
          return;
        }
        if (selectedSessionId.current !== session.id) return;

        messageRequestId.current += 1;
        messageRequestController.current?.abort();
        focusIntent.current = { kind: 'input', sessionId: session.id };
        setMessagesLoading(false);
        setMessages((current) => {
          const trustedMessages = current?.sessionId === session.id ? current.page.items : [];
          const nextItems: AgentMessage[] = [...trustedMessages, pair.userMessage, pair.assistantMessage];
          return {
            sessionId: session.id,
            page: {
              items: nextItems,
              pagination: {
                page: 1,
                pageSize: 100,
                total: nextItems.length,
                totalPages: nextItems.length ? 1 : 0,
              },
            },
          };
        });
        setDraft('');
      } catch (error) {
        if (isCanonicalAuthenticationError(error)) {
          replace('/login');
        } else if (isProviderNotConfiguredError(error)) {
          setCapability((current) =>
            current
              ? { ...current, availability: 'NOT_CONFIGURED' }
              : {
                  key: 'CONVERSATION',
                  label: '对话',
                  availability: 'NOT_CONFIGURED',
                  description: '连接 Agent Provider 后可以进行对话。',
                },
          );
        } else if (isMissingSessionError(error)) {
          setMissingSessionId(session.id);
          setSendError('该会话不存在，请选择其他会话。');
        } else {
          setSendError(errorMessage(error));
        }
      } finally {
        sendInFlight.current = false;
        setIsSending(false);
      }
    },
    [capability, draft, messages, missingSessionId, replace, selectedSession],
  );

  const displayedSessionPage = sessionPageWithPendingCreatedSession(sessions, pendingCreatedSession);
  const displayedSessionItems = displayedSessionPage?.items ?? [];
  const currentMessages =
    messages && messages.sessionId === selectedSession?.id ? messages.page.items : null;
  const canWrite =
    isConversationReady(capability) &&
    selectedSession !== null &&
    missingSessionId !== selectedSession.id &&
    messages?.sessionId === selectedSession.id;
  const canSubmit = canWrite && draft.trim().length > 0 && draft.trim().length <= 8000 && !isSending;

  return (
    <section className="agent-workspace" aria-labelledby="agent-workspace-title">
      <header className="agent-workspace__header">
        <div>
          <p className="section-kicker">AGENT / LOCAL CONVERSATION</p>
          <h1 id="agent-workspace-title">Agent 工作台</h1>
          <p>本地会话由 Core 保存。只有已就绪的对话能力可以发送消息。</p>
        </div>
      </header>

      <section className="agent-sessions-panel" aria-labelledby="agent-sessions-title">
        <div className="agent-sessions-panel__heading">
          <div>
            <p className="section-kicker">SESSIONS</p>
            <h2 id="agent-sessions-title">会话</h2>
          </div>
          <button type="button" disabled={isCreating} onClick={() => void createSession()}>
            {isCreating ? '正在创建…' : '新建会话'}
          </button>
        </div>

        {createError ? <p className="agent-inline-error" role="alert">{createError}</p> : null}
        {sessionsError ? (
          <div className="agent-inline-error" role="alert">
            <p>{sessionsError}</p>
            <button type="button" onClick={retrySessions}>重新加载会话</button>
          </div>
        ) : null}

        {sessionsLoading && !displayedSessionPage ? (
          <p className="agent-loading" role="status">正在加载会话…</p>
        ) : displayedSessionItems.length ? (
          <ul className="agent-session-list" aria-label="会话列表">
            {displayedSessionItems.map((session) => (
              <li key={session.id}>
                <button
                  ref={(element) => {
                    if (element) sessionButtonRefs.current.set(session.id, element);
                    else sessionButtonRefs.current.delete(session.id);
                  }}
                  type="button"
                  aria-label={session.title}
                  aria-pressed={selectedSession?.id === session.id}
                  onClick={() => selectSession(session)}
                >
                  <span>{session.title}</span>
                  <small>{session.updatedAt.slice(0, 10)}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="agent-empty" role="status">还没有会话</p>
        )}

        <nav className="agent-pagination" aria-label="会话分页">
          <button
            type="button"
            disabled={!displayedSessionPage || displayedSessionPage.pagination.page <= 1 || sessionsLoading}
            onClick={() =>
              requestSessionPage(Math.max(1, (displayedSessionPage?.pagination.page ?? 1) - 1))
            }
          >
            上一页会话
          </button>
          <span aria-live="polite">
            第 {displayedSessionPage?.pagination.page ?? sessionPageNumber} / {displayedSessionPage?.pagination.totalPages || 1} 页
          </span>
          <button
            type="button"
            disabled={
              !displayedSessionPage ||
              displayedSessionPage.pagination.totalPages === 0 ||
              displayedSessionPage.pagination.page >= displayedSessionPage.pagination.totalPages ||
              sessionsLoading
            }
            onClick={() => requestSessionPage((displayedSessionPage?.pagination.page ?? 0) + 1)}
          >
            下一页会话
          </button>
        </nav>
      </section>

      <section className="agent-conversation-panel" aria-labelledby="agent-conversation-title">
        <div className="agent-conversation-panel__heading">
          <div>
            <p className="section-kicker">CONVERSATION</p>
            <h2 id="agent-conversation-title">{selectedSession ? selectedSession.title : '选择一个会话'}</h2>
          </div>
          {selectedSession ? <p role="status">当前会话：{selectedSession.title}</p> : null}
        </div>

        {capabilityLoading ? <p className="agent-loading" role="status">正在读取 Agent 能力…</p> : null}
        {capabilityError ? (
          <div className="agent-inline-error" role="alert">
            <p>{capabilityError}</p>
            <button type="button" onClick={retryCapabilities}>重新读取能力</button>
          </div>
        ) : null}

        <div className="agent-message-list" aria-busy={messagesLoading} aria-live="polite">
          {!selectedSession ? (
            <p className="agent-empty" role="status">选择一个会话后可读取消息。</p>
          ) : messagesLoading && !currentMessages ? (
            <p className="agent-loading" role="status">正在加载消息…</p>
          ) : messagesError && missingSessionId === selectedSession.id ? (
            <div className="agent-inline-error" role="alert">
              <p>{messagesError}</p>
            </div>
          ) : currentMessages?.length ? (
            <>
              {messagesError ? (
                <div className="agent-inline-error" role="alert">
                  <p>{messagesError}</p>
                  <button type="button" onClick={retryMessages}>重新加载消息</button>
                </div>
              ) : null}
              {currentMessages.map((message) => (
                <article className={`agent-message agent-message--${message.role.toLowerCase()}`} key={message.id}>
                  <p className="agent-message__role">{message.role === 'USER' ? '你' : 'Agent'}</p>
                  <p className="agent-message__content">{message.content}</p>
                </article>
              ))}
            </>
          ) : messagesError ? (
            <div className="agent-inline-error" role="alert">
              <p>{messagesError}</p>
              <button type="button" onClick={retryMessages}>重新加载消息</button>
            </div>
          ) : (
            <p className="agent-empty" role="status">这个会话还没有消息</p>
          )}
        </div>

        {sendError ? <p className="agent-inline-error" role="alert">{sendError}</p> : null}
        <form className="agent-composer" onSubmit={(event) => void sendMessage(event)}>
          <label htmlFor="agent-message-content">消息内容</label>
          <textarea
            ref={inputRef}
            id="agent-message-content"
            value={draft}
            disabled={!canWrite || isSending}
            maxLength={8000}
            placeholder={
              !selectedSession
                ? '请先选择一个会话'
                : capability?.availability === 'NOT_CONFIGURED'
                  ? '需要连接 API 后才能发送消息'
                  : capability?.availability === 'UNAVAILABLE'
                    ? 'Provider 暂时不可用'
                    : '输入一条消息'
            }
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="agent-composer__footer">
            <span>{draft.length} / 8000</span>
            <button type="submit" disabled={!canSubmit}>{isSending ? '正在发送…' : '发送消息'}</button>
          </div>
        </form>
      </section>

      <AgentContextPanel capability={capability} session={selectedSession} />
    </section>
  );
}
