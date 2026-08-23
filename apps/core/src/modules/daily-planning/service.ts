import {
  dailyPlanModelOutputSchema,
  dailyPlanProposalSchema,
  type DailyPlanFailureCode,
  type DailyPlanProposal,
} from '@ev/contracts';
import { CredentialNotConfiguredError } from '../providers/credential-service';
import {
  PROVIDER_POLICY,
  ProviderPolicyError,
  validateProviderResult,
} from '../providers/provider-policy';
import type { ProviderReliabilityRepository } from '../providers/reliability-repository';
import type {
  DailyPlanExecutionUnitOfWork,
  SafeHttpSnapshot,
} from './execution-unit-of-work';
import type {
  ApprovedDailyPlanningPacket,
} from './context-service';
import { buildApprovedDailyPlanningPacket } from './context-service';
import {
  DailyPlanningProviderModelOutputError,
  DailyPlanningProviderQuotaError,
  DailyPlanningProviderTimeoutError,
  DailyPlanningProviderUnavailableError,
  type DailyPlanningProvider,
  type DailyPlanningProviderInput,
} from './provider';
import {
  DailyPlanBaseVersionStaleError,
  type DailyPlanPreflightClaimResult,
  type DailyPlanRunRepository,
} from './repository';
import {
  DailyPlanPreflightError,
  type DailyPlanPreflightService,
} from './preflight-service';
import { DailyPlanValidationError, validateDailyPlanOutput } from './validator';

export interface DailyPlanningCredentialPort {
  withApiKey(ownerId: string, callback: (apiKey: string) => void | Promise<void>): Promise<void>;
}

export interface DailyPlanningServiceDependencies {
  preflightService: DailyPlanPreflightService;
  repository: DailyPlanRunRepository;
  credentialService: DailyPlanningCredentialPort;
  provider: DailyPlanningProvider;
  reliabilityRepository?: ProviderReliabilityRepository;
  executionUnitOfWork?: DailyPlanExecutionUnitOfWork;
  newId?: () => string;
  now?: () => Date;
}

export interface DailyPlanningService {
  generateApprovedPreflight(input: {
    ownerId: string;
    preflightId: string;
    expectedPreflightVersion: number;
    execution?: {
      idempotencyRecordId: string | null;
      leaseToken: string;
      attemptCount: number;
      recovered: boolean;
      snapshotForProposal?: (proposal: DailyPlanProposal) => SafeHttpSnapshot;
      snapshotForError?: (error: unknown) => SafeHttpSnapshot;
    };
  }): Promise<DailyPlanProposal>;
}

export type DailyPlanGenerationFailureCode =
  | DailyPlanFailureCode
  | 'DAILY_PLAN_PROVIDER_TIMEOUT'
  | 'DAILY_PLAN_PROVIDER_QUOTA_EXCEEDED'
  | 'DAILY_PLAN_PROVIDER_RESPONSE_REJECTED';

export class DailyPlanGenerationError extends Error {
  constructor(
    readonly code: DailyPlanGenerationFailureCode,
    readonly executionFinalized = false,
  ) {
    super(code);
    this.name = 'DailyPlanGenerationError';
  }
}

function providerInput(
  packet: ApprovedDailyPlanningPacket,
  localDate: string,
): DailyPlanningProviderInput {
  return {
    localDate,
    fixedBlocks: packet.timeBlocks
      .filter((block) => block.isHard)
      .map(({ startLocalTime, endLocalTime }) => ({ startLocalTime, endLocalTime })),
    softBlocks: packet.timeBlocks
      .filter((block) => !block.isHard)
      .map(({ startLocalTime, endLocalTime }) => ({ startLocalTime, endLocalTime })),
    timeRequests: packet.timeRequests.map((request) => ({
      contextRef: request.contextRef,
      safeTitle: request.safeTitle,
      domain: request.domain,
      deadlineLocalDate: request.deadlineLocalDate,
      durationMinutes: request.durationMinutes,
      priority: request.priority,
      availability: {
        earliestStartLocalTime: request.earliestStartLocalTime,
        latestEndLocalTime: request.latestEndLocalTime,
      },
      isFixed: request.isFixed,
    })),
    recoveryLevel: packet.recoveryLevel,
  };
}

