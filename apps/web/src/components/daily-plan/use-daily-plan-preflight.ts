'use client';

import {
  dailyPlanPreflightApproveInputSchema,
  dailyPlanPreflightGenerateInputSchema,
  dailyPlanPreflightPrepareInputSchema,
  dailyPlanPreflightResponseSchema,
  dailyPlanProposalResponseSchema,
  type DailyPlanPreflight,
  type DailyPlanPreflightItem,
  type DailyPlanProposal,
} from '@ev/contracts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CoreClientError, requestCore } from '@/lib/core-client';

export type PreflightOperation = 'prepare' | 'approve' | 'generate';

export interface PreflightFailure {
  code: string | null;
  message: string;
  recovery: 'reprepare' | 'settings' | 'login';
}

export type EditablePreflightItem = Pick<
  DailyPlanPreflightItem,
  'contextRef' | 'safeTitle' | 'domain' | 'deadlineLocalDate' | 'included'
>;

export type EditablePreflightPatch = Pick<
  DailyPlanPreflightItem,
  'safeTitle' | 'domain' | 'deadlineLocalDate' | 'included'
>;

export type DailyPlanPreflightState =
  | { phase: 'idle'; localDate: string }
  | { phase: 'preparing'; localDate: string }
  | { phase: 'reviewing'; localDate: string; preflight: DailyPlanPreflight; draftItems: EditablePreflightItem[] }
  | { phase: 'approving'; localDate: string; preflight: DailyPlanPreflight; draftItems: EditablePreflightItem[] }
  | { phase: 'approved'; localDate: string; preflight: DailyPlanPreflight }
  | { phase: 'generating'; localDate: string; preflight: DailyPlanPreflight }
  | { phase: 'generated'; localDate: string; proposalId: string }
  | { phase: 'blocked'; localDate: string; operation: PreflightOperation; failure: PreflightFailure };

export interface DailyPlanPreflightController {
  state: DailyPlanPreflightState;
  prepare(): Promise<boolean>;
  editItem(contextRef: string, patch: Partial<EditablePreflightPatch>): void;
  approve(): Promise<boolean>;
  generate(): Promise<boolean>;
}

interface UseDailyPlanPreflightOptions {
  localDate: string;
  onGenerated: (proposal: DailyPlanProposal) => void;
}

interface InFlightOperation {
  operationId: number;
  controller: AbortController;
}

function toDraftItems(preflight: DailyPlanPreflight): EditablePreflightItem[] {
  return preflight.items.map(({ contextRef, safeTitle, domain, deadlineLocalDate, included }) => ({
    contextRef,
    safeTitle,
    domain,
    deadlineLocalDate,
    included,
  }));
}

function failureFor(error: unknown): PreflightFailure {
  if (!(error instanceof CoreClientError)) {
    return { code: null, message: '本地 Core 或响应暂时不可用；请重新准备外发内容。', recovery: 'reprepare' };
  }

  if (error.status === 401 && error.code === 'AUTHENTICATION_REQUIRED') {
    return { code: error.code, message: error.message, recovery: 'login' };
  }
  if (error.code === 'DAILY_PLAN_PROVIDER_NOT_CONFIGURED') {
    return { code: error.code, message: error.message, recovery: 'settings' };
  }
  if (error.code === 'DAILY_PLAN_PROVIDER_UNAVAILABLE') {
    return { code: error.code, message: error.message || 'Provider 暂不可用，未生成草案。', recovery: 'reprepare' };
  }
  if (error.status === 404) {
    return { code: error.code, message: '上下文不存在或已失效，请重新准备。', recovery: 'reprepare' };
  }
  if (error.status === 409) {
    return { code: error.code, message: error.message, recovery: 'reprepare' };
  }
  if (error.status === 422) {
    return { code: error.code, message: error.message, recovery: 'reprepare' };
  }
  return { code: error.code, message: error.message, recovery: 'reprepare' };
}

function invalidResponseFailure(): PreflightFailure {
  return {
    code: 'UNEXPECTED_RESPONSE',
    message: 'Core 返回了无法安全继续的响应；请重新准备外发内容。',
    recovery: 'reprepare',
  };
}

function currentDateState(state: DailyPlanPreflightState, localDate: string): DailyPlanPreflightState {
  return state.localDate === localDate ? state : { phase: 'idle', localDate };
}

