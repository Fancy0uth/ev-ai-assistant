import { join, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { DailyPlanModelOutput } from '@ev/contracts';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPublicResourceFetcher } from '../src/modules/learning/public-resource-fetcher';
import type {
  DailyPlanningProvider,
  DailyPlanningProviderInput,
  DailyPlanningProviderResult,
} from '../src/modules/daily-planning/provider';
import type {
  LearningAdviceCapability,
  PublicSearchCapability,
  VisionCapability,
} from '../src/modules/providers/capabilities';
import { SecretStoreUnavailableError, type SecretStorePort } from '../src/modules/providers/secret-store';
import { openDatabase } from '../src/storage/database';
import { createV07HealthTestAdapters } from './v0.7-health-test-adapters';
import { V07_HEALTH_EVIDENCE_FILE, writeV07HealthEvidence } from './v0.7-health-evidence';

const TEST_BOOTSTRAP_FLAG = 'EV_E2E_DAILY_PLAN_TEST_BOOTSTRAP';
const TEST_CREDENTIAL_MARKER = 'daily-plan-e2e-credential';
const TEST_PROVIDER_KEY = 'daily-plan-e2e-provider-key';
const TEST_CREDENTIAL_SKIP_QUERY = 'e2eWithoutTestCredential';
const TEST_PROVIDER_EVIDENCE_FILE = 'daily-plan-fake-provider-evidence.json';
const V06_FAKE_EVIDENCE_FILE = 'v0.6-learning-fake-evidence.json';

// This is out-of-band test infrastructure for a runner-owned, isolated EV_DATA_DIR.
// It proves neither the Owner UI -> Core -> DPAPI credential path nor any real DeepSeek request.

if (
  process.env[TEST_BOOTSTRAP_FLAG] !== '1' ||
  process.env.NODE_ENV !== 'test' ||
  process.env.EV_E2E_V06_LEARNING_TEST_ADAPTERS !== '1'
  || process.env.EV_E2E_V07_HEALTH_TEST_ADAPTERS !== '1'
) {
  throw new Error('The daily plan E2E bootstrap may run only with its explicit test-only environment.');
}

const config = loadConfig();
const runDirectory = process.env.EV_E2E_RUN_DIR;
if (!runDirectory || resolve(config.dataDir) !== resolve(runDirectory)) {
  throw new Error('The daily plan E2E bootstrap requires the runner-owned EV_E2E_RUN_DIR.');
}

const testProviderEvidencePath = join(runDirectory, TEST_PROVIDER_EVIDENCE_FILE);
const v06FakeEvidencePath = join(runDirectory, V06_FAKE_EVIDENCE_FILE);
const v07HealthEvidencePath = join(runDirectory, V07_HEALTH_EVIDENCE_FILE);
const testProviderInvocations: Array<{
  localDate: string;
  timeRequests: Array<{
    safeTitle: string;
    durationMinutes: number;
    availability: {
      earliestStartLocalTime: string | null;
      latestEndLocalTime: string | null;
    };
  }>;
}> = [];
const v06FakeEvidence: Array<{ capability: 'VISION' | 'PUBLIC_SEARCH' | 'PUBLIC_FETCH' | 'LEARNING_ADVICE' }> = [];

