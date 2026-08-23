import { describe, expect, it, vi } from 'vitest';
import {
  createDailyPlanAutomationService,
  type DailyPlanAutomationGenerationPort,
} from '../src/modules/daily-planning/automation-service';

const ownerId = '00000000-0000-4000-8000-000000000801';

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

function createService(options: {
  now: () => Date;
  credentialState?: 'CONFIGURED' | 'NOT_CONFIGURED';
  existingRun?: { status: string };
  generate?: DailyPlanAutomationGenerationPort['generateDailyPlan'];
  findOwnerId?: () => string | undefined;
  onEvent?: (event: { event: string; trigger: string; failureCode?: string }) => void;
}) {
  const timers: Array<{ delay: number; callback: () => void }> = [];
  const generated: Array<{ ownerId: string; localDate: string; trigger: string }> = [];
  const generate = options.generate ?? vi.fn(async (input) => {
    generated.push(input);
    return {};
  });
  const service = createDailyPlanAutomationService({
    dailyPlanningService: { generateDailyPlan: generate },
    dailyPlanRunRepository: {
      findLatestRunForDate: () => options.existingRun,
    },
    providerCredentialService: {
      getMetadata: () => ({ state: options.credentialState ?? 'CONFIGURED' }),
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
  return { service, timers, generated, generate };
}

describe('daily plan automation service', () => {
  it('starts one first-visit recovery run only after 07:00 Shanghai time', async () => {
    let current = new Date('2026-08-17T22:59:00.000Z');
    const generated = deferred<unknown>();
    const generatedInputs: Array<{ ownerId: string; localDate: string; trigger: string }> = [];
    const harness = createService({
      now: () => current,
      generate: async (input) => {
        generatedInputs.push(input);
        return generated.promise;
      },
    });

    expect(harness.service.ensureForFirstVisit(ownerId, '2026-08-18')).toBe('NOT_DUE');
    expect(generatedInputs).toEqual([]);

    current = new Date('2026-08-17T23:00:00.000Z');
    expect(harness.service.ensureForFirstVisit(ownerId, '2026-08-18')).toBe('STARTED');
    expect(harness.service.ensureForFirstVisit(ownerId, '2026-08-18')).toBe('IN_FLIGHT');
    expect(generatedInputs).toEqual([
      {
        ownerId,
        localDate: '2026-08-18',
        trigger: 'FIRST_VISIT_RECOVERY',
      },
    ]);
    expect(harness.service.isGenerating(ownerId, '2026-08-18')).toBe(true);

    generated.resolve({});
    await generated.promise;
    await vi.waitFor(() => {
      expect(harness.service.isGenerating(ownerId, '2026-08-18')).toBe(false);
    });
  });

  it('uses one exact next-07:00 timer and skips unconfigured or already-run dates', () => {
    const beforeSeven = createService({
      now: () => new Date('2026-08-17T22:59:00.000Z'),
      credentialState: 'NOT_CONFIGURED',
    });
    beforeSeven.service.scheduleNextRun();
    expect(beforeSeven.timers).toHaveLength(1);
    expect(beforeSeven.timers[0]!.delay).toBe(60_000);

    expect(beforeSeven.service.runScheduled()).toBe('NOT_DUE');
    expect(beforeSeven.generated).toEqual([]);

    const unconfiguredAfterSeven = createService({
      now: () => new Date('2026-08-17T23:05:00.000Z'),
      credentialState: 'NOT_CONFIGURED',
    });
    expect(unconfiguredAfterSeven.service.runScheduled()).toBe('NOT_CONFIGURED');
    expect(unconfiguredAfterSeven.generated).toEqual([]);

    const existing = createService({
      now: () => new Date('2026-08-17T23:05:00.000Z'),
      existingRun: { status: 'SUCCEEDED' },
    });
    expect(existing.service.runScheduled()).toBe('EXISTING_RUN');
    expect(existing.generated).toEqual([]);

    const scheduled = createService({
      now: () => new Date('2026-08-17T23:05:00.000Z'),
    });
    expect(scheduled.service.runScheduled()).toBe('STARTED');
    expect(scheduled.generated).toEqual([
      { ownerId, localDate: '2026-08-18', trigger: 'SCHEDULED_0700' },
    ]);
  });

  it('emits only a classified failure code, never an arbitrary provider error message', async () => {
    const events: Array<{ event: string; trigger: string; failureCode?: string }> = [];
    const harness = createService({
      now: () => new Date('2026-08-17T23:05:00.000Z'),
      generate: async () => {
        throw new Error('provider response included test-secret-value');
      },
      onEvent: (event) => events.push(event),
    });

    expect(harness.service.runScheduled()).toBe('STARTED');
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        event: 'daily_plan_automation_failed',
        trigger: 'SCHEDULED_0700',
        failureCode: 'DAILY_PLAN_PROVIDER_UNAVAILABLE',
      });
    });
    expect(JSON.stringify(events)).not.toContain('test-secret-value');
  });
});
