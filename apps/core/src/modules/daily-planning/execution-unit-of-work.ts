import type { DailyPlanFailureCode, DailyPlanProposal } from '@ev/contracts';
import type Database from 'better-sqlite3';
import type {
  ProviderCallFinishInput,
  ProviderReliabilityRepository,
} from '../providers/reliability-repository';
import type {
  DailyPlanPreflightCompletionResult,
  DailyPlanRunRepository,
} from './repository';

export interface SafeHttpSnapshot {
  status: number;
  body: unknown;
  failureCode: string;
}

export interface DailyPlanTerminalFaultCheckpoint {
  phase: 'BUSINESS_TERMINAL' | 'PROVIDER_TERMINAL';
  outcome: 'SUCCEEDED' | 'FAILED';
}

export interface DailyPlanGenerationExecutionIdentity {
  ownerId: string;
  idempotencyRecordId: string;
  leaseToken: string;
  preflightId: string;
  expectedPreflightVersion: number;
}

export interface DailyPlanExecutionUnitOfWork {
  complete(input: DailyPlanGenerationExecutionIdentity & {
    proposal: DailyPlanProposal;
    completedAt: string;
    providerCall: ProviderCallFinishInput | null;
    successSnapshot: SafeHttpSnapshot;
    staleSnapshot: SafeHttpSnapshot;
  }): DailyPlanPreflightCompletionResult;
  fail(input: DailyPlanGenerationExecutionIdentity & {
    runFailureCode: DailyPlanFailureCode;
    terminalReason: string;
    completedAt: string;
    providerCall: ProviderCallFinishInput | null;
    failureSnapshot: SafeHttpSnapshot;
  }): void;
}

export function createDailyPlanExecutionUnitOfWork(options: {
  database: Database.Database;
  dailyPlanRepository: DailyPlanRunRepository;
  reliabilityRepository: ProviderReliabilityRepository;
  fault?: (checkpoint: DailyPlanTerminalFaultCheckpoint) => void;
}): DailyPlanExecutionUnitOfWork {
  const completeTransaction = options.database.transaction(
    (input: Parameters<DailyPlanExecutionUnitOfWork['complete']>[0]) => {
      const business = options.dailyPlanRepository.commitClaimedPreflight({
        ownerId: input.ownerId,
        preflightId: input.preflightId,
        expectedVersion: input.expectedPreflightVersion,
        proposal: input.proposal,
        completedAt: input.completedAt,
        leaseToken: input.leaseToken,
      });
      options.fault?.({ phase: 'BUSINESS_TERMINAL', outcome: 'SUCCEEDED' });

      if (input.providerCall && !options.reliabilityRepository.finishProviderCall(input.providerCall)) {
        throw new Error('Provider call terminal could not be committed');
      }
      options.fault?.({ phase: 'PROVIDER_TERMINAL', outcome: 'SUCCEEDED' });

      const snapshot = business.kind === 'stale' ? input.staleSnapshot : input.successSnapshot;
      const finalized = business.kind === 'stale'
        ? options.reliabilityRepository.fail({
            ownerId: input.ownerId,
            recordId: input.idempotencyRecordId,
            leaseToken: input.leaseToken,
            status: snapshot.status,
            response: snapshot.body,
            failureCode: snapshot.failureCode,
            updatedAt: input.completedAt,
          })
        : options.reliabilityRepository.complete({
            ownerId: input.ownerId,
            recordId: input.idempotencyRecordId,
            leaseToken: input.leaseToken,
            status: snapshot.status,
            response: snapshot.body,
            updatedAt: input.completedAt,
          });
      if (!finalized) throw new Error('Generation idempotency snapshot could not be committed');
      return business;
    },
  );

  const failTransaction = options.database.transaction(
    (input: Parameters<DailyPlanExecutionUnitOfWork['fail']>[0]) => {
      options.dailyPlanRepository.failClaimedPreflight({
        ownerId: input.ownerId,
        preflightId: input.preflightId,
        expectedVersion: input.expectedPreflightVersion,
        code: input.runFailureCode,
        terminalReason: input.terminalReason,
        completedAt: input.completedAt,
        leaseToken: input.leaseToken,
      });
      options.fault?.({ phase: 'BUSINESS_TERMINAL', outcome: 'FAILED' });

      if (input.providerCall && !options.reliabilityRepository.finishProviderCall(input.providerCall)) {
        throw new Error('Provider call terminal could not be committed');
      }
      options.fault?.({ phase: 'PROVIDER_TERMINAL', outcome: 'FAILED' });

      if (
        !options.reliabilityRepository.fail({
          ownerId: input.ownerId,
          recordId: input.idempotencyRecordId,
          leaseToken: input.leaseToken,
          status: input.failureSnapshot.status,
          response: input.failureSnapshot.body,
          failureCode: input.failureSnapshot.failureCode,
          updatedAt: input.completedAt,
        })
      ) {
        throw new Error('Generation idempotency failure snapshot could not be committed');
      }
    },
  );

  return {
    complete(input) {
      return completeTransaction(input);
    },
    fail(input) {
      failTransaction(input);
    },
  };
}
