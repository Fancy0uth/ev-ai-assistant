import type { Metadata } from 'next';
import { TodayDashboard } from '@/components/today/today-dashboard';

export const metadata: Metadata = { title: '今天' };
export const dynamic = 'force-dynamic';

function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(new Date());
}

export default function TodayPage() {
  return <TodayDashboard initialDate={todayInShanghai()} />;
}
