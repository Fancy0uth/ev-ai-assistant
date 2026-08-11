import type { AgentMessage, AgentMessageRole, AgentSession } from '@ev/contracts';
import type Database from 'better-sqlite3';

export interface AgentListQuery {
  page: number;
  pageSize: number;
}

export interface AgentPage<T> {
  items: T[];
  total: number;
}

interface AgentSessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface AgentMessageRow {
  id: string;
  session_id: string;
  role: AgentMessageRole;
  content: string;
  created_at: string;
}

export interface NewAgentSession extends AgentSession {
  ownerId: string;
}

export interface AgentMessagePair {
  userMessage: AgentMessage & { role: 'USER' };
  assistantMessage: AgentMessage & { role: 'ASSISTANT' };
}

export interface AgentRepository {
  createSession(session: NewAgentSession): AgentSession;
  findSession(ownerId: string, sessionId: string): AgentSession | undefined;
  listSessions(ownerId: string, query: AgentListQuery): AgentPage<AgentSession>;
  listMessages(
    ownerId: string,
    sessionId: string,
    query: AgentListQuery,
  ): AgentPage<AgentMessage>;
  listMessageHistory(ownerId: string, sessionId: string): AgentMessage[];
  appendMessagePair(
    ownerId: string,
    sessionId: string,
    messages: AgentMessagePair,
    updatedAt: string,
  ): AgentMessagePair | undefined;
}

function toSession(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: AgentMessageRow): AgentMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

const sessionColumns = `
  id,
  title,
  created_at,
  updated_at
`;

const messageColumns = `
  agent_messages.id,
  agent_messages.session_id,
  agent_messages.role,
  agent_messages.content,
  agent_messages.created_at
`;

export function createAgentRepository(database: Database.Database): AgentRepository {
  const findSessionStatement = database.prepare(
    `select ${sessionColumns}
     from agent_sessions
     where id = ? and owner_id = ?`,
  );
  const insertSessionStatement = database.prepare(
    `insert into agent_sessions (id, owner_id, title, created_at, updated_at)
     values (?, ?, ?, ?, ?)`,
  );
  const updateSessionStatement = database.prepare(
    `update agent_sessions
     set updated_at = ?
     where id = ? and owner_id = ?`,
  );
  const insertMessageStatement = database.prepare(
    `insert into agent_messages (id, session_id, role, content, created_at)
     values (?, ?, ?, ?, ?)`,
  );

  const appendMessagePair = database.transaction(
    (
      ownerId: string,
      sessionId: string,
      messages: AgentMessagePair,
      updatedAt: string,
    ): AgentMessagePair | undefined => {
      const updated = updateSessionStatement.run(updatedAt, sessionId, ownerId);
      if (updated.changes !== 1) return undefined;

      insertMessageStatement.run(
        messages.userMessage.id,
        sessionId,
        messages.userMessage.role,
        messages.userMessage.content,
        messages.userMessage.createdAt,
      );
      insertMessageStatement.run(
        messages.assistantMessage.id,
        sessionId,
        messages.assistantMessage.role,
        messages.assistantMessage.content,
        messages.assistantMessage.createdAt,
      );
      return messages;
    },
  );

  function findSession(ownerId: string, sessionId: string): AgentSession | undefined {
    const row = findSessionStatement.get(sessionId, ownerId) as AgentSessionRow | undefined;
    return row ? toSession(row) : undefined;
  }

  return {
    createSession(session) {
      insertSessionStatement.run(
        session.id,
        session.ownerId,
        session.title,
        session.createdAt,
        session.updatedAt,
      );
      return {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    },

    findSession,

    listSessions(ownerId, query) {
      const offset = (query.page - 1) * query.pageSize;
      const rows = database
        .prepare(
          `select ${sessionColumns}
           from agent_sessions
           where owner_id = ?
           order by updated_at desc, id asc
           limit ? offset ?`,
        )
        .all(ownerId, query.pageSize, offset) as AgentSessionRow[];
      const total = database
        .prepare('select count(*) as total from agent_sessions where owner_id = ?')
        .get(ownerId) as { total: number };
      return { items: rows.map(toSession), total: total.total };
    },

    listMessages(ownerId, sessionId, query) {
      const offset = (query.page - 1) * query.pageSize;
      const rows = database
        .prepare(
          `select ${messageColumns}
           from agent_messages
           join agent_sessions on agent_sessions.id = agent_messages.session_id
           where agent_sessions.id = ? and agent_sessions.owner_id = ?
           order by agent_messages.created_at asc, agent_messages.id asc
           limit ? offset ?`,
        )
        .all(sessionId, ownerId, query.pageSize, offset) as AgentMessageRow[];
      const total = database
        .prepare(
          `select count(*) as total
           from agent_messages
           join agent_sessions on agent_sessions.id = agent_messages.session_id
           where agent_sessions.id = ? and agent_sessions.owner_id = ?`,
        )
        .get(sessionId, ownerId) as { total: number };
      return { items: rows.map(toMessage), total: total.total };
    },

    listMessageHistory(ownerId, sessionId) {
      const rows = database
        .prepare(
          `select ${messageColumns}
           from agent_messages
           join agent_sessions on agent_sessions.id = agent_messages.session_id
           where agent_sessions.id = ? and agent_sessions.owner_id = ?
           order by agent_messages.created_at asc, agent_messages.id asc`,
        )
        .all(sessionId, ownerId) as AgentMessageRow[];
      return rows.map(toMessage);
    },

    appendMessagePair,
  };
}
