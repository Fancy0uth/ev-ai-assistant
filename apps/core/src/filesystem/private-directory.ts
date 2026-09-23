import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, parse, resolve } from 'node:path';
import { resolveUnlinkedExistingDirectory, samePhysicalPath } from './path-containment';

const PRIVATE_DIRECTORY_ENV_PATH = 'EV_PRIVATE_DIRECTORY_PATH';
const PRIVATE_DIRECTORY_ENV_OPERATION = 'EV_PRIVATE_DIRECTORY_OPERATION';

export const privateDirectoryErrorCodes = [
  'PRIVATE_DIRECTORY_PATH_INVALID',
  'PRIVATE_DIRECTORY_PARENT_UNSAFE',
  'PRIVATE_DIRECTORY_EXISTS',
  'PRIVATE_DIRECTORY_CREATE_FAILED',
  'PRIVATE_DIRECTORY_NOT_FOUND',
  'PRIVATE_DIRECTORY_NOT_DIRECTORY',
  'PRIVATE_DIRECTORY_LINK_ESCAPE',
  'PRIVATE_DIRECTORY_NOT_EMPTY',
  'PRIVATE_DIRECTORY_ACL_UNAVAILABLE',
  'PRIVATE_DIRECTORY_ACL_SET_REJECTED',
  'PRIVATE_DIRECTORY_ACL_ASSERT_REJECTED',
] as const;

export type PrivateDirectoryErrorCode = (typeof privateDirectoryErrorCodes)[number];

export class PrivateDirectoryError extends Error {
  readonly code: PrivateDirectoryErrorCode;

  constructor(code: PrivateDirectoryErrorCode) {
    super(code);
    this.name = 'PrivateDirectoryError';
    this.code = code;
  }
}

function fail(code: PrivateDirectoryErrorCode): never {
  throw new PrivateDirectoryError(code);
}

function normalizeAbsoluteLocalPath(absolutePath: string): string {
  if (typeof absolutePath !== 'string' || !isAbsolute(absolutePath)) {
    fail('PRIVATE_DIRECTORY_PATH_INVALID');
  }
  if (
    process.platform === 'win32'
    && (absolutePath.startsWith('\\\\') || absolutePath.startsWith('//') || !/^[A-Za-z]:[\\/]/.test(absolutePath))
  ) {
    fail('PRIVATE_DIRECTORY_PATH_INVALID');
  }

  const normalized = resolve(absolutePath);
  if (samePhysicalPath(normalized, parse(normalized).root)) {
    fail('PRIVATE_DIRECTORY_PATH_INVALID');
  }
  return normalized;
}

function assertExistingUnlinkedDirectory(path: string): void {
  try {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) fail('PRIVATE_DIRECTORY_LINK_ESCAPE');
    if (!entry.isDirectory() || !statSync(path).isDirectory()) {
      fail('PRIVATE_DIRECTORY_NOT_DIRECTORY');
    }
    const physicalPath = resolveUnlinkedExistingDirectory(path);
    if (!samePhysicalPath(physicalPath, path)) {
      fail('PRIVATE_DIRECTORY_LINK_ESCAPE');
    }
  } catch (error) {
    if (error instanceof PrivateDirectoryError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail('PRIVATE_DIRECTORY_NOT_FOUND');
    }
    fail('PRIVATE_DIRECTORY_LINK_ESCAPE');
  }
}

function assertSafeParent(path: string): void {
  try {
    assertExistingUnlinkedDirectory(dirname(path));
  } catch {
    fail('PRIVATE_DIRECTORY_PARENT_UNSAFE');
  }
}

