import { describe, expect, it } from 'vitest';
import { workoutContextPreviewV2Schema } from '@ev/contracts';
import * as domain from '../src/index';

type WorkoutPlanValidator = (input: unknown, output: unknown) => {
  plan: unknown;
  totalDurationSeconds: number;
  alternativeTotalDurationSeconds: readonly number[];
};

const hash = (character: string) => character.repeat(64);
const utf8Bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const validateWorkoutPlanV2 = (domain as { validateWorkoutPlanV2?: WorkoutPlanValidator }).validateWorkoutPlanV2;

const candidate = (
  citationId: string,
  itemHash: string,
  sourceKind: 'INTERNAL_STARTER' | 'EXTERNAL_DATASET',
  equipment: readonly string[],
) => ({
  citationId,
  sourceKind,
  source: sourceKind === 'INTERNAL_STARTER' ? 'ev-ai-internal-starter' : 'approved-exercise-dataset',
  version: '2026.09.18.1',
  hash: hash('b'),
  itemHash,
  technicalSummary: 'Controlled low-impact movement with a documented technical range.',
  goals: ['STRENGTH'],
  equipment,
  intensityCap: 'MODERATE',
  parameterLimits: {
    roundsMax: 5,
    repsMax: 50,
    durationSecondsMax: 1800,
    secondsPerRepMax: 10,
    restSecondsMax: 600,
    transitionSecondsMax: 120,
  },
  eligibility: {
    status: 'ELIGIBLE',
    limitations: [],
    reviewRef: sourceKind === 'EXTERNAL_DATASET' ? 'review:approved-2026-09-18' : null,
    policyRef: sourceKind === 'INTERNAL_STARTER' ? 'WORKOUT_SAFETY_V1' : null,
  },
});

const input = {
  schemaVersion: 'WORKOUT_PLANNING_V2',
  policyVersion: 'WORKOUT_SAFETY_V1',
  goal: 'STRENGTH',
  scheduling: {
    targetDate: '2026-09-18',
    durationMinutes: 20,
    priority: 'MEDIUM',
    earliestStartLocalTime: '09:00',
    latestEndLocalTime: '09:30',
  },
  checkIn: {
    id: '00000000-0000-4000-8000-000000000001',
    version: 1,
    localDate: '2026-09-18',
    hasPain: false,
    acuteRisk: false,
    safety: {
      eligibility: 'ELIGIBLE',
      notice: 'NON_MEDICAL_RECOVERY_GUIDANCE',
      reasonCodes: ['RECOVERY_READY'],
      maxDurationMinutes: 60,
      intensityCap: 'MODERATE',
    },
  },
  profile: {
    version: 1,
    goals: ['STRENGTH'],
    experience: 'BEGINNER',
    weeklyTrainingDays: 3,
    availableEquipment: ['MAT'],
    bodyMeasurements: { weight: null, height: null },
    fitnessDescription: null,
    limitations: [],
    limitationsComplete: true,
  },
  authorization: {
    disclosureVersion: 'HEALTH_DISCLOSURE_V2',
    allowedFields: [
      'PROFILE_GOALS',
      'PROFILE_EXPERIENCE',
      'PROFILE_EQUIPMENT',
      'PROFILE_LIMITATIONS',
      'CHECK_IN',
      'CANDIDATES',
      'SCHEDULING',
    ],
    selectedFitnessMemoryIds: [],
  },
  recentFeedback: [],
  selectedFitnessMemory: [],
  candidates: [
    candidate(hash('a'), hash('c'), 'INTERNAL_STARTER', ['NONE']),
    candidate(hash('d'), hash('e'), 'EXTERNAL_DATASET', ['MAT']),
    candidate(hash('f'), hash('a'), 'INTERNAL_STARTER', ['NONE']),
    candidate(hash('b'), hash('d'), 'EXTERNAL_DATASET', ['MAT']),
  ],
};

