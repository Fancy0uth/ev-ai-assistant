import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DailyPlanProposal } from '@ev/contracts';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { createDailyPlanningContextService } from '../src/modules/daily-planning/context-service';
import {
  DailyPlanBaseVersionStaleError,
  createDailyPlanRunRepository,
} from '../src/modules/daily-planning/repository';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000000501';
const otherOwnerId = '00000000-0000-4000-8000-000000000502';
const localDate = '2026-08-18';
const timestamp = '2026-08-18T07:00:00.000Z';

describe('daily plan proposal repository', () => {
  let database: Database.Database;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-daily-planning-repository-'));
    database = openDatabase(join(directory, 'app.sqlite'));
    const insertOwner = database.prepare(
      'insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)',
    );
    insertOwner.run(ownerId, 'daily-plan-repository-owner', 'not-used', timestamp);
  });

  afterEach(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function prepareContext(owner = ownerId, runId = '00000000-0000-4000-8000-000000000511') {
    const repository = createDailyPlanRunRepository(database);
    const service = createDailyPlanningContextService(repository, { newId: () => runId });
    return { repository, ...service.prepare(owner, localDate, 'MANUAL', new Date(timestamp)) };
  }

  function pendingProposal(
    runId: string,
    baseScheduleVersion: number,
    id = '00000000-0000-4000-8000-000000000521',
  ): DailyPlanProposal {
    return {
      id,
      contractVersion: 'DAILY_PLAN_V1',
      runId,
      localDate,
      status: 'PENDING_REVIEW',
      baseScheduleVersion,
      summary: 'Prioritize the available study block.',
      items: [],
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  function mutateEventForOwner(owner = ownerId) {
    createCalendarRepository(database).createEvent({
      id: '00000000-0000-4000-8000-000000000531',
      ownerId: owner,
      calendarRuleId: null,
      title: 'A schedule change after context preparation',
      kind: 'MEETING',
      localDate,
      startLocalTime: '10:00',
      endLocalTime: '11:00',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  it('atomically persists a pending proposal and completes its context-ready run', () => {
    const { repository, run, packet } = prepareContext();
    const proposal = pendingProposal(run.id, packet.baseScheduleVersion);

    const completed = repository.completeWithProposal(
      ownerId,
      run.id,
      packet.baseScheduleVersion,
      proposal,
    );

    expect(completed).toMatchObject({
      id: proposal.id,
      runId: run.id,
      status: 'PENDING_REVIEW',
      baseScheduleVersion: packet.baseScheduleVersion,
    });
    expect(repository.getRun(ownerId, run.id)).toMatchObject({
      status: 'SUCCEEDED',
      proposalId: proposal.id,
      failureCode: null,
    });
    expect(repository.findProposalByRun(ownerId, run.id)).toEqual(completed);
  });

  it('fails only the stale context-ready run and writes no proposal', () => {
    const { repository, run: staleRun, packet: stalePacket } = prepareContext();
    const { run: untouchedRun } = prepareContext(
      ownerId,
      '00000000-0000-4000-8000-000000000512',
    );
    mutateEventForOwner();

    expect(() =>
      repository.completeWithProposal(
        ownerId,
        staleRun.id,
        stalePacket.baseScheduleVersion,
        pendingProposal(staleRun.id, stalePacket.baseScheduleVersion),
      ),
    ).toThrow(DailyPlanBaseVersionStaleError);
    expect(repository.getRun(ownerId, staleRun.id)).toMatchObject({
      status: 'FAILED',
      proposalId: null,
      failureCode: 'DAILY_PLAN_BASE_VERSION_STALE',
    });
    expect(repository.getRun(ownerId, untouchedRun.id)).toMatchObject({
      status: 'CONTEXT_READY',
      proposalId: null,
      failureCode: null,
    });
    expect(repository.findProposalByRun(ownerId, staleRun.id)).toBeUndefined();
  });

  it('rejects wrong owners and invalid proposal or run states without partial proposals', () => {
    const { repository, run: wrongOwnerRun, packet: wrongOwnerPacket } = prepareContext();
    const { run: nonPendingRun, packet: nonPendingPacket } = prepareContext(
      ownerId,
      '00000000-0000-4000-8000-000000000513',
    );
    const { run: failedRun, packet: failedPacket } = prepareContext(
      ownerId,
      '00000000-0000-4000-8000-000000000514',
    );

    expect(() =>
      repository.completeWithProposal(
        otherOwnerId,
        wrongOwnerRun.id,
        wrongOwnerPacket.baseScheduleVersion,
        pendingProposal(wrongOwnerRun.id, wrongOwnerPacket.baseScheduleVersion),
      ),
    ).toThrow('DAILY_PLAN_RUN_STATE_CONFLICT');
    expect(repository.findProposalByRun(ownerId, wrongOwnerRun.id)).toBeUndefined();
    expect(repository.getRun(ownerId, wrongOwnerRun.id)?.status).toBe('CONTEXT_READY');

    expect(() =>
      repository.completeWithProposal(
        ownerId,
        nonPendingRun.id,
        nonPendingPacket.baseScheduleVersion,
        { ...pendingProposal(nonPendingRun.id, nonPendingPacket.baseScheduleVersion), status: 'APPLIED' },
      ),
    ).toThrow('DAILY_PLAN_PROPOSAL_NOT_REVIEWABLE');
    expect(repository.findProposalByRun(ownerId, nonPendingRun.id)).toBeUndefined();
    expect(repository.getRun(ownerId, nonPendingRun.id)?.status).toBe('CONTEXT_READY');

    expect(repository.failRun(ownerId, failedRun.id, 'DAILY_PLAN_PROVIDER_UNAVAILABLE')).toMatchObject({
      status: 'FAILED',
      failureCode: 'DAILY_PLAN_PROVIDER_UNAVAILABLE',
    });
    expect(() =>
      repository.completeWithProposal(
        ownerId,
        failedRun.id,
        failedPacket.baseScheduleVersion,
        pendingProposal(
          failedRun.id,
          failedPacket.baseScheduleVersion,
          '00000000-0000-4000-8000-000000000522',
        ),
      ),
    ).toThrow('DAILY_PLAN_RUN_STATE_CONFLICT');
    expect(repository.findProposalByRun(ownerId, failedRun.id)).toBeUndefined();
    expect(repository.getRun(ownerId, failedRun.id)?.status).toBe('FAILED');
  });
});