async function recordV06FakeEvidence(capability: (typeof v06FakeEvidence)[number]['capability']): Promise<void> {
  v06FakeEvidence.push({ capability });
  await writeFile(v06FakeEvidencePath, JSON.stringify(v06FakeEvidence), 'utf8');
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
  async generate(apiKey: string, input: DailyPlanningProviderInput): Promise<DailyPlanningProviderResult> {
    if (apiKey !== TEST_PROVIDER_KEY) {
      throw new Error('The daily plan E2E provider received an unexpected credential.');
    }
    if (input.timeRequests.some((request) => request.durationMinutes !== 60)) {
      throw new Error('The daily plan E2E provider supports only deterministic one-hour fixtures.');
    }
    testProviderInvocations.push({
      localDate: input.localDate,
      timeRequests: input.timeRequests.map((request) => ({
        safeTitle: request.safeTitle,
        durationMinutes: request.durationMinutes,
        availability: request.availability,
      })),
    });
    await writeFile(testProviderEvidencePath, JSON.stringify(testProviderInvocations), 'utf8');

    const actions = input.timeRequests.map((request, index) => {
      const isV06LearningFixture = request.safeTitle === 'V6 cited linear algebra study';
      const startHour = 12 + index * 2;
      const startLocalTime = isV06LearningFixture
        ? request.availability.earliestStartLocalTime
        : `${String(startHour).padStart(2, '0')}:00`;
      const endLocalTime = isV06LearningFixture
        ? request.availability.latestEndLocalTime
        : `${String(startHour + 1).padStart(2, '0')}:00`;
      if (!startLocalTime || !endLocalTime) {
        throw new Error('The v0.6 E2E learning fixture requires a reviewed one-hour availability window.');
      }
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
    return {
      output,
      model: 'deepseek-v4-flash',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      outputChars: JSON.stringify(output).length,
    };
  }
}

const v06Vision: VisionCapability = {
  descriptor: {
    providerId: 'v06-e2e-vision',
    providerLabel: '自动测试 Fake Vision',
    adapterKind: 'TEST_FAKE',
  },
  async extractCourseSchedule() {
    await recordV06FakeEvidence('VISION');
    return {
      candidates: [{
        title: 'V6 Fake Timetable Course',
        location: 'V6-A101',
        weekday: 1,
        startLocalTime: '09:00',
        endLocalTime: '10:00',
        weekStart: 1,
        weekEnd: 1,
        weekPattern: 'EVERY_WEEK',
        confidence: {
          overall: 1,
          fields: {
            title: 1,
            location: 1,
            weekday: 1,
            startLocalTime: 1,
            endLocalTime: 1,
            weekStart: 1,
            weekEnd: 1,
            weekPattern: 1,
          },
        },
      }],
    };
  },
};

const v06PublicSearch: PublicSearchCapability = {
  descriptor: {
    providerId: 'v06-e2e-public-search',
    providerLabel: '自动测试 Fake Public Search',
    adapterKind: 'TEST_FAKE',
  },
  async search() {
    await recordV06FakeEvidence('PUBLIC_SEARCH');
    return {
      results: [{
        title: 'V6 public linear algebra material',
        publisherHint: 'V6 public example',
        url: 'https://learning.example/v6-linear-algebra',
      }],
    };
  },
};

const v06LearningAdvice: LearningAdviceCapability = {
  descriptor: {
    providerId: 'v06-e2e-learning-advice',
    providerLabel: '自动测试 Fake Learning Advice',
    adapterKind: 'TEST_FAKE',
  },
  async generate(input) {
    await recordV06FakeEvidence('LEARNING_ADVICE');
    const material = input.materials[0];
    if (!material) throw new Error('The v0.6 E2E learning fake requires one selected citation.');
    return {
      schemaVersion: 'CITED_LEARNING_ADVICE_V1',
      title: 'V6 cited linear algebra study',
      rationale: 'Use the selected public material for one focused review block.',
      citationIds: [material.citationId],
      durationMinutes: 60,
      priority: 'MEDIUM',
    };
  },
};

const v06PublicResourceFetcher = createPublicResourceFetcher({
  resolveAll: async () => [{ address: '93.184.216.34', family: 4 as const }],
  transport: async () => {
    await recordV06FakeEvidence('PUBLIC_FETCH');
    return {
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: (async function* () {
        yield Buffer.from('<article>V6 public linear algebra material: vector spaces and linear transformations.</article>');
      })(),
    };
  },
});

const databasePath = join(config.dataDir, 'app.sqlite');
const v07HealthAdapters = createV07HealthTestAdapters();
const app = await buildApp({
  databasePath,
  memoryProjectionRoot: join(config.dataDir, 'memory'),
  logger: true,
  secureCookies: config.secureCookies,
  enableDailyPlanAutomation: true,
  dailyPlanningProvider: new TestOnlyDailyPlanningProvider(),
  secretStore: new TestOnlyDailyPlanCredentialPort(),
  visionCapability: v06Vision,
  publicSearchCapability: v06PublicSearch,
  publicResourceFetcher: v06PublicResourceFetcher,
  learningAdviceCapability: v06LearningAdvice,
  ...v07HealthAdapters,
  v07TestAdapterGate: { nodeEnv: 'test', enabled: true, runnerDataRoot: runDirectory },
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
let v07EvidenceWrite = Promise.resolve();

function isGenerationRequest(url: string | undefined): boolean {
  const requestUrl = new URL(url ?? '/', 'http://127.0.0.1');
  return requestUrl.pathname === '/v1/daily-plans/generate';
}

function requiresTestCredential(url: string | undefined): boolean {
  const requestUrl = new URL(url ?? '/', 'http://127.0.0.1');
  return isGenerationRequest(url) && !requestUrl.searchParams.has(TEST_CREDENTIAL_SKIP_QUERY);
}

function isV07HealthRequest(url: string | undefined): boolean {
  const pathname = new URL(url ?? '/', 'http://127.0.0.1').pathname;
  return pathname.startsWith('/v1/fitness/') || pathname.startsWith('/v1/nutrition/');
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
app.addHook('onResponse', async (request) => {
  if (!isV07HealthRequest(request.raw.url)) return;
  v07EvidenceWrite = v07EvidenceWrite.then(
    () => writeV07HealthEvidence(credentialDatabase, v07HealthEvidencePath),
  );
  await v07EvidenceWrite;
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
