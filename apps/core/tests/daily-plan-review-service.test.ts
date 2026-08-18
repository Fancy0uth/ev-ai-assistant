import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  DailyPlanProposal,
  EventKind,
  LocalTime,
  TimeRequest,
  TimeRequestSource,
} from '@ev/contracts';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { createDailyPlanningContextService } from '../src/modules/daily-planning/context-service';
import {
  createDailyPlanReviewService,
  DailyPlanProposalNotFoundError,
  DailyPlanProposalVersionConflictError,
  type DailyPlanReviewService,
} from '../src/modules/daily-planning/review-service';
import {
  createDailyPlanRunRepository,
  DailyPlanReviewBaseVersionStaleError,
  type DailyPlanRunRepository,
} from '../src/modules/daily-planning/repository';
import { DailyPlanValidationError } from '../src/modules/daily-planning/validator';
import { createTaskRepository, type TaskRepository } from '../src/modules/tasks/repository';
import { openDatabase } from '../src/storage/database';

const ownerId = '00000000-0000-4000-8000-000000000701';
const otherOwnerId = '00000000-0000-4000-8000-000000000702';
const localDate = '2026-08-18';
const timestamp = '2026-08-18T07:00:00.000Z';

type ScheduledItem = Extract<DailyPlanProposal['items'][number], {
  operation: 'SCHEDULE_TIME_REQUEST';
}>;
type UnschedulableItem = Extract<DailyPlanProposal['items'][number], {
  operation: 'MARK_TIME_REQUEST_UNSCHEDULABLE';
}>;