const output = {
  schemaVersion: 'WORKOUT_PLAN_V2',
  title: 'Strength practice',
  rationale: 'A bounded, source-cited session within the reviewed technical limits.',
  goal: 'STRENGTH',
  items: [
    {
      citationId: hash('a'), phase: 'WARMUP', rounds: 1, reps: 5, durationSeconds: null,
      secondsPerRep: 5, restSeconds: 0, transitionSeconds: 15, intensity: 'LOW', reason: 'Prepare movement.',
    },
    {
      citationId: hash('d'), phase: 'MAIN', rounds: 2, reps: 8, durationSeconds: null,
      secondsPerRep: 5, restSeconds: 30, transitionSeconds: 10, intensity: 'MODERATE', reason: 'Primary practice.',
    },
    {
      citationId: hash('f'), phase: 'COOLDOWN', rounds: 1, reps: null, durationSeconds: 60,
      secondsPerRep: null, restSeconds: 0, transitionSeconds: 10, intensity: 'LOW', reason: 'Controlled recovery.',
    },
  ],
  alternatives: [{
    replacesItemIndex: 1,
    item: {
      citationId: hash('b'), phase: 'MAIN', rounds: 2, reps: 6, durationSeconds: null,
      secondsPerRep: 4, restSeconds: 20, transitionSeconds: 10, intensity: 'LOW', reason: 'Equipment alternative.',
    },
    reason: 'Use when the primary equipment is unavailable.',
  }],
  totalDurationSeconds: 230,
};

const preview = {
  schemaVersion: 'WORKOUT_PLANNING_V2',
  payload: input,
  contextHash: hash('7'),
  previewReceipt: {
    schemaVersion: 'WORKOUT_PLANNING_V2',
    contextHash: hash('7'),
    disclosureVersion: 'HEALTH_DISCLOSURE_V2',
    allowedFields: input.authorization.allowedFields,
    checkInId: input.checkIn.id,
    checkInVersion: input.checkIn.version,
    profileVersion: input.profile.version,
    candidateReferences: input.candidates.map(({ citationId, sourceKind, source, version, hash: sourceHash, itemHash }) => ({
      citationId, sourceKind, source, version, hash: sourceHash, itemHash,
    })),
    previewedAt: '2026-09-18T00:00:00.000Z',
  },
  fieldCounts: {
    feedback: 0,
    fitnessMemory: 0,
    candidates: input.candidates.length,
    utf8Bytes: utf8Bytes(input),
  },
};

