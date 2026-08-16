import type { Metadata } from 'next';
import { ProjectWorkspace } from '@/components/projects/project-workspace';

export const metadata: Metadata = { title: '项目与工作流' };
export const dynamic = 'force-dynamic';

export default function ProjectsPage() {
  return <ProjectWorkspace />;
}
