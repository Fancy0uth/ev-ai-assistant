import type { TodaySnapshot } from '@ev/contracts';

type Snapshot = TodaySnapshot['data'];

const levelCopy = {
  STEADY: { label: '节奏稳定', note: '当前安排仍在可控范围内' },
  TIGHT: { label: '日程偏紧', note: '先处理优先级最高的工作' },
  OVERLOADED: { label: '负载过高', note: '建议减少或延期部分任务' },
} as const;

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
                <p>{priority.title}</p>
                <small>{priority.area}</small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="compact-empty">当前没有需要优先处理的任务。</p>
        )}
      </article>
    </section>
  );
}
