import { expect, it } from 'vitest';
import { parseExternalExerciseCatalog } from '../src/modules/fitness/external-catalog';

it('parses a safe synthetic external catalog and rejects invalid records', () => {
  const revision = '0123456789abcdef0123456789abcdef01234567';
  const [firstRecord, secondRecord] = [
    {
      id: '0001',
      name: 'Synthetic push-up',
      body_part: 'chest',
      equipment: 'body weight',
      target: 'pectorals',
      secondary_muscles: ['triceps'],
      instruction_steps: {
        en: ['Start in a high plank.', 'Lower under control.'],
        zh: ['从高平板支撑开始。', '控制下降。'],
      },
      instructions: {
        en: 'This fallback must not replace valid English steps.',
        zh: '这段备用文字不能替换有效中文步骤。',
      },
      images: ['synthetic-media-reference'],
      muscle_group: 'chest',
      category: 'strength',
    },
    {
      id: '0002',
      name: 'Synthetic squat',
      body_part: 'upper legs',
      equipment: 'body weight',
      target: 'quadriceps',
      secondary_muscles: [],
      instructions: {
        en: 'Stand and lower with control.',
        zh: '站立后控制下蹲。',
      },
      video: 'synthetic-media-reference',
      muscle_group: 'legs',
      category: 'strength',
    },
  ] as const;
  const input = { revision, records: [firstRecord, secondRecord] };
  const originalInput = structuredClone(input);

  const catalog = parseExternalExerciseCatalog(input);

  expect(catalog).toEqual({
    sourceId: 'hasaneyldrm/exercises-dataset',
    revision: '0123456789abcdef0123456789abcdef01234567',
    license: 'MIT',
    items: [
      {
        upstreamId: '0001',
        name: 'Synthetic push-up',
        bodyPart: 'chest',
        equipment: 'body weight',
        target: 'pectorals',
        secondaryMuscles: ['triceps'],
        instructions: {
          en: ['Start in a high plank.', 'Lower under control.'],
          zh: ['从高平板支撑开始。', '控制下降。'],
        },
        safetyReview: 'UNREVIEWED',
      },
      {
        upstreamId: '0002',
        name: 'Synthetic squat',
        bodyPart: 'upper legs',
        equipment: 'body weight',
        target: 'quadriceps',
        secondaryMuscles: [],
        instructions: {
          en: ['Stand and lower with control.'],
          zh: ['站立后控制下蹲。'],
        },
        safetyReview: 'UNREVIEWED',
      },
    ],
  });
  expect(input).toEqual(originalInput);

  expect(() => parseExternalExerciseCatalog({
    revision,
    records: [firstRecord, { ...secondRecord, id: '0001' }],
  })).toThrow('EXTERNAL_EXERCISE_CATALOG_INVALID');
  expect(() => parseExternalExerciseCatalog({
    revision,
    records: [
      {
        ...firstRecord,
        instruction_steps: {
          en: [''],
          zh: ['从高平板支撑开始。'],
        },
      },
      secondRecord,
    ],
  })).toThrow('EXTERNAL_EXERCISE_CATALOG_INVALID');
});
