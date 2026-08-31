import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createArtifactStore, type ArtifactStore } from '../src/modules/calendar/artifact-store';
import { createCourseImportRepository } from '../src/modules/calendar/import-repository';
import { createCourseImportService } from '../src/modules/calendar/import-service';
import { createCalendarRepository } from '../src/modules/calendar/repository';
import { createCapabilityRunRepository } from '../src/modules/providers/capability-run-repository';
import { createCapabilityRegistry, type VisionCapability } from '../src/modules/providers/capabilities';
import { openDatabase } from '../src/storage/database';

const credentials = {
  username: '本地主人',
  password: 'correct horse battery staple',
};

function readSessionToken(setCookieHeader: string | string[] | undefined): string {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  const match = header?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('ev_session cookie was not set');
  return match[1];
}

function webpChunk(
  fourCc: 'VP8X' | 'VP8 ' | 'VP8L',
  payload: readonly number[],
  options: { declaredChunkSize?: number; declaredRiffSize?: number } = {},
): Buffer {
  const paddedLength = payload.length + (payload.length % 2);
  const bytes = Buffer.alloc(20 + paddedLength);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(options.declaredRiffSize ?? bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write(fourCc, 12, 'ascii');
  bytes.writeUInt32LE(options.declaredChunkSize ?? payload.length, 16);
  Buffer.from(payload).copy(bytes, 20);
  return bytes;
}

describe('v0.6 local course artifacts', () => {
  let app: FastifyInstance | undefined;
  let directory: string;
  let databasePath: string;

  const validPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  ]);

  const validWebp = Buffer.from(
    'UklGRgYCAABXRUJQVlA4WAoAAAAgAAAAAAAAAAAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggGAAAADABAJ0BKgEAAQABQCYlpAADcAD+/PQAAA==',
    'base64',
  );
  const validVp8Webp = Buffer.from('UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoCAAMAAUAmJQBOgC6gAP77LkvF3YjjJ4dVU9ffoAA=', 'base64');
  const validVp8lWebp = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAYAAEAdQkTIUp4CBiOh/AAA=', 'base64');

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ev-v06-course-artifact-'));
    databasePath = join(directory, 'app.sqlite');
  });

  afterEach(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('persists a verified raw PNG locally and creates a blocked local-only import disclosure', async () => {
    app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const term = await app.inject({
      method: 'POST',
      url: '/v1/terms',
      cookies: { ev_session: token },
      payload: { title: '2026 秋季学期', timezone: 'Asia/Shanghai', weekOneMonday: '2026-09-07' },
    });

    const uploaded = await app.inject({
      method: 'POST',
      url: '/v1/course-artifacts',
      cookies: { ev_session: token },
      headers: { 'content-type': 'image/png' },
      payload: validPng,
    });

    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().data.artifact).toMatchObject({
      mediaType: 'image/png', byteSize: validPng.byteLength, width: 1, height: 1,
    });
    const imported = await app.inject({
      method: 'POST',
      url: '/v1/course-imports',
      cookies: { ev_session: token },
      payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().data).toMatchObject({
      import: { status: 'BLOCKED_PROVIDER' },
      disclosure: { purpose: '提取课表候选', adapterKind: 'NONE', evidenceKind: 'NONE' },
    });
    expect(JSON.stringify(imported.json())).not.toMatch(/ownerId|storageKey|base64|password|token|session/i);
  });

  it('rejects a declared PNG whose magic bytes are JPEG before persisting metadata', async () => {
    app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const uploaded = await app.inject({
      method: 'POST',
      url: '/v1/course-artifacts',
      cookies: { ev_session: token },
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });

    expect(uploaded.statusCode).toBe(422);
    expect(uploaded.json().error).toMatchObject({ code: 'IMAGE_SIGNATURE_MISMATCH' });
    const database = openDatabase(databasePath);
    try {
      expect(database.prepare('select count(*) as count from local_artifacts').get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('rejects malformed WebP RIFF and VP8X/VP8/VP8L chunks before persistence', async () => {
    app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const malformed = [
      webpChunk('VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { declaredRiffSize: 0 }),
      webpChunk('VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { declaredChunkSize: 1 }),
      webpChunk('VP8 ', [0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 0, 1, 0, 1], { declaredChunkSize: 1 }),
      webpChunk('VP8L', [0x2f, 0, 0, 0, 0], { declaredChunkSize: 1 }),
    ];

    const valid = await app.inject({
      method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token },
      headers: { 'content-type': 'image/webp' }, payload: validWebp,
    });
    const rejected = await Promise.all(malformed.map((payload) => app!.inject({
      method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token },
      headers: { 'content-type': 'image/webp' }, payload,
    })));

    expect(valid.statusCode).toBe(201);
    expect(valid.json().data.artifact).toMatchObject({ mediaType: 'image/webp', width: 1, height: 1 });
    expect(rejected.map((response) => response.statusCode)).toEqual([422, 422, 422, 422]);
    expect(rejected.map((response) => response.json().error.code)).toEqual([
      'IMAGE_DIMENSIONS_INVALID', 'IMAGE_DIMENSIONS_INVALID', 'IMAGE_DIMENSIONS_INVALID', 'IMAGE_DIMENSIONS_INVALID',
    ]);
    const database = openDatabase(databasePath);
    try {
      expect(database.prepare('select count(*) as count from local_artifacts').get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it('rejects a VP8X-only WebP before persistence or any Vision call', async () => {
    let providerCalls = 0;
    const vision: VisionCapability = {
      descriptor: { providerId: 'controlled-vision', providerLabel: '受控 Vision', adapterKind: 'PRODUCTION_ADAPTER' },
      async extractCourseSchedule() {
        providerCalls += 1;
        return { candidates: [] };
      },
    };
    const artifactRoot = join(directory, 'artifacts');
    app = await buildApp({ databasePath, artifactRoot, visionCapability: vision, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const vp8xOnly = webpChunk('VP8X', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const uploaded = await app.inject({
      method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token },
      headers: { 'content-type': 'image/webp' }, payload: vp8xOnly,
    });

    expect(uploaded.statusCode).toBe(422);
    expect(uploaded.json().error).toMatchObject({ code: 'IMAGE_DIMENSIONS_INVALID' });
    const database = openDatabase(databasePath);
    try {
      expect(database.prepare('select count(*) as count from local_artifacts').get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
    const artifactFiles = existsSync(artifactRoot)
      ? readdirSync(artifactRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
      : [];
    expect(artifactFiles).toHaveLength(0);
    expect(providerCalls).toBe(0);
  });

  it('rejects exact-size VP8 and VP8L frame headers before persistence or any Vision call', async () => {
    let providerCalls = 0;
    const vision: VisionCapability = {
      descriptor: { providerId: 'controlled-vision', providerLabel: '受控 Vision', adapterKind: 'PRODUCTION_ADAPTER' },
      async extractCourseSchedule() {
        providerCalls += 1;
        return { candidates: [] };
      },
    };
    const artifactRoot = join(directory, 'artifacts');
    app = await buildApp({ databasePath, artifactRoot, visionCapability: vision, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const headerOnly = [
      webpChunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 1, 0, 1, 0]),
      webpChunk('VP8L', [0x2f, 0, 0, 0, 0]),
    ];

    expect(headerOnly.map((payload) => payload.byteLength)).toEqual([30, 26]);
    const rejected = await Promise.all(headerOnly.map((payload) => app!.inject({
      method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token },
      headers: { 'content-type': 'image/webp' }, payload,
    })));

    expect(rejected.map((response) => response.statusCode)).toEqual([422, 422]);
    expect(rejected.map((response) => response.json().error.code)).toEqual([
      'IMAGE_DIMENSIONS_INVALID', 'IMAGE_DIMENSIONS_INVALID',
    ]);
    const database = openDatabase(databasePath);
    try {
      expect(database.prepare('select count(*) as count from local_artifacts').get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
    const artifactFiles = existsSync(artifactRoot)
      ? readdirSync(artifactRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
      : [];
    expect(artifactFiles).toHaveLength(0);
    expect(providerCalls).toBe(0);
  });

  it('accepts fixed, locally decodable VP8 and VP8L WebP payloads with their validated dimensions', async () => {
    const decoded = await Promise.all([validVp8Webp, validVp8lWebp].map((payload) => sharp(payload, {
      failOn: 'error', limitInputPixels: 40_000_000,
    }).stats()));
    expect(decoded.map((stats) => stats.channels.length)).toEqual([3, 4]);

    app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const uploaded = await Promise.all([validVp8Webp, validVp8lWebp].map((payload) => app!.inject({
      method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token },
      headers: { 'content-type': 'image/webp' }, payload,
    })));

    expect(uploaded.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(uploaded.map((response) => response.json().data.artifact)).toEqual([
      expect.objectContaining({ mediaType: 'image/webp', width: 2, height: 3 }),
      expect.objectContaining({ mediaType: 'image/webp', width: 2, height: 3 }),
    ]);
  });

  it('recovers DELETE_PENDING artifacts after crashes before and after unlink during startup', async () => {
    const artifactRoot = join(directory, 'artifacts');
    app = await buildApp({ databasePath, artifactRoot, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const beforeUnlink = await app.inject({
      method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token },
      headers: { 'content-type': 'image/png' }, payload: validPng,
    });
    const afterUnlink = await app.inject({
      method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token },
      headers: { 'content-type': 'image/png' }, payload: Buffer.concat([validPng, Buffer.from([1])]),
    });
    const pendingIds = [beforeUnlink.json().data.artifact.id, afterUnlink.json().data.artifact.id] as string[];
    const database = openDatabase(databasePath);
    let afterUnlinkPath = '';
    try {
      const owner = database.prepare('select id from owners').get() as { id: string };
      const repository = createCourseImportRepository(database);
      for (const artifactId of pendingIds) {
        expect(repository.requestArtifactDelete(owner.id, artifactId, '2026-08-31T08:00:00.000Z')?.state).toBe('DELETE_PENDING');
      }
      const storageKey = repository.findArtifactStorageKey(owner.id, pendingIds[1]!);
      if (!storageKey) throw new Error('second artifact storage key disappeared');
      afterUnlinkPath = createArtifactStore(artifactRoot).resolveVerified(storageKey);
      rmSync(afterUnlinkPath);
    } finally {
      database.close();
    }
    await app.close();
    app = undefined;

    app = await buildApp({ databasePath, artifactRoot, logger: false });
    const recoveredDatabase = openDatabase(databasePath);
    try {
      expect(recoveredDatabase.prepare('select id, state, version from local_artifacts where id in (?, ?) order by id').all(...pendingIds))
        .toEqual([...pendingIds].sort().map((id) => ({ id, state: 'DELETED', version: 3 })));
      const storageRows = recoveredDatabase.prepare('select storage_key from local_artifacts where id in (?, ?)').all(...pendingIds) as Array<{ storage_key: string }>;
      expect(storageRows.every((row) => !existsSync(createArtifactStore(artifactRoot).resolveVerified(row.storage_key)))).toBe(true);
    } finally {
      recoveredDatabase.close();
    }
    expect(existsSync(afterUnlinkPath)).toBe(false);
    for (const artifactId of pendingIds) {
      const firstRetry = await app.inject({ method: 'DELETE', url: `/v1/course-artifacts/${artifactId}`, cookies: { ev_session: token } });
      const secondRetry = await app.inject({ method: 'DELETE', url: `/v1/course-artifacts/${artifactId}`, cookies: { ev_session: token } });
      expect([firstRetry.statusCode, secondRetry.statusCode]).toEqual([204, 204]);
    }
  });

  it('keeps unsafe and failed artifact removals pending and observable outside write transactions', async () => {
    const artifactRoot = join(directory, 'artifacts');
    app = await buildApp({ databasePath, artifactRoot, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const uploaded = await app.inject({
      method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token },
      headers: { 'content-type': 'image/png' }, payload: validPng,
    });
    await app.close();
    app = undefined;

    const outsidePath = join(directory, 'outside-artifact.bin');
    writeFileSync(outsidePath, 'must remain');
    const database = openDatabase(databasePath);
    try {
      const owner = database.prepare('select id from owners').get() as { id: string };
      const repository = createCourseImportRepository(database);
      const uploadedId = uploaded.json().data.artifact.id as string;
      expect(repository.requestArtifactDelete(owner.id, uploadedId, '2026-08-31T08:10:00.000Z')?.state).toBe('DELETE_PENDING');
      repository.insertArtifact({
        id: '00000000-0000-4000-8000-000000000991', ownerId: owner.id, kind: 'COURSE_SCHEDULE_IMAGE',
        storageKey: `${owner.id}/unsafe\\outside-artifact.bin`, mediaType: 'image/png', byteSize: 24, width: 1, height: 1,
        pixelCount: 1, sha256: 'a'.repeat(64), state: 'DELETE_PENDING', version: 2,
        createdAt: '2026-08-31T08:00:00.000Z', deleteRequestedAt: '2026-08-31T08:10:00.000Z', deletedAt: null,
      });
      const realStore = createArtifactStore(artifactRoot);
      const transactionStates: boolean[] = [];
      const failingStore: ArtifactStore = {
        ...realStore,
        async remove(storageKey) {
          transactionStates.push(database.inTransaction);
          if (storageKey === repository.findArtifactStorageKey(owner.id, uploadedId)) {
            throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
          }
          await realStore.remove(storageKey);
        },
      };
      const service = createCourseImportService(
        database,
        createCalendarRepository(database),
        artifactRoot,
        createCapabilityRegistry({ dataRoot: directory }),
        { repository, store: failingStore, now: () => new Date('2026-08-31T08:20:00.000Z') },
      );

      const recovery = await service.recoverPendingArtifactDeletes();

      expect(recovery.recovered).toBe(0);
      expect(recovery.failures.map((failure) => failure.artifactId).sort()).toEqual([
        '00000000-0000-4000-8000-000000000991', uploadedId,
      ].sort());
      expect(transactionStates).toEqual([false, false]);
      expect(database.prepare(`select id, state from local_artifacts where id in (?, ?) order by id`).all(uploadedId, '00000000-0000-4000-8000-000000000991'))
        .toEqual([
          { id: '00000000-0000-4000-8000-000000000991', state: 'DELETE_PENDING' },
          { id: uploadedId, state: 'DELETE_PENDING' },
        ].sort((left, right) => left.id.localeCompare(right.id)));
      expect(existsSync(outsidePath)).toBe(true);
    } finally {
      database.close();
    }
  });

  it('terminalizes artifact deletion only for the exact Owner and still-pending row', async () => {
    const artifactRoot = join(directory, 'artifacts');
    app = await buildApp({ databasePath, artifactRoot, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const uploaded = await app.inject({
      method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token },
      headers: { 'content-type': 'image/png' }, payload: validPng,
    });
    await app.close();
    app = undefined;

    const database = openDatabase(databasePath);
    try {
      const owner = database.prepare('select id from owners').get() as { id: string };
      const foreignOwnerId = '00000000-0000-4000-8000-000000000992';
      database.pragma('ignore_check_constraints = ON');
      database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)')
        .run(foreignOwnerId, 'artifact-recovery-foreign-owner', 'unused', '2026-08-31T08:00:00.000Z');
      const repository = createCourseImportRepository(database);
      const artifactId = uploaded.json().data.artifact.id as string;
      expect(repository.requestArtifactDelete(owner.id, artifactId, '2026-08-31T08:10:00.000Z')?.state).toBe('DELETE_PENDING');
      expect(repository.markArtifactDeleted(foreignOwnerId, artifactId, '2026-08-31T08:11:00.000Z')).toBeUndefined();
      expect(repository.findArtifact(owner.id, artifactId)?.state).toBe('DELETE_PENDING');
      const transactionStates: boolean[] = [];
      const realStore = createArtifactStore(artifactRoot);
      const observingStore: ArtifactStore = {
        ...realStore,
        async remove(storageKey) {
          transactionStates.push(database.inTransaction);
          await realStore.remove(storageKey);
        },
      };
      const service = createCourseImportService(
        database,
        createCalendarRepository(database),
        artifactRoot,
        createCapabilityRegistry({ dataRoot: directory }),
        { repository, store: observingStore, now: () => new Date('2026-08-31T08:20:00.000Z') },
      );

      expect(await service.recoverPendingArtifactDeletes()).toMatchObject({ recovered: 1, failures: [] });
      expect(transactionStates).toEqual([false]);
      expect(repository.findArtifact(owner.id, artifactId)).toMatchObject({ state: 'DELETED', version: 3 });
      expect(repository.markArtifactDeleted(owner.id, artifactId, '2026-08-31T08:21:00.000Z')).toBeUndefined();
      expect(repository.findArtifact(owner.id, artifactId)).toMatchObject({ state: 'DELETED', version: 3 });
    } finally {
      database.close();
    }
  });

  it('atomically claims Vision extraction and replays only the same key, resource, and payload', async () => {
    let providerCalls = 0;
    const vision: VisionCapability = {
      descriptor: { providerId: 'controlled-vision', providerLabel: '受控 Vision', adapterKind: 'PRODUCTION_ADAPTER' },
      async extractCourseSchedule() {
        providerCalls += 1;
        return {
          candidates: [{
            title: '事务课程', location: null, weekday: 1, startLocalTime: '08:00', endLocalTime: '09:00',
            weekStart: 1, weekEnd: 1, weekPattern: 'EVERY_WEEK',
            confidence: { overall: 1, fields: { title: 1, location: 1, weekday: 1, startLocalTime: 1, endLocalTime: 1, weekStart: 1, weekEnd: 1, weekPattern: 1 } },
          }],
        };
      },
    };
    app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), visionCapability: vision, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const term = await app.inject({ method: 'POST', url: '/v1/terms', cookies: { ev_session: token }, payload: { title: '2026 秋季学期', timezone: 'Asia/Shanghai', weekOneMonday: '2026-09-07' } });
    const uploaded = await app.inject({ method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token }, headers: { 'content-type': 'image/png' }, payload: validPng });
    const firstImport = await app.inject({ method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token }, payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id } });
    const collisionImport = await app.inject({ method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token }, payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id } });
    const command = { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' as const };
    const key = 'v06-vision-atomic-replay-01';

    const first = await app.inject({ method: 'POST', url: `/v1/course-imports/${firstImport.json().data.import.id}/extract`, cookies: { ev_session: token }, headers: { 'idempotency-key': key }, payload: command });
    const replay = await app.inject({ method: 'POST', url: `/v1/course-imports/${firstImport.json().data.import.id}/extract`, cookies: { ev_session: token }, headers: { 'idempotency-key': key }, payload: command });
    const changedPayload = await app.inject({ method: 'POST', url: `/v1/course-imports/${firstImport.json().data.import.id}/extract`, cookies: { ev_session: token }, headers: { 'idempotency-key': key }, payload: { ...command, expectedVersion: 2 } });
    const changedResource = await app.inject({ method: 'POST', url: `/v1/course-imports/${collisionImport.json().data.import.id}/extract`, cookies: { ev_session: token }, headers: { 'idempotency-key': key }, payload: command });

    expect(first.statusCode).toBe(202);
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toEqual(first.json());
    expect(changedPayload.statusCode).toBe(409);
    expect(changedPayload.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(changedResource.statusCode).toBe(409);
    expect(changedResource.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(providerCalls).toBe(1);
    const database = openDatabase(databasePath);
    try {
      expect(database.prepare('select status, version from course_imports_v2 where id = ?').get(collisionImport.json().data.import.id))
        .toEqual({ status: 'AWAITING_DISCLOSURE', version: 1 });
      expect(database.prepare('select idempotency_key, request_hash, status from external_capability_runs where id = ?').get(collisionImport.json().data.import.capabilityRunId))
        .toEqual({ idempotency_key: null, request_hash: null, status: 'AWAITING_DISCLOSURE' });
    } finally {
      database.close();
    }
  });

  it('rejects the twenty-first Vision reservation before calling the adapter', async () => {
    let providerCalls = 0;
    const vision: VisionCapability = {
      descriptor: { providerId: 'controlled-vision', providerLabel: '受控 Vision', adapterKind: 'PRODUCTION_ADAPTER' },
      async extractCourseSchedule() {
        providerCalls += 1;
        return { candidates: [] };
      },
    };
    app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), visionCapability: vision, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const term = await app.inject({ method: 'POST', url: '/v1/terms', cookies: { ev_session: token }, payload: { title: '2026 秋季学期', timezone: 'Asia/Shanghai', weekOneMonday: '2026-09-07' } });
    const uploaded = await app.inject({ method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token }, headers: { 'content-type': 'image/png' }, payload: validPng });
    const imports = [] as Array<{ id: string; capabilityRunId: string }>;
    for (let index = 0; index < 21; index += 1) {
      const created = await app.inject({ method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token }, payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id } });
      imports.push(created.json().data.import);
    }
    const database = openDatabase(databasePath);
    try {
      const owner = database.prepare('select id from owners').get() as { id: string };
      const runs = createCapabilityRunRepository(database);
      for (let index = 0; index < 20; index += 1) {
        const imported = imports[index]!;
        expect(runs.claim(owner.id, imported.capabilityRunId, `seed-vision-quota-${index}`, `${index}`.padStart(64, '0'), new Date().toISOString())).toBe(true);
        const running = runs.findByOwnerAndId(owner.id, imported.capabilityRunId);
        expect(runs.complete(owner.id, imported.capabilityRunId, {
          leaseToken: running!.leaseToken!, status: 'SUCCEEDED', actualCalls: 1, inputChars: 0, outputChars: 1,
          failureCode: null, evidenceKind: 'REAL_PROVIDER', now: new Date().toISOString(),
        })).toBe(true);
      }
    } finally {
      database.close();
    }

    const target = imports[20]!;
    const rejected = await app.inject({
      method: 'POST', url: `/v1/course-imports/${target.id}/extract`, cookies: { ev_session: token },
      headers: { 'idempotency-key': 'v06-vision-quota-twenty-one' }, payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' },
    });
    expect(rejected.statusCode).toBe(429);
    expect(rejected.json().error.code).toBe('CAPABILITY_PROVIDER_QUOTA_EXCEEDED');
    expect(providerCalls).toBe(0);
    const after = openDatabase(databasePath);
    try {
      expect(after.prepare('select status, version from course_imports_v2 where id = ?').get(target.id))
        .toEqual({ status: 'AWAITING_DISCLOSURE', version: 1 });
      expect(after.prepare('select status, reserved_calls, actual_calls, evidence_kind from external_capability_runs where id = ?').get(target.capabilityRunId))
        .toEqual({ status: 'AWAITING_DISCLOSURE', reserved_calls: 0, actual_calls: 0, evidence_kind: 'NONE' });
    } finally {
      after.close();
    }
  });

  it('atomically recovers an expired Vision extraction without calling or replaying the Provider', async () => {
    let providerCalls = 0;
    const vision: VisionCapability = {
      descriptor: { providerId: 'controlled-vision', providerLabel: '受控 Vision', adapterKind: 'PRODUCTION_ADAPTER' },
      async extractCourseSchedule() {
        providerCalls += 1;
        return { candidates: [] };
      },
    };
    app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), visionCapability: vision, logger: false });
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
    const token = readSessionToken(setup.headers['set-cookie']);
    const term = await app.inject({
      method: 'POST', url: '/v1/terms', cookies: { ev_session: token },
      payload: { title: '2026 秋季学期', timezone: 'Asia/Shanghai', weekOneMonday: '2026-09-07' },
    });
    const uploaded = await app.inject({
      method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token },
      headers: { 'content-type': 'image/png' }, payload: validPng,
    });
    const createImport = async () => (await app!.inject({
      method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token },
      payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id },
    })).json().data.import as { id: string; capabilityRunId: string };
    const staleImport = await createImport();
    const alreadyTerminalImport = await createImport();
    const claimAt = '2026-08-31T01:00:00.000Z';
    const sweepAt = '2026-08-31T01:00:36.000Z';
    const extractionInput = { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' as const };
    const extractionKey = 'v06-stale-vision-extraction-01';
    const extractionHash = createHash('sha256')
      .update(JSON.stringify({ importId: staleImport.id, ...extractionInput }))
      .digest('hex');
    const database = openDatabase(databasePath);
    try {
      const owner = database.prepare('select id from owners').get() as { id: string };
      const runs = createCapabilityRunRepository(database);
      expect(runs.claim(owner.id, staleImport.capabilityRunId, extractionKey, extractionHash, claimAt)).toBe(true);
      expect(runs.claim(owner.id, alreadyTerminalImport.capabilityRunId, 'v06-stale-vision-terminal-01', 'e'.repeat(64), claimAt)).toBe(true);
      expect(database.prepare(`update course_imports_v2 set status = 'EXTRACTING', updated_at = ?, version = version + 1
        where id = ? and owner_id = ? and capability_run_id = ? and status = 'AWAITING_DISCLOSURE'`)
        .run(claimAt, staleImport.id, owner.id, staleImport.capabilityRunId).changes).toBe(1);
      expect(database.prepare(`update course_imports_v2 set status = 'FAILED', failure_code = 'PREEXISTING_FAILURE', updated_at = ?, version = version + 1
        where id = ? and owner_id = ? and capability_run_id = ? and status = 'AWAITING_DISCLOSURE'`)
        .run(claimAt, alreadyTerminalImport.id, owner.id, alreadyTerminalImport.capabilityRunId).changes).toBe(1);

      expect(runs.sweepExpired(sweepAt)).toBe(2);
      expect(database.prepare('select status, failure_code, updated_at, version from course_imports_v2 where id = ?').get(staleImport.id))
        .toEqual({ status: 'FAILED', failure_code: 'CAPABILITY_EXECUTION_STALE', updated_at: sweepAt, version: 3 });
      expect(database.prepare('select status, failure_code, reserved_calls, actual_calls, evidence_kind from external_capability_runs where id = ?').get(staleImport.capabilityRunId))
        .toEqual({ status: 'FAILED', failure_code: 'CAPABILITY_EXECUTION_STALE', reserved_calls: 1, actual_calls: 1, evidence_kind: 'NONE' });
      expect(database.prepare('select status, failure_code, updated_at, version from course_imports_v2 where id = ?').get(alreadyTerminalImport.id))
        .toEqual({ status: 'FAILED', failure_code: 'PREEXISTING_FAILURE', updated_at: claimAt, version: 2 });
    } finally {
      database.close();
    }

    const replay = await app.inject({
      method: 'POST', url: `/v1/course-imports/${staleImport.id}/extract`, cookies: { ev_session: token },
      headers: { 'idempotency-key': extractionKey }, payload: extractionInput,
    });
    expect(replay.statusCode).toBe(422);
    expect(replay.json().error.code).toBe('CAPABILITY_EXECUTION_STALE');
    expect(providerCalls).toBe(0);
  });

  it('keeps a 100% confidence Vision result in REVIEW_REQUIRED until the Owner confirms a saved revision', async () => {
    const priorRunDirectory = process.env.EV_E2E_RUN_DIR;
    const priorFlag = process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS;
    process.env.EV_E2E_RUN_DIR = directory;
    process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS = '1';
    let invalidVisionOutput = false;
    const vision: VisionCapability = {
      descriptor: { providerId: 'production-vision', providerLabel: '受控生产 Vision 测试适配器', adapterKind: 'PRODUCTION_ADAPTER' },
      async extractCourseSchedule() {
        if (invalidVisionOutput) return { candidates: [{ title: 'strict schema must reject this provider output' }] };
        return {
          candidates: [{
            title: '数据库系统', location: null, weekday: 1, startLocalTime: '08:00', endLocalTime: '09:40',
            weekStart: 1, weekEnd: 16, weekPattern: 'EVERY_WEEK',
            confidence: { overall: 1, fields: { title: 1, location: 1, weekday: 1, startLocalTime: 1, endLocalTime: 1, weekStart: 1, weekEnd: 1, weekPattern: 1 } },
          }],
        };
      },
    };
    const externalTransactionStates: boolean[] = [];
    try {
      app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), visionCapability: vision, courseImportExternalOperationObserver: (inTransaction) => externalTransactionStates.push(inTransaction), logger: false });
      const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials });
      const token = readSessionToken(setup.headers['set-cookie']);
      const term = await app.inject({ method: 'POST', url: '/v1/terms', cookies: { ev_session: token }, payload: { title: '2026 秋季学期', timezone: 'Asia/Shanghai', weekOneMonday: '2026-09-07' } });
      const uploaded = await app.inject({ method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token }, headers: { 'content-type': 'image/png' }, payload: validPng });
      const imported = await app.inject({ method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token }, payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id } });
      expect(imported.statusCode).toBe(201);
      expect(imported.json().data).toMatchObject({ disclosure: { adapterKind: 'PRODUCTION_ADAPTER', evidenceKind: 'NONE' } });

      const extracted = await app.inject({
        method: 'POST', url: `/v1/course-imports/${imported.json().data.import.id}/extract`, cookies: { ev_session: token },
        headers: { 'idempotency-key': 'v06-review-high-confidence-01' },
        payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' },
      });

      expect(extracted.statusCode).toBe(202);
      expect(extracted.json().data.import).toMatchObject({ status: 'REVIEW_REQUIRED', currentRevisionId: expect.any(String) });
      expect(extracted.json().data.revision.candidates[0]).toMatchObject({ included: true, confidence: { overall: 1 }, provenance: [{ kind: 'VISION_OUTPUT', capabilityRunId: expect.any(String) }] });
      expect(externalTransactionStates).toEqual([false]);
      const database = openDatabase(databasePath);
      try {
        expect(database.prepare('select count(*) as count from courses').get()).toEqual({ count: 0 });
        expect(database.prepare('select count(*) as count from proposals').get()).toEqual({ count: 0 });
        expect(database.prepare('select evidence_kind, actual_calls from external_capability_runs where id = ?').get(imported.json().data.import.capabilityRunId))
          .toEqual({ evidence_kind: 'REAL_PROVIDER', actual_calls: 1 });
      } finally {
        database.close();
      }

      invalidVisionOutput = true;
      const failedImport = await app.inject({ method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token }, payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id } });
      const failedExtraction = await app.inject({
        method: 'POST', url: `/v1/course-imports/${failedImport.json().data.import.id}/extract`, cookies: { ev_session: token },
        headers: { 'idempotency-key': 'v06-review-invalid-output-01' },
        payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' },
      });
      expect(failedExtraction.statusCode).toBe(422);
      expect(failedExtraction.json().error.code).toBe('VISION_RESPONSE_INVALID');
      const failedDatabase = openDatabase(databasePath);
      try {
        expect(failedDatabase.prepare('select status, evidence_kind, actual_calls, failure_code from external_capability_runs where id = ?').get(failedImport.json().data.import.capabilityRunId))
          .toEqual({ status: 'FAILED', evidence_kind: 'NONE', actual_calls: 1, failure_code: 'VISION_RESPONSE_INVALID' });
        const storedArtifact = failedDatabase.prepare('select storage_key from local_artifacts where id = ?').get(uploaded.json().data.artifact.id) as { storage_key: string };
        rmSync(join(directory, 'artifacts', storedArtifact.storage_key), { force: true });
      } finally {
        failedDatabase.close();
      }

      const unreadableImport = await app.inject({ method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token }, payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id } });
      const unreadableExtraction = await app.inject({
        method: 'POST', url: `/v1/course-imports/${unreadableImport.json().data.import.id}/extract`, cookies: { ev_session: token },
        headers: { 'idempotency-key': 'v06-review-artifact-read-01' },
        payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' },
      });
      expect(unreadableExtraction.statusCode).toBe(422);
      expect(unreadableExtraction.json().error.code).toBe('VISION_RESPONSE_INVALID');
      const unreadableDatabase = openDatabase(databasePath);
      try {
        expect(unreadableDatabase.prepare('select status, evidence_kind, actual_calls, failure_code from external_capability_runs where id = ?').get(unreadableImport.json().data.import.capabilityRunId))
          .toEqual({ status: 'FAILED', evidence_kind: 'NONE', actual_calls: 0, failure_code: 'VISION_RESPONSE_INVALID' });
      } finally {
        unreadableDatabase.close();
      }
      expect(externalTransactionStates).toEqual([false, false, false]);
    } finally {
      if (priorRunDirectory === undefined) delete process.env.EV_E2E_RUN_DIR; else process.env.EV_E2E_RUN_DIR = priorRunDirectory;
      if (priorFlag === undefined) delete process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS; else process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS = priorFlag;
    }
  });

  it('persists an excluded Owner revision and replays an identical confirmation without duplicate Course facts', async () => {
    const priorRunDirectory = process.env.EV_E2E_RUN_DIR; const priorFlag = process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS;
    process.env.EV_E2E_RUN_DIR = directory; process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS = '1';
    const vision: VisionCapability = { descriptor: { providerId: 'test-vision', providerLabel: '自动测试 Fake Vision', adapterKind: 'TEST_FAKE' }, async extractCourseSchedule() { return { candidates: [{ title: '数据库系统', location: 'A101', weekday: 1, startLocalTime: '08:00', endLocalTime: '09:40', weekStart: 1, weekEnd: 16, weekPattern: 'EVERY_WEEK', confidence: { overall: 1, fields: { title: 1, location: 1, weekday: 1, startLocalTime: 1, endLocalTime: 1, weekStart: 1, weekEnd: 1, weekPattern: 1 } } }, { title: '离散数学', location: null, weekday: 2, startLocalTime: '10:00', endLocalTime: '11:40', weekStart: 1, weekEnd: 16, weekPattern: 'EVERY_WEEK', confidence: { overall: .9, fields: { title: 1, location: 1, weekday: 1, startLocalTime: 1, endLocalTime: 1, weekStart: 1, weekEnd: 1, weekPattern: 1 } } }] }; } };
    try {
      app = await buildApp({ databasePath, artifactRoot: join(directory, 'artifacts'), visionCapability: vision, logger: false });
      const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: credentials }); const token = readSessionToken(setup.headers['set-cookie']);
      const term = await app.inject({ method: 'POST', url: '/v1/terms', cookies: { ev_session: token }, payload: { title: '2026 秋季学期', timezone: 'Asia/Shanghai', weekOneMonday: '2026-09-07' } });
      const uploaded = await app.inject({ method: 'POST', url: '/v1/course-artifacts', cookies: { ev_session: token }, headers: { 'content-type': 'image/png' }, payload: validPng });
      const created = await app.inject({ method: 'POST', url: '/v1/course-imports', cookies: { ev_session: token }, payload: { termId: term.json().data.id, artifactId: uploaded.json().data.artifact.id } });
      const extracted = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/extract`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-confirm-extract-01' }, payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' } });
      const reviewed = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/revisions`, cookies: { ev_session: token }, payload: { expectedVersion: 3, parentRevisionId: extracted.json().data.revision.id, candidates: extracted.json().data.revision.candidates.map((candidate: { candidateId: string; title: string; location: string | null; weekday: number; startLocalTime: string; endLocalTime: string; weekStart: number; weekEnd: number; weekPattern: string }, index: number) => ({ candidateId: candidate.candidateId, included: index === 0, title: candidate.title, location: candidate.location, weekday: candidate.weekday, startLocalTime: candidate.startLocalTime, endLocalTime: candidate.endLocalTime, weekStart: candidate.weekStart, weekEnd: candidate.weekEnd, weekPattern: candidate.weekPattern })) } });
      expect(reviewed.statusCode).toBe(201); expect(reviewed.json().data.revision.candidates[1]).toMatchObject({ included: false, provenance: [{ kind: 'VISION_OUTPUT' }, { kind: 'OWNER_EDIT', editedFields: ['included'] }] });
      const body = { expectedVersion: reviewed.json().data.import.version, revisionId: reviewed.json().data.revision.id };
      const first = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/confirm`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-confirm-replay-01' }, payload: body });
      const replay = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/confirm`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-confirm-replay-01' }, payload: body });
      expect(first.statusCode).toBe(201); expect(replay.statusCode).toBe(201); expect(replay.json()).toEqual(first.json());
      const reused = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/confirm`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-confirm-replay-01' }, payload: { ...body, expectedVersion: body.expectedVersion + 1 } });
      const duplicate = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/confirm`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-confirm-second-01' }, payload: body });
      expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED'); expect(duplicate.json().error.code).toBe('IMPORT_ALREADY_CONFIRMED');
      const proposalId = first.json().data.import.scheduleProposalId as string;
      const accepted = await app.inject({ method: 'POST', url: `/v1/proposals/${proposalId}/decision`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-course-expand-01' }, payload: { version: 1, decision: 'ACCEPT' } });
      const acceptedReplay = await app.inject({ method: 'POST', url: `/v1/proposals/${proposalId}/decision`, cookies: { ev_session: token }, headers: { 'idempotency-key': 'v06-course-expand-01' }, payload: { version: 1, decision: 'ACCEPT' } });
      const today = await app.inject({ method: 'GET', url: '/v1/today?date=2026-09-07', cookies: { ev_session: token } });
      expect(accepted.statusCode).toBe(200); expect(acceptedReplay.json()).toEqual(accepted.json()); expect(today.json().data.events).toMatchObject([{ kind: 'COURSE', courseId: expect.any(String) }]);
      const afterAccept = await app.inject({ method: 'GET', url: `/v1/course-imports/${created.json().data.import.id}`, cookies: { ev_session: token } });
      expect(afterAccept.json().data.import.status).toBe('CONFIRMED');
      const otherToken = 'other-owner-v06-import-token';
      const database = openDatabase(databasePath); try {
        database.pragma('ignore_check_constraints = ON');
        database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)').run('00000000-0000-4000-8000-000000000998', '其他主人', 'unused', '2026-08-17T03:00:00.000Z');
        database.prepare('insert into sessions (id, owner_id, token_hash, expires_at, created_at) values (?, ?, ?, ?, ?)').run('00000000-0000-4000-8000-000000000997', '00000000-0000-4000-8000-000000000998', createHash('sha256').update(otherToken).digest('hex'), '2099-01-01T00:00:00.000Z', '2026-08-17T03:00:00.000Z');
      } finally { database.close(); }
      for (const request of [
        { method: 'GET' as const, url: `/v1/course-imports/${created.json().data.import.id}` },
        { method: 'POST' as const, url: `/v1/course-imports/${created.json().data.import.id}/extract`, headers: { 'idempotency-key': 'v06-other-owner-extract-01' }, payload: { expectedVersion: 1, disclosureVersion: 'CAPABILITY_DISCLOSURE_V1' } },
        { method: 'POST' as const, url: `/v1/course-imports/${created.json().data.import.id}/revisions`, payload: { expectedVersion: 1, parentRevisionId: reviewed.json().data.revision.id, candidates: [{ candidateId: reviewed.json().data.revision.candidates[0].candidateId, included: true, title: '数据库系统', location: 'A101', weekday: 1, startLocalTime: '08:00', endLocalTime: '09:40', weekStart: 1, weekEnd: 16, weekPattern: 'EVERY_WEEK' }] } },
        { method: 'POST' as const, url: `/v1/course-imports/${created.json().data.import.id}/confirm`, headers: { 'idempotency-key': 'v06-other-owner-confirm-01' }, payload: body },
      ]) expect((await app.inject({ ...request, cookies: { ev_session: otherToken } })).statusCode).toBe(404);
      const staleRevision = await app.inject({ method: 'POST', url: `/v1/course-imports/${created.json().data.import.id}/revisions`, cookies: { ev_session: token }, payload: { expectedVersion: 4, parentRevisionId: extracted.json().data.revision.id, candidates: reviewed.json().data.revision.candidates.map((candidate: { candidateId: string; included: boolean; title: string; location: string | null; weekday: number; startLocalTime: string; endLocalTime: string; weekStart: number; weekEnd: number; weekPattern: string }) => ({ candidateId: candidate.candidateId, included: candidate.included, title: candidate.title, location: candidate.location, weekday: candidate.weekday, startLocalTime: candidate.startLocalTime, endLocalTime: candidate.endLocalTime, weekStart: candidate.weekStart, weekEnd: candidate.weekEnd, weekPattern: candidate.weekPattern })) } });
      expect(staleRevision.json().error.code).toBe('VERSION_CONFLICT');
      const finalDatabase = openDatabase(databasePath); try { expect(finalDatabase.prepare('select count(*) as count from courses').get()).toEqual({ count: 1 }); expect(finalDatabase.prepare('select count(*) as count from course_import_entities').get()).toEqual({ count: 1 }); expect(() => finalDatabase.prepare('update course_import_revisions set revision_no = 99 where id = ?').run(extracted.json().data.revision.id)).toThrow(/immutable/); } finally { finalDatabase.close(); }
    } finally { if (priorRunDirectory === undefined) delete process.env.EV_E2E_RUN_DIR; else process.env.EV_E2E_RUN_DIR = priorRunDirectory; if (priorFlag === undefined) delete process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS; else process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS = priorFlag; }
  });
});
