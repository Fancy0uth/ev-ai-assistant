'use client';

import {
  createEventProposalInputSchema,
  eventLanguageParseInputSchema,
  eventLanguageParseResponseSchema,
  proposalDecisionSchema,
  proposalListResponseSchema,
  proposalResponseSchema,
  proposalVersionConflictDetailsSchema,
  type EventLanguageParseResult,
  type EventLanguageMissingField,
  type EventKind,
  type Proposal,
} from '@ev/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CoreClientError, isUncertainCoreWriteFailure, requestCore } from '@/lib/core-client';
import { createIdempotencyKey } from '@/lib/idempotency-key';

interface ManualEventProposalPanelProps {
  initialDate: string;
}

interface ListOperation {
  controller: AbortController;
  id: number;
  isReload: boolean;
}

const eventKinds: Array<[EventKind, string]> = [
  ['MEETING', '会议'],
  ['PERSONAL', '个人事务'],
  ['WORK_BLOCK', '工作时段'],
  ['WORKOUT', '训练'],
  ['STUDY', '学习'],
  ['COURSE', '课程'],
];

const missingFieldLabels: Record<EventLanguageMissingField, string> = {
  title: '标题',
  kind: '类型',
  localDate: '日期',
  startLocalTime: '开始时间',
  endLocalTime: '结束时间',
  isHard: '是否为固定安排',
};

function failureMessage(error: unknown): string {
  return error instanceof CoreClientError ? error.message : '手工日程提案暂时未完成，请稍后重试。';
}

function isManualEventProposal(proposal: Proposal): boolean {
  return proposal.kind === 'SCHEDULE'
    && proposal.changes.length === 1
    && proposal.changes[0]?.operation === 'CREATE_EVENT';
}

function isPendingManualEventProposal(proposal: Proposal): boolean {
  return proposal.status === 'PENDING' && isManualEventProposal(proposal);
}

function acceptedEvent(proposal: Proposal) {
  if (proposal.status !== 'ACCEPTED' || !isManualEventProposal(proposal)) return null;
  const [change] = proposal.changes;
  return change?.operation === 'CREATE_EVENT' ? change.event : null;
}

function statusCopy(status: Proposal['status']): string {
  switch (status) {
    case 'PENDING':
      return '待确认 · 尚未写入日程';
    case 'ACCEPTED':
      return '已确认 · 已写入日程';
    case 'REJECTED':
      return '已拒绝 · 未写入日程';
    case 'EXPIRED':
      return '已过期 · 未写入日程';
  }
}

function conflictProposal(error: unknown): Proposal | null {
  if (!(error instanceof CoreClientError) || error.status !== 409) return null;
  const parsed = proposalVersionConflictDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data.currentProposal : null;
}

