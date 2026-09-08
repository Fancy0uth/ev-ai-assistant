import {
  taskSchema,
  type NormalizedTask,
  type Task,
  type TaskArea,
  type TaskListQuery,
  type TaskPriority,
  type TaskSchedulingInput,
  type TaskStatus,
} from '@ev/contracts';
import type Database from 'better-sqlite3';

interface TaskRow {
  id: string;
  title: string;
  area: TaskArea;
  priority: TaskPriority;
  status: TaskStatus;
  target_date: string | null;
  completed_at: string | null;
  scheduling_duration_minutes: number | null;
  scheduling_earliest_start_local_time: string | null;
  scheduling_latest_end_local_time: string | null;
  scheduling_is_fixed: number | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface NewTask extends Task {
  ownerId: string;
}

export interface TaskUpdate {
  title: string;
  area: TaskArea;
  priority: TaskPriority;
  status: TaskStatus;
  targetDate: string | null;
  completedAt: string | null;
  scheduling?: TaskSchedulingInput | null;
  updatedAt: string;
  expectedVersion: number;
}

interface TaskPage<TTask extends Task> {
  items: TTask[];
  total: number;
}

export interface TaskRepository<TTask extends Task = Task> {
  create(task: NewTask): TTask;
  findById(ownerId: string, id: string): TTask | undefined;
  list(ownerId: string, query: TaskListQuery): TaskPage<TTask>;
  listForDate(ownerId: string, targetDate: string): TTask[];
  update(ownerId: string, id: string, update: TaskUpdate): TTask | undefined;
}

function toTask(row: TaskRow): NormalizedTask {
  const hasDuration = row.scheduling_duration_minutes !== null;
  const hasFixed = row.scheduling_is_fixed !== null;
  const hasWindow =
    row.scheduling_earliest_start_local_time !== null ||
    row.scheduling_latest_end_local_time !== null;
  if (hasDuration !== hasFixed || (!hasDuration && hasWindow)) {
    throw new Error('TASK_SCHEDULING_INCONSISTENT_STORAGE');
  }

  const scheduling = hasDuration
    ? {
        durationMinutes: row.scheduling_duration_minutes!,
        earliestStartLocalTime: row.scheduling_earliest_start_local_time,
        latestEndLocalTime: row.scheduling_latest_end_local_time,
        isFixed: row.scheduling_is_fixed === 1,
      }
    : null;

  return taskSchema.parse({
    id: row.id,
    title: row.title,
    area: row.area,
    priority: row.priority,
    status: row.status,
    targetDate: row.target_date,
    completedAt: row.completed_at,
    scheduling,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const taskColumns = `
  id,
  title,
  area,
  priority,
  status,
  target_date,
  completed_at,
  scheduling_duration_minutes,
  scheduling_earliest_start_local_time,
  scheduling_latest_end_local_time,
  scheduling_is_fixed,
  version,
  created_at,
  updated_at
`;

function taskListPredicate(ownerId: string, query: TaskListQuery): {
  where: string;
  bindings: unknown[];
} {
  const conditions = ['owner_id = ?'];
  const bindings: unknown[] = [ownerId];

  if (query.area !== undefined) {
    conditions.push('area = ?');
    bindings.push(query.area);
  }
  if (query.status !== undefined) {
    conditions.push('status = ?');
    bindings.push(query.status);
  }
  if (query.targetDate !== undefined) {
    conditions.push('target_date = ?');
    bindings.push(query.targetDate);
  } else if (query.dateScope === 'FUTURE') {
    conditions.push('target_date > ?');
    bindings.push(query.referenceDate);
  } else if (query.dateScope === 'UNDATED') {
    conditions.push('target_date is null');
  }

  return { where: conditions.join(' and '), bindings };
}

export function createTaskRepository(database: Database.Database): TaskRepository<NormalizedTask> {
  const findByIdStatement = database.prepare(
    `select ${taskColumns}
     from tasks
     where id = ? and owner_id = ?`,
  );

  const findById = (ownerId: string, id: string): NormalizedTask | undefined => {
    const row = findByIdStatement.get(id, ownerId) as TaskRow | undefined;
    return row ? toTask(row) : undefined;
  };

  return {
    create(task) {
      const scheduling = task.scheduling ?? null;
      database
        .prepare(
          `insert into tasks (
             id, owner_id, title, area, priority, status, target_date,
             completed_at, scheduling_duration_minutes, scheduling_earliest_start_local_time,
             scheduling_latest_end_local_time, scheduling_is_fixed, version, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          task.id,
          task.ownerId,
          task.title,
          task.area,
          task.priority,
          task.status,
          task.targetDate,
          task.completedAt,
          scheduling?.durationMinutes ?? null,
          scheduling?.earliestStartLocalTime ?? null,
          scheduling?.latestEndLocalTime ?? null,
          scheduling === null ? null : scheduling.isFixed ? 1 : 0,
          task.version,
          task.createdAt,
          task.updatedAt,
        );
      return toTask({
        id: task.id,
        title: task.title,
        area: task.area,
        priority: task.priority,
        status: task.status,
        target_date: task.targetDate,
        completed_at: task.completedAt,
        scheduling_duration_minutes: scheduling?.durationMinutes ?? null,
        scheduling_earliest_start_local_time: scheduling?.earliestStartLocalTime ?? null,
        scheduling_latest_end_local_time: scheduling?.latestEndLocalTime ?? null,
        scheduling_is_fixed: scheduling === null ? null : scheduling.isFixed ? 1 : 0,
        version: task.version,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
      });
    },

    findById,

    list(ownerId, query) {
      const offset = (query.page - 1) * query.pageSize;
      const { where, bindings } = taskListPredicate(ownerId, query);
      const rows = database
        .prepare(
          `select ${taskColumns}
           from tasks
           where ${where}
           order by
             case status
               when 'IN_PROGRESS' then 0
               when 'OPEN' then 1
               when 'DEFERRED' then 2
               when 'DONE' then 3
               else 4
             end,
             case priority
               when 'HIGH' then 0
               when 'MEDIUM' then 1
               else 2
             end,
             created_at asc,
             id asc
           limit ? offset ?`,
        )
        .all(...bindings, query.pageSize, offset) as TaskRow[];
      const total = database
        .prepare(`select count(*) as total from tasks where ${where}`)
        .get(...bindings) as { total: number };
      return { items: rows.map(toTask), total: total.total };
    },

    listForDate(ownerId, targetDate) {
      const rows = database
        .prepare(
          `select ${taskColumns}
           from tasks
           where owner_id = ? and target_date = ?
           order by
             case status
               when 'IN_PROGRESS' then 0
               when 'OPEN' then 1
               when 'DEFERRED' then 2
               when 'DONE' then 3
               else 4
             end,
             case priority
               when 'HIGH' then 0
               when 'MEDIUM' then 1
               else 2
             end,
             created_at asc,
             id asc`,
        )
        .all(ownerId, targetDate) as TaskRow[];
      return rows.map(toTask);
    },

    update(ownerId, id, update) {
      const scheduling = update.scheduling ?? null;
      const result = database
        .prepare(
          `update tasks
           set title = ?,
               area = ?,
               priority = ?,
               status = ?,
               target_date = ?,
               completed_at = ?,
               scheduling_duration_minutes = ?,
               scheduling_earliest_start_local_time = ?,
               scheduling_latest_end_local_time = ?,
               scheduling_is_fixed = ?,
               version = version + 1,
               updated_at = ?
           where id = ? and owner_id = ? and version = ?`,
        )
        .run(
          update.title,
          update.area,
          update.priority,
          update.status,
          update.targetDate,
          update.completedAt,
          scheduling?.durationMinutes ?? null,
          scheduling?.earliestStartLocalTime ?? null,
          scheduling?.latestEndLocalTime ?? null,
          scheduling === null ? null : scheduling.isFixed ? 1 : 0,
          update.updatedAt,
          id,
          ownerId,
          update.expectedVersion,
        );
      return result.changes === 1 ? findById(ownerId, id) : undefined;
    },
  };
}
