import { randomUUID } from 'node:crypto';
import type { CheckInInput, Signal } from '@ev/contracts';
import { calculateRecovery } from '@ev/domain';
import type { CalendarRepository } from '../calendar/repository';

export interface FitnessService {
  checkIn(
    ownerId: string,
    input: CheckInInput,
  ): { signal: Signal; assessment: ReturnType<typeof calculateRecovery> };
}

export function createFitnessService(
  calendarRepository: CalendarRepository,
  options: { now?: () => Date; newId?: () => string } = {},
): FitnessService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  return {
    checkIn(ownerId, input) {
      const assessment = calculateRecovery(input);
      const timestamp = now().toISOString();
      const signal = calendarRepository.createSignal({
        id: newId(),
        ownerId,
        localDate: input.localDate,
        kind: 'RECOVERY',
        value: assessment.score,
        source: 'CHECK_IN',
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return { signal, assessment };
    },
  };
}
