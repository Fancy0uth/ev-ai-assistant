import type { TodayDailyPlanSummary } from '@ev/contracts';
import { CalendarCheck, Settings2, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface DailyPlanStatusCardProps {
  date: string;
  dailyPlan: TodayDailyPlanSummary;
}

function contentFor(
  date: string,
  status: TodayDailyPlanSummary['status'],
  pendingItemCount: number,
): {
  detail: string;
  href: string;
  label: string;
  icon: typeof CalendarCheck;
} {
  switch (status) {
    case 'NOT_CONFIGURED':
      return {
        detail: '连接 DeepSeek 后，系统才能基于今天的日程和具体事项生成仅供审核的建议。',
        href: '/settings/providers',
        label: '配置 DeepSeek',
        icon: Settings2,
      };
    case 'READY_TO_GENERATE':
      return {
        detail: '今天还没有计划草案。生成后，每一项仍需要你单独确认。',
        href: `/daily-plan?date=${encodeURIComponent(date)}`,
        label: '生成今日计划',
        icon: Sparkles,
      };
    case 'AWAITING_CONTEXT_APPROVAL':
      return {
        detail: '外发上下文等待你审阅/批准，尚未调用 Provider。',
        href: `/daily-plan?date=${encodeURIComponent(date)}`,
        label: '审阅外发上下文',
        icon: Settings2,
      };
    case 'PENDING_REVIEW':
      return {
        detail: `有 ${pendingItemCount} 项建议等待你的审核，尚未写入日程。`,
        href: `/daily-plan?date=${encodeURIComponent(date)}`,
        label: '查看并确认今日计划',
        icon: CalendarCheck,
      };
    case 'PARTIALLY_APPLIED':
      return {
        detail: `还有 ${pendingItemCount} 项建议等待你的审核，已确认的时间块已经显示在时间轴中。`,
        href: `/daily-plan?date=${encodeURIComponent(date)}`,
        label: '继续审核今日计划',
        icon: CalendarCheck,
      };
    case 'APPLIED':
      return {
        detail: '今天的计划已处理完成。需要调整时可以回到审核记录重新查看。',
        href: `/daily-plan?date=${encodeURIComponent(date)}`,
        label: '查看今日计划',
        icon: CalendarCheck,
      };
    case 'REJECTED':
      return {
        detail: '你已拒绝今天的上一份计划。准备好后可以重新生成一份新的草案。',
        href: `/daily-plan?date=${encodeURIComponent(date)}`,
        label: '重新生成今日计划',
        icon: Sparkles,
      };
    case 'STALE':
      return {
        detail: '生成计划后日程已变化。请重新生成草案，再决定是否采用。',
        href: `/daily-plan?date=${encodeURIComponent(date)}`,
        label: '重新生成今日计划',
        icon: Sparkles,
      };
    case 'GENERATING':
      return {
        detail: '系统正在准备今日计划。生成完成后会显示为待审核草案。',
        href: `/daily-plan?date=${encodeURIComponent(date)}`,
        label: '查看生成状态',
        icon: Sparkles,
      };
    case 'FAILED':
      return {
        detail: '上一次自动生成没有完成。你可以进入审核页手动重新生成。',
        href: `/daily-plan?date=${encodeURIComponent(date)}`,
        label: '打开每日计划',
        icon: Sparkles,
      };
  }
}

export function DailyPlanStatusCard({ date, dailyPlan }: DailyPlanStatusCardProps) {
  const content = contentFor(date, dailyPlan.status, dailyPlan.pendingItemCount);
  const Icon = content.icon;

  return (
    <section className="daily-plan-status-card" aria-labelledby="daily-plan-status-heading">
      <div>
        <p className="section-kicker">DAILY PLAN / REVIEW GATE</p>
        <h2 id="daily-plan-status-heading">今日计划</h2>
      </div>
      <p>{content.detail}</p>
      <Link aria-label={content.label} href={content.href}>
        <Icon aria-hidden="true" size={16} />
        {content.label}
      </Link>
    </section>
  );
}
