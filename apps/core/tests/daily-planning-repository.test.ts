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
    items: DailyPlanProposal['items'] = [],
    updatedAt = timestamp,
  ): DailyPlanProposal {
    return {
      id,
      contractVersion: 'DAILY_PLAN_V1',
      runId,
      localDate,
      status: 'PENDING_REVIEW',
      baseScheduleVersion,
      summary: 'Prioritize the available study block.',
      items,
      version: 1,
      createdAt: timestamp,
      updatedAt,
    };
  }

  function createTimeRequest(
    id: string,
    owner = ownerId,
    targetDate = localDate,
    title = 'A request to schedule',
  ): void {
    createCalendarRepository(database).createTimeRequest({
      id,
      ownerId: owner,
      source: 'PROJECT_AGENT',
      title,
      targetDate,
      durationMinutes: 60,
      priority: 'HIGH',
      earliestStartLocalTime: '09:00',
      latestEndLocalTime: '18:00',
      isFixed: false,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  function scheduledItem(
    id: string,
    timeRequestId: string,
    ordinal = 1,
  ): DailyPlanProposal['items'][number] {
    return {
      id,
      ordinal,
      status: 'PENDING_REVIEW',
      operation: 'SCHEDULE_TIME_REQUEST',
      timeRequestId,
      timeRequestVersion: 1,
      startLocalTime: '10:00',
      endLocalTime: '11:00',
      reasonCode: null,
      rationale: 'The requested hour fits within the available window.',
    };
  }

  function unschedulableItem(
    id: string,
    timeRequestId: string,
    ordinal = 1,
  ): DailyPlanProposal['items'][number] {
    return {
      id,
      ordinal,
      status: 'PENDING_REVIEW',
      operation: 'MARK_TIME_REQUEST_UNSCHEDULABLE',
      timeRequestId,
      timeRequestVersion: 1,
      startLocalTime: null,
      endLocalTime: null,
      reasonCode: 'HARD_EVENT_CONFLICT',
      rationale: 'No available block remains after hard commitments.',
    };
  }

  function preparedSoftEvent(id: string, startLocalTime = '10:00', endLocalTime = '11:00') {
    return {
      id,
      kind: 'WORK_BLOCK' as const,
      startLocalTime,
      endLocalTime,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  function completeProposal(
    owner: string,
    runId: string,
    proposalId: string,
    items: DailyPlanProposal['items'],
    updatedAt = timestamp,
  ) {
    const { repository, run, packet } = prepareContext(owner, runId);
    expect(run.id).toBe(runId);
    return {
      repository,
      proposal: repository.completeWithProposal(
        owner,
        run.id,
        packet.baseScheduleVersion,
        pendingProposal(run.id, packet.baseScheduleVersion, proposalId, items, updatedAt),
      ),
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

  it('marks a prepared run as generating, completes it, and finds it by local date', () => {
    const { repository, run, packet } = prepareContext();

    expect(repository.markRunGenerating(ownerId, run.id)).toMatchObject({
      id: run.id,
      status: 'GENERATING',
      proposalId: null,
      failureCode: null,
    });
    expect(repository.findLatestRunForDate(ownerId, localDate)).toMatchObject({
      id: run.id,
      status: 'GENERATING',
    });

    const completed = repository.completeWithProposal(
      ownerId,
      run.id,
      packet.baseScheduleVersion,
      pendingProposal(run.id, packet.baseScheduleVersion),
    );

    expect(repository.findLatestRunForDate(ownerId, localDate)).toMatchObject({
      id: run.id,
      status: 'SUCCEEDED',
      proposalId: completed.id,
    });
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

  it('lists owner-scoped reviews in stable updated-at pages and hides them from other owners', () => {
    const firstProposalId = '00000000-0000-4000-8000-000000000541';
    const secondProposalId = '00000000-0000-4000-8000-000000000542';
    const { repository } = completeProposal(
      ownerId,
      '00000000-0000-4000-8000-000000000543',
      firstProposalId,
      [],
      '2026-08-18T07:00:00.000Z',
    );
    completeProposal(
      ownerId,
      '00000000-0000-4000-8000-000000000544',
      secondProposalId,
      [],
      '2026-08-18T08:00:00.000Z',
    );

    expect(repository.listProposals(ownerId, { localDate, page: 1, pageSize: 1 })).toEqual({
      items: [
        expect.objectContaining({
          proposal: expect.objectContaining({ id: secondProposalId }),
          decisions: [],
        }),
      ],
      pagination: { page: 1, pageSize: 1, total: 2, totalPages: 2 },
    });
    expect(repository.listProposals(ownerId, { localDate, page: 2, pageSize: 1 })).toEqual({
      items: [expect.objectContaining({ proposal: expect.objectContaining({ id: firstProposalId }) })],
      pagination: { page: 2, pageSize: 1, total: 2, totalPages: 2 },
    });
    expect(repository.getReview(otherOwnerId, firstProposalId)).toBeUndefined();
    expect(repository.getReviewExecutionContext(otherOwnerId, firstProposalId)).toBeUndefined();
    expect(repository.getReviewExecutionContext(ownerId, secondProposalId)).toEqual(
      expect.objectContaining({
        review: expect.objectContaining({ proposal: expect.objectContaining({ id: secondProposalId }) }),
        events: [],
        timeRequests: [],
      }),
    );
    expect(repository.getReview(ownerId, secondProposalId)).toEqual(
      expect.objectContaining({ proposal: expect.objectContaining({ id: secondProposalId }) }),
    );
  });

  it('commits a partial batch atomically without changing source task or action rows', () => {
    const firstRequestId = '00000000-0000-4000-8000-000000000551';
    const secondRequestId = '00000000-0000-4000-8000-000000000552';
    const firstItemId = '00000000-0000-4000-8000-000000000553';
    const secondItemId = '00000000-0000-4000-8000-000000000554';
    const proposalId = '00000000-0000-4000-8000-000000000555';
    createTimeRequest(firstRequestId);
    createTimeRequest(secondRequestId);
    const { repository } = completeProposal(
      ownerId,
      '00000000-0000-4000-8000-000000000556',
      proposalId,
      [scheduledItem(firstItemId, firstRequestId), scheduledItem(secondItemId, secondRequestId, 2)],
    );
    const unchanged = database
      .prepare('select (select count(*) from tasks) as tasks, (select count(*) from actions) as actions')
      .get();

    const review = repository.commitReviewDecisions(ownerId, proposalId, {
      expectedProposalVersion: 1,
      decisions: [
        {
          id: '00000000-0000-4000-8000-000000000557',
          input: { itemId: firstItemId, decision: 'APPLY' },
          scheduledEvent: preparedSoftEvent('00000000-0000-4000-8000-000000000558'),
        },
      ],
    });

    expect(review).toEqual({
      proposal: expect.objectContaining({ status: 'PARTIALLY_APPLIED', version: 2 }),
      decisions: [
        {
          itemId: firstItemId,
          decision: 'APPLY',
          scheduledEventId: '00000000-0000-4000-8000-000000000558',
          startLocalTime: '10:00',
          endLocalTime: '11:00',
          reason: null,
        },
      ],
    });
    expect(review.proposal.items).toEqual([
      expect.objectContaining({ id: firstItemId, status: 'APPLIED', startLocalTime: '10:00' }),
      expect.objectContaining({ id: secondItemId, status: 'PENDING_REVIEW' }),
    ]);
    expect(
      database
        .prepare('select id, is_hard, status, start_local_time, end_local_time from events where id = ?')
        .get('00000000-0000-4000-8000-000000000558'),
    ).toEqual({
      id: '00000000-0000-4000-8000-000000000558',
      is_hard: 0,
      status: 'CONFIRMED',
      start_local_time: '10:00',
      end_local_time: '11:00',
    });
    expect(
      database
        .prepare('select decision, scheduled_event_id from proposal_decisions where proposal_id = ?')
        .all(proposalId),
    ).toEqual([{ decision: 'APPLY', scheduled_event_id: '00000000-0000-4000-8000-000000000558' }]);
    expect(
      database
        .prepare('select (select count(*) from tasks) as tasks, (select count(*) from actions) as actions')
        .get(),
    ).toEqual(unchanged);
  });

  it('marks all-rejected proposals terminal without creating events', () => {
    const scheduledRequestId = '00000000-0000-4000-8000-000000000561';
    const unschedulableRequestId = '00000000-0000-4000-8000-000000000562';
    const scheduledItemId = '00000000-0000-4000-8000-000000000563';
    const unschedulableItemId = '00000000-0000-4000-8000-000000000564';
    const proposalId = '00000000-0000-4000-8000-000000000565';
    createTimeRequest(scheduledRequestId);
    createTimeRequest(unschedulableRequestId);
    const { repository } = completeProposal(
      ownerId,
      '00000000-0000-4000-8000-000000000566',
      proposalId,
      [
        scheduledItem(scheduledItemId, scheduledRequestId),
        unschedulableItem(unschedulableItemId, unschedulableRequestId, 2),
      ],
    );

    const review = repository.commitReviewDecisions(ownerId, proposalId, {
      expectedProposalVersion: 1,
      decisions: [
        {
          id: '00000000-0000-4000-8000-000000000567',
          input: { itemId: scheduledItemId, decision: 'REJECT', reason: 'Keep the existing plan.' },
        },
        {
          id: '00000000-0000-4000-8000-000000000568',
          input: { itemId: unschedulableItemId, decision: 'REJECT' },
        },
      ],
    });

    expect(review).toEqual({
      proposal: expect.objectContaining({ status: 'REJECTED', version: 2 }),
      decisions: [
        {
          itemId: scheduledItemId,
          decision: 'REJECT',
          scheduledEventId: null,
          startLocalTime: null,
          endLocalTime: null,
          reason: 'Keep the existing plan.',
        },
        {
          itemId: unschedulableItemId,
          decision: 'REJECT',
          scheduledEventId: null,
          startLocalTime: null,
          endLocalTime: null,
          reason: null,
        },
      ],
    });
    expect(database.prepare('select count(*) as count from events').get()).toEqual({ count: 0 });
  });

  it('returns a null scheduled Event ID for an applied unschedulable decision', () => {
    const requestId = '00000000-0000-4000-8000-000000000586';
    const itemId = '00000000-0000-4000-8000-000000000587';
    const proposalId = '00000000-0000-4000-8000-000000000588';
    createTimeRequest(requestId);
    const { repository } = completeProposal(
      ownerId,
      '00000000-0000-4000-8000-000000000589',
      proposalId,
      [unschedulableItem(itemId, requestId)],
    );

    const review = repository.commitReviewDecisions(ownerId, proposalId, {
      expectedProposalVersion: 1,
      decisions: [
        {
          id: '00000000-0000-4000-8000-000000000590',
          input: { itemId, decision: 'APPLY' },
        },
      ],
    });

    expect(review).toEqual({
      proposal: expect.objectContaining({ status: 'APPLIED', version: 2 }),
      decisions: [
        {
          itemId,
          decision: 'APPLY',
          scheduledEventId: null,
          startLocalTime: null,
          endLocalTime: null,
          reason: null,
        },
      ],
    });
    expect(database.prepare('select count(*) as count from events').get()).toEqual({ count: 0 });
  });

  it('marks a changed base schedule stale without persisting any decisions', () => {
    const requestId = '00000000-0000-4000-8000-000000000569';
    const itemId = '00000000-0000-4000-8000-000000000570';
    const proposalId = '00000000-0000-4000-8000-000000000581';
    createTimeRequest(requestId);
    const { repository } = completeProposal(
      ownerId,
      '00000000-0000-4000-8000-000000000582',
      proposalId,
      [scheduledItem(itemId, requestId)],
    );
    createCalendarRepository(database).createEvent({
      id: '00000000-0000-4000-8000-000000000583',
      ownerId,
      calendarRuleId: null,
      title: 'A change after proposal generation',
      kind: 'MEETING',
      localDate,
      startLocalTime: '15:00',
      endLocalTime: '16:00',
      isHard: true,
      status: 'CONFIRMED',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(() =>
      repository.commitReviewDecisions(ownerId, proposalId, {
        expectedProposalVersion: 1,
        decisions: [
          {
            id: '00000000-0000-4000-8000-000000000584',
            input: { itemId, decision: 'APPLY' },
            scheduledEvent: preparedSoftEvent('00000000-0000-4000-8000-000000000585'),
          },
        ],
      }),
    ).toThrow('DAILY_PLAN_BASE_VERSION_STALE');

    expect(repository.getReview(ownerId, proposalId)).toEqual({
      proposal: expect.objectContaining({ status: 'STALE', version: 2 }),
      decisions: [],
    });
    expect(
      database.prepare('select count(*) as count from events where id = ?').get('00000000-0000-4000-8000-000000000585'),
    ).toEqual({ count: 0 });
  });

  it('rolls back every decision and event when one prepared event cannot persist', () => {
    const firstRequestId = '00000000-0000-4000-8000-000000000571';
    const secondRequestId = '00000000-0000-4000-8000-000000000572';
    const firstItemId = '00000000-0000-4000-8000-000000000573';
    const secondItemId = '00000000-0000-4000-8000-000000000574';
    const proposalId = '00000000-0000-4000-8000-000000000575';
    const conflictingEventId = '00000000-0000-4000-8000-000000000576';
    createTimeRequest(firstRequestId);
    createTimeRequest(secondRequestId);
    createCalendarRepository(database).createEvent({
      id: conflictingEventId,
      ownerId,
      calendarRuleId: null,
      title: 'Already occupied identity',
      kind: 'MEETING',
      localDate,
      startLocalTime: '16:00',
      endLocalTime: '17:00',
      isHard: false,
      status: 'CONFIRMED',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const { repository } = completeProposal(
      ownerId,
      '00000000-0000-4000-8000-000000000577',
      proposalId,
      [scheduledItem(firstItemId, firstRequestId), scheduledItem(secondItemId, secondRequestId, 2)],
    );

    expect(() =>
      repository.commitReviewDecisions(ownerId, proposalId, {
        expectedProposalVersion: 1,
        decisions: [
          {
            id: '00000000-0000-4000-8000-000000000578',
            input: { itemId: firstItemId, decision: 'APPLY' },
            scheduledEvent: preparedSoftEvent('00000000-0000-4000-8000-000000000579'),
          },
          {
            id: '00000000-0000-4000-8000-000000000580',
            input: { itemId: secondItemId, decision: 'APPLY' },
            scheduledEvent: preparedSoftEvent(conflictingEventId),
          },
        ],
      }),
    ).toThrow();

    expect(database.prepare('select count(*) as count from proposal_decisions').get()).toEqual({ count: 0 });
    expect(
      database.prepare('select count(*) as count from events where id = ?').get('00000000-0000-4000-8000-000000000579'),
    ).toEqual({ count: 0 });
    expect(repository.getReview(ownerId, proposalId)).toEqual({
      proposal: expect.objectContaining({ status: 'PENDING_REVIEW', version: 1 }),
      decisions: [],
    });
  });
});
