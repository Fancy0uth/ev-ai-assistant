import { join, resolve } from 'node:path';
import type { DailyPlanModelOutput } from '@ev/contracts';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { DailyPlanningProvider, DailyPlanningProviderInput } from '../src/modules/daily-planning/provider';
import { SecretStoreUnavailableError, type SecretStorePort } from '../src/modules/providers/secret-store';
import { openDatabase } from '../src/storage/database';

const TEST_BOOTSTRAP_FLAG = 'EV_E2E_DAILY_PLAN_TEST_BOOTSTRAP';
const TEST_CREDENTIAL_MARKER = 'daily-plan-e2e-credential';
const TEST_PROVIDER_KEY = 'daily-plan-e2e-provider-key';
const TEST_CREDENTIAL_SKIP_QUERY = 'e2eWithoutTestCredential';

if (process.env[TEST_BOOTSTRAP_FLAG] !== '1' || process.env.NODE_ENV !== 'test') {
  throw new Error('The daily plan E2E bootstrap may run only with its explicit test-only environment.');
}

const config = loadConfig();
const runDirectory = process.env.EV_E2E_RUN_DIR;
if (!runDirectory || resolve(config.dataDir) !== resolve(runDirectory)) {
  throw new Error('The daily plan E2E bootstrap requires the runner-owned EV_E2E_RUN_DIR.');
}

class TestOnlyDailyPlanCredentialPort implements SecretStorePort {
  async protect(plaintext: string): Promise<string> {
    void plaintext;
    return TEST_CREDENTIAL_MARKER;
  }

  async unprotect(protectedValue: string): Promise<string> {
    if (protectedValue !== TEST_CREDENTIAL_MARKER) throw new SecretStoreUnavailableError();
    return TEST_PROVIDER_KEY;
  }
}

class TestOnlyDailyPlanningProvider implements DailyPlanningProvider {
  async generate(apiKey: string, input: DailyPlanningProviderInput): Promise<unknown> {
    if (apiKey !== TEST_PROVIDER_KEY) {
      throw new Error('The daily plan E2E provider received an unexpected credential.');
    }
    if (input.timeRequests.some((request) => request.durationMinutes !== 60)) {
      throw new Error('The daily plan E2E provider supports only deterministic one-hour fixtures.');
    }

    const actions = input.timeRequests.map((request, index) => {
      const startHour = 12 + index * 2;
      const startLocalTime = `${String(startHour).padStart(2, '0')}:00`;
      const endLocalTime = `${String(startHour + 1).padStart(2, '0')}:00`;
      return {
        operation: 'SCHEDULE_TIME_REQUEST' as const,
        contextRef: request.contextRef,
        startLocalTime,
        endLocalTime,
        rationale: '由测试 Fake Provider 在请求可用窗口内生成的一小时审核安排。',
      };
    });
    const output: DailyPlanModelOutput = {
      schemaVersion: 'DAILY_PLAN_MODEL_V1',
      summary: '由测试 Fake Provider 生成的待审核安排。',
      actions,
    };
    return output;
  }
}

const databasePath = join(config.dataDir, 'app.sqlite');
const app = await buildApp({
  databasePath,
  memoryProjectionRoot: join(config.dataDir, 'memory'),
  logger: true,
  secureCookies: config.secureCookies,
  enableDailyPlanAutomation: true,
  dailyPlanningProvider: new TestOnlyDailyPlanningProvider(),
  secretStore: new TestOnlyDailyPlanCredentialPort(),
});
const credentialDatabase = openDatabase(databasePath);
const insertTestCredential = credentialDatabase.prepare(
  `insert into provider_credentials (
     owner_id, provider_key, protected_value, version, created_at, updated_at
   )
   values (?, 'DEEPSEEK', ?, 1, ?, ?)
   on conflict(owner_id, provider_key) do update set
     protected_value = excluded.protected_value,
     version = provider_credentials.version + 1,
     updated_at = excluded.updated_at`,
);
const listOwnerIds = credentialDatabase.prepare('select id from owners');
const removeTestCredential = credentialDatabase.prepare(
  `delete from provider_credentials
   where provider_key = 'DEEPSEEK' and protected_value = ?`,
);

function isGenerationRequest(url: string | undefined): boolean {
  const requestUrl = new URL(url ?? '/', 'http://127.0.0.1');
  return requestUrl.pathname === '/v1/daily-plans/generate';
}

function requiresTestCredential(url: string | undefined): boolean {
  const requestUrl = new URL(url ?? '/', 'http://127.0.0.1');
  return isGenerationRequest(url) && !requestUrl.searchParams.has(TEST_CREDENTIAL_SKIP_QUERY);
}

app.addHook('onRequest', (request, _reply, done) => {
  if (requiresTestCredential(request.raw.url)) {
    const now = new Date().toISOString();
    const owners = listOwnerIds.all() as Array<{ id: string }>;
    for (const owner of owners) {
      insertTestCredential.run(owner.id, TEST_CREDENTIAL_MARKER, now, now);
    }
  }
  done();
});
app.addHook('onResponse', (request, _reply, done) => {
  if (requiresTestCredential(request.raw.url)) {
    removeTestCredential.run(TEST_CREDENTIAL_MARKER);
  }
  done();
});
app.addHook('onClose', async () => {
  if (credentialDatabase.open) credentialDatabase.close();
});

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.log.info({ signal }, 'Stopping Core E2E test bootstrap');
  await app.close();
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ error }, 'Core E2E test bootstrap failed to start');
  process.exitCode = 1;
}