export function useDailyPlanPreflight({ localDate, onGenerated }: UseDailyPlanPreflightOptions): DailyPlanPreflightController {
  const { replace } = useRouter();
  const initialState: DailyPlanPreflightState = { phase: 'idle', localDate };
  const [renderedState, setRenderedState] = useState<DailyPlanPreflightState>(initialState);
  const stateRef = useRef<DailyPlanPreflightState>(initialState);
  const localDateRef = useRef(localDate);
  const epochRef = useRef(0);
  const operationIdRef = useRef(0);
  const inFlightRef = useRef<InFlightOperation | null>(null);
  const onGeneratedRef = useRef(onGenerated);

  function transition(next: DailyPlanPreflightState): void {
    stateRef.current = next;
    setRenderedState(next);
  }

  function resetForDate(nextDate: string): void {
    epochRef.current += 1;
    inFlightRef.current?.controller.abort();
    inFlightRef.current = null;
    transition({ phase: 'idle', localDate: nextDate });
  }

  function getCurrentState(): DailyPlanPreflightState {
    const state = currentDateState(stateRef.current, localDateRef.current);
    if (state !== stateRef.current) resetForDate(localDateRef.current);
    return stateRef.current;
  }

  useLayoutEffect(() => {
    localDateRef.current = localDate;
    onGeneratedRef.current = onGenerated;
    if (stateRef.current.localDate !== localDate) {
      epochRef.current += 1;
      inFlightRef.current?.controller.abort();
      inFlightRef.current = null;
      transition({ phase: 'idle', localDate });
    }
  }, [localDate, onGenerated]);

  useEffect(() => () => {
    epochRef.current += 1;
    inFlightRef.current?.controller.abort();
    inFlightRef.current = null;
  }, []);

  function begin(): { operationId: number; epoch: number; localDate: string; controller: AbortController } | null {
    if (inFlightRef.current !== null) return null;
    const controller = new AbortController();
    const operationId = operationIdRef.current + 1;
    operationIdRef.current = operationId;
    const token = { operationId, epoch: epochRef.current, localDate: localDateRef.current, controller };
    inFlightRef.current = { operationId, controller };
    return token;
  }

  function canCommit(token: { operationId: number; epoch: number; localDate: string; controller: AbortController }): boolean {
    return (
      !token.controller.signal.aborted &&
      epochRef.current === token.epoch &&
      localDateRef.current === token.localDate &&
      inFlightRef.current?.operationId === token.operationId
    );
  }

  function finish(token: { operationId: number }): void {
    if (inFlightRef.current?.operationId === token.operationId) inFlightRef.current = null;
  }

  function block(operation: PreflightOperation, token: { operationId: number; epoch: number; localDate: string; controller: AbortController }, failure: PreflightFailure): void {
    if (!canCommit(token)) return;
    transition({ phase: 'blocked', localDate: token.localDate, operation, failure });
    if (failure.recovery === 'login') replace('/login');
  }

  async function prepare(): Promise<boolean> {
    const state = getCurrentState();
    if (state.phase !== 'idle' && state.phase !== 'blocked' && state.phase !== 'generated') return false;
    const token = begin();
    if (!token) return false;

    transition({ phase: 'preparing', localDate: token.localDate });
    try {
      const input = dailyPlanPreflightPrepareInputSchema.parse({ localDate: token.localDate });
      const payload = await requestCore('daily-plans/preflights', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: token.controller.signal,
      });
      const preflight = dailyPlanPreflightResponseSchema.parse(payload).data;
      if (preflight.status !== 'AWAITING_APPROVAL') {
        block('prepare', token, invalidResponseFailure());
        return false;
      }
      if (!canCommit(token)) return false;
      transition({ phase: 'reviewing', localDate: token.localDate, preflight, draftItems: toDraftItems(preflight) });
      return true;
    } catch (error: unknown) {
      block('prepare', token, failureFor(error));
      return false;
    } finally {
      finish(token);
    }
  }

  function editItem(contextRef: string, patch: Partial<EditablePreflightPatch>): void {
    const state = getCurrentState();
    if (state.phase !== 'reviewing') return;
    const draftItems = state.draftItems.map((item) => (item.contextRef === contextRef ? { ...item, ...patch } : item));
    transition({ ...state, draftItems });
  }

  async function approve(): Promise<boolean> {
    const state = getCurrentState();
    if (state.phase !== 'reviewing') return false;
    const token = begin();
    if (!token) return false;
    transition({ phase: 'approving', localDate: token.localDate, preflight: state.preflight, draftItems: state.draftItems });
    try {
      const input = dailyPlanPreflightApproveInputSchema.parse({
        expectedPreflightVersion: state.preflight.version,
        items: state.draftItems,
      });
      const payload = await requestCore(`daily-plans/preflights/${state.preflight.id}/approve`, {
        method: 'POST',
        body: JSON.stringify(input),
        signal: token.controller.signal,
      });
      const preflight = dailyPlanPreflightResponseSchema.parse(payload).data;
      if (preflight.status !== 'APPROVED') {
        block('approve', token, invalidResponseFailure());
        return false;
      }
      if (!canCommit(token)) return false;
      transition({ phase: 'approved', localDate: token.localDate, preflight });
      return true;
    } catch (error: unknown) {
      block('approve', token, failureFor(error));
      return false;
    } finally {
      finish(token);
    }
  }

  async function generate(): Promise<boolean> {
    const state = getCurrentState();
    if (state.phase !== 'approved' || state.preflight.status !== 'APPROVED') return false;
    const token = begin();
    if (!token) return false;
    transition({ phase: 'generating', localDate: token.localDate, preflight: state.preflight });
    try {
      const input = dailyPlanPreflightGenerateInputSchema.parse({
        preflightId: state.preflight.id,
        expectedPreflightVersion: state.preflight.version,
      });
      const payload = await requestCore('daily-plans/generate', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: token.controller.signal,
      });
      const proposal = dailyPlanProposalResponseSchema.parse(payload).data;
      if (!canCommit(token)) return false;
      transition({ phase: 'generated', localDate: token.localDate, proposalId: proposal.id });
      if (canCommit(token)) onGeneratedRef.current(proposal);
      return true;
    } catch (error: unknown) {
      block('generate', token, failureFor(error));
      return false;
    } finally {
      finish(token);
    }
  }

  return {
    state: currentDateState(renderedState, localDate),
    prepare,
    editItem,
    approve,
    generate,
  };
}
