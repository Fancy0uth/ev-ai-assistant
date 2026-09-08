'use client';

import {
  mealConfirmResponseSchema,
  mealDraftCreateResponseSchema,
  mealDraftDetailResponseSchema,
  mealDraftListResponseSchema,
  mealDraftMatchResponseSchema,
  mealDraftRevisionResponseSchema,
  type MealDraft,
  type MealRevision,
  type MealV2,
  type NutritionSourceDescriptor,
} from '@ev/contracts';
import { Save, Utensils } from 'lucide-react';
import { useState } from 'react';
import { MealDraftReview } from '@/components/nutrition/meal-draft-review';
import { CoreClientError, requestCore } from '@/lib/core-client';
import { createIdempotencyKey } from '@/lib/idempotency-key';

type NutritionStage = 'ENTRY' | 'PARSER_UNAVAILABLE' | 'CANDIDATES_REVIEW' | 'MATCHING' | 'MATCHES_REVIEW' | 'CONFIRM' | 'CONFIRMED' | 'FAILED';
type MealDetail = { draft: MealDraft; revision: MealRevision; matches: MealCandidateMatch[]; source: NutritionSourceDescriptor | null; meal: MealV2 | null };
type ManualCandidate = { displayName: string; quantityDecimal: string; unit: 'GRAM' | 'MILLILITER' | 'ITEM' };
type MealCandidateMatch = ReturnType<typeof mealDraftMatchResponseSchema.parse>['data']['matches'][number];

function failureMessage(error: unknown): string {
  if (!(error instanceof CoreClientError)) return '本地餐食流程暂时不可用，请稍后重试。';
  if (error.status === 404 || error.status === 409) return '草稿已变化或不存在，请刷新后重新审阅。';
  if (error.status === 422) return '候选、单位或版本不符合确认要求；未写入餐食。';
  if (error.status === 429) return '今日 Provider 调用次数已达上限，请稍后重试。';
  if (error.status === 503) return '餐食文本 Provider 尚未配置或待审批；请使用手工候选。';
  return error.message;
}

function idempotentInit(): { headers: HeadersInit } {
  return { headers: { 'Idempotency-Key': createIdempotencyKey() } };
}

