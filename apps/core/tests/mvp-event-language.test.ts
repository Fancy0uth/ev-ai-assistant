import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { createEventLanguageService } from '../src/modules/calendar/event-language';
import { createCalendarService } from '../src/modules/calendar/service';
import { createProposalRepository } from '../src/modules/proposals/repository';
import { createProposalService } from '../src/modules/proposals/service';
import type { DeepSeekJsonOptions } from '../src/modules/providers/deepseek-json';
import { createProviderCredentialService } from '../src/modules/providers/credential-service';
import type { SecretStorePort } from '../src/modules/providers/secret-store';
import { openDatabase } from '../src/storage/database';

class FakeSecretStore implements SecretStorePort {
  private readonly values = new Map<string, string>();
  unprotectCalls = 0;

  async protect(plaintext: string): Promise<string> {
    const protectedValue = `event-language-${this.values.size + 1}`;
    this.values.set(protectedValue, plaintext);
    return protectedValue;
  }

  async unprotect(protectedValue: string): Promise<string> {
    this.unprotectCalls += 1;
    const value = this.values.get(protectedValue);
    if (value === undefined) throw new Error('test credential is missing');
    return value;
  }
}

describe('MVP natural-language event proposal', () => {
  it('blocks unconfirmed or unconfigured parsing, surfaces an editable conflict candidate, and writes only through the existing proposal decision', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ev-mvp-event-language-'));
    const database = openDatabase(join(directory, 'app.sqlite'));
    const ownerId = '00000000-0000-4000-8000-000000000401';
    const now = new Date('2026-09-20T00:00:00.000Z');
    const secrets = new FakeSecretStore();
    const requestJson = vi.fn(async (options: DeepSeekJsonOptions): Promise<unknown> => {
      expect(options.apiKey).toBe('test-event-language-key');
      expect(options.timeoutMs).toBe(8_000);
      expect(options.maxInputBytes).toBe(16_000);
      expect(options.input).toEqual({
        schemaVersion: 'EVENT_LANGUAGE_PARSE_V1',
        statement: '周三下午两点和导师开会',
        reference: { localDate: '2026-09-20', timezone: 'Asia/Shanghai' },
      });
      return {
        schemaVersion: 'EVENT_LANGUAGE_PARSE_V1',
        candidate: {
          title: '与导师开会',
          kind: 'MEETING',
          localDate: '2026-09-23',
          startLocalTime: '14:00',
          endLocalTime: '15:00',
          isHard: null,
        },
      };
    });

    try {
      database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run(ownerId, 'event-language-owner', 'not-used', now.toISOString());
      const calendarRepository = createCalendarRepository(database);
      calendarRepository.createEvent({
        id: '00000000-0000-4000-8000-000000000402',
        ownerId,
        calendarRuleId: null,
        courseId: null,
        title: '固定课程',
        kind: 'COURSE',
        localDate: '2026-09-23',
        startLocalTime: '13:30',
        endLocalTime: '15:10',
        isHard: true,
        status: 'CONFIRMED',
        version: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      const proposalRepository = createProposalRepository(database);
      const proposalService = createProposalService(proposalRepository, calendarRepository, {
        database,
        now: () => now,
      });
      const calendarService = createCalendarService(calendarRepository, proposalService, { now: () => now });
      const credentials = createProviderCredentialService(database, secrets);
      const eventLanguage = createEventLanguageService(calendarRepository, credentials, { requestJson });
      const request = {
        text: '周三下午两点和导师开会',
        referenceDate: '2026-09-20',
        timezone: 'Asia/Shanghai' as const,
        externalProcessingConfirmed: true,
      };

      await expect(eventLanguage.parse(ownerId, { ...request, externalProcessingConfirmed: false }))
        .rejects.toMatchObject({ statusCode: 422, code: 'EVENT_LANGUAGE_EXTERNAL_CONFIRMATION_REQUIRED' });
      await expect(eventLanguage.parse(ownerId, request))
        .rejects.toMatchObject({ statusCode: 503, code: 'EVENT_LANGUAGE_PROVIDER_NOT_CONFIGURED' });
      expect(secrets.unprotectCalls).toBe(0);
      expect(requestJson).not.toHaveBeenCalled();

      await credentials.save(ownerId, 'test-event-language-key');
      const parsed = await eventLanguage.parse(ownerId, request);
      expect(parsed.candidate).toMatchObject({
        title: '与导师开会',
        kind: 'MEETING',
        localDate: '2026-09-23',
        startLocalTime: '14:00',
        endLocalTime: '15:00',
        isHard: null,
      });
      expect(parsed.missingFields).toEqual(['isHard']);
      expect(parsed.conflicts).toMatchObject([{
        eventId: '00000000-0000-4000-8000-000000000402',
        title: '固定课程',
        isHard: true,
        reason: expect.stringContaining('固定日程'),
      }]);
      expect(secrets.unprotectCalls).toBe(1);
      expect(requestJson).toHaveBeenCalledTimes(1);
      expect(calendarRepository.listEventsForDate(ownerId, '2026-09-23')).toHaveLength(1);
      expect(proposalRepository.listPending(ownerId)).toEqual([]);

      const candidate = parsed.candidate;
      if (
        candidate.title === null
        || candidate.kind === null
        || candidate.localDate === null
        || candidate.startLocalTime === null
        || candidate.endLocalTime === null
      ) {
        throw new Error('expected a complete candidate except for the owner-selected hard-event field');
      }
      const proposal = calendarService.createEventProposal(ownerId, {
        title: candidate.title,
        kind: candidate.kind,
        localDate: candidate.localDate,
        startLocalTime: candidate.startLocalTime,
        endLocalTime: candidate.endLocalTime,
        isHard: false,
      });
      expect(proposal).toMatchObject({ kind: 'SCHEDULE', status: 'PENDING' });
      expect(calendarRepository.listEventsForDate(ownerId, '2026-09-23')).toHaveLength(1);

      expect(proposalService.decide(ownerId, proposal.id, {
        version: proposal.version,
        decision: 'ACCEPT',
      })).toMatchObject({ status: 'ACCEPTED' });
      expect(calendarRepository.listEventsForDate(ownerId, '2026-09-23')).toMatchObject([
        { title: '固定课程' },
        { title: '与导师开会', kind: 'MEETING', startLocalTime: '14:00', endLocalTime: '15:00' },
      ]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