function failure(error: unknown): { code: DailyPlanGenerationFailureCode; runCode: DailyPlanFailureCode } {
  if (error instanceof CredentialNotConfiguredError) {
    return { code: 'DAILY_PLAN_PROVIDER_NOT_CONFIGURED', runCode: 'DAILY_PLAN_PROVIDER_NOT_CONFIGURED' };
  }
  if (error instanceof DailyPlanningProviderTimeoutError) {
    return { code: 'DAILY_PLAN_PROVIDER_TIMEOUT', runCode: 'DAILY_PLAN_PROVIDER_UNAVAILABLE' };
  }
  if (error instanceof DailyPlanningProviderQuotaError) {
    return { code: 'DAILY_PLAN_PROVIDER_QUOTA_EXCEEDED', runCode: 'DAILY_PLAN_PROVIDER_UNAVAILABLE' };
  }
  if (error instanceof ProviderPolicyError) {
    return { code: error.code, runCode: 'DAILY_PLAN_PROVIDER_UNAVAILABLE' };
  }
  if (error instanceof DailyPlanningProviderModelOutputError) {
    return { code: 'DAILY_PLAN_MODEL_OUTPUT_INVALID', runCode: 'DAILY_PLAN_MODEL_OUTPUT_INVALID' };
  }
  if (error instanceof DailyPlanValidationError) {
    return { code: 'DAILY_PLAN_VALIDATION_FAILED', runCode: 'DAILY_PLAN_VALIDATION_FAILED' };
  }
  if (error instanceof DailyPlanningProviderUnavailableError) {
    return { code: 'DAILY_PLAN_PROVIDER_UNAVAILABLE', runCode: 'DAILY_PLAN_PROVIDER_UNAVAILABLE' };
  }
  if (error instanceof Error && error.name === 'ZodError') {
    return { code: 'DAILY_PLAN_MODEL_OUTPUT_INVALID', runCode: 'DAILY_PLAN_MODEL_OUTPUT_INVALID' };
  }
  return { code: 'DAILY_PLAN_PROVIDER_UNAVAILABLE', runCode: 'DAILY_PLAN_PROVIDER_UNAVAILABLE' };
}

function claimError(kind: Exclude<DailyPlanPreflightClaimResult['kind'], 'claimed' | 'stale'>): DailyPlanPreflightError {
  switch (kind) {
    case 'not_found':
      return new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_NOT_FOUND');
    case 'version_conflict':
      return new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_VERSION_CONFLICT');
    case 'not_approved':
      return new DailyPlanPreflightError('DAILY_PLAN_PREFLIGHT_NOT_APPROVED');
  }
}

