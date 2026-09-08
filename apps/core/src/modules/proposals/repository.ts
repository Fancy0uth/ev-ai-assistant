import {
  proposalChangeSchema,
  proposalSchema,
  type ProposalDecisionInput,
  type Proposal,
  type ProposalChange,
} from '@ev/contracts';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface NewProposal extends Proposal {
  ownerId: string;
}

interface ProposalRow {
  id: string;
  kind: Proposal['kind'];
  status: Proposal['status'];
  source: Proposal['source'];
  title: string;
  changes_json: string;
  version: number;
  created_at: string;
  expires_at: string | null;
}

export interface ProposalRepository {
  create(proposal: NewProposal): Proposal;
  findById(ownerId: string, proposalId: string): Proposal | undefined;
  listPending(ownerId: string): Proposal[];
  decide(
    ownerId: string,
    proposalId: string,
    input: ProposalDecisionInput,
    decidedAt: string,
    applyAcceptedChanges: (proposal: Proposal) => void,
  ): Proposal | undefined;
}

function parseChanges(changesJson: string): ProposalChange[] {
  return proposalChangeSchema.array().parse(JSON.parse(changesJson));
}

function toProposal(row: ProposalRow): Proposal {
  return proposalSchema.parse({
    id: row.id,
    kind: row.kind,
    status: row.status,
    source: row.source,
    title: row.title,
    changes: parseChanges(row.changes_json),
    version: row.version,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  });
}

const proposalColumns = `
  id, kind, status, source, title, changes_json, version, created_at, expires_at
`;

export function createProposalRepository(database: Database.Database): ProposalRepository {
  const findByIdStatement = database.prepare(
    `select ${proposalColumns} from proposals where id = ? and owner_id = ?`,
  );
  const updateDecisionStatement = database.prepare(
    `update proposals
     set status = ?, version = version + 1, decided_at = ?
     where id = ? and owner_id = ? and status = 'PENDING' and version = ?`,
  );
  const insertAuditStatement = database.prepare(
    `insert into proposal_audits (
       id, owner_id, proposal_id, decision, expected_version, applied_version, created_at
     ) values (?, ?, ?, ?, ?, ?, ?)`,
  );

  const decide = database.transaction(
    (
      ownerId: string,
      proposalId: string,
      input: ProposalDecisionInput,
      decidedAt: string,
      applyAcceptedChanges: (proposal: Proposal) => void,
    ): Proposal | undefined => {
      const row = findByIdStatement.get(proposalId, ownerId) as ProposalRow | undefined;
      if (!row) return undefined;
      const current = toProposal(row);
      if (current.status !== 'PENDING' || current.version !== input.version) return undefined;
      applyAcceptedChanges(current);

      const status = input.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
      const updated = updateDecisionStatement.run(
        status,
        decidedAt,
        proposalId,
        ownerId,
        input.version,
      );
      if (updated.changes !== 1) return undefined;
      insertAuditStatement.run(
        randomUUID(),
        ownerId,
        proposalId,
        input.decision,
        input.version,
        input.version + 1,
        decidedAt,
      );
      return proposalSchema.parse({
        ...current,
        status,
        version: input.version + 1,
      });
    },
  );

  return {
    create(proposal) {
      database
        .prepare(
          `insert into proposals (
           id, owner_id, kind, status, source, title, changes_json, version, created_at,
             expires_at, decided_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          proposal.id,
          proposal.ownerId,
          proposal.kind,
          proposal.status,
          proposal.source,
          proposal.title,
          JSON.stringify(proposal.changes),
          proposal.version,
          proposal.createdAt,
          proposal.expiresAt,
          null,
        );
      const row = findByIdStatement.get(proposal.id, proposal.ownerId) as ProposalRow;
      return toProposal(row);
    },

    findById(ownerId, proposalId) {
      const row = findByIdStatement.get(proposalId, ownerId) as ProposalRow | undefined;
      return row ? toProposal(row) : undefined;
    },

    listPending(ownerId) {
      const rows = database
        .prepare(
          `select ${proposalColumns}
           from proposals
           where owner_id = ? and status = 'PENDING'
           order by created_at asc, id asc`,
        )
        .all(ownerId) as ProposalRow[];
      return rows.map(toProposal);
    },

    decide,
  };
}
