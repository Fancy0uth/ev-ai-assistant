import type { Metadata } from 'next';
import { MemoryWorkspace } from '@/components/memory/memory-workspace';

export const metadata: Metadata = { title: 'Agent 本地记忆' };
export const dynamic = 'force-dynamic';

export default function MemoryPage() {
  return <MemoryWorkspace />;
}
