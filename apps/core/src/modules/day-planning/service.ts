import { calculateDailyStatus } from '@ev/domain';
import { taskSchema, type DayView } from '@ev/contracts';
import type { CalendarRepository } from '../calendar/repository';
import type { ProposalService } from '../proposals/service';
import type { TaskService } from '../tasks/service';

export interface DayPlanningService {
  getDay(ownerId: string, localDate: string): DayView;
}

export function createDayPlanningService(
  calendarRepository: CalendarRepository,
  taskService: TaskService,
  proposalService: ProposalService,
): DayPlanningService {
  return {
    getDay(ownerId, localDate) {
      const tasks = taskService.listForDate(ownerId, localDate).map((task) => taskSchema.parse(task));
      return {
        date: localDate,
        status: calculateDailyStatus({ tasks, yesterday: null }),
        events: calendarRepository.listEventsForDate(ownerId, localDate),
        tasks,
        signals: calendarRepository.listSignalsForDate(ownerId, localDate),
        pendingProposals: proposalService.listPending(ownerId),
      };
    },
  };
}