const privateDaclScript = String.raw`
$ErrorActionPreference = 'Stop'
$target = [Environment]::GetEnvironmentVariable('${PRIVATE_DIRECTORY_ENV_PATH}', 'Process')
$operation = [Environment]::GetEnvironmentVariable('${PRIVATE_DIRECTORY_ENV_OPERATION}', 'Process')
if ([string]::IsNullOrWhiteSpace($target) -or -not [System.IO.Directory]::Exists($target)) { exit 40 }
if ($operation -ne 'set' -and $operation -ne 'assert') { exit 41 }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
if ($null -eq $identity -or $null -eq $identity.User) { exit 42 }
$sid = $identity.User
$fullControl = [System.Security.AccessControl.FileSystemRights]::FullControl
$inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
$directory = [System.IO.DirectoryInfo]::new($target)

if ($operation -eq 'set') {
  $acl = $directory.GetAccessControl()
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($accessRule in @($acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))) {
    [void] $acl.RemoveAccessRuleSpecific($accessRule)
  }
  $newRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $sid,
    $fullControl,
    $inheritance,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  [void] $acl.AddAccessRule($newRule)
  $directory.SetAccessControl($acl)
}

$actual = $directory.GetAccessControl()
if (-not $actual.AreAccessRulesProtected) { exit 50 }
$owner = $actual.GetOwner([System.Security.Principal.SecurityIdentifier])
if ($null -eq $owner -or $owner.Value -ne $sid.Value) { exit 51 }
$rules = @($actual.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))
if ($rules.Count -ne 1) { exit 52 }
$rule = $rules[0]
if ($rule.IdentityReference.Value -ne $sid.Value) { exit 53 }
if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { exit 54 }
if ((([int] $rule.FileSystemRights -band ([int] $fullControl)) -ne ([int] $fullControl))) { exit 55 }
if ((([int] $rule.InheritanceFlags -band ([int] $inheritance)) -ne ([int] $inheritance))) { exit 56 }
exit 0
`;

function runPrivateDaclOperation(path: string, operation: 'set' | 'assert'): void {
  if (process.platform !== 'win32') {
    fail('PRIVATE_DIRECTORY_ACL_UNAVAILABLE');
  }

  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', privateDaclScript],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        [PRIVATE_DIRECTORY_ENV_PATH]: path,
        [PRIVATE_DIRECTORY_ENV_OPERATION]: operation,
      },
      maxBuffer: 1024,
      timeout: 10_000,
      windowsHide: true,
    },
  );

  const spawnErrorCode = result.error
    && 'code' in result.error
    && typeof result.error.code === 'string'
    ? result.error.code
    : undefined;
  if (spawnErrorCode === 'ENOENT') {
    fail('PRIVATE_DIRECTORY_ACL_UNAVAILABLE');
  }
  if (result.error || result.signal || result.status !== 0) {
    fail(operation === 'set'
      ? 'PRIVATE_DIRECTORY_ACL_SET_REJECTED'
      : 'PRIVATE_DIRECTORY_ACL_ASSERT_REJECTED');
  }
}

/**
 * Exclusively creates one new directory and gives its current Windows user a
 * protected DACL before callers place sensitive data inside it.
 */
export function createPrivateDirectory(absolutePath: string): void {
  const path = normalizeAbsoluteLocalPath(absolutePath);
  assertSafeParent(path);
  if (existsSync(path)) fail('PRIVATE_DIRECTORY_EXISTS');

  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      fail('PRIVATE_DIRECTORY_EXISTS');
    }
    fail('PRIVATE_DIRECTORY_CREATE_FAILED');
  }

  assertExistingUnlinkedDirectory(path);
  if (readdirSync(path).length !== 0) {
    fail('PRIVATE_DIRECTORY_NOT_EMPTY');
  }
  runPrivateDaclOperation(path, 'set');
  assertExistingUnlinkedDirectory(path);
}

/**
 * Verifies a directory without changing its ACL or any other existing state.
 */
export function assertPrivateDirectory(absolutePath: string): void {
  const path = normalizeAbsoluteLocalPath(absolutePath);
  assertExistingUnlinkedDirectory(path);
  runPrivateDaclOperation(path, 'assert');
}