export function NutritionWorkspace({ initialDate }: { initialDate: string }) {
  const [localDate, setLocalDate] = useState(initialDate);
  const [mealText, setMealText] = useState('');
  const [stage, setStage] = useState<NutritionStage>('ENTRY');
  const [manualCandidates, setManualCandidates] = useState<ManualCandidate[]>([{ displayName: '', quantityDecimal: '1', unit: 'GRAM' }]);
  const [detail, setDetail] = useState<MealDetail | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<MealDraft[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function createDraft(body: unknown): Promise<void> {
    const payload = await requestCore('nutrition/meal-drafts', { method: 'POST', ...idempotentInit(), body: JSON.stringify(body) });
    const created = mealDraftCreateResponseSchema.parse(payload).data;
    setDetail({ draft: created.draft, revision: created.revision, matches: [], source: null, meal: null });
    setStage('CANDIDATES_REVIEW');
  }

  async function parseMeal(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setIsBusy(true);
    try {
      await createDraft({ mode: 'PARSE_TEXT', localDate, mealText, disclosureVersion: 'HEALTH_DISCLOSURE_V1' });
    } catch (error) {
      setFailure(failureMessage(error));
      setStage(error instanceof CoreClientError && error.status === 503 ? 'PARSER_UNAVAILABLE' : 'FAILED');
    } finally {
      setIsBusy(false);
    }
  }

  function changeManualCandidate(index: number, field: keyof ManualCandidate, value: string): void {
    setManualCandidates((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, [field]: value } : candidate));
  }

  async function createManualDraft(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setIsBusy(true);
    try {
      await createDraft({ mode: 'MANUAL', localDate, candidates: manualCandidates });
    } catch (error) {
      setFailure(failureMessage(error));
      setStage('PARSER_UNAVAILABLE');
    } finally {
      setIsBusy(false);
    }
  }

  async function matchDraft(): Promise<void> {
    if (!detail) return;
    setFailure(null);
    setStage('MATCHING');
    setIsBusy(true);
    try {
      const payload = await requestCore(`nutrition/meal-drafts/${detail.draft.id}/matches`, { method: 'POST', ...idempotentInit(), body: JSON.stringify({ expectedVersion: detail.draft.version, revisionId: detail.revision.id }) });
      const matched = mealDraftMatchResponseSchema.parse(payload).data;
      setDetail((current) => current ? { ...current, draft: matched.draft, revision: matched.revision, matches: matched.matches, source: matched.source } : current);
      setStage('MATCHES_REVIEW');
    } catch (error) {
      setFailure(failureMessage(error));
      setStage('FAILED');
    } finally {
      setIsBusy(false);
    }
  }

  async function saveSelections(selections: Array<{ candidateId: string; selectedFoodSnapshotId: string | null; included: boolean }>): Promise<void> {
    if (!detail) return;
    setFailure(null);
    setIsBusy(true);
    try {
      const payload = await requestCore(`nutrition/meal-drafts/${detail.draft.id}/revisions`, {
        method: 'POST', ...idempotentInit(),
        body: JSON.stringify({ expectedVersion: detail.draft.version, parentRevisionId: detail.revision.id, operation: 'SELECT_MATCHES', candidates: selections }),
      });
      const revised = mealDraftRevisionResponseSchema.parse(payload).data;
      setDetail((current) => current ? { ...current, draft: revised.draft, revision: revised.revision } : current);
      setStage('CONFIRM');
    } catch (error) {
      setFailure(failureMessage(error));
      setStage('FAILED');
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmDraft(): Promise<void> {
    if (!detail) return;
    setFailure(null);
    setIsBusy(true);
    try {
      const payload = await requestCore(`nutrition/meal-drafts/${detail.draft.id}/confirm`, { method: 'POST', ...idempotentInit(), body: JSON.stringify({ expectedVersion: detail.draft.version, revisionId: detail.revision.id }) });
      const confirmed = mealConfirmResponseSchema.parse(payload).data;
      setDetail((current) => current ? { ...current, draft: confirmed.draft, meal: confirmed.meal } : current);
      setStage('CONFIRMED');
    } catch (error) {
      setFailure(failureMessage(error));
      setStage('FAILED');
    } finally {
      setIsBusy(false);
    }
  }

  async function loadSavedDrafts(): Promise<void> {
    setFailure(null);
    setIsBusy(true);
    try {
      const payload = await requestCore(`nutrition/meal-drafts?localDate=${encodeURIComponent(localDate)}&page=1&pageSize=50`, { method: 'GET' });
      setSavedDrafts(mealDraftListResponseSchema.parse(payload).data.items);
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function openSavedDraft(draftId: string): Promise<void> {
    setFailure(null);
    setIsBusy(true);
    try {
      const payload = await requestCore(`nutrition/meal-drafts/${draftId}`, { method: 'GET' });
      const saved = mealDraftDetailResponseSchema.parse(payload).data;
      setDetail({ draft: saved.draft, revision: saved.revision, matches: saved.matches, source: saved.matches[0]?.snapshots[0]?.source ?? null, meal: saved.confirmedMeal });
      setStage(saved.draft.state === 'CONFIRMED' ? 'CONFIRMED' : saved.draft.state === 'MATCHES_READY' ? 'CONFIRM' : 'CANDIDATES_REVIEW');
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="domain-workspace health-workspace" aria-labelledby="nutrition-heading">
      <header className="domain-workspace__header"><p className="section-kicker">NUTRITION / SOURCED REVIEW</p><h1 id="nutrition-heading">饮食记录</h1><p>先表达一餐，再审阅候选与来源。营养数字只来自已选择的来源快照。</p></header>
      {stage === 'ENTRY' || stage === 'FAILED' ? <form className="domain-card domain-form" onSubmit={(event) => void parseMeal(event)}>
        <div className="domain-card__heading"><Utensils aria-hidden="true" size={19} /><div><h2>输入一餐</h2><p>{localDate} · 仅本地保存</p></div></div>
        <label>本地日期<input type="date" value={localDate} onChange={(event) => setLocalDate(event.target.value)} /></label>
        <label>餐食文本<textarea maxLength={1000} required value={mealText} onChange={(event) => setMealText(event.target.value)} /></label>
        {failure ? <p className="domain-form__error" role="alert">{failure}</p> : null}
        <button disabled={isBusy} type="submit"><Save aria-hidden="true" size={16} /> {isBusy ? '正在解析…' : '解析候选食物'}</button>
        <button disabled={isBusy} onClick={() => void loadSavedDrafts()} type="button">读取本地餐食草稿</button>
        {savedDrafts.map((savedDraft) => <button key={savedDraft.id} disabled={isBusy} onClick={() => void openSavedDraft(savedDraft.id)} type="button">打开餐食草稿 {savedDraft.id}</button>)}
      </form> : null}
      {stage === 'PARSER_UNAVAILABLE' ? <form className="health-manual-candidates" onSubmit={(event) => void createManualDraft(event)}>
        <p className="section-kicker">PARSER UNAVAILABLE</p><h2>手工候选</h2><p>Provider 返回 503 或尚待审批。仅输入名称、十进制数量和单位；这里不接受营养数值。</p>
        {manualCandidates.map((candidate, index) => <fieldset key={index}><legend>候选 {index + 1}</legend><label>食物名称<input required value={candidate.displayName} onChange={(event) => changeManualCandidate(index, 'displayName', event.target.value)} /></label><label>十进制数量<input inputMode="decimal" pattern="^(0|[1-9][0-9]{0,5})(\\.[0-9]{1,6})?$" required value={candidate.quantityDecimal} onChange={(event) => changeManualCandidate(index, 'quantityDecimal', event.target.value)} /></label><label>单位<select value={candidate.unit} onChange={(event) => changeManualCandidate(index, 'unit', event.target.value)}><option value="GRAM">GRAM</option><option value="MILLILITER">MILLILITER</option><option value="ITEM">ITEM</option></select></label></fieldset>)}
        <button onClick={() => setManualCandidates((current) => [...current, { displayName: '', quantityDecimal: '1', unit: 'GRAM' }])} type="button">添加候选</button>
        {failure ? <p className="domain-form__error" role="alert">{failure}</p> : null}
        <button disabled={isBusy} type="submit">保存手工候选</button>
      </form> : null}
      {detail ? <MealDraftReview key={detail.revision.id} draft={detail.draft} revision={detail.revision} matches={detail.matches} source={detail.source} meal={detail.meal} busy={isBusy} failure={failure} onMatch={matchDraft} onSaveSelections={saveSelections} onConfirm={confirmDraft} /> : null}
    </section>
  );
}
