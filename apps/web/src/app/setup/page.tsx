import type { Metadata } from 'next';
import { AuthShell } from '@/components/auth/auth-shell';

export const metadata: Metadata = { title: '初始化' };

export default function SetupPage() {
  return <AuthShell mode="setup" />;
}
