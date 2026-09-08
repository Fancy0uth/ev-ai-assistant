import type { TodaySnapshot } from '@ev/contracts';
import Link from 'next/link';

type Snapshot = TodaySnapshot['data'];

const levelCopy = {
  STEADY: { label: '节奏稳定', note: '当前安排仍在可控范围内' },
  TIGHT: { label: '日程偏紧', note: '先处理优先级最高的工作' },
  OVERLOADED: { label: '负载过高', note: '建议减少或延期部分任务' },
} as const;

function recoveryCopy(value: number): { label: string; note: string } {
  if (value <= 34) return { label: '注意恢复', note: '今天优先降低训练和任务负载' };
  if (value <= 59) return { label: '适度安排', note: '保留弹性时间，避免连续高强度安排' };
  return { label: '恢复良好', note: '当前恢复信号支持按计划安排训练' };
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(`${date}T00:00:00+08:00`));
}

export function StatusOverview({ snapshot }: { snapshot: Snapshot }) {
  const copy = levelCopy[snapshot.status.level];
  const recoverySignal = snapshot.signals.filter((signal) => signal.kind === 'RECOVERY').slice(-1)[0];
  const recovery = recoverySignal ? recoveryCopy(recoverySignal.value) : null;

  return (
    <section className="status-overview" aria-labelledby="status-heading">
      <article className={`score-card score-card--${snapshot.status.level.toLowerCase()}`}>
        <div className="score-card__topline">
          <span>今日状态</span>
          <span className="score-card__source">规则引擎</span>
        </div>
        <div className="score-card__value">
          <strong>{snapshot.status.score}</strong>
          <span>/ 100</span>
        </div>
        <h2 id="status-heading">{copy.label}</h2>
        <p>{copy.note}</p>
        <progress
          className="status-progress"
          max={100}
          value={snapshot.status.score}
          aria-label={`今日状态分数 ${snapshot.status.score} 分`}
        />
      </article>

      <article className="overview-card overview-card--reasons">
        <div className="section-heading">
          <div>
            <p className="section-kicker">WHY THIS STATUS</p>
            <h2>状态依据</h2>
          </div>
          <span>{formatDate(snapshot.date)}</span>
        </div>
        <ul className="reason-list">
          {snapshot.status.reasons.map((reason, index) => (
            <li key={reason}>
              <span aria-hidden="true">0{index + 1}</span>
              <p>{reason}</p>
            </li>
          ))}
        </ul>
      </article>

      <article className="overview-card overview-card--priorities">
        <div className="section-heading">
          <div>
            <p className="section-kicker">NEXT UP</p>
            <h2>当前优先项</h2>
          </div>
          <span>{snapshot.status.priorities.length}/3</span>
        </div>
        {snapshot.status.priorities.length > 0 ? (
          <ol className="priority-list">
            {snapshot.status.priorities.map((priority) => (
              <li key={priority.id}>
                <span className={`priority-flag priority-flag--${priority.priority.toLowerCase()}`}>
                  {priority.priority}
                </span>
                <Link aria-label={`查看优先任务详情：${priority.title}`} href={`/tasks/${priority.id}`}>
                  {priority.title}
                </Link>
                <small>{priority.area}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="compact-empty">当前没有需要优先处理的任务。</p>
        )}
      </article>

      {recoverySignal && recovery ? (
        <article className="overview-card overview-card--recovery">
          <div className="section-heading">
            <div>
              <p className="section-kicker">LOCAL CHECK-IN</p>
              <h2>恢复状态</h2>
            </div>
            <span>{recoverySignal.value} / 100</span>
          </div>
          <p className="recovery-card__level">{recovery.label}</p>
          <p className="recovery-card__note">{recovery.note}</p>
          <p className="recovery-card__boundary">来自本地打卡，不构成医疗判断</p>
        </article>
      ) : null}
    </section>
  );
}
