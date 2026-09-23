import type {
  CreateFitnessCheckInInput,
  ExerciseCatalogItem,
  ExerciseCitation,
  WorkoutGoal,
  WorkoutPlanItem,
  WorkoutSafetyDecision,
} from '@ev/contracts';
import { calculateRecovery } from './recovery';

export function deriveWorkoutSafetyV1(input: CreateFitnessCheckInInput): WorkoutSafetyDecision {
  if (input.hasPain || input.acuteRisk) {
    const reasonCodes: Array<'SELF_REPORTED_PAIN' | 'SELF_REPORTED_ACUTE_RISK'> = [];
    if (input.hasPain) reasonCodes.push('SELF_REPORTED_PAIN');
    if (input.acuteRisk) reasonCodes.push('SELF_REPORTED_ACUTE_RISK');
    return {
      eligibility: 'BLOCKED',
      notice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP',
      reasonCodes,
      maxDurationMinutes: 0,
      intensityCap: 'NONE',
    };
  }

  const recovery = calculateRecovery({
    sleepHours: input.sleepMinutes / 60,
    energy: input.energyLevel,
    discomfort: input.discomfortLevel,
  });
  if (recovery.level === 'CAUTION') {
    return { eligibility: 'ELIGIBLE', notice: 'NON_MEDICAL_RECOVERY_GUIDANCE', reasonCodes: ['RECOVERY_CAUTION'], maxDurationMinutes: 30, intensityCap: 'LOW' };
  }
  if (recovery.level === 'MODERATE') {
    return { eligibility: 'ELIGIBLE', notice: 'NON_MEDICAL_RECOVERY_GUIDANCE', reasonCodes: ['RECOVERY_MODERATE'], maxDurationMinutes: 45, intensityCap: 'LOW' };
  }
  return { eligibility: 'ELIGIBLE', notice: 'NON_MEDICAL_RECOVERY_GUIDANCE', reasonCodes: ['RECOVERY_READY'], maxDurationMinutes: 60, intensityCap: 'MODERATE' };
}

function hasAvailableEquipment(item: ExerciseCatalogItem, availableEquipment: readonly string[]): boolean {
  return item.equipment.every((equipment) => equipment === 'NONE' || availableEquipment.includes(equipment));
}

function scoreCatalogItem(item: ExerciseCatalogItem, goal: WorkoutGoal, availableEquipment: readonly string[], query: string | null): number {
  const queryToken = query?.trim().toLocaleLowerCase('en-US') ?? '';
  const goalMatch = item.goals.includes(goal) ? 4 : 0;
  const movementMatch = queryToken.length > 0 && ([item.name, ...item.movementTags].some((value) => value.toLocaleLowerCase('en-US').includes(queryToken))) ? 2 : 0;
  const equipmentMatch = item.equipment.some((equipment) => equipment !== 'NONE' && availableEquipment.includes(equipment)) ? 2 : 0;
  return goalMatch + movementMatch + equipmentMatch + 1;
}

export function rankExerciseCatalogV1(input: {
  safety: WorkoutSafetyDecision;
  goal: WorkoutGoal;
  availableEquipment: readonly string[];
  query: string | null;
  items: readonly ExerciseCatalogItem[];
  limit: number;
}): ExerciseCatalogItem[] {
  if (input.safety.eligibility === 'BLOCKED') return [];
  if (!Number.isInteger(input.limit) || input.limit < 1) throw new RangeError('CATALOG_LIMIT_INVALID');
  return input.items
    .filter((item) => item.impact === 'LOW' && hasAvailableEquipment(item, input.availableEquipment))
    .map((item) => ({ item, score: scoreCatalogItem(item, input.goal, input.availableEquipment, input.query) }))
    .sort((first, second) => second.score - first.score || first.item.exerciseId.localeCompare(second.item.exerciseId))
    .slice(0, Math.min(input.limit, 5))
    .map(({ item }) => item);
}

export function createWorkoutDefaultsV1(input: {
  citations: readonly ExerciseCitation[];
  catalogItems: readonly ExerciseCatalogItem[];
  durationMinutes: number;
  intensityCap: 'LOW' | 'MODERATE';
}): WorkoutPlanItem[] {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 120) {
    throw new RangeError('WORKOUT_DURATION_INVALID');
  }
  const itemsById = new Map(input.catalogItems.map((item) => [item.exerciseId, item]));
  return input.citations.map((citation) => {
    const item = itemsById.get(citation.exerciseId);
    if (!item) throw new RangeError('CATALOG_CITATION_UNKNOWN');
    const defaults = item.defaults[input.intensityCap];
    return {
      citation,
      rounds: defaults.rounds,
      reps: defaults.reps,
      durationSeconds: defaults.durationSeconds,
      restSeconds: defaults.restSeconds,
    };
  });
}
