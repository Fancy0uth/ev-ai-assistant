import { createHash } from 'node:crypto';
import { realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Socket } from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { workoutPlanningInputV2Schema, type WorkoutPlanningInputV2, type WorkoutPlanningOutputV2 } from '@ev/contracts';
import { validateWorkoutPlanV2, type WorkoutPlanningProvider } from '@ev/domain';

// Dedicated entry point only. Never imported by the production server.
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'));
const configured = process.env.EV_E2E_RUN_DIR;
const data = process.env.EV_DATA_DIR;
const logs = process.env.EV_LOG_DIR;
if (process.env.NODE_ENV !== 'test'
  || process.env.EV_E2E_MANAGED !== '1'
  || process.env.EV_E2E_FITNESS_PLANNING_TEST_BOOTSTRAP !== '1'
  || process.env.EV_CORE_HOST !== '127.0.0.1'
  || process.env.EV_CORE_PORT !== '4327'
  || !configured || !data || !logs
  || !isAbsolute(configured) || !isAbsolute(data) || !isAbsolute(logs)) {
  throw new Error('FIT04C_BOOTSTRAP_GATE_REJECTED');
}
const runDirectory = realpathSync(configured);
const runsRoot = realpathSync(join(root, 'data', 'e2e-runs'));
if (dirname(realpathSync(join(root, 'data'))) !== root
  || dirname(runsRoot) !== realpathSync(join(root, 'data'))
  || dirname(runDirectory) !== runsRoot
  || !basename(runDirectory).startsWith('managed-run-')
  || realpathSync(data) !== runDirectory
  || realpathSync(logs) !== join(runDirectory, 'logs')) {
  throw new Error('FIT04C_RUN_DIRECTORY_REJECTED');
}

// Core serves incoming loopback traffic; it needs no outgoing connection at all.
// Install before loading App/adapters. Fixed errors never disclose request URLs/body.
let blockedNetworkRequests = 0;
function denyNetwork(): never {
  blockedNetworkRequests += 1;
  writeFileSync(join(runDirectory, 'fitness-planning-network-evidence.json'), JSON.stringify({ blockedNetworkRequests }));
  throw new Error('FIT04C_OUTBOUND_NETWORK_DENIED');
}
globalThis.fetch = async () => denyNetwork();
Socket.prototype.connect = denyNetwork;
syncBuiltinESMExports();
writeFileSync(join(runDirectory, 'fitness-planning-network-evidence.json'), JSON.stringify({ blockedNetworkRequests }));

type CallEvidence = { call: number; candidateHash: string; feedbackCount: number; feedbackIds: string[]; memoryCount: number };
const calls: CallEvidence[] = [];
const descriptor = {
  providerId: 'v07-test-fixture',
  providerLabel: 'FIT04c isolated workout-planning FAKE',
  adapterKind: 'TEST_FIXTURE',
  evidenceKind: 'AUTOMATED_TEST_FIXTURE',
} as const;

function createPlan(input: WorkoutPlanningInputV2): WorkoutPlanningOutputV2 {
  // One supplied citation may occur once in each of the three distinct phases.
  // Try only the bounded input set; domain validation remains the final authority.
  for (const candidate of input.candidates) {
    if (candidate.sourceKind !== 'INTERNAL_STARTER') continue;
    const limits = candidate.parameterLimits;
    if (limits.durationSecondsMax === 'UNKNOWN') continue;
    const durationSeconds = Math.min(30, limits.durationSecondsMax);
    const output: WorkoutPlanningOutputV2 = {
      schemaVersion: 'WORKOUT_PLAN_V2',
      title: 'FIT04c FAKE detailed workout',
      rationale: 'Synthetic test output using the supplied starter technical limits.',
      goal: input.goal,
      items: (['WARMUP', 'MAIN', 'COOLDOWN'] as const).map((phase) => ({
        citationId: candidate.citationId, phase, rounds: 1,
        reps: null, secondsPerRep: null, durationSeconds,
        restSeconds: 0, transitionSeconds: 0, intensity: 'LOW',
        reason: 'FAKE bounded starter phase for automated testing.',
      })),
      alternatives: [], totalDurationSeconds: durationSeconds * 3,
    };
    try { return validateWorkoutPlanV2(input, output).plan; } catch { /* Try next supplied candidate, never relax validation. */ }
  }
  throw new Error('FIT04C_NO_LEGAL_STARTER_PLAN');
}

const workoutPlanningProvider: WorkoutPlanningProvider = {
  descriptor,
  async generateWorkout(_ownerId, rawInput, signal) {
    if (signal.aborted) throw new Error('FIT04C_FAKE_ABORTED');
    const parsed = workoutPlanningInputV2Schema.safeParse(rawInput);
    if (!parsed.success) throw new Error('FIT04C_FAKE_INPUT_REJECTED');
    if (calls.length >= 2) throw new Error('FIT04C_FAKE_CALL_LIMIT');
    const input = parsed.data;
    const output = createPlan(input);
    calls.push({
      call: calls.length + 1,
      candidateHash: createHash('sha256').update(JSON.stringify(input.candidates)).digest('hex'),
      feedbackCount: input.recentFeedback.length,
      feedbackIds: input.recentFeedback.map((feedback) => feedback.feedbackId),
      memoryCount: input.selectedFitnessMemory.length,
    });
    writeFileSync(join(runDirectory, 'fitness-planning-fake-evidence.json'), JSON.stringify({
      schemaVersion: 'FITNESS_PLANNING_FAKE_EVIDENCE_V1', descriptor, calls,
    }));
    return output;
  },
};

const { buildApp } = await import('../src/app');
// This direct option intentionally fails typechecking until FIT03e adds the frozen port.
// No cast, ignored diagnostic, credential seeding, or default production Fake.
const app = await buildApp({
  databasePath: join(runDirectory, 'app.sqlite'),
  artifactRoot: join(runDirectory, 'artifacts'),
  memoryProjectionRoot: join(runDirectory, 'memory'),
  runtimeLogRoot: logs,
  logger: true, secureCookies: false, enableDailyPlanAutomation: false,
  workoutPlanningProvider,
  v07TestAdapterGate: { nodeEnv: 'test', enabled: true, runnerDataRoot: runDirectory },
  dailyPlanningProvider: { async generate() { throw new Error('FIT04C_REQUIRES_LOCAL_RULES'); } },
});
let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  try { await app.close(); } catch { process.stderr.write('FIT04C_SHUTDOWN_FAILED\n'); process.exitCode = 1; }
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
try { await app.listen({ host: '127.0.0.1', port: 4327 }); }
catch { process.stderr.write('FIT04C_STARTUP_FAILED\n'); process.exitCode = 1; await shutdown(); }