export function ManualEventProposalPanel({ initialDate }: ManualEventProposalPanelProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<EventKind | ''>('MEETING');
  const [localDate, setLocalDate] = useState(initialDate);
  const [startLocalTime, setStartLocalTime] = useState('09:00');
  const [endLocalTime, setEndLocalTime] = useState('10:00');
  const [isHard, setIsHard] = useState<boolean | null>(false);
  const [eventLanguageText, setEventLanguageText] = useState('');
  const [externalProcessingConfirmed, setExternalProcessingConfirmed] = useState(false);
  const [eventLanguageAssessment, setEventLanguageAssessment] = useState<EventLanguageParseResult | null>(null);
  const [eventLanguageReviewRequired, setEventLanguageReviewRequired] = useState(false);
  const [isParsingEventLanguage, setIsParsingEventLanguage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [listFailure, setListFailure] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [decidingProposalId, setDecidingProposalId] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [listRequest, setListRequest] = useState({ id: 0, isReload: false });
  const createInFlightRef = useRef(false);
  const eventLanguageParseInFlightRef = useRef(false);
  const decisionInFlightRef = useRef<string | null>(null);
  const decisionIdempotencyKeysRef = useRef(new Map<string, string>());
  const listRequestIdRef = useRef(0);
  const listOperationIdRef = useRef(0);
  const activeListOperationRef = useRef<ListOperation | null>(null);
  const listReloadInFlightRef = useRef(false);
  const quarantinedVersionsRef = useRef(new Map<string, number>());
  const statusRef = useRef<HTMLParagraphElement>(null);
  const visibleFailure = listFailure ?? failure;
  const isQuarantinedProposalVersion = useCallback((proposal: Proposal): boolean => {
    const quarantinedVersion = quarantinedVersionsRef.current.get(proposal.id);
    return quarantinedVersion !== undefined && proposal.version <= quarantinedVersion;
  }, []);
  const isActionablePendingManualEventProposal = useCallback(
    (proposal: Proposal): boolean => isPendingManualEventProposal(proposal) && !isQuarantinedProposalVersion(proposal),
    [isQuarantinedProposalVersion],
  );

  function isActiveListOperation(operation: ListOperation): boolean {
    return activeListOperationRef.current?.id === operation.id && !operation.controller.signal.aborted;
  }

  function settleListOperation(operation: ListOperation): void {
    if (activeListOperationRef.current?.id !== operation.id) return;
    activeListOperationRef.current = null;
    setIsLoading(false);
    if (operation.isReload) {
      listReloadInFlightRef.current = false;
      setIsReloading(false);
    }
  }

  useEffect(() => {
    const operationId = listOperationIdRef.current + 1;
    listOperationIdRef.current = operationId;
    const operation: ListOperation = {
      controller: new AbortController(),
      id: operationId,
      isReload: listRequest.isReload,
    };
    activeListOperationRef.current = operation;
    void requestCore('proposals?status=PENDING', {
      method: 'GET',
      signal: operation.controller.signal,
    })
      .then((payload) => {
        if (!isActiveListOperation(operation)) return;
        const pending = proposalListResponseSchema.parse(payload).data.filter(isPendingManualEventProposal);
        const containsQuarantinedVersion = pending.some(isQuarantinedProposalVersion);
        setProposals(pending.filter(isActionablePendingManualEventProposal));
        setListFailure(containsQuarantinedVersion ? '检测到过期的日程提案版本，请重新读取最新待确认日程。' : null);
      })
      .catch((error: unknown) => {
        if (!isActiveListOperation(operation)) return;
        setListFailure(failureMessage(error));
      })
      .finally(() => {
        settleListOperation(operation);
      });
    return () => {
      operation.controller.abort();
      if (activeListOperationRef.current?.id === operation.id) {
        activeListOperationRef.current = null;
        if (operation.isReload) listReloadInFlightRef.current = false;
      }
    };
  }, [isActionablePendingManualEventProposal, isQuarantinedProposalVersion, listRequest]);

  useEffect(() => {
    if (statusMessage) statusRef.current?.focus();
  }, [statusMessage]);

  function invalidateList(): void {
    const operation = activeListOperationRef.current;
    if (!operation) return;
    operation.controller.abort();
    settleListOperation(operation);
  }

  function quarantineProposal(proposal: Proposal): void {
    const quarantinedVersion = quarantinedVersionsRef.current.get(proposal.id);
    if (quarantinedVersion === undefined || proposal.version > quarantinedVersion) {
      quarantinedVersionsRef.current.set(proposal.id, proposal.version);
    }
  }

  function replaceProposal(next: Proposal): void {
    if (!isManualEventProposal(next) || (next.status === 'PENDING' && !isActionablePendingManualEventProposal(next))) return;
    setProposals((current) => {
      const existingIndex = current.findIndex((proposal) => proposal.id === next.id);
      if (existingIndex === -1) return [next, ...current];
      return current.map((proposal) => (proposal.id === next.id ? next : proposal));
    });
  }

  function removeProposal(id: string): void {
    setProposals((current) => current.filter((proposal) => proposal.id !== id));
  }

  function reloadPendingProposals(clearFailure = true): void {
    if (listReloadInFlightRef.current) return;
    listReloadInFlightRef.current = true;
    invalidateList();
    if (clearFailure) setFailure(null);
    setListFailure(null);
    setIsReloading(true);
    setIsLoading(true);
    const nextRequestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = nextRequestId;
    setListRequest({ id: nextRequestId, isReload: true });
  }

  function freezeAndReload(proposal: Proposal, message: string): void {
    quarantineProposal(proposal);
    removeProposal(proposal.id);
    setFailure(message);
    setStatusMessage(null);
    reloadPendingProposals(false);
  }

  function clearEventLanguageAssessment(): void {
    if (eventLanguageAssessment !== null) {
      setEventLanguageAssessment(null);
      setEventLanguageReviewRequired(true);
    }
  }

  async function parseEventLanguage(): Promise<void> {
    if (eventLanguageParseInFlightRef.current || createInFlightRef.current || listReloadInFlightRef.current) return;
    const input = eventLanguageParseInputSchema.safeParse({
      text: eventLanguageText,
      referenceDate: initialDate,
      timezone: 'Asia/Shanghai',
      externalProcessingConfirmed,
    });
    if (!input.success) {
      setFailure(input.error.issues[0]?.message ?? '请检查自然语言事项描述。');
      return;
    }
    eventLanguageParseInFlightRef.current = true;
    setIsParsingEventLanguage(true);
    setFailure(null);
    setStatusMessage(null);
    try {
      const payload = await requestCore('event-language/parse', {
        method: 'POST',
        body: JSON.stringify(input.data),
      });
      const result = eventLanguageParseResponseSchema.parse(payload).data;
      setTitle(result.candidate.title ?? '');
      setKind(result.candidate.kind ?? '');
      setLocalDate(result.candidate.localDate ?? '');
      setStartLocalTime(result.candidate.startLocalTime ?? '');
      setEndLocalTime(result.candidate.endLocalTime ?? '');
      setIsHard(result.candidate.isHard);
      setEventLanguageAssessment(result);
      setEventLanguageReviewRequired(false);
      setStatusMessage(
        result.missingFields.length === 0
          ? '已填入可编辑候选，请核对冲突后再创建待确认日程。'
          : '已填入可识别字段；请补全提示的字段后再创建待确认日程。',
      );
    } catch (error: unknown) {
      setFailure(failureMessage(error));
    } finally {
      eventLanguageParseInFlightRef.current = false;
      setIsParsingEventLanguage(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (createInFlightRef.current || listReloadInFlightRef.current) return;
    const parsed = createEventProposalInputSchema.safeParse({ title, kind, localDate, startLocalTime, endLocalTime, isHard });
    if (!parsed.success) {
      setFailure(parsed.error.issues[0]?.message ?? '请检查手工日程输入。');
      return;
    }
    createInFlightRef.current = true;
    setIsCreating(true);
    invalidateList();
    setFailure(null);
    setListFailure(null);
    setStatusMessage(null);
    try {
      const payload = await requestCore('event-proposals', { method: 'POST', body: JSON.stringify(parsed.data) });
      const proposal = proposalResponseSchema.parse(payload).data;
      if (!isActionablePendingManualEventProposal(proposal)) throw new Error('Core 返回了与手工日程创建不一致的响应。');
      replaceProposal(proposal);
      setTitle('');
      setStatusMessage('手工日程已创建为待确认提案，尚未写入日程。');
    } catch (error: unknown) {
      setFailure(failureMessage(error));
    } finally {
      createInFlightRef.current = false;
      setIsCreating(false);
    }
  }

  async function decide(proposal: Proposal, decision: 'ACCEPT' | 'REJECT'): Promise<void> {
    if (decisionInFlightRef.current !== null || listReloadInFlightRef.current || !isActionablePendingManualEventProposal(proposal)) return;
    decisionInFlightRef.current = proposal.id;
    invalidateList();
    setDecidingProposalId(proposal.id);
    setFailure(null);
    setListFailure(null);
    setStatusMessage(null);
    const semanticAction = `${proposal.id}:${proposal.version}:${decision}`;
    const idempotencyKey =
      decisionIdempotencyKeysRef.current.get(semanticAction) ?? createIdempotencyKey();
    decisionIdempotencyKeysRef.current.set(semanticAction, idempotencyKey);
    try {
      const input = proposalDecisionSchema.parse({ version: proposal.version, decision });
      const payload = await requestCore(`proposals/${proposal.id}/decision`, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      const next = proposalResponseSchema.parse(payload).data;
      const expectedStatus = decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
      if (next.id !== proposal.id || !isManualEventProposal(next) || next.status !== expectedStatus) {
        decisionIdempotencyKeysRef.current.delete(semanticAction);
        freezeAndReload(proposal, 'Core 返回了与此次日程决定不一致的响应，正在重新读取待确认提案。');
        return;
      }
      decisionIdempotencyKeysRef.current.delete(semanticAction);
      replaceProposal(next);
      setStatusMessage(next.status === 'ACCEPTED' ? '日程提案已确认并写入日程。' : '日程提案已拒绝，未写入日程。');
    } catch (error: unknown) {
      if (!isUncertainCoreWriteFailure(error)) {
        decisionIdempotencyKeysRef.current.delete(semanticAction);
      }
      const current = conflictProposal(error);
      const replacesProposal = current
        && current.id === proposal.id
        && current.version > proposal.version
        && isManualEventProposal(current)
        && (current.status !== 'PENDING' || isActionablePendingManualEventProposal(current));
      if (replacesProposal) {
        replaceProposal(current);
        setStatusMessage('提案已由 Core 的最新版本替换。');
      } else if (error instanceof CoreClientError && error.status === 409) {
        freezeAndReload(proposal, '日程提案发生冲突，正在重新读取待确认提案。');
      } else {
        setFailure(failureMessage(error));
      }
    } finally {
      if (decisionInFlightRef.current === proposal.id) decisionInFlightRef.current = null;
      setDecidingProposalId(null);
    }
  }

  return (
    <section className="manual-event-proposal-panel" aria-labelledby="manual-event-heading">
      <header className="manual-event-proposal-panel__header">
        <div>
          <p className="section-kicker">MANUAL EVENT / REVIEW GATE</p>
          <h2 id="manual-event-heading">添加待确认日程</h2>
          <p>提交后只会创建待确认 Proposal；只有确认后才写入日程。</p>
        </div>
      </header>

      <form className="manual-event-proposal-form" onSubmit={(event) => void submit(event)} noValidate>
        <fieldset>
          <legend>自然语言生成候选</legend>
          <label>
            描述事项
            <textarea
              maxLength={1000}
              value={eventLanguageText}
              onChange={(event) => setEventLanguageText(event.target.value)}
              placeholder="例如：周三下午两点和导师开会"
            />
          </label>
          <label className="manual-event-proposal-form__hard">
            <input
              checked={externalProcessingConfirmed}
              type="checkbox"
              onChange={(event) => setExternalProcessingConfirmed(event.target.checked)}
            />
            我确认将这条事项描述发送给已配置的 Provider 解析
          </label>
          <p className="domain-form__hint">参考日期：{initialDate}（Asia/Shanghai）。未填写或不明确的字段会留空供你补全。</p>
          <button
            disabled={!externalProcessingConfirmed || isParsingEventLanguage || isCreating || isReloading}
            aria-busy={isParsingEventLanguage || undefined}
            type="button"
            onClick={() => void parseEventLanguage()}
          >
            {isParsingEventLanguage ? '正在解析候选…' : '解析并填入候选'}
          </button>
        </fieldset>

        <label>日程标题<input maxLength={200} value={title} onChange={(event) => { clearEventLanguageAssessment(); setTitle(event.target.value); }} /></label>
        <label>
          日程类型
          <select value={kind} onChange={(event) => { clearEventLanguageAssessment(); setKind(event.target.value as EventKind | ''); }}>
            <option value="">请选择类型</option>
            {eventKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>日程日期<input type="date" value={localDate} onChange={(event) => { clearEventLanguageAssessment(); setLocalDate(event.target.value); }} /></label>
        <label>开始时间<input type="time" value={startLocalTime} onChange={(event) => { clearEventLanguageAssessment(); setStartLocalTime(event.target.value); }} /></label>
        <label>结束时间<input type="time" value={endLocalTime} onChange={(event) => { clearEventLanguageAssessment(); setEndLocalTime(event.target.value); }} /></label>
        <label className="manual-event-proposal-form__hard">
          安排性质
          <select
            value={isHard === null ? '' : String(isHard)}
            onChange={(event) => {
              clearEventLanguageAssessment();
              setIsHard(event.target.value === '' ? null : event.target.value === 'true');
            }}
          >
            <option value="">请选择是否为固定安排</option>
            <option value="true">固定安排</option>
            <option value="false">可协商安排</option>
          </select>
        </label>
        <button disabled={isCreating || isReloading || isParsingEventLanguage} aria-busy={isCreating || isReloading || undefined} type="submit">创建待确认日程</button>
      </form>

      {eventLanguageAssessment ? (
        <section className="manual-event-proposal-panel__assessment" aria-live="polite">
          <h3>已解析候选的冲突提示</h3>
          <p>以下冲突只对应刚解析出的候选（参考：{eventLanguageAssessment.reference.localDate}，{eventLanguageAssessment.reference.timezone}）。你仍可编辑候选后再创建待确认 Proposal。</p>
          {eventLanguageAssessment.missingFields.length > 0 ? (
            <p role="status">请补全：{eventLanguageAssessment.missingFields.map((field) => missingFieldLabels[field]).join('、')}。</p>
          ) : null}
          {eventLanguageAssessment.conflicts.length === 0 ? (
            <p role="status">当前候选没有发现与已确认日程的时间重叠。</p>
          ) : (
            <ul>
              {eventLanguageAssessment.conflicts.map((conflict) => (
                <li key={conflict.eventId}>{conflict.reason}</li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {eventLanguageReviewRequired ? (
        <p className="manual-event-proposal-panel__failure" role="status">候选已修改，上次冲突检查已失效，请核对当日日程后确认。</p>
      ) : null}

      {visibleFailure ? <p className="manual-event-proposal-panel__failure" role="alert">{visibleFailure}</p> : null}
      {listFailure ? <button disabled={isReloading} aria-busy={isReloading || undefined} type="button" onClick={() => reloadPendingProposals()}>重新读取待确认手工日程</button> : null}
      {statusMessage ? <p className="manual-event-proposal-panel__status" ref={statusRef} role="status" tabIndex={-1}>{statusMessage}</p> : null}
      {isLoading ? <p role="status" aria-live="polite">正在读取待确认手工日程…</p> : null}
      {!isLoading && proposals.length === 0 ? <p className="manual-event-proposal-panel__empty" role="status">还没有待确认的手工日程。</p> : null}
      <ul className="manual-event-proposal-list">
        {proposals.map((proposal) => {
          const event = acceptedEvent(proposal);
          const isDeciding = decidingProposalId === proposal.id || isReloading;
          return (
            <li key={`${proposal.id}:${proposal.version}`}>
              <article className={`manual-event-proposal-card manual-event-proposal-card--${proposal.status.toLowerCase()}`}>
                <div>
                  <h3>{proposal.title}</h3>
                  <p role="status">{statusCopy(proposal.status)}</p>
                </div>
                {proposal.status === 'PENDING' ? (
                  <div className="manual-event-proposal-card__actions">
                    <button disabled={isDeciding} aria-busy={isDeciding || undefined} type="button" onClick={() => void decide(proposal, 'REJECT')}>拒绝写入日程</button>
                    <button disabled={isDeciding} aria-busy={isDeciding || undefined} type="button" onClick={() => void decide(proposal, 'ACCEPT')}>{isDeciding ? '正在处理…' : '确认写入日程'}</button>
                  </div>
                ) : null}
                {event ? <Link aria-label={`查看日程详情：${event.title}`} href={`/schedule/events/${event.id}`}>查看日程详情</Link> : null}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
