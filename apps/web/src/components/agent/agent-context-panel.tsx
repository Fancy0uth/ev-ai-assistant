import type { AgentCapability, AgentSession } from '@ev/contracts';

interface AgentContextPanelProps {
  capability: AgentCapability | null;
  session: AgentSession | null;
}

function availabilityCopy(capability: AgentCapability | null): { label: string; detail: string } {
  if (!capability) {
    return { label: '正在读取状态', detail: '正在读取本地 Core 的 Agent 能力。' };
  }

  switch (capability.availability) {
    case 'READY':
      return { label: '可以对话', detail: capability.description };
    case 'NOT_CONFIGURED':
      return { label: '需要连接 API', detail: '连接 API 后才能发送消息；本地会话仍可使用。' };
    case 'UNAVAILABLE':
      return { label: 'Provider 暂时不可用', detail: '暂时不能发送消息；本地会话和历史消息仍可查看。' };
  }
}

export function AgentContextPanel({ capability, session }: AgentContextPanelProps) {
  const availability = availabilityCopy(capability);

  return (
    <aside className="agent-context-panel" aria-labelledby="agent-context-title">
      <p className="section-kicker">AGENT / LOCAL CONTEXT</p>
      <h2 id="agent-context-title">当前上下文</h2>
      <dl>
        <div>
          <dt>对话</dt>
          <dd>{availability.label}</dd>
        </div>
        <div>
          <dt>会话</dt>
          <dd>{session ? session.title : '尚未选择'}</dd>
        </div>
      </dl>
      <p className="agent-context-panel__detail" role="status">
        {availability.detail}
      </p>
      <p className="agent-context-panel__local-note">数据保存在本地 Core。</p>
    </aside>
  );
}
