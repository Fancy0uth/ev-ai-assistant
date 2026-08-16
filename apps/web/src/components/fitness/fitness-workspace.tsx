'use client';

import { checkInResponseSchema } from '@ev/contracts';
import { Activity, Save } from 'lucide-react';
import { useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';

function failureMessage(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '本地打卡暂时未保存，请稍后重试。';
}

const levelCopy = {
  READY: '恢复良好',
  MODERATE: '适度安排',
  CAUTION: '注意恢复',
} as const;

export function FitnessWorkspace({ initialDate }: { initialDate: string }) {
  const [sleepHours, setSleepHours] = useState('7');
  const [energy, setEnergy] = useState('3');
  const [discomfort, setDiscomfort] = useState('0');
  const [result, setResult] = useState<ReturnType<typeof checkInResponseSchema.parse>['data'] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    setIsSaving(true);
    try {
      const payload = await requestCore('check-ins', {
        method: 'POST',
        body: JSON.stringify({
          localDate: initialDate,
          sleepHours: Number(sleepHours),
          energy: Number(energy),
          discomfort: Number(discomfort),
        }),
      });
      setResult(checkInResponseSchema.parse(payload).data);
    } catch (error) {
      setFailure(failureMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="domain-workspace" aria-labelledby="fitness-heading">
      <header className="domain-workspace__header">
        <p className="section-kicker">FITNESS / LOCAL SIGNAL</p>
        <h1 id="fitness-heading">训练与恢复</h1>
        <p>先记录身体状态；训练计划只能在这个信号的基础上提出建议，不能替你作医疗判断。</p>
      </header>

      <div className="domain-workspace__grid">
        <form className="domain-card domain-form" onSubmit={(event) => void submit(event)}>
          <div className="domain-card__heading">
            <Activity aria-hidden="true" size={19} />
            <div>
              <h2>今天的恢复打卡</h2>
              <p>{initialDate} · 只保存到本机</p>
            </div>
          </div>
          <label>
            睡眠时长（小时）
            <input
              min="0"
              max="24"
              step="0.5"
              type="number"
              value={sleepHours}
              onChange={(event) => setSleepHours(event.target.value)}
            />
          </label>
          <label>
            主观精力（1–5）
            <select value={energy} onChange={(event) => setEnergy(event.target.value)}>
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            不适程度（0–5）
            <select value={discomfort} onChange={(event) => setDiscomfort(event.target.value)}>
              {[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          {failure ? <p className="domain-form__error" role="alert">{failure}</p> : null}
          <button disabled={isSaving} type="submit">
            <Save aria-hidden="true" size={16} /> {isSaving ? '正在保存…' : '保存本地打卡'}
          </button>
        </form>

        <aside className="domain-card domain-result" aria-live="polite">
          <p className="section-kicker">RECOVERY RESULT</p>
          {result ? (
            <>
              <h2>{levelCopy[result.assessment.level]}</h2>
              <p className="domain-result__score">{result.assessment.score} / 100</p>
              <ul>
                {result.assessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              <p className="domain-result__boundary">本结果仅用于安排负载，不构成医疗诊断。</p>
            </>
          ) : (
            <>
              <h2>等待今天的打卡</h2>
              <p>打卡后会生成可审计的恢复信号，并同步到今日控制台。</p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
