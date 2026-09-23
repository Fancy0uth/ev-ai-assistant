import type { WorkoutPlanningInputV2, WorkoutPlanningOutputV2 } from '@ev/contracts';
export function publicGuidanceFixture(input: WorkoutPlanningInputV2): WorkoutPlanningOutputV2 {
  const walk = input.candidates.find(c => c.publicGuidance?.phases.includes('WARMUP'))!;
  const chair = input.candidates.find(c => c.publicGuidance?.reps?.max === 5)!;
  const timed = { citationId: walk.citationId, rounds: 1, reps: null, secondsPerRep: null, durationSeconds: 300, restSeconds: 0, transitionSeconds: 30, intensity: 'LOW' as const, reason: 'Synthetic public guidance fixture' };
  return { schemaVersion: 'WORKOUT_PLAN_V2', title: 'Synthetic sourced plan', rationale: 'Not a real provider result', goal: input.goal,
    items: [{ ...timed, phase: 'WARMUP' }, { ...timed, citationId: chair.citationId, phase: 'MAIN', reps: 5, secondsPerRep: 3, durationSeconds: null }, { ...timed, phase: 'COOLDOWN' }], alternatives: [], totalDurationSeconds: 705 };
}
