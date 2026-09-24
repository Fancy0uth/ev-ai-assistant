import type { Metadata } from 'next';
import { TodayDashboard } from '@/components/today/today-dashboard';
import { todayInShanghai } from '@/lib/today-date';
import '../dashboard.css';

export const metadata: Metadata = { title: '今天' };
export const dynamic = 'force-dynamic';

export default function TodayPage() {
  return <TodayDashboard initialDate={todayInShanghai()} />;
}
