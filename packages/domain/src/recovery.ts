export interface RecoveryInput {
  sleepHours: number;
  energy: 1 | 2 | 3 | 4 | 5;
  discomfort: 0 | 1 | 2 | 3 | 4 | 5;
}

export interface RecoveryAssessment {
  score: number;
  level: 'READY' | 'MODERATE' | 'CAUTION';
  reasons: string[];
}

export function calculateRecovery(input: RecoveryInput): RecoveryAssessment {
  if (!Number.isFinite(input.sleepHours) || input.sleepHours < 0 || input.sleepHours > 24) {
    throw new RangeError('sleepHours must be between 0 and 24');
  }
  const sleepScore = Math.min(40, Math.max(0, Math.round((input.sleepHours / 8) * 40)));
  const energyScore = input.energy * 12;
  const discomfortPenalty = input.discomfort * 15;
  const score = Math.max(25, Math.min(100, sleepScore + energyScore - discomfortPenalty));
  const reasons: string[] = [];
  if (input.sleepHours >= 7) reasons.push('睡眠时长达标');
  else reasons.push('睡眠时长偏少');
  if (input.energy >= 4) reasons.push('主观精力良好');
  else if (input.energy <= 2) reasons.push('主观精力偏低');
  if (input.discomfort >= 3) reasons.push('不适反馈较高，建议降低训练强度');
  return {
    score,
    level: score >= 75 ? 'READY' : score >= 45 ? 'MODERATE' : 'CAUTION',
    reasons,
  };
}
