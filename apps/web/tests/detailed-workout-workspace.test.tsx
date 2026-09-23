import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { FitnessWorkspace } from '@/components/fitness/fitness-workspace';
import { requestCore } from '@/lib/core-client';

vi.mock('@/lib/core-client', async (original) => ({ ...await original<typeof import('@/lib/core-client')>(), requestCore: vi.fn() }));

it('keeps manual startup local and requires configured capability plus fresh explicit preview consent', async () => {
  const id = '00000000-0000-4000-8000-000000000711';
  const hash = 'a'.repeat(64);
  const now = '2026-09-19T01:00:00.000Z';
  let ready = false;
  let profile: any = null;
  let posted = 0;
  let detail: any;
  const checkInReplays = new Map<string, any>();
  const checkInKeys: string[] = [];
  let latestCheckInput: any;
  let failCandidates = false;
  let loseCheckInResponse = false;
  let latestCheckResponse: any;
  const candidate = { citationId: hash, sourceKind: 'INTERNAL_STARTER', source: 'starter', version: '1', hash, itemHash: hash, technicalSummary: '合成步行技术说明', goals: ['RECOVERY'], equipment: [], intensityCap: 'LOW', parameterLimits: { roundsMax: 5, repsMax: 50, durationSecondsMax: 1800, secondsPerRepMax: 10, restSecondsMax: 600, transitionSecondsMax: 120 }, eligibility: { status: 'ELIGIBLE', limitations: [], reviewRef: null, policyRef: 'NOT_MEDICALLY_CERTIFIED' } };
  const safety = { eligibility: 'ELIGIBLE', notice: 'NON_MEDICAL_RECOVERY_GUIDANCE', reasonCodes: ['RECOVERY_READY'], maxDurationMinutes: 60, intensityCap: 'LOW' };
  vi.mocked(requestCore).mockImplementation(async (path, init) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (path === 'fitness/planning/profile') {
      if (init.method === 'PUT') profile = { ...body.profile, version: (profile?.version ?? 0) + 1 };
      return { data: { profile } };
    }
    if (path === 'fitness/planning/capability') return { data: { capability: 'WORKOUT_DETAILED_PLANNING', availability: ready ? 'READY' : 'NOT_CONFIGURED', providerId: ready ? 'fixture' : null, providerLabel: 'Fake', adapterKind: ready ? 'TEST_FIXTURE' : 'NONE', evidenceKind: ready ? 'AUTOMATED_TEST_FIXTURE' : 'NONE', disclosureVersion: 'HEALTH_DISCLOSURE_V2', policyVersion: 'HEALTH_CAPABILITY_POLICY_V1', realEvidenceStatus: 'NOT_RUN_APPROVAL_REQUIRED' } };
    if (path === 'fitness/planning/memory') return { data: { items: [] } };
    if (path === 'fitness/check-ins') {
      const key = new Headers(init.headers).get('Idempotency-Key')!;
      checkInKeys.push(key);
      if (checkInReplays.has(key)) return checkInReplays.get(key);
      latestCheckInput = body;
      latestCheckResponse = { data: { checkIn: { ...body, id, signalId: id, recovery: { score: 80, level: 'READY', reasonCodes: ['ready'] }, safety: body.hasPain ? { eligibility: 'BLOCKED', notice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP', reasonCodes: ['SELF_REPORTED_PAIN'], maxDurationMinutes: 0, intensityCap: 'NONE' } : safety, policyVersion: 'WORKOUT_SAFETY_V1', version: 1, createdAt: now }, signal: { id, localDate: body.localDate, kind: 'RECOVERY', value: 80, source: 'CHECK_IN', version: 1, createdAt: now, updatedAt: now } } };
      checkInReplays.set(key, latestCheckResponse);
      if (loseCheckInResponse) { loseCheckInResponse = false; throw new Error('response lost after commit'); }
      return latestCheckResponse;
    }
    if (path.startsWith('fitness/planning/candidates?')) {
      if (failCandidates) { failCandidates = false; throw new Error('candidate lookup failed after check-in saved'); }
      return { data: { items: [candidate] } };
    }
    if (path === 'fitness/planning/context/preview') {
      const payload = { schemaVersion: 'WORKOUT_PLANNING_V2', policyVersion: 'NOT_MEDICALLY_CERTIFIED', goal: body.goal, scheduling: body.scheduling, checkIn: { id, version: 1, localDate: '2026-09-19', hasPain: false, acuteRisk: false, safety }, profile, authorization: body.authorization, recentFeedback: [], selectedFitnessMemory: [], candidates: [candidate] };
      return { data: { schemaVersion: 'WORKOUT_PLANNING_V2', payload, contextHash: hash, previewReceipt: { schemaVersion: 'WORKOUT_PLANNING_V2', contextHash: hash, disclosureVersion: 'HEALTH_DISCLOSURE_V2', allowedFields: body.authorization.allowedFields, checkInId: id, checkInVersion: 1, profileVersion: profile.version, candidateReferences: [{ citationId: hash, sourceKind: candidate.sourceKind, source: candidate.source, version: '1', hash, itemHash: hash }], previewedAt: now }, fieldCounts: { feedback: 0, fitnessMemory: 0, candidates: 1, utf8Bytes: new TextEncoder().encode(JSON.stringify(payload)).length } } };
    }
    if (path === 'fitness/planning/workouts' && init.method === 'POST') {
      posted++; expect(body.consentedAt).not.toBe(now); expect(body).not.toHaveProperty('previewedAt');
      if (posted === 1) throw new Error('synthetic transport failure');
      const workout = { id, checkInId: id, signalId: id, currentRevisionId: id, generationMode: 'ASSISTED', version: 1, createdAt: now, updatedAt: now, state: 'DRAFT', proposalId: null, actionId: null, timeRequestId: null, feedbackId: null };
      const revision = { id, workoutId: id, parentRevisionId: null, revisionNo: 1, schemaVersion: 'WORKOUT_PLAN_V2', title: '合成恢复训练', rationale: '合成理由', goal: 'RECOVERY', items: ['WARMUP', 'MAIN', 'COOLDOWN'].map((phase) => ({ citationId: hash, phase, rounds: 1, reps: null, durationSeconds: 100, secondsPerRep: null, restSeconds: 0, transitionSeconds: 0, intensity: 'LOW', reason: '保持轻松' })), alternatives: [], scheduling: body.scheduling, provenance: [{ kind: 'MODEL_SELECTION', capabilityRunId: null, editedFields: [], capturedAt: now }], contextReceipt: { schemaVersion: 'WORKOUT_PLANNING_V2', contextHash: hash, disclosureVersion: 'HEALTH_DISCLOSURE_V2', allowedFields: body.allowedFields, checkInId: id, checkInVersion: 1, profileVersion: profile.version, candidateReferences: [{ citationId: hash, sourceKind: candidate.sourceKind, source: candidate.source, version: '1', hash, itemHash: hash }], consentedAt: body.consentedAt }, policyVersion: 'NOT_MEDICALLY_CERTIFIED', contentHash: hash, createdAt: now };
      detail = { workout, revision, citations: [{ candidate, name: '合成步行', instructions: ['以舒适速度行走'] }], proposal: null, action: null, timeRequest: null, feedback: null };
      return { data: { workout, revision, totalDurationSeconds: 300, capabilityRunId: null } };
    }
    if (path === `fitness/planning/workouts/${id}`) return { data: detail };
    if (path === `fitness/planning/workouts/${id}/revisions`) { expect(body.contextReceipt).toEqual(detail.revision.contextReceipt); expect(body.policyVersion).toBe('NOT_MEDICALLY_CERTIFIED'); detail.revision = { ...detail.revision, title: body.title, rationale: body.rationale }; return { data: { workout: detail.workout, revision: detail.revision } }; }
    if (path === `fitness/planning/workouts/${id}/proposal`) {
      detail.workout = { ...detail.workout, state: 'PROPOSAL_PENDING', proposalId: id, version: 2 };
      detail.proposal = { id, kind: 'WORKOUT', source: 'FITNESS_AGENT', status: 'PENDING', title: '合成提案', version: 1, createdAt: now, expiresAt: null, changes: [{ operation: 'CREATE_WORKOUT_ACTION', workout: { workoutId: id, revisionId: id, expectedWorkoutVersion: 2, contentHash: hash }, action: { id, title: '合成训练', targetDate: '2026-09-19', status: 'OPEN', kind: 'FITNESS', version: 1, createdAt: now, updatedAt: now }, scheduling: { timeRequestId: id, durationMinutes: 25, priority: 'MEDIUM', earliestStartLocalTime: '10:00', latestEndLocalTime: '11:00', isFixed: false }, citationIds: [hash] }] };
      return { data: { workout: detail.workout, proposal: detail.proposal } };
    }
    if (path === `proposals/${id}/decision`) { expect(body).toEqual({ version: 1, decision: 'ACCEPT' }); detail = { ...detail, workout: { ...detail.workout, state: 'ACCEPTED', actionId: id, timeRequestId: id, version: 3 }, proposal: { ...detail.proposal, status: 'ACCEPTED' }, action: { id }, timeRequest: { id } }; return { data: detail.proposal }; }
    if (path === `fitness/planning/workouts/${id}/feedback`) {
      expect(body.hadPain).toBe(true); expect(body.perceivedEffort).toBe(4); expect(body.note).toBe('合成备注');
      expect(Date.parse(body.endedAt) - Date.parse(body.startedAt)).toBe(12 * 60000);
      detail.workout = { ...detail.workout, state: 'COMPLETED', feedbackId: id, version: 4 };
      return { data: { workout: detail.workout, feedback: { id }, action: { id }, activitySession: null, safetyNotice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP', memoryStatus: { state: 'DEGRADED', sourceId: id } } };
    }
    if (path.startsWith('fitness/workouts?')) return { data: { items: [{ ...detail.workout, state: 'ACCEPTED', feedbackId: null }], pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 } } };
    if (path === `fitness/workouts/${id}`) return { data: {
      workout: { ...detail.workout, state: 'ACCEPTED', feedbackId: null }, checkIn: latestCheckResponse.data.checkIn,
      revision: { id, workoutId: id, parentRevisionId: null, revisionNo: 1, title: '手动训练', rationale: '手动理由', items: [{ citation: { citationId: hash, catalogId: 'ev-ai-internal-starter', catalogVersion: '2026.08.31.1', catalogHash: hash, exerciseId: 'easy-walk', itemHash: hash, sourceKind: 'FIRST_PARTY_INTERNAL', redistribution: false }, rounds: 1, reps: null, durationSeconds: 300, restSeconds: 0 }], scheduling: detail.revision.scheduling, provenance: detail.revision.provenance, contentHash: hash, createdAt: now },
      proposal: detail.proposal, action: { id }, timeRequest: { id }, feedback: null,
    } };
    if (path === `fitness/workouts/${id}/feedback`) {
      expect(body.hadPain).toBe(true);
      return { data: { workout: { ...detail.workout, state: 'SKIPPED', feedbackId: id }, feedback: { id }, action: { id }, activitySession: null, safetyNotice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP' } };
    }
    throw new Error(`Unexpected mock route ${path}`);
  });
  const user = userEvent.setup();
  render(<FitnessWorkspace initialDate="2026-09-19" />);
  expect(requestCore).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'DeepSeek 详细训练计划' }));
  await screen.findByText(/未配置详细训练能力/);
  expect(screen.getByRole('link', { name: '配置 DeepSeek' })).toHaveAttribute('href', '/settings/providers');
  expect(screen.getByRole('button', { name: '同意后生成详细草稿' })).toBeDisabled();
  expect(screen.getByLabelText('病史与训练限制')).toHaveValue('UNKNOWN');
  await user.selectOptions(screen.getByLabelText('病史与训练限制'), 'NONE');
  await user.click(screen.getByRole('button', { name: '保存画像' }));
  await screen.findByText(/画像已保存/);
  await user.click(screen.getByRole('button', { name: '保存当天状态并读取候选' }));
  await screen.findByText('合成步行技术说明');
  // Two independent soft failures make both reviewed regressions visible in the same RED run.
  const firstSafeKey = checkInKeys.at(-1);
  await user.click(screen.getByLabelText('是否存在疼痛'));
  await user.click(screen.getByRole('button', { name: '保存当天状态并读取候选' }));
  await screen.findByText(/STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP/);
  const firstBlockedKey = checkInKeys.at(-1);
  await user.click(screen.getByLabelText('是否存在疼痛'));
  await user.click(screen.getByRole('button', { name: '保存当天状态并读取候选' }));
  await screen.findByText('合成步行技术说明');
  expect.soft(checkInKeys.at(-1), 'safe A after B must be a new command').not.toBe(firstSafeKey);
  expect.soft(latestCheckInput.hasPain, 'exact A must become latest persisted state').toBe(false);
  await user.click(screen.getByLabelText('是否存在疼痛'));
  await user.click(screen.getByRole('button', { name: '保存当天状态并读取候选' }));
  await screen.findByText(/STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP/);
  expect.soft(checkInKeys.at(-1), 'confirmed blocked check-in key must also retire').not.toBe(firstBlockedKey);
  await user.click(screen.getByLabelText('是否存在疼痛'));
  fireEvent.change(screen.getByLabelText('睡眠分钟'), { target: { value: '421' } });
  failCandidates = true;
  await user.click(screen.getByRole('button', { name: '保存当天状态并读取候选' }));
  await screen.findByRole('alert');
  expect.soft(screen.queryByText(/当天状态已保存；候选读取失败/), 'candidate failure must distinguish confirmed check-in').toBeInTheDocument();
  const confirmedBeforeCandidateFailure = checkInKeys.at(-1);
  await user.click(screen.getByRole('button', { name: '保存当天状态并读取候选' }));
  await screen.findByText('合成步行技术说明');
  expect.soft(checkInKeys.at(-1), 'candidate fetch failure must not keep successful write key').not.toBe(confirmedBeforeCandidateFailure);
  fireEvent.change(screen.getByLabelText('睡眠分钟'), { target: { value: '422' } });
  loseCheckInResponse = true;
  await user.click(screen.getByRole('button', { name: '保存当天状态并读取候选' }));
  await screen.findByRole('alert');
  const uncertainKey = checkInKeys.at(-1);
  await user.click(screen.getByRole('button', { name: '保存当天状态并读取候选' }));
  await screen.findByText('合成步行技术说明');
  expect(checkInKeys.at(-1), 'uncertain check-in retry must retain its key').toBe(uncertainKey);
  await user.click(screen.getByRole('button', { name: '预览实际外发内容' }));
  await screen.findByText(/外发 hash/);
  await user.click(screen.getByLabelText('我已审阅上述实际内容并同意发送'));
  expect(screen.getByRole('button', { name: '同意后生成详细草稿' })).toBeDisabled();
  expect(posted).toBe(0);
  ready = true;
  await user.click(screen.getByRole('button', { name: '刷新能力状态' }));
  await screen.findByText(/Fake 测试能力/);
  fireEvent.change(screen.getByLabelText('训练预算（分钟）'), { target: { value: '25' } });
  expect(screen.queryByText(/外发 hash/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '同意后生成详细草稿' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '预览实际外发内容' }));
  await screen.findByText(/外发 hash/);
  expect(screen.getByLabelText('我已审阅上述实际内容并同意发送')).not.toBeChecked();
  expect(posted).toBe(0);
  await user.click(screen.getByLabelText('我已审阅上述实际内容并同意发送'));
  await user.click(screen.getByRole('button', { name: '同意后生成详细草稿' }));
  await waitFor(() => expect(posted).toBe(1));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('训练预算（分钟）')).toHaveValue(25);
  expect(screen.queryByText('详细草稿已生成')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '同意后生成详细草稿' }));
  await screen.findByRole('heading', { name: '详细训练草稿审阅' });
  expect(screen.getByRole('heading', { name: '热身' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '主训练' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '放松' })).toBeInTheDocument();
  expect(screen.getByText('以舒适速度行走')).toBeInTheDocument();
  expect(screen.getByText(/总时长 300 秒/)).toBeInTheDocument();
  await user.type(screen.getByLabelText('详细训练标题'), '修订');
  await user.click(screen.getByRole('button', { name: '保存详细计划修订' }));
  await user.click(screen.getByRole('button', { name: '提交详细训练提案' }));
  await screen.findByRole('button', { name: '接受详细训练提案' });
  await user.click(screen.getByRole('button', { name: '接受详细训练提案' }));
  await screen.findByLabelText('实际开始时间');
  expect(screen.getByRole('link', { name: '前往每日计划审核日程' })).toHaveAttribute('href', '/daily-plan');
  fireEvent.change(screen.getByLabelText('实际开始时间'), { target: { value: '2026-09-19T10:00' } });
  fireEvent.change(screen.getByLabelText('实际结束时间'), { target: { value: '2026-09-19T10:12' } });
  await user.type(screen.getByLabelText('自述用力（1–10，可不填）'), '4');
  await user.selectOptions(screen.getByLabelText('训练期间是否疼痛'), 'YES');
  await user.type(screen.getByLabelText('反馈备注'), '合成备注');
  await user.click(screen.getByRole('button', { name: '提交实际反馈' }));
  await screen.findByText(/训练反馈已保存/);
  expect(screen.getByText(/记忆结果：DEGRADED/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '再次规划训练' }));
  expect(screen.queryByRole('heading', { name: '详细训练草稿审阅' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '同意后生成详细草稿' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: '返回手动训练流程' }));
  await user.click(screen.getByRole('button', { name: '读取本地训练草稿' }));
  await user.click(await screen.findByRole('button', { name: `打开训练草稿 ${id}` }));
  await screen.findByLabelText('训练结果');
  await user.selectOptions(screen.getByLabelText('训练结果'), 'SKIPPED');
  await user.selectOptions(screen.getByLabelText('训练期间是否疼痛'), 'YES');
  await user.click(screen.getByRole('button', { name: '提交实际反馈' }));
  await screen.findByText('训练反馈已确认：已跳过。');
  expect.soft(screen.queryByText(/STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP/), 'legacy DONE must retain returned stop notice').toBeInTheDocument();
});
