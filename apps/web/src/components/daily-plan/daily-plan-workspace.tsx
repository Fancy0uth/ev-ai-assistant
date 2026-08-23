'use client';

import {
  dailyPlanDecisionBatchInputSchema,
  dailyPlanDecisionBatchResponseSchema,
  dailyPlanReviewExplanationResponseSchema,
  dailyPlanReviewListResponseSchema,
  dailyPlanReviewSchema,
  type DailyPlanProposalItem,
  type DailyPlanReviewExplanation,
  type DailyPlanReview,
} from '@ev/contracts';
import { CalendarDays, Check, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CoreClientError, requestCore } from '@/lib/core-client';
import { createIdempotencyKey } from '@/lib/idempotency-key';
import { PreflightReviewPanel } from './preflight-review-panel';
import { useDailyPlanPreflight } from './use-daily-plan-preflight';

interface DailyPlanWorkspaceProps { initialDate: string; }
interface FailureState { code: string | null; message: string; }

function failureState(error: unknown): FailureState {
  if (error instanceof CoreClientError) {
    return { code: error.code, message: error.message };
  }
  return { code: null, message: '每日计划操作暂时未完成，请稍后重试。' };
}

function conflictReview(error: unknown): DailyPlanReview | null {
  if (!(error instanceof CoreClientError) || error.status !== 409) return null;
  if (typeof error.details !== 'object' || error.details === null || !('currentReview' in error.details)) {
    return null;
  }
  const parsed = dailyPlanReviewSchema.safeParse(error.details.currentReview);
  return parsed.success ? parsed.data : null;
}

function isUncertainTransportFailure(error: unknown): boolean {
  return error instanceof CoreClientError && (error.status === 0 || error.status === 502);
}

function itemStatusLabel(status: DailyPlanProposalItem['status']): string {
  switch (status) {
    case 'APPLIED':
      return '已采用';
    case 'REJECTED':
      return '已拒绝';
    case 'INVALIDATED':
      return '已失效';
    default:
      return '待审核';
  }
}

function proposalStatusLabel(status: DailyPlanReview['proposal']['status']): string {
  switch (status) {
    case 'APPLIED':
      return '已全部采用';
    case 'PARTIALLY_APPLIED':
      return '部分已处理';
    case 'REJECTED':
      return '已拒绝';
    case 'STALE':
      return '已失效';
    default:
      return '待审核';
  }
}

