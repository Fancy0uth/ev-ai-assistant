import { realpathSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ALLOWED_FILES = new Set(['PRD.md', 'TECH_SPEC.md', 'ARCHITECTURE.md', 'TASKS.md']);
const MAX_FILE_BYTES = 256_000;

export interface ProjectSnapshotFile {
  relativePath: string;
  content: string;
}

export interface ProjectSnapshot {
  root: string;
  files: ProjectSnapshotFile[];
}

export function createProjectSnapshot(root: string): ProjectSnapshot {
  const realRoot = realpathSync(resolve(root));
  const files: ProjectSnapshotFile[] = [];
  for (const entry of readdirSync(realRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !ALLOWED_FILES.has(entry.name)) continue;
    const candidate = join(realRoot, entry.name);
    const realCandidate = realpathSync(candidate);
    const relativePath = relative(realRoot, realCandidate);
    if (relativePath.startsWith(`..${sep}`) || relativePath === '..' || resolve(realCandidate) === realRoot) {
      continue;
    }
    const stat = statSync(realCandidate);
    if (stat.size > MAX_FILE_BYTES) continue;
    files.push({ relativePath, content: readFileSync(realCandidate, 'utf8') });
  }
  return { root: realRoot, files: files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)) };
}
