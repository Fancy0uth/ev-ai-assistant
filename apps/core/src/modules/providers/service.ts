import { randomUUID } from 'node:crypto';
import {
  agentRunOutputSchema,
  agentRunSchema,
  type AgentRun,
  type AgentRunOutput,
  type CreateAgentRunInput,
  type ProviderProfile,
} from '@ev/contracts';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import type { DomainAgentProvider } from '../agents/provider';

interface AgentRunRow {
  id: string;
  provider_key: AgentRun['providerKey'];
  capability: AgentRun['capability'];
  status: AgentRun['status'];
  context_json: string;
  output_json: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

interface ProviderServiceOptions {
  now?: () => Date;
  newId?: () => string;
  provider?: DomainAgentProvider;
}

export interface ProviderService {
  listProfiles(): ProviderProfile[];
  listRuns(ownerId: string): AgentRun[];
  startRun(ownerId: string, input: CreateAgentRunInput): Promise<AgentRun>;
}

function toRun(row: AgentRunRow): AgentRun {
  return agentRunSchema.parse({
    id: row.id,
    providerKey: row.provider_key,
    capability: row.capability,
    status: row.status,
    context: JSON.parse(row.context_json),
    output: row.output_json ? JSON.parse(row.output_json) : null,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const runColumns = `
  id, provider_key, capability, status, context_json, output_json, failure_code, created_at, updated_at
`;

export function createProviderService(
  database: Database.Database,
  options: ProviderServiceOptions = {},
): ProviderService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const findRunStatement = database.prepare(
    `select ${runColumns} from agent_runs where id = ? and owner_id = ?`,
  );

  function findRun(ownerId: string, id: string): AgentRun | undefined {
    const row = findRunStatement.get(id, ownerId) as AgentRunRow | undefined;
    return row ? toRun(row) : undefined;
  }

  function updateRun(
    ownerId: string,
    id: string,
    status: AgentRun['status'],
    output: AgentRunOutput | null,
    failureCode: string | null,
  ): AgentRun {
    database
      .prepare(
        `update agent_runs
         set status = ?, output_json = ?, failure_code = ?, updated_at = ?
         where id = ? and owner_id = ?`,
      )
      .run(status, output ? JSON.stringify(output) : null, failureCode, now().toISOString(), id, ownerId);
    const run = findRun(ownerId, id);
    if (!run) throw new Error('agent run disappeared');
    return run;
  }

  return {
    listProfiles() {
      return [
        {
          key: 'DEEPSEEK',
          label: 'DeepSeek（生活与轻量任务）',
          availability: options.provider?.key === 'DEEPSEEK' ? 'READY' : 'NOT_CONFIGURED',
          acceptsSecrets: false,
        },
        {
          key: 'CODEX_LOCAL',
          label: '本地 Codex（只读项目分析）',
          availability: options.provider?.key === 'CODEX_LOCAL' ? 'READY' : 'NOT_CONFIGURED',
          acceptsSecrets: false,
        },
      ];
    },

    listRuns(ownerId) {
      const rows = database
        .prepare(
          `select ${runColumns} from agent_runs where owner_id = ? order by created_at desc, id asc`,
        )
        .all(ownerId) as AgentRunRow[];
      return rows.map(toRun);
    },

    async startRun(ownerId, input) {
      const timestamp = now().toISOString();
      const id = newId();
      database
        .prepare(
          `insert into agent_runs (
             id, owner_id, provider_key, capability, status, context_json, output_json,
             failure_code, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          ownerId,
          input.providerKey,
          input.capability,
          'BLOCKED',
          JSON.stringify(input.context),
          null,
          'PROVIDER_NOT_CONFIGURED',
          timestamp,
          timestamp,
        );
      if (!options.provider || options.provider.key !== input.providerKey) {
        throw new ApiError(503, 'AGENT_PROVIDER_NOT_CONFIGURED', 'Agent Provider 尚未配置');
      }

      let output: AgentRunOutput;
      try {
        output = agentRunOutputSchema.parse(
          await options.provider.run({ capability: input.capability, context: input.context }),
        );
      } catch {
        updateRun(ownerId, id, 'FAILED', null, 'PROVIDER_RESPONSE_INVALID');
        throw new ApiError(503, 'AGENT_PROVIDER_UNAVAILABLE', 'Agent Provider 暂不可用');
      }
      return updateRun(ownerId, id, 'SUCCEEDED', output, null);
    },
  };
}
