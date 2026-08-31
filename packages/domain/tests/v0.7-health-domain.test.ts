import { describe, expect, it } from 'vitest';
import type { ExerciseCatalogItem, ExerciseCitation, WorkoutSafetyDecision } from '@ev/contracts';
import {
  calculateMealTotalsV1,
  createWorkoutDefaultsV1,
  deriveWorkoutSafetyV1,
  formatCanonicalDecimalFromMicros,
  parseCanonicalDecimalToMicros,
  rankExerciseCatalogV1,
  scaleNutrientV1,
} from '../src/index';

const hash = (character: string) => character.repeat(64);
const citation = (exerciseId: string, character: string): ExerciseCitation => ({
  citationId: hash(character), catalogId: 'ev-ai-internal-starter', catalogVersion: '2026.08.31.1', catalogHash: hash('c'),
  exerciseId, itemHash: hash(character.toUpperCase()), sourceKind: 'FIRST_PARTY_INTERNAL' as const, redistribution: false as const,
});

const catalog: ExerciseCatalogItem[] = [
  {
    exerciseId: 'alpha-move', name: 'Alpha move', neutralTechniqueText: 'Controlled practice.', goals: ['STRENGTH'] as const,
    movementTags: ['HINGE'], equipment: ['NONE'], impact: 'LOW' as const,
    defaults: { LOW: { rounds: 2, reps: 6, durationSeconds: null, restSeconds: 45 }, MODERATE: { rounds: 3, reps: 8, durationSeconds: null, restSeconds: 45 } },
  },
  {
    exerciseId: 'beta-move', name: 'Beta move', neutralTechniqueText: 'Controlled practice.', goals: ['STRENGTH'] as const,
    movementTags: ['HINGE'], equipment: ['MAT'], impact: 'LOW' as const,
    defaults: { LOW: { rounds: 2, reps: 6, durationSeconds: null, restSeconds: 45 }, MODERATE: { rounds: 3, reps: 8, durationSeconds: null, restSeconds: 45 } },
  },
];

describe('v0.7 deterministic health domain policy', () => {
  it('blocks every reported pain or acute-risk combination before recovery output can select a workout', () => {
    for (const [hasPain, acuteRisk, reasonCodes] of [
      [true, false, ['SELF_REPORTED_PAIN']],
      [false, true, ['SELF_REPORTED_ACUTE_RISK']],
      [true, true, ['SELF_REPORTED_PAIN', 'SELF_REPORTED_ACUTE_RISK']],
    ] as const) {
      expect(deriveWorkoutSafetyV1({
        localDate: '2026-09-01', sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain, acuteRisk,
      })).toEqual({
        eligibility: 'BLOCKED', notice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP', reasonCodes, maxDurationMinutes: 0, intensityCap: 'NONE',
      });
    }
  });

  it('derives every eligible recovery branch and ranks stable catalog ties without exceeding five items', () => {
    expect(deriveWorkoutSafetyV1({ localDate: '2026-09-01', sleepMinutes: 480, energyLevel: 5, discomfortLevel: 0, hasPain: false, acuteRisk: false }))
      .toMatchObject({ eligibility: 'ELIGIBLE', maxDurationMinutes: 60, intensityCap: 'MODERATE', reasonCodes: ['RECOVERY_READY'] });
    expect(deriveWorkoutSafetyV1({ localDate: '2026-09-01', sleepMinutes: 360, energyLevel: 3, discomfortLevel: 1, hasPain: false, acuteRisk: false }))
      .toMatchObject({ eligibility: 'ELIGIBLE', maxDurationMinutes: 45, intensityCap: 'LOW', reasonCodes: ['RECOVERY_MODERATE'] });
    expect(deriveWorkoutSafetyV1({ localDate: '2026-09-01', sleepMinutes: 0, energyLevel: 1, discomfortLevel: 5, hasPain: false, acuteRisk: false }))
      .toMatchObject({ eligibility: 'ELIGIBLE', maxDurationMinutes: 30, intensityCap: 'LOW', reasonCodes: ['RECOVERY_CAUTION'] });

    const safety: WorkoutSafetyDecision = { eligibility: 'ELIGIBLE', notice: 'NON_MEDICAL_RECOVERY_GUIDANCE', reasonCodes: ['RECOVERY_READY'], maxDurationMinutes: 60, intensityCap: 'MODERATE' };
    expect(rankExerciseCatalogV1({ safety, goal: 'STRENGTH', availableEquipment: [], query: null, items: catalog, limit: 9 }).map((item) => item.exerciseId))
      .toEqual(['alpha-move']);
    expect(rankExerciseCatalogV1({ safety: { eligibility: 'BLOCKED', notice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP', reasonCodes: ['SELF_REPORTED_PAIN'], maxDurationMinutes: 0, intensityCap: 'NONE' }, goal: 'STRENGTH', availableEquipment: ['MAT'], query: null, items: catalog, limit: 5 }))
      .toEqual([]);
  });

  it('derives workout defaults only from cited catalog records', () => {
    expect(createWorkoutDefaultsV1({
      citations: [citation('alpha-move', 'a')], catalogItems: catalog, durationMinutes: 30, intensityCap: 'LOW',
    })).toEqual([{ citation: citation('alpha-move', 'a'), rounds: 2, reps: 6, durationSeconds: null, restSeconds: 45 }]);
  });

  it('parses, rounds, formats and totals canonical decimal micros without floating-point inputs', () => {
    expect(parseCanonicalDecimalToMicros('0.000001')).toBe(1n);
    expect(parseCanonicalDecimalToMicros('999999.999999')).toBe(999_999_999_999n);
    expect(formatCanonicalDecimalFromMicros(1n)).toBe('0.000001');
    expect(formatCanonicalDecimalFromMicros(1_000_000n)).toBe('1');
    expect(scaleNutrientV1('1', '1', '3')).toBe('0.333333');
    expect(scaleNutrientV1('1', '2', '3')).toBe('0.666667');
    expect(calculateMealTotalsV1([
      { energyKcalDecimal: '0.333333', proteinGramsDecimal: '0.333333', carbohydrateGramsDecimal: '0.333333', fatGramsDecimal: '0.333333' },
      { energyKcalDecimal: '0.666667', proteinGramsDecimal: '0.666667', carbohydrateGramsDecimal: '0.666667', fatGramsDecimal: '0.666667' },
    ])).toEqual({ energyKcalDecimal: '1', proteinGramsDecimal: '1', carbohydrateGramsDecimal: '1', fatGramsDecimal: '1' });
    for (const invalid of ['0.0', '0.000000', '1.0', '1.2300']) expect(() => parseCanonicalDecimalToMicros(invalid)).toThrow('DECIMAL_NON_CANONICAL');
    expect(() => formatCanonicalDecimalFromMicros(1_000_000_000_000n)).toThrow('DECIMAL_OUT_OF_RANGE');
    expect(() => scaleNutrientV1('999999.999999', '999999.999999', '0.000001')).toThrow('DECIMAL_OUT_OF_RANGE');
    expect(() => calculateMealTotalsV1([
      { energyKcalDecimal: '999999.999999', proteinGramsDecimal: '0', carbohydrateGramsDecimal: '0', fatGramsDecimal: '0' },
      { energyKcalDecimal: '0.000001', proteinGramsDecimal: '0', carbohydrateGramsDecimal: '0', fatGramsDecimal: '0' },
    ])).toThrow('DECIMAL_OUT_OF_RANGE');
  });
});
