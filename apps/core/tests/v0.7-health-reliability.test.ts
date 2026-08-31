import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createV07IdempotencyService, V07IdempotencyConflictError } from '../src/modules/health-loop/idempotency-service';
import { canonicalJson, createV07HealthLoopRepository } from '../src/modules/health-loop/repository';
import { openDatabase } from '../src/storage/database';

const databases: Database.Database[] = [];
afterEach(() => { while (databases.length > 0) databases.pop()?.close(); });

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
    expect(service.executeLocal(command, () => ({ status: 201, body: { shouldNotRun: true } }))).toEqual({ kind: 'IN_PROGRESS', retryAfterSeconds: 1 });
    currentNow = new Date('2026-09-01T00:00:21.000Z');
    expect(service.executeLocal(command, () => ({ status: 201, body: { shouldNotRun: true } }))).toEqual({ status: 503, body: { error: { code: 'V07_COMMAND_INTERRUPTED' } }, replayed: true });
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
