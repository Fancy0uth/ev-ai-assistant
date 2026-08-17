import {
  dailyPlanModelOutputSchema,
  dailyPlanProposalSchema,
  type DailyPlanFailureCode,
  type DailyPlanProposal,
} from '@ev/contracts';
import { CredentialNotConfiguredError } from '../providers/credential-service';
import type {
  DailyPlanningContextService,
  DailyPlanningPacket,
} from './context-service';
import {
  DailyPlanningProviderModelOutputError,
  DailyPlanningProviderUnavailableError,
  type DailyPlanningProvider,
  type DailyPlanningProviderInput,
} from './provider';
import type { DailyPlanRunRepository } from './repository';
import { DailyPlanValidationError, validateDailyPlanOutput } from './validator';

export interface DailyPlanningCredentialPort {
  withApiKey(ownerId: string, callback: (apiKey: string) => void | Promise<void>): Promise<void>;
}

export interface DailyPlanningServiceDependencies {
  contextService: DailyPlanningContextService;
  repository: DailyPlanRunRepository;
  credentialService: DailyPlanningCredentialPort;
  provider: DailyPlanningProvider;
  newId?: () => string;
  now?: () => Date;
}

export interface DailyPlanningService {
  generateDailyPlan(input: {
    ownerId: string;
    localDate: string;
    trigger: 'MANUAL';
  }): Promise<DailyPlanProposal>;
}

export class DailyPlanGenerationError extends Error {
  constructor(readonly code: DailyPlanFailureCode) {
    super(code);
    this.name = 'DailyPlanGenerationError';
  }
}

function providerInput(packet: DailyPlanningPacket, localDate: string): DailyPlanningProviderInput {
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
      durationMinutes: request.durationMinutes,
      priority: request.priority,
      availability: {
        earliestStartLocalTime: request.earliestStartLocalTime,
        latestEndLocalTime: request.latestEndLocalTime,
      },
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
    async generateDailyPlan(input) {
      const { run, packet } = dependencies.contextService.prepare(
        input.ownerId,
        input.localDate,
        input.trigger,
        now(),
      );

      let proposal: DailyPlanProposal;
      try {
        let providerOutput: unknown;
        await dependencies.credentialService.withApiKey(input.ownerId, async (apiKey) => {
          providerOutput = await dependencies.provider.generate(apiKey, providerInput(packet, input.localDate));
        });
        const modelOutput = dailyPlanModelOutputSchema.parse(providerOutput);
        const validatedItems = validateDailyPlanOutput(packet, modelOutput);
        proposal = dailyPlanProposalSchema.parse({
          id: newId(),
          contractVersion: 'DAILY_PLAN_V1',
          runId: run.id,
          localDate: input.localDate,
          status: 'PENDING_REVIEW',
          baseScheduleVersion: packet.baseScheduleVersion,
          summary: modelOutput.summary,
          items: validatedItems.map((item) => ({ id: newId(), ...item })),
          version: 1,
          createdAt: now().toISOString(),
          updatedAt: now().toISOString(),
        });
      } catch (error) {
        const code = failureCode(error);
        dependencies.repository.failRun(input.ownerId, run.id, code);
        throw new DailyPlanGenerationError(code);
      }

      return dependencies.repository.completeWithProposal(
        input.ownerId,
        run.id,
        packet.baseScheduleVersion,
        proposal,
      );
    },
  };
}
