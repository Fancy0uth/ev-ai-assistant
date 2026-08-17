import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

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

interface WindowsDpapiSecretStoreOptions {
  platform?: NodeJS.Platform;
}

function isBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function readLimited(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteLength = 0;

    stream.on('data', (chunk: Buffer) => {
      byteLength += chunk.length;
      if (byteLength <= MAX_DPAPI_OUTPUT_BYTES) {
        chunks.push(chunk);
      }
    });
    stream.once('error', reject);
    stream.once('end', () => {
      if (byteLength > MAX_DPAPI_OUTPUT_BYTES) {
        reject(new Error('output limit exceeded'));
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

async function runDpapi(script: string, inputBase64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('powershell.exe', [...POWERSHELL_ARGUMENTS, script], {
        shell: false,
        windowsHide: true,
        timeout: DPAPI_TIMEOUT_MS,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      reject(new SecretStoreUnavailableError());
      return;
    }

    const stdout = readLimited(child.stdout);
    void readLimited(child.stderr).catch(() => undefined);
    let settled = false;
    const fail = () => {
      if (!settled) {
        settled = true;
        reject(new SecretStoreUnavailableError());
      }
    };

    child.once('error', fail);
    child.once('close', (exitCode) => {
      void stdout
        .then((output) => {
          if (exitCode !== 0 || !isBase64(output)) {
            fail();
            return;
          }
          if (!settled) {
            settled = true;
            resolve(output);
          }
        })
        .catch(fail);
    });
    child.stdin.once('error', fail);
    child.stdin.end(inputBase64, 'utf8');
  });
}

export function createWindowsDpapiSecretStore(
  options: WindowsDpapiSecretStoreOptions = {},
): SecretStorePort {
  const platform = options.platform ?? process.platform;

  async function protect(plaintext: string): Promise<string> {
    if (platform !== 'win32') throw new SecretStoreUnavailableError();
    return runDpapi(PROTECT_SCRIPT, Buffer.from(plaintext, 'utf8').toString('base64'));
  }

  async function unprotect(protectedValue: string): Promise<string> {
    if (platform !== 'win32') throw new SecretStoreUnavailableError();
    const plaintextBase64 = await runDpapi(UNPROTECT_SCRIPT, protectedValue);
    return Buffer.from(plaintextBase64, 'base64').toString('utf8');
  }

  return { protect, unprotect };
}
