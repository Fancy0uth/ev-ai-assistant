import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

function ensureContained(root: string, storageKey: string): string {
  if (!storageKey || storageKey.includes('\\') || storageKey.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('artifact storage key is invalid');
  }
  const destination = resolve(root, storageKey);
  const relativePath = relative(root, destination);
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`) || relativePath.includes(`..${sep}`)) {
    throw new Error('artifact path escapes configured root');
  }
  return destination;
}

export interface ArtifactStore {
  write(ownerId: string, bytes: Uint8Array): Promise<{ storageKey: string }>;
  remove(storageKey: string): Promise<void>;
  resolveVerified(storageKey: string): string;
}

export function createArtifactStore(root: string): ArtifactStore {
  const resolvedRoot = resolve(root);
  return {
    async write(ownerId, bytes) {
      const storageKey = `${ownerId}/${randomUUID()}`;
      const destination = ensureContained(resolvedRoot, storageKey);
      const partial = `${destination}.partial`;
      await mkdir(dirname(destination), { recursive: true });
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(partial, 'wx');
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(partial, destination);
        return { storageKey };
      } catch (error) {
        await handle?.close().catch(() => undefined);
        await rm(partial, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    async remove(storageKey) {
      try {
        await unlink(ensureContained(resolvedRoot, storageKey));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
    },
    resolveVerified(storageKey) {
      return ensureContained(resolvedRoot, storageKey);
    },
  };
}
