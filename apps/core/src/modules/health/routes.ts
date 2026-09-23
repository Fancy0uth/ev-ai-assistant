import {
  APP_VERSION,
  backupHealthSnapshotSchema,
  healthResponseSchema,
  ownerOperationsHealthResponseSchema,
  readinessResponseSchema,
  type BackupHealthSnapshot,
  type OperationsHealthCheckStatus,
} from '@ev/contracts';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { authenticatedOwnerId, createAuthGuard } from '../auth/guard';
import type { AuthService } from '../auth/service';
import type { ProviderCredentialService } from '../providers/credential-service';
import type { RuntimeLogger } from '../../observability/runtime-logger';

interface HealthRouteOptions {
  authService: AuthService;
  providerCredentialService: ProviderCredentialService;
  readBackupHealthSnapshot?: () => BackupHealthSnapshot | undefined;
  runtimeLogger?: RuntimeLogger;
  schedulerStatus: 'unknown' | 'not_run';
}

function databaseHealth(database: Database.Database): {
  database: OperationsHealthCheckStatus;
  migration: OperationsHealthCheckStatus;
  schemaVersion: number;
} {
  try {
    database.prepare('select 1').get();
  } catch {
    return { database: 'down', migration: 'down', schemaVersion: 0 };
  }

  try {
    const row = database.prepare('select max(version) as version from schema_migrations').get() as {
      version: number | null;
    };
    if (typeof row.version !== 'number' || !Number.isInteger(row.version) || row.version < 0) {
      return { database: 'up', migration: 'unknown', schemaVersion: 0 };
    }
    return { database: 'up', migration: 'up', schemaVersion: row.version };
  } catch {
    return { database: 'up', migration: 'down', schemaVersion: 0 };
  }
}

function backupHealth(
  readBackupHealthSnapshot: (() => BackupHealthSnapshot | undefined) | undefined,
): OperationsHealthCheckStatus {
  if (!readBackupHealthSnapshot) return 'not_run';
  try {
    const snapshot = readBackupHealthSnapshot();
    if (!snapshot) return 'not_run';
    const parsed = backupHealthSnapshotSchema.safeParse(snapshot);
    return parsed.success ? parsed.data.status : 'unknown';
  } catch {
    return 'unknown';
  }
}

function providerHealth(
  providerCredentialService: ProviderCredentialService,
  ownerId: string,
): OperationsHealthCheckStatus {
  try {
    const metadata = providerCredentialService.getMetadata(ownerId);
    if (metadata.state === 'NOT_CONFIGURED') return 'unconfigured';
    if (metadata.lastConnectionTest === null) return 'unknown';
    return metadata.lastConnectionTest.status === 'SUCCEEDED' ? 'up' : 'down';
  } catch {
    return 'unknown';
  }
}

function runtimeLoggerHealth(runtimeLogger: RuntimeLogger | undefined): OperationsHealthCheckStatus {
  const status = runtimeLogger?.status;
  return status === 'up' || status === 'degraded'
    ? status
    : 'unconfigured';
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  database: Database.Database,
  options: HealthRouteOptions,
): Promise<void> {
  app.get('/v1/health/live', async () => {
    return healthResponseSchema.parse({
      status: 'ok',
      service: 'ev-core',
      version: APP_VERSION,
    });
  });

  app.get('/v1/health/ready', async (_request, reply) => {
    try {
      database.prepare('select 1').get();
      return readinessResponseSchema.parse({
        status: 'ready',
        checks: { database: 'up' },
      });
    } catch {
      return reply.status(503).send(
        readinessResponseSchema.parse({
          status: 'not_ready',
          checks: { database: 'down' },
        }),
      );
    }
  });

  const authGuard = createAuthGuard(options.authService, { readOnlySessionLookup: true });
  app.get('/v1/health', { preHandler: authGuard }, async (request) => {
    const ownerId = authenticatedOwnerId(request);
    const databaseCheck = databaseHealth(database);
    return ownerOperationsHealthResponseSchema.parse({
      appVersion: APP_VERSION,
      schemaVersion: databaseCheck.schemaVersion,
      checks: {
        database: databaseCheck.database,
        migration: databaseCheck.migration,
        backup: backupHealth(options.readBackupHealthSnapshot),
        provider: providerHealth(options.providerCredentialService, ownerId),
        scheduler: options.schedulerStatus,
        log: runtimeLoggerHealth(options.runtimeLogger),
      },
    });
  });
}
