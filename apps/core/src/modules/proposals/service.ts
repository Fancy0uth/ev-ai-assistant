import { randomUUID } from 'node:crypto';
import {
  proposalVersionConflictDetailsSchema,
  type CreateProposalInput,
  type Proposal,
  type ProposalDecisionInput,
} from '@ev/contracts';
import { expandCalendarRule } from '@ev/domain';
import { ApiError } from '../../http/api-error';
import type { CalendarRepository, NewCalendarRule, NewEvent } from '../calendar/repository';
import type { ProposalRepository } from './repository';

interface ProposalServiceOptions {
  now?: () => Date;
  newId?: () => string;
}

export interface ProposalService {
  create(ownerId: string, input: CreateProposalInput): Proposal;
  listPending(ownerId: string): Proposal[];
  findById(ownerId: string, proposalId: string): Proposal;
  decide(ownerId: string, proposalId: string, input: ProposalDecisionInput): Proposal;
}

function versionConflict(currentProposal?: Proposal): ApiError {
  const details = currentProposal
    ? proposalVersionConflictDetailsSchema.parse({ currentProposal })
    : undefined;
  return new ApiError(409, 'VERSION_CONFLICT', '数据已变化，请确认最新内容后重试', details);
}

export function createProposalService(
  proposalRepository: ProposalRepository,
  calendarRepository: CalendarRepository,
  options: ProposalServiceOptions = {},
): ProposalService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;

  function findById(ownerId: string, proposalId: string): Proposal {
    const proposal = proposalRepository.findById(ownerId, proposalId);
    if (!proposal) throw new ApiError(404, 'PROPOSAL_NOT_FOUND', '提案不存在');
    return proposal;
  }

  function applyAcceptedScheduleChanges(ownerId: string, proposal: Proposal): void {
    if (proposal.kind !== 'SCHEDULE') {
      throw new ApiError(422, 'PROPOSAL_CANNOT_APPLY', '当前 MVP 只支持确认日程提案');
    }

    for (const change of proposal.changes) {
      if (change.operation === 'CREATE_CALENDAR_RULE') {
        const term = calendarRepository.findTerm(ownerId, change.rule.termId);
        if (!term) {
          throw new ApiError(422, 'PROPOSAL_CANNOT_APPLY', '提案引用的学期不存在或不可访问');
        }
        const rule: NewCalendarRule = { ...change.rule, ownerId };
        calendarRepository.createRule(rule);
        const occurrences = expandCalendarRule({
          ruleId: rule.id,
          termWeekOneMonday: term.weekOneMonday,
          weekday: rule.weekday,
          startLocalTime: rule.startLocalTime,
          endLocalTime: rule.endLocalTime,
          weekStart: rule.weekStart,
          weekEnd: rule.weekEnd,
          weekPattern: rule.weekPattern,
        });
        for (const occurrence of occurrences) {
          const event: NewEvent = {
            id: newId(),
            ownerId,
            calendarRuleId: rule.id,
            title: rule.title,
            kind: 'COURSE',
            localDate: occurrence.localDate,
            startLocalTime: occurrence.startLocalTime,
            endLocalTime: occurrence.endLocalTime,
            isHard: rule.isHard,
            status: 'CONFIRMED',
            version: 1,
            createdAt: now().toISOString(),
            updatedAt: now().toISOString(),
          };
          calendarRepository.createEvent(event);
        }
      } else if (change.operation === 'CREATE_EVENT') {
        const event: NewEvent = { ...change.event, ownerId };
        calendarRepository.createEvent(event);
      }
    }
  }

  return {
    create(ownerId, input) {
      return proposalRepository.create({
        id: newId(),
        ownerId,
        kind: input.kind,
        status: 'PENDING',
        source: input.source,
        title: input.title,
        changes: input.changes,
        version: 1,
        createdAt: now().toISOString(),
        expiresAt: input.expiresAt ?? null,
      });
    },

    listPending(ownerId) {
      return proposalRepository.listPending(ownerId);
    },

    findById,

    decide(ownerId, proposalId, input) {
      const current = findById(ownerId, proposalId);
      if (current.status !== 'PENDING' || current.version !== input.version) {
        throw versionConflict(current);
      }
      const decided = proposalRepository.decide(
        ownerId,
        proposalId,
        input,
        now().toISOString(),
        (proposal) => applyAcceptedScheduleChanges(ownerId, proposal),
      );
      if (decided) return decided;
      throw versionConflict(proposalRepository.findById(ownerId, proposalId));
    },
  };
}
