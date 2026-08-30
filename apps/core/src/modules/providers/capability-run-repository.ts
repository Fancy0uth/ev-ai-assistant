import type Database from 'better-sqlite3';

export interface CapabilityRunRepository {
  sweepExpired(now: string): number;
}

export function createCapabilityRunRepository(database: Database.Database): CapabilityRunRepository {
  const terminalize = database.prepare(`update external_capability_runs
    set status = 'FAILED', failure_code = 'CAPABILITY_EXECUTION_STALE', lease_token = null,
        lease_expires_at = null, updated_at = ?, version = version + 1
    where status = 'RUNNING' and lease_expires_at is not null and lease_expires_at <= ?`);
  return {
    sweepExpired(now) {
      return terminalize.run(now, now).changes;
    },
  };
}
