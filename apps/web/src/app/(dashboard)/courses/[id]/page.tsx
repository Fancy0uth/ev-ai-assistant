import type { Metadata } from 'next';
import { CourseDetailWorkspace } from '@/components/learning/course-detail-workspace';

export const metadata: Metadata = { title: '课程档案' };
export const dynamic = 'force-dynamic';

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CourseDetailWorkspace courseId={id} />;
}
