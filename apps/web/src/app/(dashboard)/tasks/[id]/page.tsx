import { taskPathParamsSchema } from '@ev/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TaskDetailWorkspace } from '@/components/details/entity-detail-workspaces';

export const metadata: Metadata = { title: '任务详情' };
export const dynamic = 'force-dynamic';

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = taskPathParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return <TaskDetailWorkspace id={parsed.data.id} />;
}
