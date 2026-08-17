import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentWorkspace } from '@/components/agent/agent-workspace';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

const sessionOne = {
  id: '00000000-0000-4000-8000-000000000001',
  title: '学习安排',
  createdAt: '2026-08-10T01:00:00.000Z',
  updatedAt: '2026-08-10T01:00:00.000Z',
};

const sessionTwo = {
  id: '00000000-0000-4000-8000-000000000002',
  title: '项目复盘',
  createdAt: '2026-08-10T02:00:00.000Z',
  updatedAt: '2026-08-10T02:00:00.000Z',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function capabilityResponse(availability: 'READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE') {
  return {
    data: {
      items: [
        {
          key: 'CONVERSATION',
          label: '对话',
          availability,
          description: '连接 Agent Provider 后可以进行对话。',
        },
      ],
    },
  };
}

function sessionsResponse(
  items: typeof sessionOne[] = [],
  page = 1,
  pageSize = 20,
  total = items.length,
  totalPages = total === 0 ? 0 : Math.ceil(total / pageSize),
) {
  return { data: { items, pagination: { page, pageSize, total, totalPages } } };
}

function messageResponse(
  sessionId: string,
  items: Array<{ id: string; role: 'USER' | 'ASSISTANT'; content: string }> = [],
) {
  return {
    data: {
      items: items.map((message, index) => ({
        ...message,
        sessionId,
        createdAt: `2026-08-10T03:00:0${index}.000Z`,
      })),
      pagination: { page: 1, pageSize: 100, total: items.length, totalPages: items.length ? 1 : 0 },
    },
  };
}

function sentPairResponse(sessionId: string, content: string, reply: string) {
  return {
    data: {
      userMessage: {
        id: '00000000-0000-4000-8000-000000000101',
        sessionId,
        role: 'USER' as const,
        content,
        createdAt: '2026-08-10T03:00:00.000Z',
      },
      assistantMessage: {
        id: '00000000-0000-4000-8000-000000000102',
        sessionId,
        role: 'ASSISTANT' as const,
        content: reply,
        createdAt: '2026-08-10T03:00:01.000Z',
      },
    },
  };
}

function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function requestInit(fetchMock: ReturnType<typeof vi.fn>, index: number): RequestInit {
  return fetchMock.mock.calls[index]?.[1] as RequestInit;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('AgentWorkspace', () => {
  beforeEach(() => {
    replace.mockReset();
  });

  it('keeps local session creation available when conversation needs an API connection', async () => {
    const createdSession = {
      ...sessionOne,
      id: '00000000-0000-4000-8000-000000000011',
      title: '新会话',
    };
    let sessionListReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/core/agent/capabilities') {
        return Promise.resolve(jsonResponse(capabilityResponse('NOT_CONFIGURED')));
      }
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') {
        sessionListReads += 1;
        return Promise.resolve(jsonResponse(sessionsResponse(sessionListReads === 1 ? [] : [createdSession])));
      }
      if (String(input) === '/api/core/agent/sessions' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ data: createdSession }, 201));
      }
      if (String(input) === `/api/core/agent/sessions/${createdSession.id}/messages?page=1&pageSize=100`) {
        return Promise.resolve(jsonResponse(messageResponse(createdSession.id)));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);

    expect(await screen.findByText('需要连接 API')).toBeInTheDocument();
    expect(screen.getByLabelText('消息内容')).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '新建会话' }));

    expect(await screen.findByRole('button', { name: '新会话' })).toHaveFocus();
    expect(screen.queryByText('正在生成回复')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/core/agent/sessions')).toHaveLength(1);
  });

  it('loads the selected session messages and moves through server pagination', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      switch (String(input)) {
        case '/api/core/agent/capabilities':
          return Promise.resolve(jsonResponse(capabilityResponse('READY')));
        case '/api/core/agent/sessions?page=1&pageSize=20':
          return Promise.resolve(jsonResponse(sessionsResponse([sessionOne], 1, 20, 21, 2)));
        case '/api/core/agent/sessions?page=2&pageSize=20':
          return Promise.resolve(jsonResponse(sessionsResponse([sessionTwo], 2, 20, 21, 2)));
        case `/api/core/agent/sessions/${sessionTwo.id}/messages?page=1&pageSize=100`:
          return Promise.resolve(
            jsonResponse(messageResponse(sessionTwo.id, [{ id: '00000000-0000-4000-8000-000000000201', role: 'ASSISTANT', content: '第二页会话内容' }])),
          );
        default:
          throw new Error(`Unexpected request: ${String(input)}`);
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);

    expect(await screen.findByRole('button', { name: sessionOne.title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '下一页会话' }));
    expect(await screen.findByRole('button', { name: sessionTwo.title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: sessionTwo.title }));

    expect(await screen.findByText('第二页会话内容')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/core/agent/sessions/${sessionTwo.id}/messages?page=1&pageSize=100`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('selects a schema-valid created session and reads its server message history', async () => {
    const createdSession = { ...sessionOne, title: '刚创建的会话' };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/core/agent/capabilities') {
        return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      }
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') {
        return Promise.resolve(jsonResponse(sessionsResponse()));
      }
      if (String(input) === '/api/core/agent/sessions' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ data: createdSession }, 201));
      }
      if (String(input) === `/api/core/agent/sessions/${createdSession.id}/messages?page=1&pageSize=100`) {
        return Promise.resolve(jsonResponse(messageResponse(createdSession.id)));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByText('还没有会话');
    await user.click(screen.getByRole('button', { name: '新建会话' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(requestInit(fetchMock, 2)).toMatchObject({ method: 'POST', body: '{}' });
    expect(screen.getByText('当前会话：刚创建的会话')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('消息内容')).toHaveFocus());
  });

  it('sends one trimmed exact request and renders only the returned server pair', async () => {
    const send = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/core/agent/capabilities') {
        return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      }
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') {
        return Promise.resolve(jsonResponse(sessionsResponse([sessionOne])));
      }
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages?page=1&pageSize=100`) {
        return Promise.resolve(jsonResponse(messageResponse(sessionOne.id)));
      }
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages` && init?.method === 'POST') {
        return send.promise;
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByRole('button', { name: sessionOne.title });
    await user.click(screen.getByRole('button', { name: sessionOne.title }));
    await screen.findByText('这个会话还没有消息');

    await user.type(screen.getByLabelText('消息内容'), '  请安排今天  ');
    await user.click(screen.getByRole('button', { name: '发送消息' }));

    expect(screen.queryByText('请安排今天', { selector: '.agent-message__content' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === `/api/core/agent/sessions/${sessionOne.id}/messages`)).toHaveLength(1);
    const sendIndex = fetchMock.mock.calls.findIndex(([url]) => url === `/api/core/agent/sessions/${sessionOne.id}/messages`);
    expect(requestInit(fetchMock, sendIndex)).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ content: '请安排今天' }),
    });

    send.resolve(jsonResponse(sentPairResponse(sessionOne.id, '请安排今天', '先处理最重要的任务。'), 201));

    expect(await screen.findByText('先处理最重要的任务。')).toBeInTheDocument();
    expect(screen.getByText('请安排今天')).toBeInTheDocument();
    expect(screen.getByLabelText('消息内容')).toHaveValue('');
    expect(screen.getByLabelText('消息内容')).toBeEnabled();
    await waitFor(() => expect(screen.getByLabelText('消息内容')).toHaveFocus());
  });

  it('preserves the draft and trusted messages when a send success payload is malformed', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') return Promise.resolve(jsonResponse(sessionsResponse([sessionOne])));
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages?page=1&pageSize=100`) {
        return Promise.resolve(jsonResponse(messageResponse(sessionOne.id, [{ id: '00000000-0000-4000-8000-000000000202', role: 'ASSISTANT', content: '可信历史' }])));
      }
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages` && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ data: { userMessage: {} } }, 201));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByRole('button', { name: sessionOne.title });
    await user.click(screen.getByRole('button', { name: sessionOne.title }));
    expect(await screen.findByText('可信历史')).toBeInTheDocument();

    await user.type(screen.getByLabelText('消息内容'), '保留草稿');
    await user.click(screen.getByRole('button', { name: '发送消息' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('无法识别');
    expect(screen.getByText('可信历史')).toBeInTheDocument();
    expect(screen.getByLabelText('消息内容')).toHaveValue('保留草稿');
  });

  it('routes canonical authentication failures to login', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/core/agent/capabilities') {
        return Promise.resolve(errorResponse('AUTHENTICATION_REQUIRED', '请先登录本地账号', 401));
      }
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') {
        return Promise.resolve(jsonResponse(sessionsResponse()));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AgentWorkspace />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('shows a session-not-found state without removing other selectable sessions', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') return Promise.resolve(jsonResponse(sessionsResponse([sessionOne, sessionTwo])));
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages?page=1&pageSize=100`) {
        return Promise.resolve(errorResponse('AGENT_SESSION_NOT_FOUND', '会话不存在', 404));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByRole('button', { name: sessionOne.title });
    await user.click(screen.getByRole('button', { name: sessionOne.title }));

    expect(await screen.findByRole('alert')).toHaveTextContent('该会话不存在');
    expect(screen.getByRole('button', { name: sessionTwo.title })).toBeEnabled();
  });

  it('changes to not configured without appending messages after the canonical provider 503', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') return Promise.resolve(jsonResponse(sessionsResponse([sessionOne])));
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages?page=1&pageSize=100`) return Promise.resolve(jsonResponse(messageResponse(sessionOne.id)));
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages` && init?.method === 'POST') {
        return Promise.resolve(errorResponse('AGENT_PROVIDER_NOT_CONFIGURED', '请先连接 API', 503));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByRole('button', { name: sessionOne.title });
    await user.click(screen.getByRole('button', { name: sessionOne.title }));
    await screen.findByText('这个会话还没有消息');
    await user.type(screen.getByLabelText('消息内容'), '不能写入');
    await user.click(screen.getByRole('button', { name: '发送消息' }));

    expect(await screen.findByText('需要连接 API')).toBeInTheDocument();
    expect(screen.getByLabelText('消息内容')).toBeDisabled();
    expect(screen.queryByText('不能写入', { selector: '.agent-message__content' })).not.toBeInTheDocument();
  });

  it('discards a slow message response after a newer session selection', async () => {
    const firstMessages = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') return Promise.resolve(jsonResponse(sessionsResponse([sessionOne, sessionTwo])));
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages?page=1&pageSize=100`) return firstMessages.promise;
      if (String(input) === `/api/core/agent/sessions/${sessionTwo.id}/messages?page=1&pageSize=100`) {
        return Promise.resolve(jsonResponse(messageResponse(sessionTwo.id, [{ id: '00000000-0000-4000-8000-000000000203', role: 'ASSISTANT', content: '第二个会话可信内容' }])));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByRole('button', { name: sessionOne.title });
    await user.click(screen.getByRole('button', { name: sessionOne.title }));
    await user.click(screen.getByRole('button', { name: sessionTwo.title }));
    expect(await screen.findByText('第二个会话可信内容')).toBeInTheDocument();

    firstMessages.resolve(
      jsonResponse(messageResponse(sessionOne.id, [{ id: '00000000-0000-4000-8000-000000000204', role: 'ASSISTANT', content: '过期消息' }])),
    );
    await Promise.resolve();

    expect(screen.queryByText('过期消息')).not.toBeInTheDocument();
    expect(screen.getByText('第二个会话可信内容')).toBeInTheDocument();
  });

  it('keeps trusted messages visible when a message refresh fails', async () => {
    let messageRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') return Promise.resolve(jsonResponse(sessionsResponse([sessionOne])));
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages?page=1&pageSize=100`) {
        messageRequests += 1;
        return messageRequests === 1
          ? Promise.resolve(jsonResponse(messageResponse(sessionOne.id, [{ id: '00000000-0000-4000-8000-000000000206', role: 'ASSISTANT', content: '可信消息仍应保留' }])))
          : Promise.resolve(errorResponse('CORE_UNAVAILABLE', '消息刷新失败', 503));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByRole('button', { name: sessionOne.title });
    await user.click(screen.getByRole('button', { name: sessionOne.title }));
    expect(await screen.findByText('可信消息仍应保留')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: sessionOne.title }));

    expect(await screen.findByRole('alert')).toHaveTextContent('消息刷新失败');
    expect(screen.getByText('可信消息仍应保留')).toBeInTheDocument();
  });

  it('rejects schema-valid messages that belong to another session and preserves trusted history', async () => {
    let messageRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') return Promise.resolve(jsonResponse(sessionsResponse([sessionOne, sessionTwo])));
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages?page=1&pageSize=100`) {
        messageRequests += 1;
        return messageRequests === 1
          ? Promise.resolve(jsonResponse(messageResponse(sessionOne.id, [{ id: '00000000-0000-4000-8000-000000000208', role: 'ASSISTANT', content: '会话 A 的可信历史' }])))
          : Promise.resolve(jsonResponse(messageResponse(sessionTwo.id, [{ id: '00000000-0000-4000-8000-000000000209', role: 'ASSISTANT', content: '不应显示的会话 B 消息' }])));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByRole('button', { name: sessionOne.title });
    await user.click(screen.getByRole('button', { name: sessionOne.title }));
    expect(await screen.findByText('会话 A 的可信历史')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: sessionOne.title }));

    expect(await screen.findByRole('alert')).toHaveTextContent('当前会话');
    expect(screen.getByText('会话 A 的可信历史')).toBeInTheDocument();
    expect(screen.queryByText('不应显示的会话 B 消息')).not.toBeInTheDocument();
  });

  it('retains a created session when an older sessions response settles later', async () => {
    const staleSessions = deferred<Response>();
    const authoritativeSessions = deferred<Response>();
    const createdSession = { ...sessionOne, id: '00000000-0000-4000-8000-000000000012', title: '创建后保留' };
    let sessionReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') {
        sessionReads += 1;
        return sessionReads === 1 ? staleSessions.promise : authoritativeSessions.promise;
      }
      if (String(input) === '/api/core/agent/sessions' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ data: createdSession }, 201));
      }
      if (String(input) === `/api/core/agent/sessions/${createdSession.id}/messages?page=1&pageSize=100`) {
        return Promise.resolve(jsonResponse(messageResponse(createdSession.id)));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await user.click(screen.getByRole('button', { name: '新建会话' }));

    expect(await screen.findByRole('button', { name: createdSession.title })).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/core/agent/sessions?page=1&pageSize=20')).toHaveLength(2);
    });

    staleSessions.resolve(jsonResponse(sessionsResponse()));

    await waitFor(() => expect(screen.getByRole('button', { name: createdSession.title })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: createdSession.title })).toHaveAttribute('aria-pressed', 'true');
    authoritativeSessions.resolve(jsonResponse(sessionsResponse([createdSession])));
    expect(await screen.findByRole('button', { name: createdSession.title })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/core/agent/sessions?page=1&pageSize=20')).toHaveLength(2);
  });

  it('keeps a pending created session visible until a trusted first page includes it', async () => {
    const createdSession = { ...sessionOne, id: '00000000-0000-4000-8000-000000000013', title: '待确认创建会话' };
    let sessionReads = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') {
        sessionReads += 1;
        if (sessionReads < 3) return Promise.resolve(jsonResponse(sessionsResponse([sessionOne], 1, 20, 20, 1)));
        return Promise.resolve(jsonResponse(sessionsResponse([createdSession, sessionOne], 1, 20, 21, 2)));
      }
      if (String(input) === '/api/core/agent/sessions?page=2&pageSize=20') {
        return Promise.resolve(jsonResponse(sessionsResponse([sessionTwo], 2, 20, 21, 2)));
      }
      if (String(input) === '/api/core/agent/sessions' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ data: createdSession }, 201));
      }
      if (String(input) === `/api/core/agent/sessions/${createdSession.id}/messages?page=1&pageSize=100`) {
        return Promise.resolve(jsonResponse(messageResponse(createdSession.id)));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByRole('button', { name: sessionOne.title });
    await user.click(screen.getByRole('button', { name: '新建会话' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/core/agent/sessions?page=1&pageSize=20')).toHaveLength(2);
    });
    expect(await screen.findByRole('button', { name: createdSession.title })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { name: createdSession.title })).toHaveLength(1);
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页会话' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '下一页会话' }));
    expect(await screen.findByRole('button', { name: sessionTwo.title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '上一页会话' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/core/agent/sessions?page=1&pageSize=20')).toHaveLength(3);
    });
    expect(screen.getAllByRole('button', { name: createdSession.title })).toHaveLength(1);
    expect(screen.getByRole('button', { name: createdSession.title })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the last trusted sessions page usable when the requested page fails', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') {
        return Promise.resolve(jsonResponse(sessionsResponse([sessionOne], 1, 20, 21, 2)));
      }
      if (String(input) === '/api/core/agent/sessions?page=2&pageSize=20') {
        return Promise.resolve(errorResponse('CORE_UNAVAILABLE', '第二页读取失败', 503));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    expect(await screen.findByRole('button', { name: sessionOne.title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '下一页会话' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('第二页读取失败');
    expect(screen.getByRole('button', { name: sessionOne.title })).toBeInTheDocument();
    expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页会话' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '重新加载会话' })).toBeEnabled();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/core/agent/sessions?page=2&pageSize=20')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '下一页会话' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/core/agent/sessions?page=2&pageSize=20')).toHaveLength(2);
    });
  });

  it('issues at most one send POST for duplicate submit events', async () => {
    const send = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') return Promise.resolve(jsonResponse(sessionsResponse([sessionOne])));
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages?page=1&pageSize=100`) return Promise.resolve(jsonResponse(messageResponse(sessionOne.id)));
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages` && init?.method === 'POST') return send.promise;
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByRole('button', { name: sessionOne.title });
    await user.click(screen.getByRole('button', { name: sessionOne.title }));
    await screen.findByText('这个会话还没有消息');
    await user.type(screen.getByLabelText('消息内容'), '只发一次');

    const form = screen.getByRole('button', { name: '发送消息' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === `/api/core/agent/sessions/${sessionOne.id}/messages`)).toHaveLength(1);
    });
  });

  it('keeps the composer disabled until initial history settles, then renders history and a server pair once', async () => {
    const history = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') return Promise.resolve(jsonResponse(sessionsResponse([sessionOne])));
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages?page=1&pageSize=100`) return history.promise;
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages` && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(sentPairResponse(sessionOne.id, '新消息', '服务端新回复'), 201));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByRole('button', { name: sessionOne.title });
    await user.click(screen.getByRole('button', { name: sessionOne.title }));
    expect(await screen.findByText('正在加载消息…')).toBeInTheDocument();
    expect(screen.getByLabelText('消息内容')).toBeDisabled();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: '发送消息' }).closest('form')!);
    expect(fetchMock.mock.calls.filter(([url]) => url === `/api/core/agent/sessions/${sessionOne.id}/messages`)).toHaveLength(0);

    history.resolve(jsonResponse(messageResponse(sessionOne.id, [{ id: '00000000-0000-4000-8000-000000000207', role: 'ASSISTANT', content: '已持久化历史' }])));

    expect(await screen.findByText('已持久化历史')).toBeInTheDocument();
    expect(screen.getByLabelText('消息内容')).toBeEnabled();
    await user.type(screen.getByLabelText('消息内容'), '新消息');
    await user.click(screen.getByRole('button', { name: '发送消息' }));

    expect(await screen.findByText('服务端新回复')).toBeInTheDocument();
    expect(screen.getAllByText('已持久化历史', { selector: '.agent-message__content' })).toHaveLength(1);
    expect(screen.getAllByText('新消息', { selector: '.agent-message__content' })).toHaveLength(1);
    expect(screen.getAllByText('服务端新回复', { selector: '.agent-message__content' })).toHaveLength(1);
  });

  it('renders long server text in a containment class guarded by responsive CSS', async () => {
    const longContent = '很长的连续内容'.repeat(1_000);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input) === '/api/core/agent/capabilities') return Promise.resolve(jsonResponse(capabilityResponse('READY')));
      if (String(input) === '/api/core/agent/sessions?page=1&pageSize=20') return Promise.resolve(jsonResponse(sessionsResponse([sessionOne])));
      if (String(input) === `/api/core/agent/sessions/${sessionOne.id}/messages?page=1&pageSize=100`) {
        return Promise.resolve(jsonResponse(messageResponse(sessionOne.id, [{ id: '00000000-0000-4000-8000-000000000205', role: 'ASSISTANT', content: longContent }])));
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<AgentWorkspace />);
    await screen.findByRole('button', { name: sessionOne.title });
    await user.click(screen.getByRole('button', { name: sessionOne.title }));

    const content = await screen.findByText(longContent);
    expect(content).toHaveClass('agent-message__content');
    const dashboardCss = readFileSync(resolve(process.cwd(), 'src/app/dashboard.css'), 'utf8');
    const messageRule = dashboardCss.match(/\.agent-message__content\s*\{[\s\S]*?\n\}/)?.[0];
    expect(messageRule).toContain('overflow-wrap: anywhere');
    expect(messageRule).toContain('word-break: break-word');
  });
});
