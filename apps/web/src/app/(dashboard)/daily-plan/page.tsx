import type { Metadata } from 'next';
import { DailyPlanWorkspace } from '@/components/daily-plan/daily-plan-workspace';

export const metadata: Metadata = { title: '每日计划审核' };
export const dynamic = 'force-dynamic';

function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(new Date());
}

function requestedDate(value: string | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayInShanghai();
}

export default async function DailyPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  return <DailyPlanWorkspace initialDate={requestedDate(params.date)} />;
}
