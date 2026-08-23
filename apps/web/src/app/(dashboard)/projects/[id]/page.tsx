import { projectScopePathSchema } from '@ev/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProjectDetailWorkspace } from '@/components/details/entity-detail-workspaces';

export const metadata: Metadata = { title: '项目详情' };
export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = projectScopePathSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return <ProjectDetailWorkspace id={parsed.data.id} />;
}
