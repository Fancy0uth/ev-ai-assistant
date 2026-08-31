import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NutritionWorkspace } from '@/components/nutrition/nutrition-workspace';

const draftId = '00000000-0000-4000-8000-000000000811';
const revisionId = '00000000-0000-4000-8000-000000000812';
const candidateId = '00000000-0000-4000-8000-000000000813';
const runId = '00000000-0000-4000-8000-000000000814';
const hash = 'c'.repeat(64);

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function parsedDraftResponse() {
  return {
    data: {
      draft: { id: draftId, localDate: '2026-08-17', mode: 'PARSE_TEXT', originalText: 'Fixture Food Alpha 150 g', state: 'CANDIDATES_READY', currentRevisionId: revisionId, confirmedMealId: null, version: 1, createdAt: '2026-08-17T02:00:00.000Z', updatedAt: '2026-08-17T02:00:00.000Z' },
      revision: { id: revisionId, draftId, parentRevisionId: null, revisionNo: 1, candidates: [{ candidateId, displayName: 'Fixture Food Alpha', quantityDecimal: '150', unit: 'GRAM', included: true, selectedFoodSnapshotId: null, provenance: [{ kind: 'MODEL_PARSE', capabilityRunId: runId, editedFields: ['displayName', 'quantityDecimal', 'unit'], capturedAt: '2026-08-17T02:00:00.000Z' }] }], contentHash: hash, createdBy: 'PARSER', capabilityRunId: runId, createdAt: '2026-08-17T02:00:00.000Z' },
      disclosure: { capabilityRunId: runId, disclosureVersion: 'HEALTH_DISCLOSURE_V1' },
    },
  };
}

describe('NutritionWorkspace', () => {
  it('starts the v0.7 sourced meal flow without direct nutrient inputs', () => {
    render(<NutritionWorkspace initialDate="2026-08-17" />);

    expect(screen.getByLabelText('餐食文本')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解析候选食物' })).toBeInTheDocument();
    expect(screen.queryByLabelText('热量（千卡）')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('蛋白质（克）')).not.toBeInTheDocument();
  });

  it('shows the explicit 503 manual candidate path with no macro fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'HEALTH_TEXT_PROVIDER_NOT_CONFIGURED', message: '餐食文本能力尚未配置' } }, 503));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<NutritionWorkspace initialDate="2026-08-17" />);

    await user.type(screen.getByLabelText('餐食文本'), '米饭 150 g');
    await user.click(screen.getByRole('button', { name: '解析候选食物' }));

    expect(await screen.findByText('手工候选')).toBeInTheDocument();
    expect(screen.getByText(/Provider 返回 503/)).toBeInTheDocument();
    expect(screen.getByLabelText('食物名称')).toBeInTheDocument();
    expect(screen.getByLabelText('十进制数量')).toBeInTheDocument();
    expect(screen.queryByLabelText('热量（千卡）')).not.toBeInTheDocument();
  });

  it('sends only parser text/disclosure and preserves candidate decimals as strings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(parsedDraftResponse(), 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<NutritionWorkspace initialDate="2026-08-17" />);

    await user.type(screen.getByLabelText('餐食文本'), 'Fixture Food Alpha 150 g');
    await user.click(screen.getByRole('button', { name: '解析候选食物' }));

    expect(await screen.findByText('Fixture Food Alpha · 150 GRAM')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/core/nutrition/meal-drafts', expect.objectContaining({ method: 'POST', body: JSON.stringify({ mode: 'PARSE_TEXT', localDate: '2026-08-17', mealText: 'Fixture Food Alpha 150 g', disclosureVersion: 'HEALTH_DISCLOSURE_V1' }) }));
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
  });
});