export function DailyPlanWorkspace({ initialDate }: DailyPlanWorkspaceProps) {
  const [localDate, setLocalDate] = useState(initialDate);
  const [reviews, setReviews] = useState<DailyPlanReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<FailureState | null>(null);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const updateStatusRef = useRef<HTMLParagraphElement>(null);
  const selectedDateRef = useRef(initialDate);
  const decisionIdempotencyKeysRef = useRef(new Map<string, string>());

  const loadReviews = useCallback(async (date: string): Promise<DailyPlanReview[]> => {
    const payload = await requestCore(`daily-plans/proposals?localDate=${encodeURIComponent(date)}&page=1&pageSize=20`, { method: 'GET' });
    return dailyPlanReviewListResponseSchema.parse(payload).data.items;
  }, []);

  const onGenerated = useCallback((proposal: { localDate: string }) => {
    const generatedDate = proposal.localDate;
    void loadReviews(generatedDate)
      .then((nextReviews) => {
        if (generatedDate !== selectedDateRef.current) return;
        setReviews(nextReviews);
        setUpdateMessage('每日计划已生成，等待你的审核。');
      })
      .catch((error: unknown) => {
        if (generatedDate === selectedDateRef.current) setFailure(failureState(error));
      });
  }, [loadReviews]);

  const preflight = useDailyPlanPreflight({ localDate, onGenerated });

  useEffect(() => {
    let isActive = true;

    void loadReviews(localDate)
      .then((nextReviews) => {
        if (isActive) setReviews(nextReviews);
      })
      .catch((error: unknown) => {
        if (isActive) setFailure(failureState(error));
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [loadReviews, localDate]);

  useEffect(() => {
    if (updateMessage) updateStatusRef.current?.focus();
  }, [reviews, updateMessage]);

  function replaceReview(nextReview: DailyPlanReview, message: string): void {
    setReviews((current) => {
      const existingIndex = current.findIndex((review) => review.proposal.id === nextReview.proposal.id);
      if (existingIndex === -1) return [nextReview, ...current];
      return current.map((review) => (review.proposal.id === nextReview.proposal.id ? nextReview : review));
    });
    setUpdateMessage(message);
  }

  function changeDate(nextDate: string): void {
    selectedDateRef.current = nextDate;
    setLocalDate(nextDate);
    setIsLoading(true);
    setReviews([]);
    setFailure(null);
    setUpdateMessage(null);
  }

  async function submitDecision(
    review: DailyPlanReview,
    decision: { itemId: string; decision: 'APPLY'; startLocalTime?: string; endLocalTime?: string } | { itemId: string; decision: 'REJECT'; reason?: string },
  ): Promise<void> {
    const key = `${review.proposal.id}:${decision.itemId}`;
    if (mutationKey !== null) return;

    setFailure(null);
    setUpdateMessage(null);
    setMutationKey(key);
    try {
      const input = dailyPlanDecisionBatchInputSchema.parse({
        expectedProposalVersion: review.proposal.version,
        decisions: [decision],
      });
      const semanticAction = JSON.stringify({ action: 'daily_plan.proposal.decision', proposalId: review.proposal.id, input });
      const idempotencyKey = decisionIdempotencyKeysRef.current.get(semanticAction) ?? createIdempotencyKey();
      decisionIdempotencyKeysRef.current.set(semanticAction, idempotencyKey);
      const payload = await requestCore(`daily-plans/proposals/${review.proposal.id}/decisions`, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      const nextReview = dailyPlanDecisionBatchResponseSchema.parse(payload).data;
      replaceReview(nextReview, '草案已按 Core 的最新结果更新。');
      decisionIdempotencyKeysRef.current.delete(semanticAction);
    } catch (error) {
      const currentReview = conflictReview(error);
      if (currentReview) replaceReview(currentReview, '草案已由 Core 的最新版本替换。');
      if (!isUncertainTransportFailure(error)) {
        const input = dailyPlanDecisionBatchInputSchema.parse({
          expectedProposalVersion: review.proposal.version,
          decisions: [decision],
        });
        decisionIdempotencyKeysRef.current.delete(JSON.stringify({ action: 'daily_plan.proposal.decision', proposalId: review.proposal.id, input }));
      }
      setFailure(failureState(error));
    } finally {
      setMutationKey(null);
    }
  }

  return (
    <section className="daily-plan-workspace" aria-labelledby="daily-plan-heading">
      <header className="daily-plan-workspace__header">
        <div>
          <p className="section-kicker">DAILY PLAN / REVIEW GATE</p>
          <h1 id="daily-plan-heading">每日计划审核</h1>
          <p>生成后的每项安排都需要你明确采用或拒绝，审核完成前不会写入日程。</p>
        </div>
        <label className="daily-plan-workspace__date-control">
          计划日期
          <input
            type="date"
            value={localDate}
            onChange={(event) => changeDate(event.target.value)}
          />
        </label>
      </header>

      <PreflightReviewPanel controller={preflight} />

      {failure ? (
        <div className="daily-plan-workspace__failure" role="alert">
          <p>{failure.message}</p>
          {failure.code === 'DAILY_PLAN_PROVIDER_NOT_CONFIGURED' ? (
            <Link href="/settings/providers">前往 Provider 设置</Link>
          ) : null}
        </div>
      ) : null}

      {updateMessage ? (
        <p
          ref={updateStatusRef}
          aria-label="草案更新状态"
          className="daily-plan-workspace__update"
          role="status"
          tabIndex={-1}
        >
          {updateMessage}
        </p>
      ) : null}

      {isLoading ? <DailyPlanLoading /> : null}
      {!isLoading && reviews.length === 0 ? (
        <section className="daily-plan-workspace__empty" aria-live="polite">
          <CalendarDays aria-hidden="true" size={20} />
          <p>还没有该日期的每日计划</p>
        </section>
      ) : null}
      {!isLoading ? (
        <div className="daily-plan-workspace__reviews">
          {reviews.map((review) => (
            <DailyPlanReviewCard
              key={`${review.proposal.id}:${review.proposal.version}`}
              review={review}
              mutationKey={mutationKey}
              onDecision={submitDecision}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DailyPlanLoading() {
  return (
    <div className="daily-plan-workspace__loading" aria-busy="true" aria-label="正在读取每日计划">
      <span />
      <span />
    </div>
  );
}

function DailyPlanReviewCard({
  review,
  mutationKey,
  onDecision,
}: {
  review: DailyPlanReview;
  mutationKey: string | null;
  onDecision: (
    review: DailyPlanReview,
    decision:
      | { itemId: string; decision: 'APPLY'; startLocalTime?: string; endLocalTime?: string }
      | { itemId: string; decision: 'REJECT'; reason?: string },
  ) => Promise<void>;
}) {
  const { proposal } = review;

  return (
    <article className="daily-plan-review-card" aria-labelledby={`daily-plan-${proposal.id}`}>
      <header className="daily-plan-review-card__header">
        <div>
          <p className="section-kicker">{proposal.localDate} / {proposalStatusLabel(proposal.status)}</p>
          <h2 id={`daily-plan-${proposal.id}`}>每日计划草案</h2>
        </div>
        <span className="daily-plan-review-card__version">v{proposal.version}</span>
      </header>
      <p className="daily-plan-review-card__summary">{proposal.summary}</p>
      <DailyPlanExplanationDetails proposalId={proposal.id} />
      {proposal.items.length === 0 ? (
        <p className="daily-plan-review-card__empty">这个草案没有需要审核的安排。</p>
      ) : (
        <ol className="daily-plan-review-card__items">
          {proposal.items.map((item) => (
            <DailyPlanItemCard
              item={item}
              isMutating={mutationKey === `${proposal.id}:${item.id}`}
              isProposalStale={proposal.status === 'STALE'}
              key={item.id}
              onDecision={(decision) => onDecision(review, decision)}
            />
          ))}
        </ol>
      )}
    </article>
  );
}

function contextCategoryLabel(category: DailyPlanReviewExplanation['contextManifest']['entries'][number]['category']): string {
  switch (category) {
    case 'FIXED_EVENTS':
      return '固定日程';
    case 'CONFIRMED_SOFT_BLOCKS':
      return '已确认时间块';
    case 'OPEN_TIME_REQUESTS':
      return '待安排请求';
    case 'RECOVERY_CONSTRAINTS':
      return '恢复约束';
    case 'SCHEDULE_PREFERENCES':
      return '日程偏好';
  }
}

function contextFieldLabel(field: DailyPlanReviewExplanation['contextManifest']['entries'][number]['fieldCategories'][number]): string {
  switch (field) {
    case 'LOCAL_DATE':
      return '日期';
    case 'TIME_RANGE':
      return '时间范围';
    case 'DURATION_MINUTES':
      return '时长';
    case 'PRIORITY':
      return '优先级';
    case 'STATUS':
      return '状态';
    case 'TARGET_DATE':
      return '目标日期';
    case 'AVAILABILITY_WINDOW':
      return '可用时间';
    case 'RECOVERY_LEVEL':
      return '恢复程度';
    case 'PREFERENCE_WINDOW':
      return '偏好时段';
  }
}

function verificationLabel(status: DailyPlanReviewExplanation['items'][number]['verification']['status']): string {
  switch (status) {
    case 'CURRENT':
      return '当前本地日程校验通过。';
    case 'SCHEDULE_VERSION_CHANGED':
      return '日程版本已变化，请在采用前重新核对。';
    case 'TIME_REQUEST_MISSING':
      return '原时间请求已不存在，不能直接采用。';
    case 'TIME_REQUEST_VERSION_CHANGED':
      return '时间请求已更新，请重新核对。';
    case 'DURATION_MISMATCH':
      return '建议时长与当前时间请求不一致。';
    case 'OUTSIDE_AVAILABILITY':
      return '建议时间已超出当前可用时间。';
    case 'HARD_EVENT_CONFLICT':
      return '建议时间与固定日程冲突。';
    case 'CONFIRMED_EVENT_CONFLICT':
      return '建议时间与已确认时间块冲突。';
  }
}

function DailyPlanExplanationDetails({ proposalId }: { proposalId: string }) {
  const [explanation, setExplanation] = useState<DailyPlanReviewExplanation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function loadExplanation(isOpen: boolean): Promise<void> {
    if (!isOpen || explanation !== null || isLoading) return;

    setFailure(null);
    setIsLoading(true);
    try {
      const payload = await requestCore(`daily-plans/proposals/${proposalId}/explanation`, {
        method: 'GET',
      });
      setExplanation(dailyPlanReviewExplanationResponseSchema.parse(payload).data);
    } catch {
      setFailure('暂时无法读取本次上下文与本地校验结果，请稍后重试。');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <details className="daily-plan-explanation" onToggle={(event) => void loadExplanation(event.currentTarget.open)}>
      <summary>查看本次上下文与校验</summary>
      {isLoading ? <p aria-live="polite">正在读取本地校验结果…</p> : null}
      {failure ? <p role="alert">{failure}</p> : null}
      {explanation ? (
        <div className="daily-plan-explanation__content">
          <p>草案基于日程版本 v{explanation.baseScheduleVersion}；当前为 v{explanation.currentScheduleVersion}。</p>
          <ul aria-label="本次上下文类别">
            {explanation.contextManifest.entries.map((entry) => (
              <li key={entry.category}>
                {contextCategoryLabel(entry.category)}：{entry.entityCount} 条（{entry.fieldCategories.map(contextFieldLabel).join('、')}）
              </li>
            ))}
          </ul>
          <ol aria-label="草案项本地校验">
            {explanation.items.map((item) => (
              <li key={item.itemId}>
                <strong>{item.timeRequest?.title ?? `请求 ${item.ordinal}`}</strong>
                <p>{verificationLabel(item.verification.status)}</p>
                {item.verification.conflicts.length > 0 ? (
                  <p>
                    冲突时段：{item.verification.conflicts
                      .map((conflict) => `${conflict.startLocalTime}–${conflict.endLocalTime}`)
                      .join('、')}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </details>
  );
}

function DailyPlanItemCard({
  item,
  isMutating,
  isProposalStale,
  onDecision,
}: {
  item: DailyPlanProposalItem;
  isMutating: boolean;
  isProposalStale: boolean;
  onDecision: (
    decision:
      | { itemId: string; decision: 'APPLY'; startLocalTime?: string; endLocalTime?: string }
      | { itemId: string; decision: 'REJECT'; reason?: string },
  ) => Promise<void>;
}) {
  const isScheduled = item.operation === 'SCHEDULE_TIME_REQUEST';
  const [startLocalTime, setStartLocalTime] = useState(isScheduled ? item.startLocalTime : '');
  const [endLocalTime, setEndLocalTime] = useState(isScheduled ? item.endLocalTime : '');
  const [reason, setReason] = useState('');
  const itemLabel = `请求 ${item.ordinal}`;

  async function apply(): Promise<void> {
    if (isScheduled) {
      await onDecision({ itemId: item.id, decision: 'APPLY', startLocalTime, endLocalTime });
      return;
    }
    await onDecision({ itemId: item.id, decision: 'APPLY' });
  }

  async function reject(): Promise<void> {
    await onDecision({ itemId: item.id, decision: 'REJECT', ...(reason.trim() ? { reason: reason.trim() } : {}) });
  }

  return (
    <li className="daily-plan-item-card">
      <div className="daily-plan-item-card__heading">
        <div>
          <p>{itemLabel}</p>
          <h3>{isScheduled ? '安排时间请求' : '标记为暂不可安排'}</h3>
        </div>
        <span className={`daily-plan-item-card__status daily-plan-item-card__status--${item.status.toLowerCase()}`}>
          {itemStatusLabel(item.status)}
        </span>
      </div>

      {isScheduled ? (
        <p className="daily-plan-item-card__time">{item.startLocalTime}–{item.endLocalTime}</p>
      ) : (
        <p className="daily-plan-item-card__time">{item.reasonCode}</p>
      )}
      <p className="daily-plan-item-card__rationale">{item.rationale}</p>

      {item.status === 'PENDING_REVIEW' ? (
        <div className="daily-plan-item-card__controls">
          {isScheduled ? (
            <div className="daily-plan-item-card__time-inputs">
              <label>
                开始时间（{itemLabel}）
                <input disabled={isProposalStale} type="time" value={startLocalTime} onChange={(event) => setStartLocalTime(event.target.value)} />
              </label>
              <label>
                结束时间（{itemLabel}）
                <input disabled={isProposalStale} type="time" value={endLocalTime} onChange={(event) => setEndLocalTime(event.target.value)} />
              </label>
            </div>
          ) : null}
          <label className="daily-plan-item-card__reason">
            拒绝原因（{itemLabel}）
            <input disabled={isProposalStale} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="daily-plan-item-card__actions">
            <button disabled={isProposalStale || isMutating} type="button" onClick={() => void apply()}>
              <Check aria-hidden="true" size={16} />
              {isMutating ? '正在提交…' : isScheduled ? '采用安排' : '确认无法安排'}
            </button>
            <button disabled={isProposalStale || isMutating} type="button" onClick={() => void reject()}>
              <X aria-hidden="true" size={16} />
              拒绝安排
            </button>
          </div>
        </div>
      ) : (
        <p className="daily-plan-item-card__terminal" role="status">
          {itemStatusLabel(item.status)}，该项不再提供审核操作。
        </p>
      )}
    </li>
  );
}
