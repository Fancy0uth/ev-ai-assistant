import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentRepository } from '../src/modules/agent/repository';
import {
  createAgentService,
  type AgentService,
} from '../src/modules/agent/service';
import type { AgentProvider, AgentProviderRequest } from '../src/modules/agent/provider';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000000101';
const otherOwnerId = '00000000-0000-4000-8000-000000000102';

class FakeAgentProvider implements AgentProvider {
  readonly calls: AgentProviderRequest[] = [];
  private replyIndex = 0;

  constructor(private readonly replies: string[]) {}

  async generate(input: AgentProviderRequest): Promise<string> {
    this.calls.push(input);
    const reply = this.replies[this.replyIndex++];
    if (reply === undefined) throw new Error('Unexpected provider call');
    return reply;
  }
}

describe('AgentService', () => {
  let database: ReturnType<typeof openDatabase>;
  let currentTime: Date;
  let nextId: number;

  beforeEach(() => {
    database = openDatabase(':memory:');
    currentTime = new Date('2026-08-10T00:00:00.000Z');
    nextId = 1;
    addOwner(ownerId, 'agent-owner');
  });

  afterEach(() => {
    database.close();
  });

  it('creates owner-isolated sessions and paginates them by updated time and id', () => {
    const service = createService();
    const first = service.createSession(ownerId, { title: 'First session' });
    const second = service.createSession(ownerId, { title: 'Second session' });
    currentTime = new Date('2026-08-10T00:00:01.000Z');
    const third = service.createSession(ownerId, { title: 'Third session' });

    const page = service.listSessions(ownerId, { page: 1, pageSize: 2 });
    expect(page).toEqual({
      items: [third, first],
      pagination: { page: 1, pageSize: 2, total: 3, totalPages: 2 },
    });
    expect(service.listSessions(ownerId, { page: 2, pageSize: 2 }).items).toEqual([second]);
    expect(service.listSessions(otherOwnerId, { page: 1, pageSize: 20 })).toEqual({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    expect(first).not.toHaveProperty('ownerId');
    expect(page.items.every((session) => !Object.hasOwn(session, 'ownerId'))).toBe(true);
  });

  it('paginates messages chronologically by created time and id', async () => {
    const service = createService(new FakeAgentProvider(['Reply one', 'Reply two', 'Reply three']));
    const session = service.createSession(ownerId, { title: 'Message pagination' });

    await service.sendMessage(ownerId, session.id, { content: 'Question one' });
    await service.sendMessage(ownerId, session.id, { content: 'Question two' });
    await service.sendMessage(ownerId, session.id, { content: 'Question three' });

    const firstPage = service.listMessages(ownerId, session.id, { page: 1, pageSize: 2 });
    const secondPage = service.listMessages(ownerId, session.id, { page: 2, pageSize: 2 });
    const thirdPage = service.listMessages(ownerId, session.id, { page: 3, pageSize: 2 });

    expect(firstPage.items.map((message) => [message.role, message.content])).toEqual([
      ['USER', 'Question one'],
      ['ASSISTANT', 'Reply one'],
    ]);
    expect(secondPage.items.map((message) => [message.role, message.content])).toEqual([
      ['USER', 'Question two'],
      ['ASSISTANT', 'Reply two'],
    ]);
    expect(thirdPage).toMatchObject({
      items: [
        { role: 'USER', content: 'Question three' },
        { role: 'ASSISTANT', content: 'Reply three' },
      ],
      pagination: { page: 3, pageSize: 2, total: 6, totalPages: 3 },
    });
    expect(firstPage.items.every((message) => !Object.hasOwn(message, 'ownerId'))).toBe(true);
  });

  it('treats another owner session and messages as not found', async () => {
    const service = createService(new FakeAgentProvider(['Never returned']));
    const session = service.createSession(ownerId, { title: 'Private session' });

    expect(() => service.listMessages(otherOwnerId, session.id, { page: 1, pageSize: 20 })).toThrow(
      expect.objectContaining({ statusCode: 404, code: 'AGENT_SESSION_NOT_FOUND' }),
    );
    await expect(
      service.sendMessage(otherOwnerId, session.id, { content: 'Other owner input' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'AGENT_SESSION_NOT_FOUND' });
    expect(messageCount(session.id)).toBe(0);
  });

  it('returns the exact unavailable error before writing when no provider is configured', async () => {
    const service = createService();
    const session = service.createSession(ownerId, { title: 'No provider' });

    await expect(
      service.sendMessage(ownerId, session.id, { content: 'No provider input' }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'AGENT_PROVIDER_NOT_CONFIGURED' });
    expect(messageCount(session.id)).toBe(0);
  });

  it('does not write a user message when the provider throws', async () => {
    const service = createService({
      async generate() {
        throw new Error('Provider network failure');
      },
    });
    const session = service.createSession(ownerId, { title: 'Throwing provider' });

    await expect(
      service.sendMessage(ownerId, session.id, { content: 'Trigger provider failure' }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'AGENT_PROVIDER_UNAVAILABLE' });
    expect(messageCount(session.id)).toBe(0);
  });

  it.each(['   ', 'x'.repeat(8001)])(
    'does not write a user message when the provider returns invalid output',
    async (invalidReply) => {
      const service = createService(new FakeAgentProvider([invalidReply]));
      const session = service.createSession(ownerId, { title: 'Invalid provider output' });

      await expect(
        service.sendMessage(ownerId, session.id, { content: 'Validate this reply' }),
      ).rejects.toMatchObject({ statusCode: 503, code: 'AGENT_PROVIDER_UNAVAILABLE' });
      expect(messageCount(session.id)).toBe(0);
    },
  );

  it('passes only public ordered context to the provider and persists exactly two messages per send', async () => {
    const provider = new FakeAgentProvider(['First response', 'Second response']);
    const service = createService(provider);
    const session = service.createSession(ownerId, { title: 'Provider context' });

    const first = await service.sendMessage(ownerId, session.id, { content: 'First question' });
    expect(messageCount(session.id)).toBe(2);

    const second = await service.sendMessage(ownerId, session.id, { content: 'Second question' });
    expect(messageCount(session.id)).toBe(4);
    expect(provider.calls).toHaveLength(2);
    const secondCall = provider.calls[1];
    expect(secondCall).toBeDefined();
    if (!secondCall) throw new Error('Provider did not receive the second message');
    expect(secondCall).toEqual({
      session,
      history: [first.userMessage, first.assistantMessage],
      candidateUserMessage: second.userMessage,
    });
    expect(secondCall.session).not.toHaveProperty('ownerId');
    expect(secondCall.history.every((message) => !Object.hasOwn(message, 'ownerId'))).toBe(
      true,
    );
    expect(secondCall.candidateUserMessage).not.toHaveProperty('ownerId');
    expect(second.userMessage).not.toHaveProperty('ownerId');
    expect(second.assistantMessage).not.toHaveProperty('ownerId');
  });

  function createService(provider?: AgentProvider): AgentService {
    return createAgentService(createAgentRepository(database), {
      ...(provider ? { provider } : {}),
      now: () => currentTime,
      createId: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
    });
  }

  function addOwner(id: string, username: string): void {
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(id, username, 'hash', currentTime.toISOString());
  }

  function messageCount(sessionId: string): number {
    return (
      database
        .prepare('select count(*) as count from agent_messages where session_id = ?')
        .get(sessionId) as { count: number }
    ).count;
  }
});
