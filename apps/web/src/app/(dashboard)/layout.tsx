import type { ReactNode } from 'react';
import { AuthBootstrap } from '@/components/auth/auth-bootstrap';
import { AppShell } from '@/components/shell/app-shell';
import '../dashboard.css';

export default function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AuthBootstrap entry="dashboard">
      <AppShell>{children}</AppShell>
    </AuthBootstrap>
  );
}
