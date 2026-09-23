import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FitnessWorkspace } from '@/components/fitness/fitness-workspace';

const checkInId = '00000000-0000-4000-8000-000000000711';
const signalId = '00000000-0000-4000-8000-000000000712';
const hash = 'a'.repeat(64);
const citationId = 'b'.repeat(64);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function checkInResponse(blocked = false) {
  return {
    data: {
      checkIn: {
        id: checkInId, localDate: '2026-08-17', sleepMinutes: 420, energyLevel: 3, discomfortLevel: 0, hasPain: blocked, acuteRisk: false,
        signalId, recovery: { score: 82, level: 'READY', reasonCodes: ['恢复良好'] },
        safety: blocked
          ? { eligibility: 'BLOCKED', notice: 'STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP', reasonCodes: ['SELF_REPORTED_PAIN'], maxDurationMinutes: 0, intensityCap: 'NONE' }
          : { eligibility: 'ELIGIBLE', notice: 'NON_MEDICAL_RECOVERY_GUIDANCE', reasonCodes: ['RECOVERY_READY'], maxDurationMinutes: 60, intensityCap: 'MODERATE' },
        policyVersion: 'WORKOUT_SAFETY_V1', version: 1, createdAt: '2026-08-17T01:00:00.000Z',
      },
      signal: { id: signalId, localDate: '2026-08-17', kind: 'RECOVERY', value: 82, source: 'CHECK_IN', version: 1, createdAt: '2026-08-17T01:00:00.000Z', updatedAt: '2026-08-17T01:00:00.000Z' },
    },
  };
}

function unavailableCapabilities() {
  const unavailable = (capability: 'WORKOUT_TEXT_SELECTION' | 'MEAL_CANDIDATE_PARSE' | 'NUTRITION_DATA_LOOKUP') => ({ capability, availability: 'NOT_CONFIGURED', providerId: null, providerLabel: 'Not configured', adapterKind: 'NONE', evidenceKind: 'NONE', disclosureVersion: 'HEALTH_DISCLOSURE_V1', policyVersion: 'HEALTH_CAPABILITY_POLICY_V1', realEvidenceStatus: 'NOT_RUN_APPROVAL_REQUIRED' });
  return { data: [unavailable('WORKOUT_TEXT_SELECTION'), unavailable('MEAL_CANDIDATE_PARSE'), unavailable('NUTRITION_DATA_LOOKUP')] };
}

function exerciseResponse() {
  return {
    data: {
      safety: { eligibility: 'ELIGIBLE', notice: 'NON_MEDICAL_RECOVERY_GUIDANCE', reasonCodes: ['RECOVERY_READY'], maxDurationMinutes: 60, intensityCap: 'MODERATE' },
      manifest: { schemaVersion: 'EXERCISE_CATALOG_V1', catalogId: 'ev-ai-internal-starter', catalogVersion: '2026.08.31.1', source: { kind: 'FIRST_PARTY_INTERNAL', name: 'EV AI internal starter catalog', licenseId: null, redistribution: false, medicalClaims: false }, contentSha256: hash, itemCount: 8 },
      items: [{ exerciseId: 'easy-walk', name: 'Easy walk', neutralTechniqueText: 'Walk at an easy, steady pace.', goals: ['RECOVERY'], movementTags: ['WALK'], equipment: [], impact: 'LOW', defaults: { LOW: { rounds: 1, reps: null, durationSeconds: 300, restSeconds: 0 }, MODERATE: { rounds: 1, reps: null, durationSeconds: 600, restSeconds: 0 } }, citation: { citationId, catalogId: 'ev-ai-internal-starter', catalogVersion: '2026.08.31.1', catalogHash: hash, exerciseId: 'easy-walk', itemHash: hash, sourceKind: 'FIRST_PARTY_INTERNAL', redistribution: false } }],
      pagination: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
    },
  };
}

describe('FitnessWorkspace', () => {
  it('starts the v0.7 check-in review flow without a legacy hour field', () => {
    render(<FitnessWorkspace initialDate="2026-08-17" />);

    expect(screen.getByLabelText('睡眠分钟')).toBeInTheDocument();
    expect(screen.getByLabelText('是否存在疼痛')).toBeInTheDocument();
    expect(screen.getByLabelText('是否存在急性风险')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存并查看训练目录' })).toBeInTheDocument();
    expect(screen.queryByLabelText('睡眠时长（小时）')).not.toBeInTheDocument();
  });

  it('renders only the fixed stop/help state for a pain check-in before any catalog request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(checkInResponse(true), 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<FitnessWorkspace initialDate="2026-08-17" />);

    await user.click(screen.getByLabelText('是否存在疼痛'));
    await user.click(screen.getByRole('button', { name: '保存并查看训练目录' }));

    expect(await screen.findByText('STOP_EXERCISE_AND_SEEK_PROFESSIONAL_HELP')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建手动训练草稿' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/core/fitness/check-ins', expect.objectContaining({ method: 'POST', body: JSON.stringify({ localDate: '2026-08-17', sleepMinutes: 420, energyLevel: 3, discomfortLevel: 0, hasPain: true, acuteRisk: false }) }));
  });

  it('uses v2 check-in and presents the bounded internal catalog when text selection is unavailable', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/core/fitness/check-ins') return Promise.resolve(jsonResponse(checkInResponse(), 201));
      if (url === '/api/core/health-capabilities') return Promise.resolve(jsonResponse(unavailableCapabilities()));
      if (url.startsWith('/api/core/fitness/exercises?')) return Promise.resolve(jsonResponse(exerciseResponse()));
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<FitnessWorkspace initialDate="2026-08-17" />);

    await user.click(screen.getByRole('button', { name: '保存并查看训练目录' }));

    expect(await screen.findByText('项目内部非医疗目录')).toBeInTheDocument();
    expect(screen.getByText(/redistribution=false/)).toBeInTheDocument();
    expect(screen.getByText(/WORKOUT_TEXT_SELECTION 未配置/)).toBeInTheDocument();
    expect(screen.getByLabelText('选择 Easy walk')).toBeChecked();
    expect(screen.getByRole('button', { name: '使用测试 Workout selector' })).toBeDisabled();
  });
});