describe('FIT-03a V2 workout-plan validator', () => {
  it('accepts a bounded three-phase plan and rejects model attempts to bypass frozen citations, timing, safety, time-window, or unknown-limit gates', () => {
    expect(() => validateWorkoutPlanV2!(input, output)).not.toThrow();
    expect(validateWorkoutPlanV2!(input, output)).toMatchObject({
      totalDurationSeconds: 230,
      alternativeTotalDurationSeconds: [188],
    });
    expect(workoutContextPreviewV2Schema.safeParse(preview).success).toBe(true);

    const previewWithUnauthorizedFields = structuredClone(preview);
    previewWithUnauthorizedFields.previewReceipt.allowedFields = previewWithUnauthorizedFields.previewReceipt.allowedFields
      .filter((field) => field !== 'PROFILE_EQUIPMENT');

    const previewWithWrongCheckIn = structuredClone(preview);
    previewWithWrongCheckIn.previewReceipt.checkInId = '00000000-0000-4000-8000-000000000099';
    previewWithWrongCheckIn.previewReceipt.checkInVersion = 2;

    const previewWithWrongProfile = structuredClone(preview);
    previewWithWrongProfile.previewReceipt.profileVersion = 2;

    const previewWithPartialCandidates = structuredClone(preview);
    previewWithPartialCandidates.previewReceipt.candidateReferences.pop();

    for (const invalidPreview of [
      previewWithUnauthorizedFields,
      previewWithWrongCheckIn,
      previewWithWrongProfile,
      previewWithPartialCandidates,
    ]) {
      expect(workoutContextPreviewV2Schema.safeParse(invalidPreview).success).toBe(false);
    }

    const lowSafetyInput = structuredClone(input);
    lowSafetyInput.checkIn.safety = {
      eligibility: 'ELIGIBLE',
      notice: 'NON_MEDICAL_RECOVERY_GUIDANCE',
      reasonCodes: ['RECOVERY_CAUTION'],
      maxDurationMinutes: 30,
      intensityCap: 'LOW',
    };

    const unknownLimitInput = {
      ...structuredClone(input),
      profile: {
        ...structuredClone(input).profile,
        limitations: 'UNKNOWN',
        limitationsComplete: false,
      },
    };

    const duplicateCitationInput = structuredClone(input);
    duplicateCitationInput.candidates[3] = structuredClone(duplicateCitationInput.candidates[0]!);

    const unauthorizedOptionalProfileInput = {
      ...structuredClone(input),
      profile: {
        ...structuredClone(input).profile,
        bodyMeasurements: { weight: { value: 70, unit: 'KG' }, height: null },
        fitnessDescription: 'Self-reported fitness detail.',
      },
      authorization: {
        ...structuredClone(input).authorization,
        allowedFields: input.authorization.allowedFields.filter((field) => field !== 'PROFILE_BODY_MEASUREMENTS' && field !== 'PROFILE_FITNESS_DESCRIPTION'),
      },
    };

    const unauthorizedExperienceInput = {
      ...structuredClone(input),
      authorization: {
        ...structuredClone(input).authorization,
        allowedFields: input.authorization.allowedFields.filter((field) => field !== 'PROFILE_EXPERIENCE'),
      },
    };

    const missingRequiredProfileFieldsInput = {
      ...structuredClone(input),
      authorization: {
        ...structuredClone(input).authorization,
        allowedFields: input.authorization.allowedFields.filter((field) => field !== 'PROFILE_GOALS' && field !== 'PROFILE_EQUIPMENT'),
      },
    };

    const shortWindowInput = structuredClone(input);
    shortWindowInput.scheduling.latestEndLocalTime = '09:02';

    const uncitedOutput = structuredClone(output);
    uncitedOutput.items[0]!.citationId = hash('9');

    const missingPhaseOutput = structuredClone(output);
    missingPhaseOutput.items[2]!.phase = 'MAIN';

    const wrongTotalOutput = structuredClone(output);
    wrongTotalOutput.totalDurationSeconds = 229;

    const longAlternativeOutput = {
      ...structuredClone(output),
      alternatives: output.alternatives.map((alternative, index) => index === 0 ? {
        ...alternative,
        item: {
          ...alternative.item,
          reps: null,
          durationSeconds: 1800,
          secondsPerRep: null,
        },
      } : alternative),
    };

    const combinedAlternativesOutput = {
      ...structuredClone(output),
      alternatives: [
        {
          ...structuredClone(output).alternatives[0]!,
          item: {
            ...structuredClone(output).alternatives[0]!.item,
            reps: null,
            durationSeconds: 400,
            secondsPerRep: null,
          },
        },
        {
          replacesItemIndex: 2,
          item: {
            citationId: hash('b'), phase: 'COOLDOWN', rounds: 1, reps: null, durationSeconds: 400,
            secondsPerRep: null, restSeconds: 0, transitionSeconds: 10, intensity: 'LOW', reason: 'Long cooldown alternative.',
          },
          reason: 'Use only after a new revision review.',
        },
      ],
    };

    // Each replacement fits the 1,200-second budget; together they take 1,280 seconds.
    for (const [index, expectedDuration] of [940, 570].entries()) {
      const singleAlternativeOutput = {
        ...combinedAlternativesOutput,
        alternatives: [combinedAlternativesOutput.alternatives[index]!],
      };
      expect(() => validateWorkoutPlanV2!(input, singleAlternativeOutput)).not.toThrow();
      expect(validateWorkoutPlanV2!(input, singleAlternativeOutput).alternativeTotalDurationSeconds)
        .toEqual([expectedDuration]);
    }
    expect(() => validateWorkoutPlanV2!(input, combinedAlternativesOutput)).toThrow(
      /^WORKOUT_PLAN_ALTERNATIVE_COMBINATION_TIME_WINDOW_EXCEEDED$/,
    );

    const fractionalTimingOutput = structuredClone(output);
    fractionalTimingOutput.items[1]!.rounds = 1.5;

    for (const [rejectedInput, rejectedOutput] of [
      [input, uncitedOutput],
      [input, missingPhaseOutput],
      [input, wrongTotalOutput],
      [input, longAlternativeOutput],
      [lowSafetyInput, output],
      [unknownLimitInput, output],
      [duplicateCitationInput, output],
      [unauthorizedOptionalProfileInput, output],
      [unauthorizedExperienceInput, output],
      [missingRequiredProfileFieldsInput, output],
      [shortWindowInput, output],
      [input, fractionalTimingOutput],
    ]) {
      expect(() => validateWorkoutPlanV2!(rejectedInput, rejectedOutput)).toThrow(/^WORKOUT_PLAN_/);
    }
  });
});