export function createDailyPlanningService(
  dependencies: DailyPlanningServiceDependencies,
): DailyPlanningService {
  const newId = dependencies.newId ?? crypto.randomUUID;
  const now = dependencies.now ?? (() => new Date());

  return {
    async generateApprovedPreflight(input) {
      const startedAt = now();
      const execution = input.execution ?? {
        idempotencyRecordId: null,
        leaseToken: newId(),
        attemptCount: 1,
        recovered: false,
      };
      const claimedAt = startedAt.toISOString();
      const executionLease = {
        leaseToken: execution.leaseToken,
        attemptCount: execution.attemptCount,
        leaseExpiresAt: new Date(startedAt.getTime() + PROVIDER_POLICY.leaseMs).toISOString(),
        deadlineAt: new Date(startedAt.getTime() + PROVIDER_POLICY.totalTimeoutMs).toISOString(),
        idempotencyRecordId: execution.idempotencyRecordId,
      };
      const claimed = execution.recovered
        ? dependencies.repository.recoverClaimedPreflight({
            ownerId: input.ownerId,
            preflightId: input.preflightId,
            expectedVersion: input.expectedPreflightVersion + 1,
            claimedAt,
            execution: executionLease,
          })
        : dependencies.repository.claimApprovedPreflight({
            ownerId: input.ownerId,
            preflightId: input.preflightId,
            expectedVersion: input.expectedPreflightVersion,
            claimedAt,
            execution: executionLease,
          });
      if (claimed.kind === 'stale') throw new DailyPlanBaseVersionStaleError();
      if (claimed.kind !== 'claimed') throw claimError(claimed.kind);
      const packet = buildApprovedDailyPlanningPacket(
        claimed.context,
        claimed.preflight.items,
        claimed.preflight.baseScheduleVersion,
      );
      const safeProviderInput = providerInput(packet, claimed.preflight.localDate);
      const inputChars = JSON.stringify(safeProviderInput).length;
      let providerCallId: string | undefined;
      let providerResult: Awaited<ReturnType<DailyPlanningProvider['generate']>> | undefined;
      let terminalizationStarted = false;
      try {
        if (inputChars > PROVIDER_POLICY.maxInputChars) {
          throw new ProviderPolicyError('DAILY_PLAN_PROVIDER_RESPONSE_REJECTED');
        }
        if (execution.attemptCount > PROVIDER_POLICY.maxCallsPerRun) {
          throw new DailyPlanningProviderQuotaError();
        }
        const priorUsage = dependencies.reliabilityRepository?.usageForOwnerDate(
          input.ownerId,
          claimed.preflight.localDate,
        );
        if (
          priorUsage &&
          (priorUsage.attempts >= PROVIDER_POLICY.maxCallsPerOwnerDay ||
            priorUsage.totalTokens >= PROVIDER_POLICY.maxTokensPerOwnerDay)
        ) {
          throw new DailyPlanningProviderQuotaError();
        }
        await dependencies.credentialService.withApiKey(input.ownerId, async (apiKey) => {
          providerCallId = newId();
          dependencies.reliabilityRepository?.startProviderCall({
            id: providerCallId,
            ownerId: input.ownerId,
            runId: claimed.run.id,
            idempotencyRecordId: execution.idempotencyRecordId,
            provider: 'DEEPSEEK',
            operation: 'daily_plan.generate',
            model: 'deepseek-v4-flash',
            attemptNo: execution.attemptCount,
            inputChars,
            localDate: claimed.preflight.localDate,
            startedAt: now().toISOString(),
          });
          providerResult = await dependencies.provider.generate(apiKey, safeProviderInput);
        });
        if (!providerResult) throw new DailyPlanningProviderUnavailableError();
        validateProviderResult(providerResult);
        if (
          priorUsage &&
          providerResult.usage.totalTokens !== null &&
          priorUsage.totalTokens + providerResult.usage.totalTokens > PROVIDER_POLICY.maxTokensPerOwnerDay
        ) {
          throw new DailyPlanningProviderQuotaError();
        }
        const modelOutput = dailyPlanModelOutputSchema.parse(providerResult.output);
        const validatedItems = validateDailyPlanOutput(packet, modelOutput);
        const timestamp = now().toISOString();
        const proposal = dailyPlanProposalSchema.parse({
          id: newId(),
          contractVersion: 'DAILY_PLAN_V1',
          runId: claimed.run.id,
          localDate: claimed.preflight.localDate,
          status: 'PENDING_REVIEW',
          baseScheduleVersion: packet.baseScheduleVersion,
          summary: modelOutput.summary,
          items: validatedItems.map((item) => ({ id: newId(), ...item })),
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        const completedAt = now().toISOString();
        if (
          dependencies.executionUnitOfWork &&
          execution.idempotencyRecordId &&
          execution.snapshotForProposal &&
          execution.snapshotForError
        ) {
          terminalizationStarted = true;
          const terminal = dependencies.executionUnitOfWork.complete({
            ownerId: input.ownerId,
            idempotencyRecordId: execution.idempotencyRecordId,
            leaseToken: execution.leaseToken,
            preflightId: input.preflightId,
            expectedPreflightVersion: claimed.preflight.version,
            proposal,
            completedAt,
            providerCall: providerCallId
              ? {
                  id: providerCallId,
                  status: 'SUCCEEDED',
                  failureCode: null,
                  finishReason: providerResult.finishReason,
                  usage: providerResult.usage,
                  outputChars: providerResult.outputChars,
                  finishedAt: completedAt,
                  durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
                }
              : null,
            successSnapshot: execution.snapshotForProposal(proposal),
            staleSnapshot: execution.snapshotForError(new DailyPlanBaseVersionStaleError()),
          });
          if (terminal.kind === 'stale') throw new DailyPlanBaseVersionStaleError(true);
          return terminal.proposal;
        }

        const completed = dependencies.repository.completeClaimedPreflight({
          ownerId: input.ownerId,
          preflightId: input.preflightId,
          expectedVersion: claimed.preflight.version,
          proposal,
          completedAt,
          leaseToken: execution.leaseToken,
        });
        if (providerCallId) {
          dependencies.reliabilityRepository?.finishProviderCall({
            id: providerCallId,
            status: 'SUCCEEDED',
            failureCode: null,
            finishReason: providerResult.finishReason,
            usage: providerResult.usage,
            outputChars: providerResult.outputChars,
            finishedAt: now().toISOString(),
            durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
          });
        }
        return completed;
      } catch (error) {
        if (terminalizationStarted) throw error;
        const mapped = failure(error);
        if (
          dependencies.executionUnitOfWork &&
          execution.idempotencyRecordId &&
          execution.snapshotForError
        ) {
          const completedAt = now().toISOString();
          const terminalError = new DailyPlanGenerationError(mapped.code, true);
          terminalizationStarted = true;
          dependencies.executionUnitOfWork.fail({
            ownerId: input.ownerId,
            idempotencyRecordId: execution.idempotencyRecordId,
            leaseToken: execution.leaseToken,
            preflightId: input.preflightId,
            expectedPreflightVersion: claimed.preflight.version,
            runFailureCode: mapped.runCode,
            terminalReason: mapped.code,
            completedAt,
            providerCall: providerCallId
              ? {
                  id: providerCallId,
                  status: 'FAILED',
                  failureCode: mapped.code,
                  finishReason: providerResult?.finishReason ?? null,
                  usage: providerResult?.usage ?? {
                    promptTokens: null,
                    completionTokens: null,
                    totalTokens: null,
                  },
                  outputChars: providerResult?.outputChars ?? null,
                  finishedAt: completedAt,
                  durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
                }
              : null,
            failureSnapshot: execution.snapshotForError(terminalError),
          });
          throw terminalError;
        }
        if (providerCallId) {
          dependencies.reliabilityRepository?.finishProviderCall({
            id: providerCallId,
            status: 'FAILED',
            failureCode: mapped.code,
            finishReason: providerResult?.finishReason ?? null,
            usage: providerResult?.usage ?? { promptTokens: null, completionTokens: null, totalTokens: null },
            outputChars: providerResult?.outputChars ?? null,
            finishedAt: now().toISOString(),
            durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
          });
        }
        if (error instanceof DailyPlanBaseVersionStaleError) {
          throw error;
        }
        try {
          dependencies.repository.failClaimedPreflight({
            ownerId: input.ownerId,
            preflightId: input.preflightId,
            expectedVersion: claimed.preflight.version,
            code: mapped.runCode,
            terminalReason: mapped.code,
            completedAt: now().toISOString(),
            leaseToken: execution.leaseToken,
          });
        } catch {
          // A recovery can make an old Provider response late.  Do not let it
          // overwrite the newer lease holder's run or idempotency snapshot.
        }
        throw new DailyPlanGenerationError(mapped.code);
      }
    },
  };
}
