import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import type { CreateProjectScopeInput, ProjectScope } from '@ev/contracts';
import type Database from 'better-sqlite3';
import { ApiError } from '../../http/api-error';
import { createProjectSnapshot, type ProjectSnapshot } from './snapshot';

interface ProjectScopeRow {
  id: string;
  label: string;
  root_path: string;
  created_at: string;
  updated_at: string;
}

function toScope(row: ProjectScopeRow): ProjectScope {
  return { id: row.id, label: row.label, rootPath: row.root_path, createdAt: row.created_at, updatedAt: row.updated_at };
}

function verifyProjectRoot(rootPath: string): string {
  try {
    const realRoot = realpathSync(rootPath);
    if (!statSync(realRoot).isDirectory()) throw new Error('not a directory');
    return realRoot;
  } catch {
    throw new ApiError(422, 'PROJECT_ROOT_INVALID', '项目目录不存在或不可读取');
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export function createProjectScopeService(database: Database.Database, options: { now?: () => Date; newId?: () => string } = {}) {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const columns = 'id, label, root_path, created_at, updated_at';
  const find = (ownerId: string, id: string): ProjectScope | undefined => {
    const row = database.prepare(`select ${columns} from project_scopes where id = ? and owner_id = ?`).get(id, ownerId) as ProjectScopeRow | undefined;
    return row ? toScope(row) : undefined;
  };
  return {
    create(ownerId: string, input: CreateProjectScopeInput): ProjectScope {
      const rootPath = verifyProjectRoot(input.rootPath);
      const timestamp = now().toISOString();
      const scope = { id: newId(), label: input.label, rootPath, createdAt: timestamp, updatedAt: timestamp };
      try {
        database.prepare('insert into project_scopes (id, owner_id, label, root_path, created_at, updated_at) values (?, ?, ?, ?, ?, ?)').run(scope.id, ownerId, scope.label, scope.rootPath, scope.createdAt, scope.updatedAt);
      } catch (error) {
        if (isUniqueConstraint(error)) {
          throw new ApiError(409, 'PROJECT_SCOPE_EXISTS', '该本地项目目录已经登记');
        }
        throw error;
      }
      return scope;
    },
    list(ownerId: string): ProjectScope[] {
      return (database.prepare(`select ${columns} from project_scopes where owner_id = ? order by created_at asc, id asc`).all(ownerId) as ProjectScopeRow[]).map(toScope);
    },
    snapshot(ownerId: string, id: string): { scope: ProjectScope; snapshot: ProjectSnapshot } {
      const scope = find(ownerId, id);
      if (!scope) throw new ApiError(404, 'PROJECT_SCOPE_NOT_FOUND', '项目范围不存在');
      try {
        return { scope, snapshot: createProjectSnapshot(scope.rootPath) };
      } catch {
        throw new ApiError(422, 'PROJECT_ROOT_UNAVAILABLE', '项目范围当前不可读取');
      }
    },
  };
}
