'use client';

import { BookOpenCheck, CalendarRange, Dumbbell, FolderSearch, NotebookText, Utensils } from 'lucide-react';
import Link from 'next/link';

const modules = [
  {
    href: '/schedule',
    label: '打开日程与课表模块',
    title: '日程与课表',
    detail: '导入课表，先审核，再写入时间块。',
    icon: CalendarRange,
  },
  {
    href: '/learning',
    label: '打开学习模块',
    title: '学习',
    detail: '维护课程资料与后续预习上下文。',
    icon: BookOpenCheck,
  },
  {
    href: '/fitness',
    label: '打开训练恢复模块',
    title: '训练与恢复',
    detail: '打卡身体状态，再决定今天的训练负载。',
    icon: Dumbbell,
  },
  {
    href: '/nutrition',
    label: '打开饮食模块',
    title: '饮食',
    detail: '确认摄入记录，所有数值可追溯。',
    icon: Utensils,
  },
  {
    href: '/projects',
    label: '打开项目模块',
    title: '项目',
    detail: '只读分析项目进度，不修改你的仓库。',
    icon: FolderSearch,
  },
  {
    href: '/memory',
    label: '打开记忆模块',
    title: '记忆',
    detail: '查看本地可审计的 Agent 记忆投影。',
    icon: NotebookText,
  },
] as const;

export function ModuleQuickLinks() {
  return (
    <section className="module-quick-links" aria-labelledby="module-quick-links-heading">
      <div className="task-list-card__header">
        <div>
          <p className="section-kicker">DOMAIN WORKSPACES</p>
          <h2 id="module-quick-links-heading">按领域处理今天</h2>
        </div>
        <span>6 个模块</span>
      </div>
      <ul>
        {modules.map(({ href, label, title, detail, icon: Icon }) => (
          <li key={href}>
            <Link aria-label={label} href={href}>
              <Icon aria-hidden="true" size={18} />
              <span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
