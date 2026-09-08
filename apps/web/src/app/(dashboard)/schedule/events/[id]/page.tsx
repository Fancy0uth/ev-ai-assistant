import { eventPathParamsSchema } from '@ev/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventDetailWorkspace } from '@/components/details/entity-detail-workspaces';

export const metadata: Metadata = { title: '日程详情' };
export const dynamic = 'force-dynamic';

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = eventPathParamsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return <EventDetailWorkspace id={parsed.data.id} />;
}
