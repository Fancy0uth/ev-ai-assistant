import { randomUUID } from 'node:crypto';
import type { CreateTermInput, Term } from '@ev/contracts';
import type { CalendarRepository } from './repository';

interface CalendarServiceOptions {
  now?: () => Date;
  newId?: () => string;
}

export interface CalendarService {
  createTerm(ownerId: string, input: CreateTermInput): Term;
  listTerms(ownerId: string): Term[];
}

export function createCalendarService(
  repository: CalendarRepository,
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
  };
}
