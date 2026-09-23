import { describe, expect, it } from 'vitest';
import { calculateRecovery } from '../src/recovery';

describe('calculateRecovery', () => {
  it('uses deterministic sleep, energy and discomfort factors without medical inference', () => {
    expect(calculateRecovery({ sleepHours: 8, energy: 5, discomfort: 0 })).toEqual({
      score: 100,
      level: 'READY',
      reasons: ['睡眠时长达标', '主观精力良好'],
    });
    expect(calculateRecovery({ sleepHours: 5, energy: 2, discomfort: 4 })).toMatchObject({
      score: 25,
      level: 'CAUTION',
    });
  });
});
