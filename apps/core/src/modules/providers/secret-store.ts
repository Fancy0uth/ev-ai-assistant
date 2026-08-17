import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

const DPAPI_TIMEOUT_MS = 5_000;
const MAX_DPAPI_OUTPUT_BYTES = 16 * 1024;
const POWERSHELL_ARGUMENTS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'] as const;
const PROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputBase64 = [Console]::In.ReadToEnd()
$plaintext = [Convert]::FromBase64String($inputBase64)
$protected = [System.Security.Cryptography.ProtectedData]::Protect(
  $plaintext,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;
const UNPROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputBase64 = [Console]::In.ReadToEnd()
$protected = [Convert]::FromBase64String($inputBase64)
$plaintext = [System.Security.Cryptography.ProtectedData]::Unprotect(
  $protected,
  $null,
  [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($plaintext))
`;

export interface SecretStorePort {
  protect(plaintext: string): Promise<string>;
  unprotect(protectedValue: string): Promise<string>;
}

export class SecretStoreUnavailableError extends Error {
  readonly code = 'SECRET_STORE_UNAVAILABLE';

  constructor() {
    super('Secret storage is unavailable');
    this.name = 'SecretStoreUnavailableError';
  }
}

interface DpapiChild {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(event: 'close', listener: (exitCode: number | null) => void): unknown;
  kill?: () => boolean;
}

interface DpapiSpawnOptions {
  shell: false;
  windowsHide: true;
  stdio: ['pipe', 'pipe', 'pipe'];
}

type DpapiSpawn = (
  command: string,
  arguments_: readonly string[],
  options: DpapiSpawnOptions,
) => DpapiChild;

interface WindowsDpapiSecretStoreOptions {
  platform?: NodeJS.Platform;
  spawn?: DpapiSpawn;
}

function isBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function spawnPowerShell(
  command: string,
  arguments_: readonly string[],
  options: DpapiSpawnOptions,
): DpapiChild {
  const child = spawn(command, arguments_, options);
  if (!child.stdin || !child.stdout || !child.stderr) {
    child.kill();
    throw new Error('PowerShell stdio is unavailable');
  }
  return child as DpapiChild;
}

function runDpapi(script: string, inputBase64: string, spawnProcess: DpapiSpawn): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: DpapiChild | undefined;
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      try {
        child?.stdin.destroy();
      } catch {
        // Best-effort cleanup must not reveal process or secret details.
      }
      try {
        child?.kill?.();
      } catch {
        // Best-effort cleanup must not reveal process or secret details.
      }
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new SecretStoreUnavailableError());
    };
    const succeed = (output: string) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(output);
    };

    try {
      child = spawnProcess('powershell.exe', [...POWERSHELL_ARGUMENTS, script], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      fail();
      return;
    }

    let stdout = '';
    let stdoutEnded = false;
    let exitedSuccessfully = false;
    const finishIfValid = () => {
      if (!exitedSuccessfully || !stdoutEnded) return;
      if (!isBase64(stdout)) {
        fail();
        return;
      }
      succeed(stdout);
    };
    const monitor = (stream: Readable, captureStdout: boolean) => {
      let byteLength = 0;
      stream.on('data', (chunk: Buffer | string) => {
        byteLength += Buffer.byteLength(chunk);
        if (byteLength > MAX_DPAPI_OUTPUT_BYTES) {
          fail();
          return;
        }
        if (captureStdout) stdout += chunk.toString();
      });
      stream.once('error', fail);
      stream.once('end', () => {
        if (captureStdout) {
          stdoutEnded = true;
          finishIfValid();
        }
      });
    };

    monitor(child.stdout, true);
    monitor(child.stderr, false);
    child.once('error', fail);
    child.once('close', (exitCode) => {
      if (exitCode !== 0) {
        fail();
        return;
      }
      exitedSuccessfully = true;
      finishIfValid();
    });
    child.stdin.once('error', fail);
    timeout = setTimeout(fail, DPAPI_TIMEOUT_MS);
    try {
      child.stdin.end(inputBase64, 'utf8');
    } catch {
      fail();
    }
  });
}

export function createWindowsDpapiSecretStore(
  options: WindowsDpapiSecretStoreOptions = {},
): SecretStorePort {
  const platform = options.platform ?? process.platform;
  const spawnProcess = options.spawn ?? spawnPowerShell;

  async function protect(plaintext: string): Promise<string> {
    if (platform !== 'win32') throw new SecretStoreUnavailableError();
    return runDpapi(
      PROTECT_SCRIPT,
      Buffer.from(plaintext, 'utf8').toString('base64'),
      spawnProcess,
    );
  }

  async function unprotect(protectedValue: string): Promise<string> {
    if (platform !== 'win32') throw new SecretStoreUnavailableError();
    if (!isBase64(protectedValue)) throw new SecretStoreUnavailableError();
    const plaintextBase64 = await runDpapi(UNPROTECT_SCRIPT, protectedValue, spawnProcess);
    return Buffer.from(plaintextBase64, 'base64').toString('utf8');
  }

  return { protect, unprotect };
}
