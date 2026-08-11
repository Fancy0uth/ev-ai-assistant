import type { Task, TaskArea, TaskListQuery, TaskPriority, TaskStatus } from '@ev/contracts';
import type Database from 'better-sqlite3';

interface TaskRow {
  id: string;
  title: string;
  area: TaskArea;
  priority: TaskPriority;
  status: TaskStatus;
  target_date: string | null;
  completed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface NewTask extends Task {
  ownerId: string;
}

interface TaskUpdate {
  title: string;
  area: TaskArea;
  priority: TaskPriority;
  status: TaskStatus;
  targetDate: string | null;
  completedAt: string | null;
  updatedAt: string;
  expectedVersion: number;
}

interface TaskPage {
  items: Task[];
  total: number;
}

export interface TaskRepository {
  create(task: NewTask): Task;
  findById(ownerId: string, id: string): Task | undefined;
  list(ownerId: string, query: TaskListQuery): TaskPage;
  listForDate(ownerId: string, targetDate: string): Task[];
  update(ownerId: string, id: string, update: TaskUpdate): Task | undefined;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    area: row.area,
    priority: row.priority,
    status: row.status,
    targetDate: row.target_date,
    completedAt: row.completed_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const taskColumns = `
  id,
  title,
  area,
  priority,
  status,
  target_date,
  completed_at,
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

export function createTaskRepository(database: Database.Database): TaskRepository {
  const findByIdStatement = database.prepare(
    `select ${taskColumns}
     from tasks
     where id = ? and owner_id = ?`,
  );

  const findById = (ownerId: string, id: string): Task | undefined => {
    const row = findByIdStatement.get(id, ownerId) as TaskRow | undefined;
    return row ? toTask(row) : undefined;
  };

  return {
    create(task) {
      database
        .prepare(
          `insert into tasks (
             id, owner_id, title, area, priority, status, target_date,
             completed_at, version, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      const result = database
        .prepare(
          `update tasks
           set title = ?,
               area = ?,
               priority = ?,
               status = ?,
               target_date = ?,
               completed_at = ?,
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
          update.updatedAt,
          id,
          ownerId,
          update.expectedVersion,
        );
      return result.changes === 1 ? findById(ownerId, id) : undefined;
    },
  };
}
