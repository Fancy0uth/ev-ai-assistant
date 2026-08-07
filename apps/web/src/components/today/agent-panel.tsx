import type { TodaySnapshot } from '@ev/contracts';
import { Bot, Braces, Cpu, Sparkles } from 'lucide-react';

type Snapshot = TodaySnapshot['data'];

interface AgentPanelProps {
  snapshot: Snapshot;
  variant: 'desktop' | 'mobile';
}

function capabilityCopy(value: 'NOT_CONFIGURED'): string {
  return value === 'NOT_CONFIGURED' ? '未配置' : value;
}

function AgentContent({ snapshot, idPrefix }: { snapshot: Snapshot; idPrefix: string }) {
  const recommendation = snapshot.status.priorities[0]
    ? `建议先处理「${snapshot.status.priorities[0].title}」，完成后再重新评估今天的负载。`
    : '当前没有待处理任务。可以先安排一件最重要的事，再让规则引擎重新排序。';
  const recommendationHeadingId = `${idPrefix}-recommendation-heading`;
  const capabilityHeadingId = `${idPrefix}-capability-heading`;
  const memoryHeadingId = `${idPrefix}-memory-heading`;

  return (
    <div className="agent-panel__content">
      <div className="agent-identity">
        <span className="agent-identity__icon" aria-hidden="true">
          <Bot size={21} />
        </span>
        <div>
          <p>EV / LOCAL ASSISTANT</p>
          <h2>Agent 状态</h2>
        </div>
        <span className="agent-live-state">本地</span>
      </div>

      <section className="rule-recommendation" aria-labelledby={recommendationHeadingId}>
        <div className="rule-recommendation__label">
          <Sparkles aria-hidden="true" size={15} />
          <span>规则引擎</span>
        </div>
        <h3 id={recommendationHeadingId}>当前建议</h3>
        <p>{recommendation}</p>
        <small>依据：任务优先级、完成率与剩余负载；本次未调用模型。</small>
      </section>

      <section className="capability-section" aria-labelledby={capabilityHeadingId}>
        <div className="agent-section-heading">
          <h3 id={capabilityHeadingId}>能力接口</h3>
          <span>2 providers</span>
        </div>
        <dl className="capability-list">
          <div>
            <dt>
              <Cpu aria-hidden="true" size={16} /> DeepSeek
            </dt>
            <dd>{capabilityCopy(snapshot.agents.deepSeek)}</dd>
          </div>
          <div>
            <dt>
              <Braces aria-hidden="true" size={16} /> Codex
            </dt>
            <dd>{capabilityCopy(snapshot.agents.codex)}</dd>
          </div>
        </dl>
      </section>

      <section className="memory-placeholder" aria-labelledby={memoryHeadingId}>
        <div className="agent-section-heading">
          <h3 id={memoryHeadingId}>长期记忆</h3>
          <span>Milestone 0.6</span>
        </div>
        <p>本阶段尚未启动记忆循环。任务数据已在本地持久化，后续记忆模块将从这里建立压缩摘要。</p>
      </section>
    </div>
  );
}

export function AgentPanel({ snapshot, variant }: AgentPanelProps) {
  if (variant === 'mobile') {
    return (
      <details className="agent-mobile" id="agent-mobile">
        <summary>
          <span>Agent 状态与建议</span>
          <small>规则引擎 · 模型未配置</small>
        </summary>
        <AgentContent idPrefix="agent-mobile" snapshot={snapshot} />
      </details>
    );
  }

  return <AgentContent idPrefix="agent-desktop" snapshot={snapshot} />;
}
