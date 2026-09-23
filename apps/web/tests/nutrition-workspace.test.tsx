import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NutritionProviderSettings } from '@/components/nutrition/nutrition-provider-settings';
import { NutritionWorkspace } from '@/components/nutrition/nutrition-workspace';

const draftId = '00000000-0000-4000-8000-000000000811';
const revisionId = '00000000-0000-4000-8000-000000000812';
const candidateId = '00000000-0000-4000-8000-000000000813';
const runId = '00000000-0000-4000-8000-000000000814';
const replacementRevisionId = '00000000-0000-4000-8000-000000000815';
const editedCandidateId = '00000000-0000-4000-8000-000000000816';
const matchRevisionId = '00000000-0000-4000-8000-000000000817';
const snapshotId = '00000000-0000-4000-8000-000000000818';
const selectionRevisionId = '00000000-0000-4000-8000-000000000819';
const mealId = '00000000-0000-4000-8000-000000000820';
const hash = 'c'.repeat(64);
const createdAt = '2026-08-17T02:00:00.000Z';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve: (value: T) => resolve(value) };
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

const source = { sourceKind: 'TEST_FIXTURE' as const, sourceId: 'fixture-foods', sourceVersion: '2026-08-17', datasetHash: hash, redistribution: false, licenseDecisionId: null };
const editedCandidate = {
  candidateId: editedCandidateId,
  displayName: 'Cooked rice',
  quantityDecimal: '200.5',
  unit: 'GRAM' as const,
  included: true,
  selectedFoodSnapshotId: null,
  provenance: [{ kind: 'OWNER_EDIT' as const, capabilityRunId: null, editedFields: ['displayName', 'quantityDecimal', 'unit', 'included'], capturedAt: createdAt }],
};
const foodSnapshot = {
  id: snapshotId,
  candidateId: editedCandidateId,
  source,
  record: {
    schemaVersion: 'NUTRITION_RECORD_V1' as const,
    source,
    recordId: 'https://en.wikipedia.org/wiki/Rice',
    recordHash: hash,
    displayName: 'Cooked rice',
    serving: { quantityDecimal: '200.5', unit: 'GRAM' as const },
    nutrientsPerServing: { energyKcalDecimal: '150', proteinGramsDecimal: '3', carbohydrateGramsDecimal: '30', fatGramsDecimal: '1' },
  },
  capabilityRunId: runId,
  createdAt,
};
const nonWikipediaFoodSnapshot = {
  ...foodSnapshot,
  id: '00000000-0000-4000-8000-000000000822',
  record: { ...foodSnapshot.record, recordId: 'https://en.wikipedia.org.example.invalid/wiki/Rice' },
};

function editableDraftResponse() {
  const response = parsedDraftResponse();
  response.data.draft.originalText = '米饭一碗和青菜';
  response.data.revision.candidates = [
    { ...response.data.revision.candidates[0]!, displayName: '米饭', quantityDecimal: '1', unit: 'ITEM' as const },
    { ...response.data.revision.candidates[0]!, candidateId: '00000000-0000-4000-8000-000000000821', displayName: '青菜', quantityDecimal: '50', unit: 'GRAM' as const },
  ];
  return response;
}

function replacementResponse() {
  return {
    data: {
      draft: { id: draftId, localDate: '2026-08-17', mode: 'PARSE_TEXT', originalText: '米饭一碗和青菜', state: 'CANDIDATES_READY' as const, currentRevisionId: replacementRevisionId, confirmedMealId: null, version: 2, createdAt, updatedAt: createdAt },
      revision: { id: replacementRevisionId, draftId, parentRevisionId: revisionId, revisionNo: 2, candidates: [editedCandidate], contentHash: hash, createdBy: 'OWNER' as const, capabilityRunId: null, createdAt },
    },
  };
}

function matchedResponse() {
  return {
    data: {
      draft: { id: draftId, localDate: '2026-08-17', mode: 'PARSE_TEXT', originalText: '米饭一碗和青菜', state: 'MATCHES_READY' as const, currentRevisionId: matchRevisionId, confirmedMealId: null, version: 3, createdAt, updatedAt: createdAt },
      revision: { id: matchRevisionId, draftId, parentRevisionId: replacementRevisionId, revisionNo: 3, candidates: [{ ...editedCandidate, provenance: [...editedCandidate.provenance, { kind: 'DATA_MATCH' as const, capabilityRunId: runId, editedFields: ['selectedFoodSnapshotId'], capturedAt: createdAt }] }], contentHash: hash, createdBy: 'DATA_PROVIDER' as const, capabilityRunId: runId, createdAt },
      matches: [{ candidateId: editedCandidateId, status: 'MATCHED' as const, snapshots: [foodSnapshot, nonWikipediaFoodSnapshot] }],
      source,
    },
  };
}

