import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import * as nativePath from 'node:path';

type PathImplementation = Pick<typeof nativePath, 'basename' | 'dirname' | 'isAbsolute' | 'join' | 'relative' | 'resolve' | 'sep'>;

function pathImplementation(root: string, candidate: string): PathImplementation | null {
  const rootIsWindows = nativePath.win32.isAbsolute(root);
  const candidateIsWindows = nativePath.win32.isAbsolute(candidate);
  if (rootIsWindows !== candidateIsWindows) return null;
  return rootIsWindows ? nativePath.win32 : nativePath;
}

function resolveWithExistingRealPath(path: string, implementation: PathImplementation): string | null {
  const absolute = implementation.resolve(path);
  const missingSegments: string[] = [];
  let existing = absolute;

  while (!existsSync(existing)) {
    const parent = implementation.dirname(existing);
    if (parent === existing) return null;
    missingSegments.unshift(implementation.basename(existing));
    existing = parent;
  }

  let realExisting: string;
  try {
    realExisting = realpathSync.native(existing);
  } catch {
    return null;
  }
  return missingSegments.length === 0
    ? implementation.resolve(realExisting)
    : implementation.resolve(realExisting, ...missingSegments);
}

export function normalizePhysicalPath(path: string): string {
  const normalized = nativePath.resolve(path);
  return process.platform === 'win32'
    ? normalized.replace(/^\\\\\?\\/, '').replaceAll('/', '\\').toLowerCase()
    : normalized;
}

export function samePhysicalPath(left: string, right: string): boolean {
  return normalizePhysicalPath(left) === normalizePhysicalPath(right);
}

export function resolveUnlinkedExistingDirectory(path: string): string {
  const absolutePath = nativePath.resolve(path);
  const root = nativePath.parse(absolutePath).root;
  const segments = nativePath.relative(root, absolutePath).split(nativePath.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = nativePath.join(current, segment);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error('linked directory segment');
    }
  }
  const entry = lstatSync(absolutePath);
  if (entry.isSymbolicLink() || !entry.isDirectory() || !statSync(absolutePath).isDirectory()) {
    throw new Error('not an existing directory');
  }
  const physicalPath = realpathSync.native(absolutePath);
  if (!samePhysicalPath(physicalPath, absolutePath)) {
    throw new Error('directory physical path changed');
  }
  return physicalPath;
}

export function isPathInsideRoot(root: string, candidate: string): boolean {
  const implementation = pathImplementation(root, candidate);
  if (!implementation) return false;
  const realRoot = resolveWithExistingRealPath(root, implementation);
  const realCandidate = resolveWithExistingRealPath(candidate, implementation);
  if (!realRoot || !realCandidate) return false;
  const remainder = implementation.relative(realRoot, realCandidate);
  return !implementation.isAbsolute(remainder)
    && remainder !== '..'
    && !remainder.startsWith(`..${implementation.sep}`);
}
