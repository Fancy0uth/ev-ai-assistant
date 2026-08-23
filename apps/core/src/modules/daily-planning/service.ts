import {
  dailyPlanModelOutputSchema,
  dailyPlanProposalSchema,
  type DailyPlanFailureCode,
  type DailyPlanProposal,
} from '@ev/contracts';
import { CredentialNotConfiguredError } from '../providers/credential-service';
import type {
  ApprovedDailyPlanningPacket,
} from './context-service';
import {
  DailyPlanningProviderModelOutputError,
  DailyPlanningProviderUnavailableError,
  type DailyPlanningProvider,
  type DailyPlanningProviderInput,
} from './provider';
import {
  DailyPlanBaseVersionStaleError,
  type DailyPlanRunRepository,
} from './repository';
import type { DailyPlanPreflightService } from './preflight-service';
import { DailyPlanValidationError, validateDailyPlanOutput } from './validator';

export interface DailyPlanningCredentialPort {
  withApiKey(ownerId: string, callback: (apiKey: string) => void | Promise<void>): Promise<void>;
}

export interface DailyPlanningServiceDependencies {
  preflightService: DailyPlanPreflightService;
  repository: DailyPlanRunRepository;
  credentialService: DailyPlanningCredentialPort;
  provider: DailyPlanningProvider;
  newId?: () => string;
  now?: () => Date;
}

export interface DailyPlanningService {
  generateApprovedPreflight(input: {
    ownerId: string;
    preflightId: string;
    expectedPreflightVersion: number;
  }): Promise<DailyPlanProposal>;
}

export class DailyPlanGenerationError extends Error {
  constructor(readonly code: DailyPlanFailureCode) {
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

function failureCode(error: unknown): DailyPlanFailureCode {
  if (error instanceof CredentialNotConfiguredError) {
    return 'DAILY_PLAN_PROVIDER_NOT_CONFIGURED';
  }
  if (error instanceof DailyPlanningProviderModelOutputError) {
    return 'DAILY_PLAN_MODEL_OUTPUT_INVALID';
  }
  if (error instanceof DailyPlanValidationError) {
    return 'DAILY_PLAN_VALIDATION_FAILED';
  }
  if (error instanceof DailyPlanningProviderUnavailableError) {
    return 'DAILY_PLAN_PROVIDER_UNAVAILABLE';
  }
  if (error instanceof Error && error.name === 'ZodError') {
    return 'DAILY_PLAN_MODEL_OUTPUT_INVALID';
  }
  return 'DAILY_PLAN_PROVIDER_UNAVAILABLE';
}

export function createDailyPlanningService(
  dependencies: DailyPlanningServiceDependencies,
): DailyPlanningService {
  const newId = dependencies.newId ?? crypto.randomUUID;
  const now = dependencies.now ?? (() => new Date());

  return {
    async generateApprovedPreflight(input) {
      const claimed = dependencies.preflightService.claimApproved(
        input.ownerId,
        input.preflightId,
        input.expectedPreflightVersion,
      );
      try {
        let providerOutput: unknown;
        await dependencies.credentialService.withApiKey(input.ownerId, async (apiKey) => {
          providerOutput = await dependencies.provider.generate(
            apiKey,
            providerInput(claimed.packet, claimed.preflight.localDate),
          );
        });
        const modelOutput = dailyPlanModelOutputSchema.parse(providerOutput);
        const validatedItems = validateDailyPlanOutput(claimed.packet, modelOutput);
        const timestamp = now().toISOString();
        const proposal = dailyPlanProposalSchema.parse({
          id: newId(),
          contractVersion: 'DAILY_PLAN_V1',
          runId: claimed.run.id,
          localDate: claimed.preflight.localDate,
          status: 'PENDING_REVIEW',
          baseScheduleVersion: claimed.packet.baseScheduleVersion,
          summary: modelOutput.summary,
          items: validatedItems.map((item) => ({ id: newId(), ...item })),
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        return dependencies.repository.completeClaimedPreflight({
          ownerId: input.ownerId,
          preflightId: input.preflightId,
          expectedVersion: claimed.preflight.version,
          proposal,
          completedAt: now().toISOString(),
        });
      } catch (error) {
        if (error instanceof DailyPlanBaseVersionStaleError) {
          throw error;
        }
        const code = failureCode(error);
        dependencies.repository.failClaimedPreflight({
          ownerId: input.ownerId,
          preflightId: input.preflightId,
          expectedVersion: claimed.preflight.version,
          code,
          completedAt: now().toISOString(),
        });
        throw new DailyPlanGenerationError(code);
      }
    },
  };
}
