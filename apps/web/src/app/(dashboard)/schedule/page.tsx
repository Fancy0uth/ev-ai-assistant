import type { Metadata } from 'next';
import { ScheduleWorkspace } from '@/components/schedule/schedule-workspace';

export const metadata: Metadata = { title: '日程与课表' };
export const dynamic = 'force-dynamic';

export default function SchedulePage() {
  return <ScheduleWorkspace />;
}
