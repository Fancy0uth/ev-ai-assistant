'use client';

import type { DailyPlanPreflightItem } from '@ev/contracts';
import Link from 'next/link';
import { useEffect, useMemo, useRef } from 'react';
import type { DailyPlanPreflightController, EditablePreflightItem } from './use-daily-plan-preflight';

interface PreflightReviewPanelProps {
  controller: DailyPlanPreflightController;
}

const domainOptions = [
  ['WORK', '开发'],
  ['STUDY', '学习'],
  ['FITNESS', '训练'],
  ['NUTRITION', '饮食'],
  ['LIFE', '生活'],
] as const;

function originalItem(
  preflight: { items: DailyPlanPreflightItem[] },
  contextRef: string,
): DailyPlanPreflightItem | undefined {
  return preflight.items.find((item) => item.contextRef === contextRef);
}

function isDateOrNull(value: string | null): boolean {
  return value === null || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function canApprove(items: EditablePreflightItem[]): boolean {
  return (
    items.some((item) => item.included) &&
    items.every((item) => item.safeTitle.trim().length >= 1 && item.safeTitle.trim().length <= 200 && isDateOrNull(item.deadlineLocalDate))
  );
}

function availabilityLabel(item: DailyPlanPreflightItem): string {
  const { earliestStartLocalTime, latestEndLocalTime } = item.availability;
  return earliestStartLocalTime === null || latestEndLocalTime === null
    ? '不限'
    : `${earliestStartLocalTime}–${latestEndLocalTime}`;
}

export function PreflightReviewPanel({ controller }: PreflightReviewPanelProps) {
  const { state } = controller;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const approvedActionRef = useRef<HTMLButtonElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const phaseRef = useRef(state.phase);

  const draftItems = useMemo(
    () => (state.phase === 'reviewing' || state.phase === 'approving' ? state.draftItems : []),
    [state],
  );
  const approveEnabled = useMemo(() => state.phase === 'reviewing' && canApprove(draftItems), [draftItems, state.phase]);

  useEffect(() => {
    if (phaseRef.current !== state.phase && state.phase === 'reviewing') headingRef.current?.focus();
    if (phaseRef.current !== state.phase && state.phase === 'approved') approvedActionRef.current?.focus();
    if (phaseRef.current !== state.phase && state.phase === 'blocked') alertRef.current?.focus();
    phaseRef.current = state.phase;
  }, [state.phase]);

  function updateItem(contextRef: string, patch: Parameters<DailyPlanPreflightController['editItem']>[1]): void {
    controller.editItem(contextRef, patch);
  }

  function resetInclusion(contextRef: string, included: boolean): void {
    if (state.phase !== 'reviewing') return;
    const original = originalItem(state.preflight, contextRef);
    if (!original) return;
    updateItem(contextRef, {
      safeTitle: original.safeTitle,
      domain: original.domain,
      deadlineLocalDate: original.deadlineLocalDate,
      included,
    });
  }

  async function submitApproval(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (approveEnabled) await controller.approve();
  }

  return (
    <section className="preflight-review-panel" aria-labelledby="preflight-review-heading">
      <header className="preflight-review-panel__header">
        <div>
          <p className="section-kicker">OUTBOUND REVIEW GATE</p>
          <h2 id="preflight-review-heading" ref={headingRef} tabIndex={-1}>外发内容审阅</h2>
          <p>先准备并核对安全语义，再批准外发；批准本身不会调用 Provider。</p>
        </div>
        {state.phase === 'idle' ||
        state.phase === 'blocked' ||
        state.phase === 'generated' ||
        state.phase === 'preparing' ? (
          <button
            type="button"
            onClick={() => void controller.prepare()}
            disabled={state.phase === 'preparing'}
            aria-busy={state.phase === 'preparing' || undefined}
          >
            {state.phase === 'preparing'
              ? '正在准备外发内容…'
              : state.phase === 'blocked' || state.phase === 'generated'
                ? '重新准备'
                : '准备外发内容'}
          </button>
        ) : null}
      </header>

      {state.phase === 'preparing' ? <p role="status" aria-live="polite">正在准备可审阅的本地内容…</p> : null}

      {state.phase === 'reviewing' || state.phase === 'approving' ? (
        <form className="preflight-review-form" onSubmit={(event) => void submitApproval(event)} noValidate>
          <div className="preflight-review-form__items">
            {state.draftItems.map((item) => {
              const original = originalItem(state.preflight, item.contextRef);
              if (!original) return null;
              const disabled = !item.included || state.phase === 'approving';
              return (
                <fieldset className="preflight-review-item" key={item.contextRef}>
                  <legend>{item.safeTitle || original.safeTitle}</legend>
                  <label className="preflight-review-item__include">
                    <input
                      checked={item.included}
                      disabled={state.phase === 'approving'}
                      type="checkbox"
                      aria-label={`包含/排除：${original.safeTitle}`}
                      onChange={(event) => resetInclusion(item.contextRef, event.target.checked)}
                    />
                    包含此项
                  </label>
                  <div className="preflight-review-item__fields">
                    <label>
                      安全标题：{original.safeTitle}
                      <input
                        disabled={disabled}
                        maxLength={200}
                        value={item.safeTitle}
                        onChange={(event) => updateItem(item.contextRef, { safeTitle: event.target.value })}
                      />
                    </label>
                    <label>
                      领域：{original.safeTitle}
                      <select
                        disabled={disabled}
                        value={item.domain}
                        onChange={(event) => updateItem(item.contextRef, { domain: event.target.value as EditablePreflightItem['domain'] })}
                      >
                        {domainOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>
                      截止日期：{original.safeTitle}
                      <input
                        disabled={disabled}
                        type="date"
                        value={item.deadlineLocalDate ?? ''}
                        onChange={(event) => updateItem(item.contextRef, { deadlineLocalDate: event.target.value || null })}
                      />
                    </label>
                  </div>
                  <dl className="preflight-review-item__facts">
                    <div><dt>时长</dt><dd>{original.durationMinutes} 分钟</dd></div>
                    <div><dt>优先级</dt><dd>{original.priority}</dd></div>
                    <div><dt>可用时段</dt><dd>{availabilityLabel(original)}</dd></div>
                    <div><dt>固定安排</dt><dd>{original.isFixed ? '是' : '否'}</dd></div>
                  </dl>
                </fieldset>
              );
            })}
          </div>
          {!draftItems.some((item) => item.included) ? <p className="preflight-review-form__hint" role="status">没有内容会发送；至少包含一项才可继续。</p> : null}
          <button disabled={!approveEnabled || state.phase === 'approving'} type="submit">
            {state.phase === 'approving' ? '正在保存批准…' : '批准外发内容'}
          </button>
        </form>
      ) : null}

      {state.phase === 'approved' || state.phase === 'generating' ? (
        <div className="preflight-review-panel__approved" role="status" aria-live="polite">
          <p>{state.phase === 'approved' ? '你的选择已保存，尚未调用 Provider。' : '正在生成草案…'}</p>
          <button
            ref={approvedActionRef}
            type="button"
            onClick={() => void controller.generate()}
            disabled={state.phase === 'generating'}
            aria-busy={state.phase === 'generating' || undefined}
          >
            {state.phase === 'generating' ? '正在生成草案…' : '调用 Provider 生成草案'}
          </button>
        </div>
      ) : null}

      {state.phase === 'generated' ? <p role="status" aria-live="polite">草案已生成，正在刷新审核列表。</p> : null}
      {state.phase === 'blocked' ? (
        <p className="preflight-review-panel__failure" ref={alertRef} role="alert" tabIndex={-1}>
          {state.failure.message}
          {state.failure.recovery === 'settings' ? <> <Link href="/settings/providers">前往 Provider 设置</Link></> : null}
          {state.failure.recovery === 'reprepare' ? ' 请重新准备外发内容。' : null}
        </p>
      ) : null}

      <p className="preflight-review-panel__privacy">
        点击“批准外发内容”只保存你的选择，不会调用 Provider。只有随后点击“调用 Provider 生成草案”才会发起请求。Provider 会收到所选日期、已确认时间块的起止时间（不含标题/ID）、粗粒度恢复等级，以及被标记“包含”的 opaque contextRef、安全标题、领域、截止日期、时长、优先级、可用窗口和固定标记。不会发送 Owner ID、本地 Task/Event/Project ID、Event 标题、项目路径/正文、Provider 密钥或健康原文。
      </p>
    </section>
  );
}
