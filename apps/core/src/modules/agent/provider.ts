import type { AgentMessage, AgentSession } from '@ev/contracts';

export interface AgentProviderRequest {
  session: AgentSession;
  history: AgentMessage[];
  candidateUserMessage: AgentMessage & { role: 'USER' };
}

export interface AgentProvider {
  generate(input: AgentProviderRequest): Promise<string>;
}
