'use client';

import { mealDraftMatchResponseSchema, type MealDraft, type MealRevision, type MealV2, type NutritionSourceDescriptor } from '@ev/contracts';
import { Check, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

type EditableCandidate = {
  displayName: string;
  quantityDecimal: string;
  unit: 'GRAM' | 'MILLILITER' | 'ITEM';
  included: boolean;
};

function wikipediaRecordUrl(recordId: string): string | null {
  try {
    const url = new URL(recordId);
    const trustedHost = url.hostname === 'en.wikipedia.org' || url.hostname === 'zh.wikipedia.org';
    return url.protocol === 'https:' && url.port === '' && !url.username && !url.password && trustedHost ? url.href : null;
  } catch {
    return null;
  }
}

export function MealDraftReview({
  draft,
  revision,
  matches,
  source,
  meal,
  busy,
  failure,
  onMatch,
  onSaveCandidates,
  onSaveSelections,
  onConfirm,
}: {
  draft: MealDraft;
  revision: MealRevision;
  matches: MealCandidateMatch[];
  source: NutritionSourceDescriptor | null;
  meal: MealV2 | null;
  busy: boolean;
  failure: string | null;
  onMatch: () => Promise<void>;
  onSaveCandidates: (candidates: Array<Omit<EditableCandidate, 'included'>>) => Promise<void>;
  onSaveSelections: (selections: Array<{ candidateId: string; selectedFoodSnapshotId: string | null; included: boolean }>) => Promise<void>;
  onConfirm: () => Promise<void>;
}) {
  const [candidateEdits, setCandidateEdits] = useState<EditableCandidate[]>(
    () => revision.candidates.map(({ displayName, quantityDecimal, unit, included }) => ({ displayName, quantityDecimal, unit, included })),
  );
  const [selections, setSelections] = useState<Record<string, string | null>>(
    () => Object.fromEntries(revision.candidates.map((candidate) => [candidate.candidateId, candidate.selectedFoodSnapshotId])),
  );

  const hasUnsavedCandidateEdits = useMemo(() => candidateEdits.length !== revision.candidates.length || candidateEdits.some((candidate, index) => {
    const current = revision.candidates[index];
    return current === undefined
      || candidate.displayName !== current.displayName
      || candidate.quantityDecimal !== current.quantityDecimal
      || candidate.unit !== current.unit
      || candidate.included !== current.included;
  }), [candidateEdits, revision.candidates]);
  const includedCandidateEdits = useMemo(() => candidateEdits.filter((candidate) => candidate.included), [candidateEdits]);
  const canUseSavedMatches = draft.state === 'MATCHES_READY' && !hasUnsavedCandidateEdits;

  function changeCandidate(index: number, field: keyof EditableCandidate, value: string | boolean): void {
    setCandidateEdits((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, [field]: value } : candidate));
  }

  const everyIncludedCandidateHasSameUnitMatch = useMemo(() => revision.candidates.filter((candidate) => candidate.included).every((candidate) => {
    const snapshotId = selections[candidate.candidateId];
    const match = matches.find((value) => value.candidateId === candidate.candidateId);
    return snapshotId !== null && snapshotId !== undefined && match?.snapshots.some((snapshot) => snapshot.id === snapshotId && snapshot.record.serving.unit === candidate.unit) === true;
  }), [matches, revision.candidates, selections]);
  const everyIncludedCandidateHasSavedSameUnitMatch = useMemo(() => revision.candidates.filter((candidate) => candidate.included).every((candidate) => {
    const match = matches.find((value) => value.candidateId === candidate.candidateId);
    return candidate.selectedFoodSnapshotId !== null && match?.snapshots.some((snapshot) => snapshot.id === candidate.selectedFoodSnapshotId && snapshot.record.serving.unit === candidate.unit) === true;
  }), [matches, revision.candidates]);

  if (meal) {
    return (
      <section className="health-review meal-review" aria-labelledby="meal-review-heading">
        <p className="section-kicker">MEAL / CONFIRMED</p><h2 id="meal-review-heading">餐食已确认</h2>
        <p className="meal-review__totals">{meal.totals.energyKcalDecimal} kcal · 蛋白质 {meal.totals.proteinGramsDecimal} g · 碳水 {meal.totals.carbohydrateGramsDecimal} g · 脂肪 {meal.totals.fatGramsDecimal} g</p>
        {source?.sourceKind === 'TEST_FIXTURE' ? <p className="fixture-disclaimer"><ShieldCheck aria-hidden="true" size={16} /> TEST_FIXTURE — 非真实营养数据</p> : null}
        <p className="meal-review__lineage">来源 {source?.sourceKind ?? '未提供'} · {source?.sourceId ?? '未提供'} · {source?.sourceVersion ?? '未提供'} · dataset {source?.datasetHash.slice(0, 12) ?? '未提供'}…</p>
      </section>
    );
  }

  return (
    <section className="health-review meal-review" aria-labelledby="meal-review-heading">
      <header className="health-review__header"><div><p className="section-kicker">MEAL / OWNER REVIEW</p><h2 id="meal-review-heading">候选与来源审阅</h2><p>候选不会携带热量或宏量数字；只有同单位的来源快照可进入确认。</p></div><span className="health-review__state">{draft.state}</span></header>
      {failure ? <p className="health-review__failure" role="alert">{failure}</p> : null}
      <p>公开来源覆盖有限，中文名称可能无匹配，可改为英文名称后再匹配。毫升没有换算依据时不能当作克；请保留 MILLILITER 或改为确知的份量。营养数值仅来自来源快照，不能手动修改。</p>
      <form className="meal-review__candidate-editor" onSubmit={(event) => {
        event.preventDefault();
        if (!hasUnsavedCandidateEdits || !includedCandidateEdits.length || !event.currentTarget.reportValidity()) return;
        void onSaveCandidates(includedCandidateEdits.map(({ displayName, quantityDecimal, unit }) => ({ displayName, quantityDecimal, unit })));
      }}>
        <h3>编辑候选</h3>
        {candidateEdits.map((candidate, index) => <fieldset key={revision.candidates[index]?.candidateId ?? index}>
          <legend>候选 {index + 1}</legend>
          <label>候选 {index + 1} 食物名称<input disabled={!candidate.included} required value={candidate.displayName} onChange={(event) => changeCandidate(index, 'displayName', event.target.value)} /></label>
          <label>候选 {index + 1} 十进制数量<input disabled={!candidate.included} inputMode="decimal" pattern="^(0|[1-9][0-9]{0,5})([.][0-9]{1,6})?$" required value={candidate.quantityDecimal} onChange={(event) => changeCandidate(index, 'quantityDecimal', event.target.value)} /></label>
          <label>候选 {index + 1} 单位<select disabled={!candidate.included} value={candidate.unit} onChange={(event) => changeCandidate(index, 'unit', event.target.value)}><option value="GRAM">GRAM</option><option value="MILLILITER">MILLILITER</option><option value="ITEM">ITEM</option></select></label>
          <label><input checked={candidate.included} onChange={(event) => changeCandidate(index, 'included', event.target.checked)} type="checkbox" />包含候选 {index + 1}</label>
        </fieldset>)}
        {!includedCandidateEdits.length ? <p role="status">至少保留一个候选后才能保存。</p> : null}
        {candidateEdits.some((candidate) => !candidate.included) ? <p role="status">未包含的候选会在保存后从新的候选修订中移除，已匹配来源会清空。</p> : null}
        <button disabled={busy || !hasUnsavedCandidateEdits || !includedCandidateEdits.length} type="submit">保存候选修改</button>
      </form>
      {hasUnsavedCandidateEdits ? <p role="status">请先保存候选修改，再匹配营养来源。</p> : null}
      {draft.state === 'CANDIDATES_READY' ? <div className="health-review__actions"><p>匹配会在本地缓存未命中时向 DeepSeek 发送已保存且包含的候选食物名称和单位，再将这些查询信息用于 Wikipedia 公开资料查询；结果会保留在本地。不会发送原始整段餐食、个人资料或身份信息。</p><button disabled={busy || hasUnsavedCandidateEdits} onClick={() => void onMatch()} type="button"><Search aria-hidden="true" size={16} /> 匹配营养来源</button></div> : null}
      <ul className="meal-review__candidates" aria-label="餐食候选">
        {revision.candidates.map((candidate, index) => {
          const editedCandidate = candidateEdits[index] ?? candidate;
          const match = matches.find((value) => value.candidateId === candidate.candidateId);
          return <li key={candidate.candidateId}>
            <h3>{editedCandidate.displayName} · {editedCandidate.quantityDecimal} {editedCandidate.unit}{editedCandidate.included ? '' : ' · 已排除'}</h3>
            {hasUnsavedCandidateEdits ? <p>候选修改尚未保存，来源匹配将保持不可用。</p> : null}
            {!hasUnsavedCandidateEdits && !match ? <p>等待匹配来源。</p> : null}
            {canUseSavedMatches && match?.status === 'UNMATCHED' ? <p role="status">未找到同单位来源，无法确认。</p> : null}
            {canUseSavedMatches && match?.status === 'AMBIGUOUS' ? <p role="status">存在多个候选来源，请明确选择。</p> : null}
            {canUseSavedMatches && match?.snapshots.length ? <label>为 {candidate.displayName} 选择来源
              <select value={selections[candidate.candidateId] ?? ''} onChange={(event) => setSelections((current) => ({ ...current, [candidate.candidateId]: event.target.value || null }))}>
                <option value="">请选择同单位来源</option>
                {match.snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.record.displayName} · {snapshot.record.serving.quantityDecimal} {snapshot.record.serving.unit}</option>)}
              </select>
            </label> : null}
            {canUseSavedMatches && match?.snapshots.map((snapshot) => {
              const publicRecordUrl = wikipediaRecordUrl(snapshot.record.recordId);
              return <div className="meal-review__source" key={snapshot.id}>
                <p>{snapshot.record.displayName} · {snapshot.record.serving.quantityDecimal} {snapshot.record.serving.unit}</p>
                <p>{snapshot.source.sourceKind} · {snapshot.source.sourceId} · {snapshot.source.sourceVersion}</p>
                <p>dataset {snapshot.source.datasetHash} · record {snapshot.record.recordHash}</p>
                {publicRecordUrl ? <p><a href={publicRecordUrl} target="_blank" rel="noreferrer">查看 Wikipedia 公开条目</a></p> : null}
                {publicRecordUrl ? <p>公开网页提取，请核对食物、生熟状态与单位</p> : null}
                {snapshot.source.sourceKind === 'TEST_FIXTURE' ? <p className="fixture-disclaimer">TEST_FIXTURE — 非真实营养数据</p> : null}
              </div>;
            })}
          </li>;
        })}
      </ul>
      {draft.state === 'MATCHES_READY' ? <div className="health-review__actions">
        <button disabled={busy || hasUnsavedCandidateEdits} onClick={() => void onSaveSelections(revision.candidates.map((candidate) => ({ candidateId: candidate.candidateId, selectedFoodSnapshotId: selections[candidate.candidateId] ?? null, included: candidate.included })))} type="button">保存来源选择</button>
        <button disabled={busy || hasUnsavedCandidateEdits || !everyIncludedCandidateHasSameUnitMatch || !everyIncludedCandidateHasSavedSameUnitMatch} onClick={() => void onConfirm()} type="button"><Check aria-hidden="true" size={16} /> 确认这餐</button>
      </div> : null}
    </section>
  );
}

type MealCandidateMatch = ReturnType<typeof mealDraftMatchResponseSchema.parse>['data']['matches'][number];
