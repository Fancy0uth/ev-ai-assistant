import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { createDeepSeekCourseVisionResolver } from '../src/modules/calendar/deepseek-course-vision';
import { createCourseImportService } from '../src/modules/calendar/import-service';
import { createProposalRepository } from '../src/modules/proposals/repository';
import { createProposalService } from '../src/modules/proposals/service';
import { createCapabilityRegistry } from '../src/modules/providers/capabilities';
import { createProviderCredentialService } from '../src/modules/providers/credential-service';
import type { SecretStorePort } from '../src/modules/providers/secret-store';
import { openDatabase } from '../src/storage/database';

class FakeSecretStore implements SecretStorePort {
  private readonly values = new Map<string, string>();
  unprotectCalls = 0;

  async protect(plaintext: string): Promise<string> {
    const protectedValue = `course-vision-${this.values.size + 1}`;
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

describe('MVP course screenshot capability', () => {
  it('uses an Owner credential only for explicit extraction and produces a reviewable course schedule proposal', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ev-mvp-course-vision-'));
    const database = openDatabase(join(directory, 'app.sqlite'));
    const ownerId = '00000000-0000-4000-8000-000000000101';
    const now = new Date('2026-09-20T00:00:00.000Z');
    const secretStore = new FakeSecretStore();
    const fetchMock = vi.fn(async () => {
      const content = JSON.stringify({
        candidates: [{
          title: '机器学习', location: null, weekday: null, startLocalTime: null, endLocalTime: null,
          weekStart: null, weekEnd: null, weekPattern: null,
          confidence: {
            overall: 0.35,
            fields: { title: 0.98, location: 0, weekday: 0, startLocalTime: 0, endLocalTime: 0, weekStart: 0, weekEnd: 0, weekPattern: 0 },
          },
        }],
      });
      const envelope = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] });
      return new Response(envelope, {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(envelope)) },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run(ownerId, 'course-vision-owner', 'not-used', now.toISOString());
      const calendarRepository = createCalendarRepository(database);
      const term = calendarRepository.createTerm({
        id: '00000000-0000-4000-8000-000000000102', ownerId, title: '2026 秋季', timezone: 'Asia/Shanghai',
        weekOneMonday: '2026-09-07', version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      });
      const credentials = createProviderCredentialService(database, secretStore);
      const courseImports = createCourseImportService(
        database,
        calendarRepository,
        join(directory, 'artifacts'),
        createCapabilityRegistry({ dataRoot: directory }),
        {
          now: () => now,
          visionCapabilityForOwner: createDeepSeekCourseVisionResolver(credentials),
        },
      );
      const image = await sharp({ create: { width: 32, height: 20, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer();
      const uploaded = await courseImports.uploadArtifact(ownerId, 'image/png', image);
      const blocked = courseImports.create(ownerId, { termId: term.id, artifactId: uploaded.artifact.id });

      expect(blocked.import.status).toBe('BLOCKED_PROVIDER');
      expect(secretStore.unprotectCalls).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();

      await credentials.save(ownerId, 'test-only-course-vision-key');
      await expect(courseImports.extract(ownerId, blocked.import.id, {
        expectedVersion: blocked.import.version,
        disclosureVersion: 'CAPABILITY_DISCLOSURE_V1',
      }, 'mvp-course-vision-blocked-01')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

      const created = courseImports.create(ownerId, { termId: term.id, artifactId: uploaded.artifact.id });
      expect(created).toMatchObject({
        import: { status: 'AWAITING_DISCLOSURE' },
        disclosure: { providerId: 'deepseek', adapterKind: 'PRODUCTION_ADAPTER', evidenceKind: 'NONE' },
      });
      expect(secretStore.unprotectCalls).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();

      const extracted = await courseImports.extract(ownerId, created.import.id, {
        expectedVersion: created.import.version,
        disclosureVersion: 'CAPABILITY_DISCLOSURE_V1',
      }, 'mvp-course-vision-extract-01');
      if (!extracted.revision) throw new Error('expected a Vision revision');
      expect(extracted.import.status).toBe('REVIEW_REQUIRED');
      expect(extracted.revision.candidates[0]).toMatchObject({
        title: '机器学习', location: null, weekday: null, startLocalTime: null, weekStart: null, included: true,
      });
      expect(secretStore.unprotectCalls).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const reviewedIncomplete = courseImports.saveRevision(ownerId, created.import.id, {
        expectedVersion: extracted.import.version,
        parentRevisionId: extracted.revision.id,
        candidates: [{
          candidateId: extracted.revision.candidates[0]!.candidateId,
          included: true,
          title: '机器学习', location: null, weekday: null, startLocalTime: null, endLocalTime: null,
          weekStart: null, weekEnd: null, weekPattern: null,
        }],
      });
      if (!reviewedIncomplete.revision) throw new Error('expected an incomplete Owner revision');
      await expect(Promise.resolve().then(() => courseImports.confirm(ownerId, created.import.id, {
        expectedVersion: reviewedIncomplete.import.version,
        revisionId: reviewedIncomplete.revision!.id,
      }, 'mvp-course-vision-incomplete-confirm-01'))).rejects.toMatchObject({ code: 'CANDIDATE_INCOMPLETE' });
      expect(database.prepare('select count(*) as count from courses where owner_id = ?').get(ownerId)).toEqual({ count: 0 });
      expect(database.prepare('select count(*) as count from calendar_rules where owner_id = ?').get(ownerId)).toEqual({ count: 0 });
      expect(database.prepare('select count(*) as count from proposals where owner_id = ?').get(ownerId)).toEqual({ count: 0 });

      const reviewed = courseImports.saveRevision(ownerId, created.import.id, {
        expectedVersion: reviewedIncomplete.import.version,
        parentRevisionId: reviewedIncomplete.revision.id,
        candidates: [{
          candidateId: reviewedIncomplete.revision.candidates[0]!.candidateId,
          included: true,
          title: '机器学习', location: '教学楼 A101', weekday: 1, startLocalTime: '08:00', endLocalTime: '09:40',
          weekStart: 1, weekEnd: 16, weekPattern: 'EVERY_WEEK',
        }],
      });
      if (!reviewed.revision) throw new Error('expected a complete Owner revision');
      const confirmed = courseImports.confirm(ownerId, created.import.id, {
        expectedVersion: reviewed.import.version,
        revisionId: reviewed.revision.id,
      }, 'mvp-course-vision-confirm-01');
      const proposalId = confirmed.import.scheduleProposalId;
      if (!proposalId) throw new Error('expected a schedule proposal');

      expect(database.prepare('select title from courses where owner_id = ?').all(ownerId))
        .toEqual([{ title: '机器学习' }]);
      expect(database.prepare('select title, weekday, start_local_time, end_local_time from calendar_rules where owner_id = ?').all(ownerId))
        .toEqual([{ title: '机器学习', weekday: 1, start_local_time: '08:00', end_local_time: '09:40' }]);
      const proposalRepository = createProposalRepository(database);
      const proposal = proposalRepository.findById(ownerId, proposalId);
      expect(proposal).toMatchObject({
        kind: 'SCHEDULE', status: 'PENDING', source: 'COURSE_IMPORT',
        changes: [{ operation: 'EXPAND_CALENDAR_RULE' }],
      });
      if (!proposal) throw new Error('expected a persisted proposal');

      const proposals = createProposalService(proposalRepository, calendarRepository, { database, now: () => now });
      expect(proposals.decide(ownerId, proposal.id, { version: proposal.version, decision: 'ACCEPT' }))
        .toMatchObject({ status: 'ACCEPTED' });
      expect(calendarRepository.listEventsForDate(ownerId, '2026-09-07'))
        .toMatchObject([{ kind: 'COURSE', title: '机器学习', startLocalTime: '08:00', endLocalTime: '09:40' }]);
    } finally {
      vi.unstubAllGlobals();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
