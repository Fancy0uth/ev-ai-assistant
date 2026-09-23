import { createHash } from 'node:crypto';
import type { WorkoutPlanningCandidateV2 } from '@ev/contracts';
import type { InternalExerciseCatalogItem } from './catalog';

export const PUBLIC_GUIDANCE_POLICY = 'PUBLIC_GUIDANCE_GENERAL_ADULT_V1';
type Guidance = NonNullable<WorkoutPlanningCandidateV2['publicGuidance']>;
const source = (publisher: string, url: string, reviewedAt: string, summary: string): Guidance['sources'][number] => ({
  publisher, url, reviewedAt, accessedAt: '2026-09-20', summary,
  // Hash identifies this curated summary, not a downloaded whole-page snapshot.
  summaryHash: createHash('sha256').update(summary).digest('hex'),
});
const strength = source('NHS', 'https://www.nhs.uk/live-well/exercise/strength-exercises/', '2024-02-28',
  '椅子坐站目标5次；靠墙俯卧撑3组，每组5至10次。动作缓慢受控、逐步增加；椅子稳固、无轮、不滑动。');
const walking = source('American Heart Association', 'https://www.heart.org/en/healthy-living/exercise-and-physical-activity/fitness-basics/warm-up-cool-down', '2024-01-16',
  '以较慢速度活动热身5至10分钟；活动结束后降低步行速度5至10分钟放松。');
const scope = source('NHS', 'https://www.nhs.uk/live-well/exercise/physical-activity-guidelines-for-adults-aged-19-to-64/', '2024-05-22',
  '19至64岁成人活动指导：长期未运动、有疾病或健康担忧者应先咨询医生；活动与强度应适合当前能力。本产品进一步限于已确认健康、经常活动、非孕期及非近期产后的一般成人，不用于疾病治疗或康复。');

export function publicGuidanceFor(item: InternalExerciseCatalogItem): { guidance: Guidance; limits: WorkoutPlanningCandidateV2['parameterLimits'] } | undefined {
  const walk = item.exerciseId === 'easy-walk';
  const chair = item.exerciseId === 'chair-sit-to-stand';
  const wall = item.exerciseId === 'wall-push-up';
  if (!walk && !chair && !wall) return undefined;
  return {
    guidance: {
      basisKind: 'PUBLIC_GUIDANCE_NOT_INDIVIDUAL_REVIEW', scopeVersion: 'GENERAL_ADULT_19_64_V1',
      phases: walk ? ['WARMUP', 'COOLDOWN'] : ['MAIN'], rounds: wall ? 3 : 1,
      reps: walk ? null : { min: 5, max: wall ? 10 : 5 },
      durationSeconds: walk ? { min: 300, max: 600 } : null,
      sources: [walk ? walking : strength, scope],
      engineeringEstimates: '组数/次数/步行时间按上述来源；坐站仅做一轮是产品起步选择。每次3秒、组间60秒、转换30秒仅供排程估计，非指南给出的安全上限或个体处方；需要更久休息时应停止并调整，不能赶时间。',
    },
    limits: { roundsMax: wall ? 3 : 1, repsMax: wall ? 10 : 5, durationSecondsMax: walk ? 600 : 30,
      secondsPerRepMax: 3, restSecondsMax: 60, transitionSecondsMax: 30 },
  };
}
