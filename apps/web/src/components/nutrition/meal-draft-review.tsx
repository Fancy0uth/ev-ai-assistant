'use client';

import { mealDraftMatchResponseSchema, type MealDraft, type MealRevision, type MealV2, type NutritionSourceDescriptor } from '@ev/contracts';
import { Check, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

export function MealDraftReview({
  draft,
  revision,
  matches,
  source,
  meal,
  busy,
  failure,
  onMatch,
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
  onSaveSelections: (selections: Array<{ candidateId: string; selectedFoodSnapshotId: string | null; included: boolean }>) => Promise<void>;
  onConfirm: () => Promise<void>;
}) {
  const [selections, setSelections] = useState<Record<string, string | null>>(
    () => Object.fromEntries(revision.candidates.map((candidate) => [candidate.candidateId, candidate.selectedFoodSnapshotId])),
  );

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
      {draft.state === 'CANDIDATES_READY' ? <button disabled={busy} onClick={() => void onMatch()} type="button"><Search aria-hidden="true" size={16} /> 匹配营养来源</button> : null}
      <ul className="meal-review__candidates" aria-label="餐食候选">
        {revision.candidates.map((candidate) => {
          const match = matches.find((value) => value.candidateId === candidate.candidateId);
          return <li key={candidate.candidateId}>
            <h3>{candidate.displayName} · {candidate.quantityDecimal} {candidate.unit}</h3>
            {!match ? <p>等待匹配来源。</p> : null}
            {match?.status === 'UNMATCHED' ? <p role="status">未找到同单位来源，无法确认。</p> : null}
            {match?.status === 'AMBIGUOUS' ? <p role="status">存在多个候选来源，请明确选择。</p> : null}
            {match?.snapshots.length ? <label>为 {candidate.displayName} 选择来源
              <select value={selections[candidate.candidateId] ?? ''} onChange={(event) => setSelections((current) => ({ ...current, [candidate.candidateId]: event.target.value || null }))}>
                <option value="">请选择同单位来源</option>
                {match.snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.record.displayName} · {snapshot.record.serving.quantityDecimal} {snapshot.record.serving.unit}</option>)}
              </select>
            </label> : null}
            {match?.snapshots.map((snapshot) => <div className="meal-review__source" key={snapshot.id}>
              <p>{snapshot.record.displayName} · {snapshot.record.serving.quantityDecimal} {snapshot.record.serving.unit}</p>
              <p>{snapshot.source.sourceKind} · {snapshot.source.sourceId} · {snapshot.source.sourceVersion}</p>
              <p>dataset {snapshot.source.datasetHash} · record {snapshot.record.recordHash}</p>
              {snapshot.source.sourceKind === 'TEST_FIXTURE' ? <p className="fixture-disclaimer">TEST_FIXTURE — 非真实营养数据</p> : null}
            </div>)}
          </li>;
        })}
      </ul>
      {draft.state === 'MATCHES_READY' ? <div className="health-review__actions">
        <button disabled={busy} onClick={() => void onSaveSelections(revision.candidates.map((candidate) => ({ candidateId: candidate.candidateId, selectedFoodSnapshotId: selections[candidate.candidateId] ?? null, included: candidate.included })))} type="button">保存来源选择</button>
        <button disabled={busy || !everyIncludedCandidateHasSameUnitMatch || !everyIncludedCandidateHasSavedSameUnitMatch} onClick={() => void onConfirm()} type="button"><Check aria-hidden="true" size={16} /> 确认这餐</button>
      </div> : null}
    </section>
  );
}

type MealCandidateMatch = ReturnType<typeof mealDraftMatchResponseSchema.parse>['data']['matches'][number];
