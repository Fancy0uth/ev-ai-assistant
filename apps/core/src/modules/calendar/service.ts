import { randomUUID } from 'node:crypto';
import type { CreateEventProposalInput, CreateTermInput, Event, Proposal, Term } from '@ev/contracts';
import { ApiError } from '../../http/api-error';
import type { CalendarRepository } from './repository';
import type { ProposalService } from '../proposals/service';

interface CalendarServiceOptions {
  now?: () => Date;
  newId?: () => string;
}

export interface CalendarService {
  createTerm(ownerId: string, input: CreateTermInput): Term;
  listTerms(ownerId: string): Term[];
  createEventProposal(ownerId: string, input: CreateEventProposalInput): Proposal;
  getEvent(ownerId: string, eventId: string): Event;
}

export function createCalendarService(
  repository: CalendarRepository,
  proposalService: Pick<ProposalService, 'create'>,
  options: CalendarServiceOptions = {},
): CalendarService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;

  return {
    createTerm(ownerId, input) {
      const timestamp = now().toISOString();
      return repository.createTerm({
        id: newId(),
        ownerId,
        title: input.title,
        timezone: input.timezone,
        weekOneMonday: input.weekOneMonday,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    },

    listTerms(ownerId) {
      return repository.listTerms(ownerId);
    },

    createEventProposal(ownerId, input) {
      const eventTimestamp = now().toISOString();
      return proposalService.create(ownerId, {
        kind: 'SCHEDULE',
        source: 'DAILY_SCHEDULER',
        title: input.title,
        changes: [
          {
            operation: 'CREATE_EVENT',
            event: {
              id: newId(),
              calendarRuleId: null,
              title: input.title,
              kind: input.kind,
              localDate: input.localDate,
              startLocalTime: input.startLocalTime,
              endLocalTime: input.endLocalTime,
              isHard: input.isHard,
              status: 'CONFIRMED',
              version: 1,
              createdAt: eventTimestamp,
              updatedAt: eventTimestamp,
            },
          },
        ],
        expiresAt: null,
      });
    },

    getEvent(ownerId, eventId) {
      const event = repository.findEvent(ownerId, eventId);
      if (!event) throw new ApiError(404, 'EVENT_NOT_FOUND', '日程不存在');
      return event;
    },
  };
}
