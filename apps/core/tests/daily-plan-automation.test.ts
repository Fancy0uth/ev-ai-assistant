import type { DailyPlanPreflight } from '@ev/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createDailyPlanAutomationService } from '../src/modules/daily-planning/automation-service';

const ownerId = '00000000-0000-4000-8000-000000000801';

function createService(options: {
  now: () => Date;
  existingRun?: { status: string };
  findOwnerId?: () => string | undefined;
  prepareError?: Error;
  onEvent?: (event: { event: string; trigger: string; failureCode?: string }) => void;
}) {
  const timers: Array<{ delay: number; callback: () => void }> = [];
  const prepared: Array<{ ownerId: string; localDate: string; trigger: string }> = [];
  let latestRun = options.existingRun;
  const prepare = vi.fn((nextOwnerId: string, localDate: string, trigger: string): DailyPlanPreflight => {
    prepared.push({ ownerId: nextOwnerId, localDate, trigger });
    if (options.prepareError) throw options.prepareError;
    latestRun = { status: 'CONTEXT_READY' };
    return {
      id: '00000000-0000-4000-8000-000000000802',
      runId: '00000000-0000-4000-8000-000000000803',
      contractVersion: 'DAILY_PLAN_PREFLIGHT_V1',
      localDate,
      status: 'AWAITING_APPROVAL',
      baseScheduleVersion: 1,
      items: [],
      version: 1,
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
      approvedAt: null,
      claimedAt: null,
      consumedAt: null,
    };
  });
  const service = createDailyPlanAutomationService({
    dailyPlanPreflightService: { prepare },
    dailyPlanRunRepository: {
      findLatestRunForDate: () => latestRun,
    },
    findOwnerId: options.findOwnerId ?? (() => ownerId),
    now: options.now,
    schedule: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    cancel: () => undefined,
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
  });
  return { service, timers, prepared, prepare };
}

describe('daily plan automation service', () => {
  it('prepares once after 07:00 for first visit and lets every later trigger observe the existing run', () => {
    let current = new Date('2026-08-17T22:59:00.000Z');
    const harness = createService({ now: () => current });

    expect(harness.service.ensureForFirstVisit(ownerId, '2026-08-18')).toBe('NOT_DUE');
    expect(harness.prepared).toEqual([]);

    current = new Date('2026-08-17T23:00:00.000Z');
    expect(harness.service.ensureForFirstVisit(ownerId, '2026-08-18')).toBe(
      'AWAITING_CONTEXT_APPROVAL',
    );
    expect(harness.service.ensureForFirstVisit(ownerId, '2026-08-18')).toBe('EXISTING_RUN');
    expect(harness.service.runScheduled()).toBe('EXISTING_RUN');
    expect(harness.prepared).toEqual([
      {
        ownerId,
        localDate: '2026-08-18',
        trigger: 'FIRST_VISIT_RECOVERY',
      },
    ]);
  });

  it('uses scheduled preparation first when it wins the same-day race', () => {
    const harness = createService({ now: () => new Date('2026-08-17T23:05:00.000Z') });

    expect(harness.service.runScheduled()).toBe('AWAITING_CONTEXT_APPROVAL');
    expect(harness.service.ensureForFirstVisit(ownerId, '2026-08-18')).toBe('EXISTING_RUN');
    expect(harness.prepared).toEqual([
      {
        ownerId,
        localDate: '2026-08-18',
        trigger: 'SCHEDULED_0700',
      },
    ]);
  });

  it('does no preparation before 07:00, for another date, without an owner, or after a run exists', () => {
    const beforeSeven = createService({ now: () => new Date('2026-08-17T22:59:00.000Z') });
    beforeSeven.service.scheduleNextRun();
    expect(beforeSeven.timers).toHaveLength(1);
    expect(beforeSeven.timers[0]?.delay).toBe(60_000);
    expect(beforeSeven.service.runScheduled()).toBe('NOT_DUE');
    expect(beforeSeven.service.ensureForFirstVisit(ownerId, '2026-08-19')).toBe('NOT_DUE');
    expect(beforeSeven.prepared).toEqual([]);

    const noOwner = createService({
      now: () => new Date('2026-08-17T23:05:00.000Z'),
      findOwnerId: () => undefined,
    });
    expect(noOwner.service.runScheduled()).toBe('NOT_DUE');
    expect(noOwner.prepared).toEqual([]);

    const existing = createService({
      now: () => new Date('2026-08-17T23:05:00.000Z'),
      existingRun: { status: 'CONTEXT_READY' },
    });
    expect(existing.service.runScheduled()).toBe('EXISTING_RUN');
    expect(existing.prepared).toEqual([]);
  });

  it('reports only the allowlisted preparation failure and schedules the following run', () => {
    const events: Array<{ event: string; trigger: string; failureCode?: string }> = [];
    const harness = createService({
      now: () => new Date('2026-08-17T23:05:00.000Z'),
      prepareError: new Error('provider response included test-secret-value'),
      onEvent: (event) => events.push(event),
    });

    harness.service.scheduleNextRun();
    expect(harness.service.runScheduled()).toBe('PREPARATION_FAILED');
    expect(events).toEqual([
      {
        event: 'daily_plan_automation_failed',
        trigger: 'SCHEDULED_0700',
        failureCode: 'DAILY_PLAN_CONTEXT_INVALID',
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('test-secret-value');

    harness.timers[0]?.callback();
    expect(harness.timers).toHaveLength(2);
  });
});
