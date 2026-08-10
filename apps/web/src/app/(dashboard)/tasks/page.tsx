import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TasksWorkspace } from '@/components/tasks/tasks-workspace';

export const metadata: Metadata = { title: '任务' };
export const dynamic = 'force-dynamic';

export default function TasksPage() {
  return (
    <Suspense fallback={<div aria-busy="true" aria-label="正在加载任务" />}>
      <TasksWorkspace />
    </Suspense>
  );
}
