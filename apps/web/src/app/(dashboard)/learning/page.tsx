import type { Metadata } from 'next';
import { LearningWorkspace } from '@/components/learning/learning-workspace';

export const metadata: Metadata = { title: '学习与课程' };
export const dynamic = 'force-dynamic';

export default function LearningPage() {
  return <LearningWorkspace />;
}
