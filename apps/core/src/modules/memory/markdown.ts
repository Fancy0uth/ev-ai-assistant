import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const entityScopeTypes = new Set(['PROJECT', 'COURSE', 'FITNESS', 'NUTRITION', 'DAILY']);

function entityProjectionDirectory(root: string, ownerId: string, scopeType: string, scopeId: string): string {
  if (!entityScopeTypes.has(scopeType)) throw new RangeError('unsupported entity memory scope type');
  const ownerSegment = createHash('sha256').update(ownerId).digest('hex');
  const scopeSegment = createHash('sha256').update(scopeId).digest('hex');
  return join(root, 'entities', ownerSegment, scopeType, scopeSegment);
}

export function writeMemoryProjection(root: string, scope: string, content: string): void {
  const directory = join(root, scope);
  mkdirSync(directory, { recursive: true });
  const target = join(directory, 'MEMORY.md');
  const temporary = join(directory, `.MEMORY.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, `# ${scope} Memory\n\n${content}\n`, 'utf8');
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

export function deleteMemoryProjection(root: string, scope: string): void {
  const target = join(root, scope, 'MEMORY.md');
  if (existsSync(target)) rmSync(target);
}

export function writeEntityMemoryProjection(
  root: string,
  ownerId: string,
  scopeType: string,
  scopeId: string,
  content: string,
): void {
  const directory = entityProjectionDirectory(root, ownerId, scopeType, scopeId);
  mkdirSync(directory, { recursive: true });
  const target = join(directory, 'MEMORY.md');
  const temporary = join(directory, `.MEMORY.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temporary, `# ${scopeType} Memory\n\n${content}\n`, 'utf8');
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

export function deleteEntityMemoryProjection(
  root: string,
  ownerId: string,
  scopeType: string,
  scopeId: string,
): void {
  const target = join(entityProjectionDirectory(root, ownerId, scopeType, scopeId), 'MEMORY.md');
  if (existsSync(target)) rmSync(target);
}
