import { createProjectSnapshot, type ProjectSnapshot } from './snapshot';

export interface ProjectBrief {
  snapshot: ProjectSnapshot;
  status: 'PROVIDER_NOT_CONFIGURED';
  summary: null;
}

export function createProjectBrief(root: string): ProjectBrief {
  return {
    snapshot: createProjectSnapshot(root),
    status: 'PROVIDER_NOT_CONFIGURED',
    summary: null,
  };
}
