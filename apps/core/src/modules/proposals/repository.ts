import {
  proposalChangeSchema,
  proposalSchema,
  type Proposal,
  type ProposalChange,
} from '@ev/contracts';
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
      const { ownerId: _ownerId, ...saved } = proposal;
      return saved;
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
  };
}
