import type {
  AgentRunCapability,
  AgentContextManifest,
  CourseImportImage,
  ProviderKey,
} from '@ev/contracts';

export interface CourseScheduleVisionProvider {
  extract(input: { image: CourseImportImage }): Promise<unknown>;
}

export interface DomainAgentProvider {
  key: ProviderKey;
  run(input: { capability: AgentRunCapability; context: AgentContextManifest }): Promise<unknown>;
}