function selectedResponse() {
  return {
    data: {
      draft: { id: draftId, localDate: '2026-08-17', mode: 'PARSE_TEXT', originalText: '米饭一碗和青菜', state: 'MATCHES_READY' as const, currentRevisionId: selectionRevisionId, confirmedMealId: null, version: 4, createdAt, updatedAt: createdAt },
      revision: { id: selectionRevisionId, draftId, parentRevisionId: matchRevisionId, revisionNo: 4, candidates: [{ ...editedCandidate, selectedFoodSnapshotId: snapshotId, provenance: [...editedCandidate.provenance, { kind: 'DATA_MATCH' as const, capabilityRunId: runId, editedFields: ['selectedFoodSnapshotId'], capturedAt: createdAt }, { kind: 'OWNER_EDIT' as const, capabilityRunId: null, editedFields: ['included', 'selectedFoodSnapshotId'], capturedAt: createdAt }] }], contentHash: hash, createdBy: 'OWNER' as const, capabilityRunId: null, createdAt },
    },
  };
}

function confirmedResponse() {
  return {
    data: {
      draft: { id: draftId, localDate: '2026-08-17', mode: 'PARSE_TEXT', originalText: '米饭一碗和青菜', state: 'CONFIRMED' as const, currentRevisionId: selectionRevisionId, confirmedMealId: mealId, version: 5, createdAt, updatedAt: createdAt },
      meal: {
        id: mealId,
        draftId,
        localDate: '2026-08-17',
        entries: [{ candidateId: editedCandidateId, foodSnapshotId: snapshotId, displayName: 'Cooked rice', quantityDecimal: '200.5', unit: 'GRAM' as const, energyKcalDecimal: '150', proteinGramsDecimal: '3', carbohydrateGramsDecimal: '30', fatGramsDecimal: '1', lineage: [{ entityType: 'MEAL_DRAFT' as const, entityId: draftId, entityVersion: 5, contentHash: null }, { entityType: 'MEAL_REVISION' as const, entityId: selectionRevisionId, entityVersion: 4, contentHash: hash }, { entityType: 'FOOD_SNAPSHOT' as const, entityId: snapshotId, entityVersion: 1, contentHash: hash }, { entityType: 'MEAL' as const, entityId: mealId, entityVersion: 1, contentHash: null }] }],
        totals: { energyKcalDecimal: '150', proteinGramsDecimal: '3', carbohydrateGramsDecimal: '30', fatGramsDecimal: '1' },
        calculationVersion: 'DECIMAL_MICRO_V1' as const,
        version: 1 as const,
        createdAt,
      },
    },
  };
}

