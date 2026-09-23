import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import {
  createV07IdempotencyService,
  V07IdempotencyConflictError,
  V07IdempotencyInProgressError,
  V07IdempotencyReplayError,
  type V07IdempotencyOperation,
} from '../src/modules/health-loop/idempotency-service';
import { canonicalJson, createV07HealthLoopRepository } from '../src/modules/health-loop/repository';
import { openDatabase } from '../src/storage/database';

const databases: Database.Database[] = [];
const apps: FastifyInstance[] = [];
const directories: string[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
  while (databases.length > 0) databases.pop()?.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function tokenFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.join('; ') : header;
  const match = value?.match(/(?:^|;\s*)ev_session=([^;]+)/);
  if (!match?.[1]) throw new Error('missing session token');
  return match[1];
}

describe('v0.7 health-loop reliability', () => {
  it('replays exact local responses and rejects semantic collisions', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)').run('owner-a', 'owner-a', 'hash', '2026-09-01T00:00:00.000Z');
    const service = createV07IdempotencyService({ database, repository: createV07HealthLoopRepository(database), now: () => new Date('2026-09-01T00:00:00.000Z'), newId: () => 'v07-record', newLeaseToken: () => 'v07-lease' });
    const command = { ownerId: 'owner-a', key: 'v07-idempotency-key-0001', operation: 'fitness.check_in.create' as const, resourceId: 'check-in-a', body: { localDate: '2026-09-01' } };
    expect(service.executeLocal(command, () => ({ status: 201, body: { data: { id: 'check-in-a' } } }))).toEqual({ status: 201, body: { data: { id: 'check-in-a' } }, replayed: false });
    expect(service.executeLocal(command, () => ({ status: 201, body: { data: { id: 'wrong' } } }))).toEqual({ status: 201, body: { data: { id: 'check-in-a' } }, replayed: true });
    expect(() => service.executeLocal({ ...command, body: { localDate: '2026-09-02' } }, () => ({ status: 201, body: {} }))).toThrow(V07IdempotencyConflictError);
  });

  it('uses one collision contract for every v0.7 command operation', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)').run('owner-a', 'owner-a', 'hash', '2026-09-01T00:00:00.000Z');
    let sequence = 0;
    const service = createV07IdempotencyService({
      database,
      repository: createV07HealthLoopRepository(database),
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      newId: () => `record-${sequence += 1}`,
      newLeaseToken: () => `lease-${sequence += 1}`,
    });
    const operations: V07IdempotencyOperation[] = [
      'fitness.check_in.create',
      'fitness.workout.create',
      'fitness.workout.revise',
      'fitness.workout.propose',
      'fitness.workout.feedback',
      'nutrition.meal_draft.create',
      'nutrition.meal_draft.revise',
      'nutrition.meal_draft.match',
      'nutrition.meal.confirm',
    ];
    for (const [index, operation] of operations.entries()) {
      const command = { ownerId: 'owner-a', key: `v07-operation-key-${String(index).padStart(4, '0')}`, operation, resourceId: `resource-${index}`, body: { version: 1 } };
      const first = service.executeLocal(command, () => ({ status: 201, body: { data: { operation } } }));
      expect(service.executeLocal(command, () => ({ status: 201, body: { data: null } }))).toEqual({ ...first, replayed: true });
      expect(() => service.executeLocal({ ...command, body: { version: 2 } }, () => ({ status: 201, body: {} })))
        .toThrow(V07IdempotencyConflictError);
    }
  });

  it('maps semantic collision and live claims at the route boundary', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ev-v07-idem-route-'));
    directories.push(directory);
    const databasePath = join(directory, 'app.sqlite');
    const app = await buildApp({ databasePath, logger: false });
    apps.push(app);
    const setup = await app.inject({ method: 'POST', url: '/v1/auth/setup', payload: { username: 'idem-owner', password: 'correct horse battery staple' } });
    const session = tokenFrom(setup.headers['set-cookie']);
    const firstBody = { localDate: '2026-09-10', sleepMinutes: 480, energyLevel: 4, discomfortLevel: 0, hasPain: false, acuteRisk: false };
    const first = await app.inject({ method: 'POST', url: '/v1/fitness/check-ins', cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-route-collision-key01' }, payload: firstBody });
    expect(first.statusCode).toBe(201);
    const collision = await app.inject({ method: 'POST', url: '/v1/fitness/check-ins', cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-route-collision-key01' }, payload: { ...firstBody, energyLevel: 3 } });
    expect(collision.statusCode).toBe(409);
    expect(collision.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });

    const control = openDatabase(databasePath);
    databases.push(control);
    const ownerId = (control.prepare('select id from owners').get() as { id: string }).id;
    const liveBody = { ...firstBody, localDate: '2026-09-11' };
    const requestHash = createHash('sha256').update(canonicalJson({ ownerId, operation: 'fitness.check_in.create', resourceId: 'fitness-check-in:2026-09-11', body: liveBody })).digest('hex');
    control.prepare(`insert into v07_idempotency_records (
      id, owner_id, idempotency_key, operation, resource_id, request_hash, state, lease_token,
      lease_expires_at, response_status, response_json, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, 'CLAIMED', ?, ?, null, null, ?, ?)`)
      .run('live-route-record', ownerId, 'v07-route-live-claim-key1', 'fitness.check_in.create', 'fitness-check-in:2026-09-11', requestHash, 'live-route-lease', '2099-01-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
    const live = await app.inject({ method: 'POST', url: '/v1/fitness/check-ins', cookies: { ev_session: session }, headers: { 'idempotency-key': 'v07-route-live-claim-key1' }, payload: liveBody });
    expect(live.statusCode).toBe(409);
    expect(live.headers['retry-after']).toBe('1');
    expect(live.json()).toMatchObject({ error: { code: 'IN_PROGRESS' } });
  });

  it('preserves a local claim across a crash, rolls back domain writes, and recovers it on startup', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)').run('owner-a', 'owner-a', 'hash', '2026-09-01T00:00:00.000Z');
    let currentNow = new Date('2026-09-01T00:00:00.000Z');
    const command = { ownerId: 'owner-a', key: 'v07-local-crash-claim-key1', operation: 'fitness.check_in.create' as const, resourceId: 'crash-resource', body: { localDate: '2026-09-01' } };
    const service = createV07IdempotencyService({ database, repository: createV07HealthLoopRepository(database), now: () => currentNow, newId: () => 'crash-record', newLeaseToken: () => 'crash-lease' });
    expect(() => service.executeLocal(command, () => {
      database.prepare(`insert into v07_audit_events (id, owner_id, event_type, entity_type, entity_id, entity_version, metadata_json, created_at)
        values ('crash-audit', 'owner-a', 'CRASH', 'TEST', 'crash-resource', 1, '{}', '2026-09-01T00:00:00.000Z')`).run();
      throw new Error('SIMULATED_PROCESS_CRASH');
    })).toThrow('SIMULATED_PROCESS_CRASH');
    expect(database.prepare('select state, lease_token from v07_idempotency_records where id = ?').get('crash-record'))
      .toEqual({ state: 'CLAIMED', lease_token: 'crash-lease' });
    expect(database.prepare('select count(*) as count from v07_audit_events where id = ?').get('crash-audit')).toEqual({ count: 0 });

    currentNow = new Date('2026-09-01T00:00:21.000Z');
    createV07IdempotencyService({ database, repository: createV07HealthLoopRepository(database), now: () => currentNow });
    expect(database.prepare('select state, response_status from v07_idempotency_records where id = ?').get('crash-record'))
      .toEqual({ state: 'FAILED', response_status: 503 });
  });

  it('atomically rolls back external finalization and recovers the run and response after a crash', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)').run('owner-a', 'owner-a', 'hash', '2026-09-01T00:00:00.000Z');
    let currentNow = new Date('2026-09-01T00:00:00.000Z');
    const repository = createV07HealthLoopRepository(database);
    const service = createV07IdempotencyService({ database, repository, now: () => currentNow, newId: () => 'external-record', newLeaseToken: () => 'external-lease' });
    const started = service.beginExternal({ ownerId: 'owner-a', key: 'v07-external-crash-key01', operation: 'fitness.workout.create', resourceId: 'check-in-a', body: { mode: 'ASSISTED' } });
    if (started.kind !== 'CLAIMED') throw new Error('expected a new external claim');
    repository.createClaimedCapabilityRun({
      id: 'external-run', ownerId: 'owner-a', capability: 'WORKOUT_TEXT_SELECTION', operation: 'fitness.workout.create',
      resourceId: 'check-in-a', providerId: 'v07-test-fixture', providerLabel: 'Synthetic crash fixture', adapterKind: 'TEST_FIXTURE',
      disclosure: { disclosureVersion: 'HEALTH_DISCLOSURE_V1' }, localDate: '2026-09-01', appVersion: '0.7.0',
      idempotencyKey: started.claim.key, requestHash: started.claim.requestHash, leaseToken: started.claim.leaseToken,
      leaseExpiresAt: started.claim.leaseExpiresAt, deadlineAt: '2026-09-01T00:00:08.000Z', createdAt: currentNow.toISOString(),
    });

    expect(() => service.completeExternal(started.claim, () => {
      repository.appendAudit({ id: 'external-crash-audit', ownerId: 'owner-a', eventType: 'CRASH', entityType: 'TEST', entityId: 'external-run', entityVersion: 1, metadata: {}, createdAt: currentNow.toISOString() });
      throw new Error('SIMULATED_EXTERNAL_CRASH');
    })).toThrow('SIMULATED_EXTERNAL_CRASH');
    expect(database.prepare('select count(*) as count from v07_audit_events where id = ?').get('external-crash-audit')).toEqual({ count: 0 });
    expect(database.prepare('select state from v07_idempotency_records where id = ?').get('external-record')).toEqual({ state: 'CLAIMED' });
    expect(database.prepare('select state from v07_capability_runs where id = ?').get('external-run')).toEqual({ state: 'RUNNING' });

    currentNow = new Date('2026-09-01T00:00:21.000Z');
    createV07IdempotencyService({ database, repository, now: () => currentNow });
    expect(database.prepare('select state, response_status from v07_idempotency_records where id = ?').get('external-record')).toEqual({ state: 'FAILED', response_status: 503 });
    expect(database.prepare('select state, failure_code from v07_capability_runs where id = ?').get('external-run')).toEqual({ state: 'FAILED', failure_code: 'V07_COMMAND_INTERRUPTED' });
  });

  it('terminalizes an expired claim before it can run again', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)').run('owner-a', 'owner-a', 'hash', '2026-09-01T00:00:00.000Z');
    let currentNow = new Date('2026-09-01T00:00:00.000Z');
    let sequence = 0;
    const service = createV07IdempotencyService({
      database,
      repository: createV07HealthLoopRepository(database),
      now: () => currentNow,
      newId: () => `v07-record-${sequence += 1}`,
      newLeaseToken: () => `v07-lease-${sequence += 1}`,
    });
    const command = { ownerId: 'owner-a', key: 'v07-idempotency-key-0002', operation: 'fitness.check_in.create' as const, resourceId: 'check-in-a', body: { localDate: '2026-09-01' } };
    const requestHash = createHash('sha256').update(canonicalJson({ ownerId: command.ownerId, operation: command.operation, resourceId: command.resourceId, body: command.body })).digest('hex');
    database.prepare(`insert into v07_idempotency_records (
      id, owner_id, idempotency_key, operation, resource_id, request_hash, state, lease_token,
      lease_expires_at, response_status, response_json, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, 'CLAIMED', ?, ?, null, null, ?, ?)`)
      .run('expired-record', command.ownerId, command.key, command.operation, command.resourceId, requestHash, 'expired-lease', '2026-09-01T00:00:20.000Z', currentNow.toISOString(), currentNow.toISOString());
    expect(() => service.executeLocal(command, () => ({ status: 201, body: { shouldNotRun: true } }))).toThrow(V07IdempotencyInProgressError);
    currentNow = new Date('2026-09-01T00:00:21.000Z');
    expect(() => service.executeLocal(command, () => ({ status: 201, body: { shouldNotRun: true } }))).toThrow(V07IdempotencyReplayError);
    expect(database.prepare('select state, response_status from v07_idempotency_records where id = ?').get('expired-record')).toEqual({ state: 'FAILED', response_status: 503 });
  });

  it('records only redacted capability evidence and makes new ledger entities immutable', () => {
    const database = openDatabase(':memory:');
    databases.push(database);
    database.prepare('insert into owners (id, username, password_hash, created_at) values (?, ?, ?, ?)').run('owner-a', 'owner-a', 'hash', '2026-09-01T00:00:00.000Z');
    const repository = createV07HealthLoopRepository(database);
    repository.appendAudit({ id: 'audit-a', ownerId: 'owner-a', eventType: 'FITNESS_CHECK_IN_CREATED', entityType: 'FITNESS_CHECK_IN', entityId: 'check-in-a', entityVersion: 1, metadata: { reasonCodes: ['RECOVERY_READY'] }, createdAt: '2026-09-01T00:00:00.000Z' });
    expect(database.prepare('select metadata_json from v07_audit_events where id = ?').get('audit-a')).toEqual({ metadata_json: '{"reasonCodes":["RECOVERY_READY"]}' });
    expect(() => database.prepare('update v07_audit_events set event_type = ? where id = ?').run('OTHER', 'audit-a')).toThrow();
    expect(() => database.prepare('delete from v07_audit_events where id = ?').run('audit-a')).toThrow();
  });
});
