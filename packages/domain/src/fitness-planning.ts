import {
  type HealthTextProviderDescriptor,
  workoutPlanningInputV2Schema,
  workoutPlanningOutputV2Schema,
  type WorkoutPlanItemV2,
  type WorkoutPlanningCandidateV2,
  type WorkoutPlanningInputV2,
  type WorkoutPlanningOutputV2,
} from '@ev/contracts';

export interface WorkoutPlanningProvider {
  readonly descriptor: HealthTextProviderDescriptor;
  generateWorkout(ownerId: string, input: WorkoutPlanningInputV2, signal: AbortSignal): Promise<unknown>;
}

export interface ValidatedWorkoutPlanV2 {
  readonly plan: WorkoutPlanningOutputV2;
  readonly totalDurationSeconds: number;
  readonly alternativeTotalDurationSeconds: readonly number[];
}

function fail(code: string): never {
  throw new RangeError(code);
}

function intensityRank(intensity: 'NONE' | 'LOW' | 'MODERATE'): number {
  if (intensity === 'NONE') return 0;
  if (intensity === 'LOW') return 1;
  return 2;
}

function localTimeToSeconds(value: string): number {
  const [hourText = '0', minuteText = '0'] = value.split(':');
  return Number(hourText) * 3_600 + Number(minuteText) * 60;
}

function itemDurationSeconds(item: WorkoutPlanItemV2): number {
  const activeSeconds = item.durationSeconds === null
    ? item.reps * item.secondsPerRep
    : item.durationSeconds;
  return item.rounds * activeSeconds + (item.rounds - 1) * item.restSeconds + item.transitionSeconds;
}

function knownLimit(value: number | 'UNKNOWN'): number {
  if (value === 'UNKNOWN') fail('WORKOUT_PLAN_CANDIDATE_LIMIT_UNKNOWN');
  return value;
}

function validateCandidateItem(
  input: WorkoutPlanningInputV2,
  candidate: WorkoutPlanningCandidateV2,
  item: WorkoutPlanItemV2,
): void {
  if (candidate.eligibility.status !== 'ELIGIBLE') fail('WORKOUT_PLAN_CANDIDATE_INELIGIBLE');
  if (candidate.eligibility.limitations === 'UNKNOWN') fail('WORKOUT_PLAN_CANDIDATE_LIMITATIONS_UNKNOWN');
  if (!candidate.goals.includes(input.goal)) fail('WORKOUT_PLAN_CANDIDATE_GOAL_MISMATCH');
  if (input.policyVersion === 'PUBLIC_GUIDANCE_GENERAL_ADULT_V1') {
    const guidance = candidate.publicGuidance;
    if (!guidance || input.profile.generalExerciseScope !== guidance.scopeVersion) fail('WORKOUT_PLAN_APPLICABILITY_REQUIRED');
    if (!guidance.phases.includes(item.phase)) fail('WORKOUT_PLAN_GUIDANCE_PHASE_INVALID');
    if (item.rounds !== guidance.rounds) fail('WORKOUT_PLAN_GUIDANCE_DOSE_INVALID');
    if (guidance.reps) {
      if (item.reps === null || item.reps < guidance.reps.min || item.reps > guidance.reps.max
        || item.durationSeconds !== null || item.secondsPerRep !== 3) fail('WORKOUT_PLAN_GUIDANCE_DOSE_INVALID');
    } else if (!guidance.durationSeconds || item.durationSeconds === null
      || item.durationSeconds < guidance.durationSeconds.min || item.durationSeconds > guidance.durationSeconds.max
      || item.reps !== null) fail('WORKOUT_PLAN_GUIDANCE_DOSE_INVALID');
    if (item.restSeconds !== (item.rounds > 1 ? 60 : 0) || item.transitionSeconds !== 30) fail('WORKOUT_PLAN_GUIDANCE_ESTIMATE_INVALID');
  }

  const availableEquipment = new Set(input.profile.availableEquipment);
  if (!candidate.equipment.every((equipment) => equipment === 'NONE' || availableEquipment.has(equipment))) {
    fail('WORKOUT_PLAN_CANDIDATE_EQUIPMENT_UNAVAILABLE');
  }

  if (intensityRank(item.intensity) > intensityRank(candidate.intensityCap)
    || intensityRank(item.intensity) > intensityRank(input.checkIn.safety.intensityCap)) {
    fail('WORKOUT_PLAN_INTENSITY_CAP_EXCEEDED');
  }

  if (item.rounds > knownLimit(candidate.parameterLimits.roundsMax)) fail('WORKOUT_PLAN_ROUNDS_CAP_EXCEEDED');
  if (item.restSeconds > knownLimit(candidate.parameterLimits.restSecondsMax)) fail('WORKOUT_PLAN_REST_CAP_EXCEEDED');
  if (item.transitionSeconds > knownLimit(candidate.parameterLimits.transitionSecondsMax)) fail('WORKOUT_PLAN_TRANSITION_CAP_EXCEEDED');
  if (item.reps === null) {
    if (item.durationSeconds > knownLimit(candidate.parameterLimits.durationSecondsMax)) {
      fail('WORKOUT_PLAN_DURATION_CAP_EXCEEDED');
    }
    return;
  }
  if (item.reps > knownLimit(candidate.parameterLimits.repsMax)) fail('WORKOUT_PLAN_REPS_CAP_EXCEEDED');
  if (item.secondsPerRep > knownLimit(candidate.parameterLimits.secondsPerRepMax)) {
    fail('WORKOUT_PLAN_SECONDS_PER_REP_CAP_EXCEEDED');
  }
}

