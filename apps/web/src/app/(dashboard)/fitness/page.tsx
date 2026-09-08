import type { Metadata } from 'next';
import { FitnessWorkspace } from '@/components/fitness/fitness-workspace';

export const metadata: Metadata = { title: '训练与恢复' };
export const dynamic = 'force-dynamic';

function todayInShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai',
  }).format(new Date());
}

export default function FitnessPage() {
  return <FitnessWorkspace initialDate={todayInShanghai()} />;
}