describe('daily plan review service', () => {
  let database: Database.Database;
  let repository: DailyPlanRunRepository;
  let taskRepository: TaskRepository;
  let service: DailyPlanReviewService;
  let idSequence: number;

  beforeEach(() => {
    database = openDatabase(':memory:');
    database
      .prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
      .run(ownerId, 'daily-plan-review-owner', 'not-used', timestamp);
    idSequence = 800;
    repository = createDailyPlanRunRepository(database);
    taskRepository = createTaskRepository(database);
    service = createDailyPlanReviewService({
      repository,
      newId: nextId,
      now: () => new Date(timestamp),
    });
  });

  afterEach(() => {
    database.close();
  });

  function nextId(): string {
    idSequence += 1;
    return `00000000-0000-4000-8000-${String(idSequence).padStart(12, '0')}`;
  }

  function calendar() {
    return createCalendarRepository(database);
  }

  function createTimeRequest(
    options: Partial<{
      id: string;
      source: TimeRequestSource;
      title: string;
      durationMinutes: number;
      earliestStartLocalTime: LocalTime | null;
      latestEndLocalTime: LocalTime | null;
      version: number;
    }> = {},
  ): TimeRequest {
    return calendar().createTimeRequest({
      id: options.id ?? nextId(),
      ownerId,
      source: options.source ?? 'PROJECT_AGENT',
      title: options.title ?? 'Local time request title',
      targetDate: localDate,
      durationMinutes: options.durationMinutes ?? 60,
      priority: 'HIGH',
      earliestStartLocalTime:
        options.earliestStartLocalTime === undefined ? '09:00' : options.earliestStartLocalTime,
      latestEndLocalTime:
        options.latestEndLocalTime === undefined ? '18:00' : options.latestEndLocalTime,
      isFixed: false,
      version: options.version ?? 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  function scheduledItem(
    request: TimeRequest,
    options: Partial<{
      id: string;
      ordinal: number;
      startLocalTime: LocalTime;
      endLocalTime: LocalTime;
      timeRequestVersion: number;
    }> = {},
  ): ScheduledItem {
    return {
      id: options.id ?? nextId(),
      ordinal: options.ordinal ?? 1,
      status: 'PENDING_REVIEW',
      operation: 'SCHEDULE_TIME_REQUEST',
      timeRequestId: request.id,
      timeRequestVersion: options.timeRequestVersion ?? request.version,
      startLocalTime: options.startLocalTime ?? '10:00',
      endLocalTime: options.endLocalTime ?? '11:00',
      reasonCode: null,
      rationale: 'The requested time fits the available schedule.',
    };
  }

  function unschedulableItem(
    request: TimeRequest,
    options: Partial<{ id: string; ordinal: number }> = {},
  ): UnschedulableItem {
    return {
      id: options.id ?? nextId(),
      ordinal: options.ordinal ?? 1,
      status: 'PENDING_REVIEW',
      operation: 'MARK_TIME_REQUEST_UNSCHEDULABLE',
      timeRequestId: request.id,
      timeRequestVersion: request.version,
      startLocalTime: null,
      endLocalTime: null,
      reasonCode: 'HARD_EVENT_CONFLICT',
      rationale: 'No available time remains after fixed commitments.',
    };
  }

  function createProposal(items: DailyPlanProposal['items']): DailyPlanProposal {
    const contextService = createDailyPlanningContextService(repository, { newId: nextId });
    const { run, packet } = contextService.prepare(ownerId, localDate, 'MANUAL', new Date(timestamp));

    return repository.completeWithProposal(ownerId, run.id, packet.baseScheduleVersion, {
      id: nextId(),
      contractVersion: 'DAILY_PLAN_V1',
      runId: run.id,
      localDate,
      status: 'PENDING_REVIEW',
      baseScheduleVersion: packet.baseScheduleVersion,
      summary: 'Review the suggested daily plan.',
      items,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  function createConfirmedEvent(
    startLocalTime: LocalTime,
    endLocalTime: LocalTime,
    isHard: boolean,
  ): void {
    calendar().createEvent({
      id: nextId(),
      ownerId,
      calendarRuleId: null,
      title: isHard ? 'Existing hard event' : 'Existing soft event',
      kind: isHard ? 'MEETING' : 'PERSONAL',
      localDate,
      startLocalTime,
      endLocalTime,
      isHard,
      status: 'CONFIRMED',
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  function decisionCount(): number {
    return (database.prepare('select count(*) as count from proposal_decisions').get() as { count: number })
      .count;
  }

  function softEvents() {
    return calendar()
      .listEventsForDate(ownerId, localDate)
      .filter((event) => !event.isHard);
  }

  it('applies an unedited scheduled item as a soft event without changing its source Task', () => {
    const sourceTaskId = nextId();
    taskRepository.create({
      id: sourceTaskId,
      ownerId,
      title: 'Source task remains open',
      area: 'WORK',
      priority: 'HIGH',
      status: 'OPEN',
      targetDate: localDate,
      completedAt: null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const request = createTimeRequest({ title: 'Prepare the local project brief' });
    const item = scheduledItem(request);
    const proposal = createProposal([item]);

    const review = service.submitDecisions(ownerId, proposal.id, {
      expectedProposalVersion: 1,
      decisions: [{ itemId: item.id, decision: 'APPLY' }],
    });

    expect(review.proposal).toMatchObject({ status: 'APPLIED', version: 2 });
    expect(review.proposal.items).toEqual([
      expect.objectContaining({
        id: item.id,
        status: 'APPLIED',
        startLocalTime: '10:00',
        endLocalTime: '11:00',
      }),
    ]);
    expect(softEvents()).toEqual([
      expect.objectContaining({
        title: 'Prepare the local project brief',
        kind: 'WORK_BLOCK',
        startLocalTime: '10:00',
        endLocalTime: '11:00',
        isHard: false,
        status: 'CONFIRMED',
      }),
    ]);
    expect(taskRepository.findById(ownerId, sourceTaskId)?.status).toBe('OPEN');
  });

  it('applies an edited scheduled placement with the original TimeRequest duration', () => {
    const request = createTimeRequest();
    const item = scheduledItem(request);
    const proposal = createProposal([item]);

    const review = service.submitDecisions(ownerId, proposal.id, {
      expectedProposalVersion: 1,
      decisions: [
        { itemId: item.id, decision: 'APPLY', startLocalTime: '13:00', endLocalTime: '14:00' },
      ],
    });

    expect(review.proposal.items[0]).toMatchObject({
      id: item.id,
      status: 'APPLIED',
      startLocalTime: '13:00',
      endLocalTime: '14:00',
    });
    expect(softEvents()[0]).toMatchObject({ startLocalTime: '13:00', endLocalTime: '14:00' });
  });

  it('supports a second partial application against the schedule version written by the first', () => {
    const firstRequest = createTimeRequest();
    const secondRequest = createTimeRequest();
    const firstItem = scheduledItem(firstRequest, { ordinal: 1 });
    const secondItem = scheduledItem(secondRequest, {
      ordinal: 2,
      startLocalTime: '12:00',
      endLocalTime: '13:00',
    });
    const proposal = createProposal([firstItem, secondItem]);

    const firstReview = service.submitDecisions(ownerId, proposal.id, {
      expectedProposalVersion: 1,
      decisions: [{ itemId: firstItem.id, decision: 'APPLY' }],
    });
    const secondReview = service.submitDecisions(ownerId, proposal.id, {
      expectedProposalVersion: 2,
      decisions: [{ itemId: secondItem.id, decision: 'APPLY' }],
    });

    expect(firstReview.proposal).toMatchObject({ status: 'PARTIALLY_APPLIED', version: 2 });
    expect(secondReview.proposal).toMatchObject({ status: 'APPLIED', version: 3 });
    expect(secondReview.proposal.items).toEqual([
      expect.objectContaining({ id: firstItem.id, status: 'APPLIED' }),
      expect.objectContaining({ id: secondItem.id, status: 'APPLIED' }),
    ]);
    expect(softEvents()).toHaveLength(2);
  });

  it('records all rejections without creating a soft event', () => {
    const scheduledRequest = createTimeRequest();
    const unschedulableRequest = createTimeRequest();
    const scheduled = scheduledItem(scheduledRequest, { ordinal: 1 });
    const unschedulable = unschedulableItem(unschedulableRequest, { ordinal: 2 });
    const proposal = createProposal([scheduled, unschedulable]);

    const review = service.submitDecisions(ownerId, proposal.id, {
      expectedProposalVersion: 1,
      decisions: [
        { itemId: scheduled.id, decision: 'REJECT', reason: 'Keep the existing schedule.' },
        { itemId: unschedulable.id, decision: 'REJECT' },
      ],
    });

    expect(review.proposal).toMatchObject({ status: 'REJECTED', version: 2 });
    expect(softEvents()).toEqual([]);
    expect(decisionCount()).toBe(2);
  });

  it('accepts an unschedulable item without creating a soft event', () => {
    const request = createTimeRequest();
    const item = unschedulableItem(request);
    const proposal = createProposal([item]);

    const review = service.submitDecisions(ownerId, proposal.id, {
      expectedProposalVersion: 1,
      decisions: [{ itemId: item.id, decision: 'APPLY' }],
    });

    expect(review.proposal.items[0]).toMatchObject({ id: item.id, status: 'APPLIED' });
    expect(softEvents()).toEqual([]);
    expect(decisionCount()).toBe(1);
  });

  it('returns the current review for an expected proposal version conflict without another write', () => {
    const request = createTimeRequest();
    const item = scheduledItem(request);
    const proposal = createProposal([item]);
    service.submitDecisions(ownerId, proposal.id, {
      expectedProposalVersion: 1,
      decisions: [{ itemId: item.id, decision: 'APPLY' }],
    });

    expect(() =>
      service.submitDecisions(ownerId, proposal.id, {
        expectedProposalVersion: 1,
        decisions: [{ itemId: item.id, decision: 'APPLY' }],
      }),
    ).toThrow(DailyPlanProposalVersionConflictError);
    expect(repository.getReview(ownerId, proposal.id)).toMatchObject({
      proposal: expect.objectContaining({ version: 2, status: 'APPLIED' }),
    });
    expect(softEvents()).toHaveLength(1);
    expect(decisionCount()).toBe(1);
  });

  it('marks a proposal stale after schedule-version drift without persisting the selected decision', () => {
    const request = createTimeRequest();
    const item = scheduledItem(request);
    const proposal = createProposal([item]);
    createConfirmedEvent('15:00', '16:00', true);

    expect(() =>
      service.submitDecisions(ownerId, proposal.id, {
        expectedProposalVersion: 1,
        decisions: [{ itemId: item.id, decision: 'APPLY' }],
      }),
    ).toThrow(DailyPlanReviewBaseVersionStaleError);
    expect(repository.getReview(ownerId, proposal.id)).toMatchObject({
      proposal: expect.objectContaining({ status: 'STALE', version: 2 }),
      decisions: [],
    });
    expect(softEvents()).toEqual([]);
    expect(decisionCount()).toBe(0);
  });

  it('returns a version conflict when the referenced TimeRequest version drifts', () => {
    const request = createTimeRequest();
    const item = scheduledItem(request);
    const proposal = createProposal([item]);
    database.prepare('update time_requests set version = version + 1 where id = ?').run(request.id);

    expect(() =>
      service.submitDecisions(ownerId, proposal.id, {
        expectedProposalVersion: 1,
        decisions: [{ itemId: item.id, decision: 'APPLY' }],
      }),
    ).toThrow(DailyPlanProposalVersionConflictError);
    expect(repository.getReview(ownerId, proposal.id)).toMatchObject({
      proposal: expect.objectContaining({ status: 'PENDING_REVIEW', version: 1 }),
      decisions: [],
    });
    expect(softEvents()).toEqual([]);
    expect(decisionCount()).toBe(0);
  });

  it('rejects a hard Event collision without creating any decision or soft event', () => {
    const request = createTimeRequest();
    createConfirmedEvent('10:00', '11:00', true);
    const item = scheduledItem(request);
    const proposal = createProposal([item]);

    expect(() =>
      service.submitDecisions(ownerId, proposal.id, {
        expectedProposalVersion: 1,
        decisions: [{ itemId: item.id, decision: 'APPLY' }],
      }),
    ).toThrow(DailyPlanValidationError);
    expect(repository.getReview(ownerId, proposal.id)).toMatchObject({
      proposal: expect.objectContaining({ status: 'PENDING_REVIEW', version: 1 }),
      decisions: [],
    });
    expect(softEvents()).toEqual([]);
    expect(decisionCount()).toBe(0);
  });

  it('rejects a soft Event collision without creating any decision or soft event', () => {
    const request = createTimeRequest();
    createConfirmedEvent('10:00', '11:00', false);
    const item = scheduledItem(request);
    const proposal = createProposal([item]);

    expect(() =>
      service.submitDecisions(ownerId, proposal.id, {
        expectedProposalVersion: 1,
        decisions: [{ itemId: item.id, decision: 'APPLY' }],
      }),
    ).toThrow(DailyPlanValidationError);
    expect(repository.getReview(ownerId, proposal.id)).toMatchObject({
      proposal: expect.objectContaining({ status: 'PENDING_REVIEW', version: 1 }),
      decisions: [],
    });
    expect(decisionCount()).toBe(0);
  });

  it('rejects batch-internal placement collisions without a partial write', () => {
    const firstRequest = createTimeRequest();
    const secondRequest = createTimeRequest();
    const firstItem = scheduledItem(firstRequest, { ordinal: 1 });
    const secondItem = scheduledItem(secondRequest, {
      ordinal: 2,
      startLocalTime: '10:30',
      endLocalTime: '11:30',
    });
    const proposal = createProposal([firstItem, secondItem]);

    expect(() =>
      service.submitDecisions(ownerId, proposal.id, {
        expectedProposalVersion: 1,
        decisions: [
          { itemId: firstItem.id, decision: 'APPLY' },
          { itemId: secondItem.id, decision: 'APPLY' },
        ],
      }),
    ).toThrow(DailyPlanValidationError);
    expect(repository.getReview(ownerId, proposal.id)).toMatchObject({
      proposal: expect.objectContaining({ status: 'PENDING_REVIEW', version: 1 }),
      decisions: [],
    });
    expect(softEvents()).toEqual([]);
    expect(decisionCount()).toBe(0);
  });

  it.each([
    { label: 'outside the daily window', startLocalTime: '04:00', endLocalTime: '05:00' },
    { label: 'with a changed duration', startLocalTime: '13:00', endLocalTime: '13:30' },
    { label: 'outside the request availability window', startLocalTime: '08:00', endLocalTime: '09:00' },
  ])('rejects an edited placement $label without a write', ({ startLocalTime, endLocalTime }) => {
    const request = createTimeRequest({
      earliestStartLocalTime: startLocalTime === '04:00' ? null : '09:00',
      latestEndLocalTime: startLocalTime === '04:00' ? null : '18:00',
    });
    const item = scheduledItem(request);
    const proposal = createProposal([item]);

    expect(() =>
      service.submitDecisions(ownerId, proposal.id, {
        expectedProposalVersion: 1,
        decisions: [
          {
            itemId: item.id,
            decision: 'APPLY',
            startLocalTime: startLocalTime as LocalTime,
            endLocalTime: endLocalTime as LocalTime,
          },
        ],
      }),
    ).toThrow(DailyPlanValidationError);
    expect(softEvents()).toEqual([]);
    expect(decisionCount()).toBe(0);
  });

  it('rejects duplicate TimeRequest references in the submitted batch without a partial write', () => {
    const request = createTimeRequest();
    const firstItem = scheduledItem(request, { ordinal: 1 });
    const secondItem = scheduledItem(request, {
      ordinal: 2,
      startLocalTime: '12:00',
      endLocalTime: '13:00',
    });
    const proposal = createProposal([firstItem, secondItem]);

    expect(() =>
      service.submitDecisions(ownerId, proposal.id, {
        expectedProposalVersion: 1,
        decisions: [
          { itemId: firstItem.id, decision: 'APPLY' },
          { itemId: secondItem.id, decision: 'APPLY' },
        ],
      }),
    ).toThrow(DailyPlanValidationError);
    expect(softEvents()).toEqual([]);
    expect(decisionCount()).toBe(0);
  });

  it('rejects a submitted batch whose planned duration exceeds 960 minutes without a write', () => {
    const time = (hour: number): LocalTime => `${String(hour).padStart(2, '0')}:00` as LocalTime;
    const items = Array.from({ length: 17 }, (_, index) => {
      const request = createTimeRequest({
        earliestStartLocalTime: null,
        latestEndLocalTime: null,
      });
      return scheduledItem(request, {
        ordinal: index + 1,
        startLocalTime: time(5 + index),
        endLocalTime: time(6 + index),
      });
    });
    const proposal = createProposal(items);

    expect(() =>
      service.submitDecisions(ownerId, proposal.id, {
        expectedProposalVersion: 1,
        decisions: items.map((item) => ({ itemId: item.id, decision: 'APPLY' as const })),
      }),
    ).toThrow(DailyPlanValidationError);
    expect(softEvents()).toEqual([]);
    expect(decisionCount()).toBe(0);
  });

  it('rejects a time override for an unschedulable item without recording a decision', () => {
    const request = createTimeRequest();
    const item = unschedulableItem(request);
    const proposal = createProposal([item]);

    expect(() =>
      service.submitDecisions(
        ownerId,
        proposal.id,
        {
          expectedProposalVersion: 1,
          decisions: [
            {
              itemId: item.id,
              decision: 'APPLY',
              startLocalTime: '13:00',
              endLocalTime: '14:00',
            },
          ],
        } as never,
      ),
    ).toThrow(DailyPlanValidationError);
    expect(softEvents()).toEqual([]);
    expect(decisionCount()).toBe(0);
  });

  it('returns typed not-found results for another Owner and keeps owner-scoped lists empty', () => {
    const request = createTimeRequest();
    const proposal = createProposal([scheduledItem(request)]);

    expect(() => service.getReview(otherOwnerId, proposal.id)).toThrow(DailyPlanProposalNotFoundError);
    expect(service.listProposals(otherOwnerId, { page: 1, pageSize: 20 })).toEqual({
      items: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    expect(service.getReview(ownerId, proposal.id).proposal.id).toBe(proposal.id);
  });

  it.each([
    ['PROJECT_AGENT', 'WORK_BLOCK'],
    ['LEARNING_AGENT', 'STUDY'],
    ['FITNESS_AGENT', 'WORKOUT'],
    ['NUTRITION_AGENT', 'PERSONAL'],
    ['SCHEDULE_COORDINATOR', 'PERSONAL'],
  ] as const)('maps %s TimeRequests to %s Events', (source, kind) => {
    const request = createTimeRequest({ source });
    const item = scheduledItem(request);
    const proposal = createProposal([item]);

    service.submitDecisions(ownerId, proposal.id, {
      expectedProposalVersion: 1,
      decisions: [{ itemId: item.id, decision: 'APPLY' }],
    });

    expect(softEvents()[0]?.kind).toBe(kind satisfies EventKind);
  });
});