function maximumDurationSeconds(input: WorkoutPlanningInputV2): number {
  const userBudgetSeconds = input.scheduling.durationMinutes * 60;
  const safetyBudgetSeconds = input.checkIn.safety.maxDurationMinutes * 60;
  const { earliestStartLocalTime, latestEndLocalTime } = input.scheduling;
  const timeWindowSeconds = earliestStartLocalTime === null || latestEndLocalTime === null
    ? Number.POSITIVE_INFINITY
    : localTimeToSeconds(latestEndLocalTime) - localTimeToSeconds(earliestStartLocalTime);
  return Math.min(userBudgetSeconds, safetyBudgetSeconds, timeWindowSeconds);
}

export function validateWorkoutPlanV2(
  input: WorkoutPlanningInputV2,
  output: WorkoutPlanningOutputV2,
): ValidatedWorkoutPlanV2 {
  const parsedInput = workoutPlanningInputV2Schema.safeParse(input);
  if (!parsedInput.success) fail('WORKOUT_PLAN_INPUT_INVALID');
  const parsedOutput = workoutPlanningOutputV2Schema.safeParse(output);
  if (!parsedOutput.success) fail('WORKOUT_PLAN_OUTPUT_INVALID');

  const planningInput = parsedInput.data;
  const workoutPlan = parsedOutput.data;
  if (planningInput.checkIn.hasPain || planningInput.checkIn.acuteRisk || planningInput.checkIn.safety.eligibility !== 'ELIGIBLE') {
    fail('WORKOUT_PLAN_SAFETY_BLOCKED');
  }
  if (!planningInput.profile.limitationsComplete || planningInput.profile.limitations === 'UNKNOWN') {
    fail('WORKOUT_PLAN_LIMITATIONS_UNKNOWN');
  }
  if (!planningInput.profile.goals.includes(planningInput.goal) || workoutPlan.goal !== planningInput.goal) {
    fail('WORKOUT_PLAN_GOAL_MISMATCH');
  }

  for (const requiredField of ['CHECK_IN', 'PROFILE_LIMITATIONS', 'CANDIDATES', 'SCHEDULING']) {
    if (!planningInput.authorization.allowedFields.includes(requiredField as typeof planningInput.authorization.allowedFields[number])) {
      fail('WORKOUT_PLAN_AUTHORIZATION_INSUFFICIENT');
    }
  }

  const candidatesByCitation = new Map(planningInput.candidates.map((candidate) => [candidate.citationId, candidate]));
  const allItems = [...workoutPlan.items, ...workoutPlan.alternatives.map((alternative) => alternative.item)];
  if (new Set(allItems.map((item) => item.citationId)).size > 5) fail('WORKOUT_PLAN_CITATION_LIMIT_EXCEEDED');

  for (const item of allItems) {
    const candidate = candidatesByCitation.get(item.citationId);
    if (candidate === undefined) fail('WORKOUT_PLAN_CITATION_UNKNOWN');
    validateCandidateItem(planningInput, candidate, item);
  }

  const itemDurations = workoutPlan.items.map(itemDurationSeconds);
  const totalDurationSeconds = itemDurations.reduce((total, duration) => total + duration, 0);
  if (totalDurationSeconds !== workoutPlan.totalDurationSeconds) fail('WORKOUT_PLAN_DURATION_MISMATCH');

  const maximumDuration = maximumDurationSeconds(planningInput);
  if (totalDurationSeconds > maximumDuration) fail('WORKOUT_PLAN_TIME_WINDOW_EXCEEDED');

  let maximumAlternativeCombinationDuration = totalDurationSeconds;
  const alternativeTotalDurationSeconds = workoutPlan.alternatives.map((alternative) => {
    const replacedDuration = itemDurations[alternative.replacesItemIndex];
    if (replacedDuration === undefined) fail('WORKOUT_PLAN_ALTERNATIVE_INDEX_INVALID');
    const alternativeItemDuration = itemDurationSeconds(alternative.item);
    const alternativeDuration = totalDurationSeconds - replacedDuration + alternativeItemDuration;
    if (alternativeDuration > maximumDuration) fail('WORKOUT_PLAN_ALTERNATIVE_TIME_WINDOW_EXCEEDED');
    maximumAlternativeCombinationDuration += Math.max(0, alternativeItemDuration - replacedDuration);
    return alternativeDuration;
  });
  if (maximumAlternativeCombinationDuration > maximumDuration) {
    fail('WORKOUT_PLAN_ALTERNATIVE_COMBINATION_TIME_WINDOW_EXCEEDED');
  }

  return { plan: workoutPlan, totalDurationSeconds, alternativeTotalDurationSeconds };
}