describe('NutritionWorkspace', () => {
  it('makes DeepSeek and the cached public lookup primary while keeping USDA optional', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<NutritionProviderSettings />);

    expect(screen.getByRole('heading', { name: '营养匹配' })).toBeInTheDocument();
    expect(screen.getByText(/使用本页的 DeepSeek API 配置/)).toBeInTheDocument();
    expect(screen.getByText('可选：USDA 专用来源')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps optional USDA controls usable when its details close and reopen during a save', async () => {
    const save = deferred<Response>();
    const reopenedRead = deferred<Response>();
    let readCount = 0;
    const metadata = (state: 'CONFIGURED' | 'NOT_CONFIGURED') => ({ data: { providerKey: 'USDA_FDC', state, updatedAt: state === 'CONFIGURED' ? '2026-08-17T02:00:00.000Z' : null } });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/core/providers/usda/credential' && init?.method === 'GET') {
        readCount += 1;
        return readCount === 1 ? Promise.resolve(jsonResponse(metadata('NOT_CONFIGURED'))) : reopenedRead.promise;
      }
      if (url === '/api/core/providers/usda/credential' && init?.method === 'PUT') return save.promise;
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<NutritionProviderSettings />);

    await user.click(screen.getByText('可选：USDA 专用来源'));
    await user.type(await screen.findByLabelText('USDA API key'), 'legacy-key-123');
    await user.click(screen.getByRole('button', { name: '保存营养数据密钥' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/core/providers/usda/credential', expect.objectContaining({ method: 'PUT' })));
    await user.click(screen.getByText('可选：USDA 专用来源'));
    await user.click(screen.getByText('可选：USDA 专用来源'));
    await screen.findByLabelText('USDA API key');

    await act(async () => { save.resolve(jsonResponse(metadata('CONFIGURED'))); await save.promise; });
    await waitFor(() => expect(screen.getByLabelText('USDA API key')).not.toBeDisabled());
    await waitFor(() => expect(screen.getByRole('button', { name: '移除营养数据密钥' })).toBeEnabled());
    await act(async () => { reopenedRead.resolve(jsonResponse(metadata('NOT_CONFIGURED'))); await reopenedRead.promise; });
    expect(screen.getByRole('button', { name: '移除营养数据密钥' })).toBeEnabled();
  });

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
    await user.click(screen.getByLabelText('我理解解析会向已配置的 DeepSeek 发送餐食文本。'));
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
    await user.click(screen.getByLabelText('我理解解析会向已配置的 DeepSeek 发送餐食文本。'));
    await user.click(screen.getByRole('button', { name: '解析候选食物' }));

    expect(await screen.findByText('Fixture Food Alpha · 150 GRAM')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/core/nutrition/meal-drafts', expect.objectContaining({ method: 'POST', body: JSON.stringify({ mode: 'PARSE_TEXT', localDate: '2026-08-17', mealText: 'Fixture Food Alpha 150 g', disclosureVersion: 'HEALTH_DISCLOSURE_V1' }) }));
    expect(screen.queryByText(/kcal/)).not.toBeInTheDocument();
  });

  it('requires saved candidate edits before matching, then matches, selects, and confirms the edited included candidates', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (url === '/api/core/nutrition/meal-drafts') return jsonResponse(editableDraftResponse(), 201);
      if (url === `/api/core/nutrition/meal-drafts/${draftId}/revisions` && body.operation === 'REPLACE_CANDIDATES') {
        expect(body).toEqual({ expectedVersion: 1, parentRevisionId: revisionId, operation: 'REPLACE_CANDIDATES', candidates: [{ displayName: 'Cooked rice', quantityDecimal: '200.5', unit: 'GRAM' }] });
        return jsonResponse(replacementResponse(), 201);
      }
      if (url === `/api/core/nutrition/meal-drafts/${draftId}/matches`) {
        expect(body).toEqual({ expectedVersion: 2, revisionId: replacementRevisionId });
        return jsonResponse(matchedResponse(), 202);
      }
      if (url === `/api/core/nutrition/meal-drafts/${draftId}/revisions` && body.operation === 'SELECT_MATCHES') {
        expect(body).toEqual({ expectedVersion: 3, parentRevisionId: matchRevisionId, operation: 'SELECT_MATCHES', candidates: [{ candidateId: editedCandidateId, included: true, selectedFoodSnapshotId: snapshotId }] });
        return jsonResponse(selectedResponse(), 201);
      }
      if (url === `/api/core/nutrition/meal-drafts/${draftId}/confirm`) {
        expect(body).toEqual({ expectedVersion: 4, revisionId: selectionRevisionId });
        return jsonResponse(confirmedResponse(), 201);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<NutritionWorkspace initialDate="2026-08-17" />);

    await user.type(screen.getByLabelText('餐食文本'), '米饭一碗和青菜');
    expect(screen.getByRole('button', { name: '解析候选食物' })).toBeDisabled();
    await user.click(screen.getByLabelText('我理解解析会向已配置的 DeepSeek 发送餐食文本。'));
    await user.click(screen.getByRole('button', { name: '解析候选食物' }));
    await screen.findByDisplayValue('米饭');
    expect(screen.getByText(/本地缓存未命中时向 DeepSeek 发送已保存且包含的候选食物名称和单位/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText('候选 1 食物名称'));
    await user.type(screen.getByLabelText('候选 1 食物名称'), 'Cooked rice');
    await user.clear(screen.getByLabelText('候选 1 十进制数量'));
    await user.type(screen.getByLabelText('候选 1 十进制数量'), '200.5');
    await user.selectOptions(screen.getByLabelText('候选 1 单位'), 'GRAM');
    await user.click(screen.getByLabelText('包含候选 2'));

    expect(screen.getByRole('button', { name: '匹配营养来源' })).toBeDisabled();
    expect(screen.getByText('请先保存候选修改，再匹配营养来源。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存候选修改' }));
    await screen.findByDisplayValue('Cooked rice');

    await user.click(screen.getByRole('button', { name: '匹配营养来源' }));
    const sourceLink = await screen.findByRole('link', { name: '查看 Wikipedia 公开条目' });
    expect(sourceLink).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Rice');
    expect(screen.getAllByRole('link', { name: '查看 Wikipedia 公开条目' })).toHaveLength(1);
    expect(screen.getByText('公开网页提取，请核对食物、生熟状态与单位')).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText('为 Cooked rice 选择来源'), snapshotId);
    await user.click(screen.getByRole('button', { name: '保存来源选择' }));
    await user.click(screen.getByRole('button', { name: '确认这餐' }));

    expect(await screen.findByText('餐食已确认')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
