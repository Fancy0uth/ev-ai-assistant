import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeMemoryProjection(root: string, scope: string, content: string): void {
  const directory = join(root, scope);
  mkdirSync(directory, { recursive: true });
  const target = join(directory, 'MEMORY.md');
  const temporary = join(directory, `.MEMORY.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temporary, `# ${scope} Memory\n\n${content}\n`, 'utf8');
  renameSync(temporary, target);
}
