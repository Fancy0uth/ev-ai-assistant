'use client';

import { mealRecordResponseSchema } from '@ev/contracts';
import { Save, Utensils } from 'lucide-react';
import { useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

type Field = 'name' | 'grams' | 'calories' | 'proteinGrams' | 'carbohydrateGrams' | 'fatGrams';

function failureMessage(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '饮食记录暂时未保存，请稍后重试。';
}

export function NutritionWorkspace({ initialDate }: { initialDate: string }) {
  const [fields, setFields] = useState<Record<Field, string>>({
    name: '', grams: '0', calories: '0', proteinGrams: '0', carbohydrateGrams: '0', fatGrams: '0',
  });
  const [record, setRecord] = useState<ReturnType<typeof mealRecordResponseSchema.parse>['data'] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function change(field: Field, value: string): void {
    setFields((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setIsSaving(true);
    try {
      const entry = {
        name: fields.name,
        grams: Number(fields.grams),
        calories: Number(fields.calories),
        proteinGrams: Number(fields.proteinGrams),
        carbohydrateGrams: Number(fields.carbohydrateGrams),
        fatGrams: Number(fields.fatGrams),
      };
      const payload = await requestCore('meals', {
        method: 'POST', body: JSON.stringify({ localDate: initialDate, entries: [entry] }),
      });
      setRecord(mealRecordResponseSchema.parse(payload).data);
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="domain-workspace" aria-labelledby="nutrition-heading">
      <header className="domain-workspace__header">
        <p className="section-kicker">NUTRITION / CONFIRMED FACTS</p>
        <h1 id="nutrition-heading">饮食记录</h1>
        <p>先记录你已经确认的食物和营养数值。后续 API 只负责提出候选，最终写入仍需要你确认。</p>
      </header>

      <div className="domain-workspace__grid">
        <form className="domain-card domain-form" onSubmit={(event) => void submit(event)}>
          <div className="domain-card__heading">
            <Utensils aria-hidden="true" size={19} />
            <div><h2>确认一餐</h2><p>{initialDate} · 本地记录</p></div>
          </div>
          <label>
            食物名称
            <input value={fields.name} onChange={(event) => change('name', event.target.value)} />
          </label>
          <div className="nutrition-form__grid">
            <NumberField label="重量（克）" value={fields.grams} onChange={(value) => change('grams', value)} />
            <NumberField label="热量（千卡）" value={fields.calories} onChange={(value) => change('calories', value)} />
            <NumberField label="蛋白质（克）" value={fields.proteinGrams} onChange={(value) => change('proteinGrams', value)} />
            <NumberField label="碳水（克）" value={fields.carbohydrateGrams} onChange={(value) => change('carbohydrateGrams', value)} />
            <NumberField label="脂肪（克）" value={fields.fatGrams} onChange={(value) => change('fatGrams', value)} />
          </div>
          {failure ? <p className="domain-form__error" role="alert">{failure}</p> : null}
          <button disabled={isSaving} type="submit"><Save aria-hidden="true" size={16} /> {isSaving ? '正在保存…' : '确认并保存这餐'}</button>
        </form>

        <aside className="domain-card domain-result" aria-live="polite">
          <p className="section-kicker">CONFIRMATION</p>
          {record ? (
            <>
              <h2>本餐已确认</h2>
              <p className="meal-confirmation">{record.totals.calories} kcal · 蛋白质 {record.totals.proteinGrams} g</p>
              <p>碳水 {record.totals.carbohydrateGrams} g · 脂肪 {record.totals.fatGrams} g</p>
            </>
          ) : (
            <><h2>等待确认的记录</h2><p>所有数值都会显示在这里，便于你核对后再继续安排当天饮食。</p></>
          )}
          <p className="domain-result__boundary">系统不会把未经你确认的模型猜测写入饮食记录。</p>
        </aside>
      </div>
    </section>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label>{label}<input min="0" step="0.1" type="number" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}
