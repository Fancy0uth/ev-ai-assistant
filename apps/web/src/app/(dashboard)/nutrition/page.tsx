import type { Metadata } from 'next';
import { NutritionWorkspace } from '@/components/nutrition/nutrition-workspace';

export const metadata: Metadata = { title: '饮食记录' };
export const dynamic = 'force-dynamic';

function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date());
}

export default function NutritionPage() {
  return <NutritionWorkspace initialDate={todayInShanghai()} />;
}
