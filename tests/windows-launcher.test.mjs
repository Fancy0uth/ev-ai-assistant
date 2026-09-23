import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const worktreeRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const windowsScripts = join(worktreeRoot, 'scripts', 'windows');

function toPowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function findPowerShell() {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    const result = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }
  throw new Error('PowerShell is required to run the Windows launcher contract test.');
}

const powerShell = findPowerShell();

function runPowerShellFile(scriptPath, args) {
  const result = spawnSync(
    powerShell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    },
  );

  return {
    ...result,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function runPowerShellCommand(command) {
  const result = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  return {
    ...result,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function assertSucceeded(result, label) {
  assert.equal(result.error, undefined, `${label} failed to start: ${result.error?.message ?? ''}`);
  assert.equal(result.status, 0, `${label} failed:\n${result.output}`);
}

function launcherArgs({
  repoRoot,
  dataDir,
  logDir,
  adapterPath,
  webOrigin = 'https://dashboard.example.test',
  extra = [],
}) {
  return [
    '-RepoRoot', repoRoot,
    '-DataDir', dataDir,
    '-LogDir', logDir,
    '-WebOrigin', webOrigin,
    '-CorePort', '4327',
    '-WebPort', '3217',
    '-ReadyTimeoutSeconds', '1',
    '-MonitorIntervalMilliseconds', '100',
    '-TestAdapterPath', adapterPath,
    ...extra,
  ];
}

async function writeSyntheticRepository(repoRoot) {
  await Promise.all([
    mkdir(join(repoRoot, 'apps', 'core', 'src'), { recursive: true }),
    mkdir(join(repoRoot, 'apps', 'web', '.next'), { recursive: true }),
    mkdir(join(repoRoot, 'node_modules', 'tsx', 'dist'), { recursive: true }),
    mkdir(join(repoRoot, 'node_modules', 'next', 'dist', 'bin'), { recursive: true }),
  ]);

  await Promise.all([
    writeFile(join(repoRoot, 'apps', 'core', 'package.json'), '{"scripts":{"start":"tsx src/server.ts"}}\n'),
    writeFile(join(repoRoot, 'apps', 'core', 'src', 'server.ts'), 'export {};\n'),
    writeFile(join(repoRoot, 'apps', 'web', 'package.json'), '{"scripts":{"start":"next start --hostname 127.0.0.1 --port 3000"}}\n'),
    writeFile(join(repoRoot, 'apps', 'web', '.next', 'BUILD_ID'), 'synthetic-build\n'),
    writeFile(join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'export {};\n'),
    writeFile(join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next'), 'export {};\n'),
  ]);
}

function adapterSource(eventPath, mode) {
  const event = toPowerShellLiteral(eventPath);
  const common = `
$global:EvV902StoppedRoles = @{}
function global:Add-EvV902TestEvent([string] $value) {
  [System.IO.File]::AppendAllText(${event}, $value + [Environment]::NewLine)
}
`;

  if (mode === 'success') {
    return `${common}
return @{
  StartProcess = {
    param($spec)
    $id = if ($spec.Role -eq 'core') { 4101 } else { 4102 }
    $listenerFlag = if ($spec.Role -eq 'web') { [string] $spec.ArgumentList[-2] } else { '' }
    $listenerPort = if ($spec.Role -eq 'web') { [string] $spec.ArgumentList[-1] } else { '' }
    $windowsDirectory = [System.IO.Directory]::GetParent([System.Environment]::SystemDirectory).FullName
    $fixedPowerShellDirectory = Join-Path $windowsDirectory 'System32\\WindowsPowerShell\\v1.0'
    $hasFixedPowerShell = ([string] $spec.Environment['PATH']).Split(';') -contains $fixedPowerShellDirectory
    Add-EvV902TestEvent ("start|{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}|{8}|{9}|{10}|{11}|{12}|{13}" -f $spec.Role, $spec.Environment['EV_CORE_HOST'], $spec.Environment['EV_CORE_PORT'], $spec.Environment['EV_CORE_URL'], $spec.Environment['EV_WEB_ORIGIN'], $spec.Environment['EV_SECURE_COOKIES'], $spec.Environment['NODE_ENV'], $spec.Environment['EV_DATA_DIR'], $spec.Environment['EV_LOG_DIR'], $listenerFlag, $listenerPort, $hasFixedPowerShell, $spec.Environment['TEMP'], $spec.Environment['TMP'])
    [pscustomobject]@{ Id = $id; StartTimeUtcTicks = [Int64](638900000000000000 + $id); HasExited = $false }
  }
  GetProcess = {
    param($identity)
    if ($global:EvV902StoppedRoles.ContainsKey([string] $identity.Role)) { return $null }
    [pscustomobject]@{ Id = $identity.ProcessId; StartTimeUtcTicks = $identity.StartTimeUtcTicks; HasExited = $false }
  }
  StopProcess = {
    param($identity, $options)
    if ($null -eq $options -or -not [bool] $options.KillTree) { throw 'tree termination was not requested' }
    Add-EvV902TestEvent ("stop|{0}|{1}" -f $identity.Role, $options.KillTree)
    $global:EvV902StoppedRoles[[string] $identity.Role] = $true
  }
  TestPortAvailable = { param($port) Add-EvV902TestEvent ("port|{0}" -f $port); $true }
  TestCoreReady = { param($url, $timeout) Add-EvV902TestEvent ("ready|{0}|{1}" -f $url, $timeout); $true }
  GetTask = { param($definition) $null }
  RegisterTask = { param($definition) Add-EvV902TestEvent 'register-task' }
  RemoveTask = { param($definition) Add-EvV902TestEvent 'remove-task' }
}
`;
  }

  if (mode === 'existing-lock') {
    return `${common}
return @{
  StartProcess = { param($spec) Add-EvV902TestEvent 'unexpected-start'; throw 'must not start while a matching lock is active' }
  GetProcess = { param($identity) [pscustomobject]@{ Id = $identity.ProcessId; StartTimeUtcTicks = $identity.StartTimeUtcTicks; HasExited = $false } }
  StopProcess = { param($identity) Add-EvV902TestEvent 'unexpected-stop' }
  TestPortAvailable = { param($port) $true }
  TestCoreReady = { param($url, $timeout) $true }
  GetTask = { param($definition) $null }
  RegisterTask = { param($definition) Add-EvV902TestEvent 'unexpected-register' }
  RemoveTask = { param($definition) Add-EvV902TestEvent 'unexpected-remove' }
}
`;
  }

  if (mode === 'occupied-port') {
    return `${common}
return @{
  StartProcess = { param($spec) Add-EvV902TestEvent 'unexpected-start'; throw 'must not start against an occupied port' }
  GetProcess = { param($identity) $null }
  StopProcess = { param($identity) Add-EvV902TestEvent 'unexpected-stop' }
  TestPortAvailable = { param($port) Add-EvV902TestEvent ("port-blocked|{0}" -f $port); $false }
  TestCoreReady = { param($url, $timeout) $true }
  GetTask = { param($definition) $null }
  RegisterTask = { param($definition) Add-EvV902TestEvent 'unexpected-register' }
  RemoveTask = { param($definition) Add-EvV902TestEvent 'unexpected-remove' }
}
`;
  }

  if (mode === 'foreign-task') {
    return `${common}
return @{
  StartProcess = { param($spec) Add-EvV902TestEvent 'unexpected-start'; throw 'not used' }
  GetProcess = { param($identity) $null }
  StopProcess = { param($identity) Add-EvV902TestEvent 'unexpected-stop' }
  TestPortAvailable = { param($port) $true }
  TestCoreReady = { param($url, $timeout) $true }
  GetTask = { param($definition) Add-EvV902TestEvent 'get-task'; [pscustomobject]@{ Description = 'unmanaged task'; Actions = @(); Triggers = @(); Principal = $null } }
  RegisterTask = { param($definition) Add-EvV902TestEvent 'unexpected-register' }
  RemoveTask = { param($definition) Add-EvV902TestEvent 'unexpected-remove' }
}
`;
  }

  if (mode === 'owned-task') {
    return `${common}
return @{
  StartProcess = { param($spec) throw 'not used' }
  GetProcess = { param($identity) $null }
  StopProcess = { param($identity, $options) throw 'not used' }
  TestPortAvailable = { param($port) $true }
  TestCoreReady = { param($url, $timeout) $true }
  GetTask = {
    param($definition)
    Add-EvV902TestEvent ("owned-task|{0}" -f $definition.LogonType)
    [pscustomobject]@{
      Description = $definition.Description
      TaskName = $definition.Name
      TaskPath = $definition.TaskPath
      Actions = @([pscustomobject]@{ Execute = $definition.Execute; Arguments = $definition.Arguments; WorkingDirectory = $definition.WorkingDirectory })
      Principal = [pscustomobject]@{ UserId = $definition.UserId; LogonType = 'Interactive'; RunLevel = 'Limited' }
      Triggers = @([pscustomobject]@{ UserId = $definition.UserId })
    }
  }
  RegisterTask = { param($definition) Add-EvV902TestEvent 'unexpected-register' }
  RemoveTask = { param($definition) Add-EvV902TestEvent 'unexpected-remove' }
}
`;
  }

  if (mode === 'cleanup-failure') {
    return `${common}
return @{
  StartProcess = {
    param($spec)
    $id = if ($spec.Role -eq 'core') { 5101 } else { 5102 }
    [pscustomobject]@{ Id = $id; StartTimeUtcTicks = [Int64](638900000000000000 + $id); HasExited = $false }
  }
  GetProcess = {
    param($identity)
    if ($global:EvV902StoppedRoles.ContainsKey([string] $identity.Role)) { return $null }
    [pscustomobject]@{ Id = $identity.ProcessId; StartTimeUtcTicks = $identity.StartTimeUtcTicks; HasExited = $false }
  }
  StopProcess = {
    param($identity, $options)
    Add-EvV902TestEvent ("cleanup-stop|{0}|{1}" -f $identity.Role, $options.KillTree)
    if ($identity.Role -eq 'web') { throw 'C:\synthetic-secret-path\web-stop-failure' }
    $global:EvV902StoppedRoles[[string] $identity.Role] = $true
  }
  TestPortAvailable = { param($port) $true }
  TestCoreReady = { param($url, $timeout) $true }
  GetTask = { param($definition) $null }
  RegisterTask = { param($definition) Add-EvV902TestEvent 'unexpected-register' }
  RemoveTask = { param($definition) Add-EvV902TestEvent 'unexpected-remove' }
}
`;
  }

  if (mode === 'unverifiable-lock') {
    return `${common}
return @{
  StartProcess = { param($spec) Add-EvV902TestEvent 'unexpected-start'; throw 'not used' }
  GetProcess = { param($identity) throw 'C:\synthetic-secret-path\cannot-inspect-owned-process' }
  StopProcess = { param($identity, $options) Add-EvV902TestEvent 'unexpected-stop' }
  TestPortAvailable = { param($port) $true }
  TestCoreReady = { param($url, $timeout) $true }
  GetTask = { param($definition) $null }
  RegisterTask = { param($definition) Add-EvV902TestEvent 'unexpected-register' }
  RemoveTask = { param($definition) Add-EvV902TestEvent 'unexpected-remove' }
}
`;
  }

  if (mode === 'whatif') {
    return `${common}
return @{
  StartProcess = { param($spec) Add-EvV902TestEvent 'unexpected-start'; throw 'WhatIf must not launch a child' }
  GetProcess = { param($identity) Add-EvV902TestEvent 'unexpected-process-read'; $null }
  StopProcess = { param($identity) Add-EvV902TestEvent 'unexpected-stop' }
  TestPortAvailable = { param($port) Add-EvV902TestEvent 'unexpected-port-probe'; $true }
  TestCoreReady = { param($url, $timeout) Add-EvV902TestEvent 'unexpected-ready'; $true }
  GetTask = { param($definition) Add-EvV902TestEvent 'unexpected-task-read'; $null }
  RegisterTask = { param($definition) Add-EvV902TestEvent 'unexpected-register' }
  RemoveTask = { param($definition) Add-EvV902TestEvent 'unexpected-remove' }
}
`;
  }

  throw new Error(`Unknown adapter mode: ${mode}`);
}

async function writeAdapter(root, eventPath, mode) {
  const adapterPath = join(root, `${mode}.ps1`);
  await writeFile(adapterPath, adapterSource(eventPath, mode));
  return adapterPath;
}

async function eventLines(eventPath) {
  try {
    return (await readFile(eventPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

test('V9-02 launcher starts only managed mock children and blocks duplicate, foreign, and WhatIf side effects', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ev-v9-02-launcher-'));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const repoRoot = join(root, 'synthetic repo with spaces');
  const dataDir = join(root, 'managed data');
  const logDir = join(root, 'managed logs');
  const eventPath = join(root, 'events.log');
  await writeSyntheticRepository(repoRoot);

  const successAdapter = await writeAdapter(root, eventPath, 'success');
  const launcher = join(windowsScripts, 'ev-dashboard.ps1');
  const success = runPowerShellFile(launcher, launcherArgs({
    repoRoot,
    dataDir,
    logDir,
    adapterPath: successAdapter,
    extra: ['-RunOnce'],
  }));
  assertSucceeded(success, 'managed mock launch');
  assert.deepEqual(await eventLines(eventPath), [
    'port|4327',
    'port|3217',
    `start|core|127.0.0.1|4327|http://127.0.0.1:4327|https://dashboard.example.test|true|production|${dataDir}|${logDir}|||True|${join(logDir, 'runtime-tmp')}|${join(logDir, 'runtime-tmp')}`,
    'ready|http://127.0.0.1:4327/v1/health/ready|1',
    `start|web|127.0.0.1|4327|http://127.0.0.1:4327|https://dashboard.example.test|true|production|${dataDir}|${logDir}|--port|3217|True|${join(logDir, 'runtime-tmp')}|${join(logDir, 'runtime-tmp')}`,
    'stop|web|True',
    'stop|core|True',
  ]);

  await writeFile(eventPath, '');
  const localHttp = runPowerShellFile(launcher, launcherArgs({
    repoRoot,
    dataDir,
    logDir,
    adapterPath: successAdapter,
    webOrigin: 'http://127.0.0.1:3217',
    extra: ['-RunOnce'],
  }));
  assert.notEqual(localHttp.status, 0, `managed production launch accepted HTTP origin:\n${localHttp.output}`);
  assert.match(localHttp.output, /HTTPS|dev/i);
  assert.deepEqual(await eventLines(eventPath), []);

  await writeFile(eventPath, '');
  const activeTicks = '638900000000004101';
  await writeFile(join(dataDir, '.ev-dashboard.lock.json'), JSON.stringify({
    schemaVersion: 1,
    runId: 'another-launcher',
    children: [{ role: 'core', processId: 4101, startTimeUtcTicks: activeTicks }],
  }));
  const existingLockAdapter = await writeAdapter(root, eventPath, 'existing-lock');
  const duplicate = runPowerShellFile(launcher, launcherArgs({
    repoRoot,
    dataDir,
    logDir,
    adapterPath: existingLockAdapter,
    extra: ['-RunOnce'],
  }));
  assert.notEqual(duplicate.status, 0, `duplicate launch unexpectedly succeeded:\n${duplicate.output}`);
  assert.match(duplicate.output, /lock|running|duplicate/i);
  assert.deepEqual(await eventLines(eventPath), []);

  await rm(join(dataDir, '.ev-dashboard.lock.json'));
  const occupiedPortAdapter = await writeAdapter(root, eventPath, 'occupied-port');
  const occupied = runPowerShellFile(launcher, launcherArgs({
    repoRoot,
    dataDir,
    logDir,
    adapterPath: occupiedPortAdapter,
    extra: ['-RunOnce'],
  }));
  assert.notEqual(occupied.status, 0, `occupied-port launch unexpectedly succeeded:\n${occupied.output}`);
  assert.deepEqual(await eventLines(eventPath), ['port-blocked|4327']);

  await writeFile(eventPath, '');
  const foreignTaskAdapter = await writeAdapter(root, eventPath, 'foreign-task');
  const install = runPowerShellFile(join(windowsScripts, 'install-autostart.ps1'), launcherArgs({
    repoRoot,
    dataDir,
    logDir,
    adapterPath: foreignTaskAdapter,
  }));
  assert.notEqual(install.status, 0, `foreign task was unexpectedly overwritten:\n${install.output}`);
  assert.match(install.output, /foreign|unmanaged|ownership|same-name/i);
  assert.deepEqual(await eventLines(eventPath), ['get-task']);

  await writeFile(eventPath, '');
  const ownedTaskAdapter = await writeAdapter(root, eventPath, 'owned-task');
  const ownedTask = runPowerShellFile(join(windowsScripts, 'install-autostart.ps1'), launcherArgs({
    repoRoot,
    dataDir,
    logDir,
    adapterPath: ownedTaskAdapter,
  }));
  assertSucceeded(ownedTask, 'existing managed Interactive task check');
  assert.match(ownedTask.output, /AlreadyInstalled/);
  assert.deepEqual(await eventLines(eventPath), ['owned-task|Interactive']);

  await writeFile(eventPath, '');
  const cleanupDataDir = join(root, 'cleanup data');
  const cleanupLogDir = join(root, 'cleanup logs');
  const cleanupAdapter = await writeAdapter(root, eventPath, 'cleanup-failure');
  const cleanupFailure = runPowerShellFile(launcher, launcherArgs({
    repoRoot,
    dataDir: cleanupDataDir,
    logDir: cleanupLogDir,
    adapterPath: cleanupAdapter,
    extra: ['-RunOnce'],
  }));
  assert.notEqual(cleanupFailure.status, 0, `cleanup failure unexpectedly succeeded:\n${cleanupFailure.output}`);
  assert.match(cleanupFailure.output, /managed cleanup failed for web child|lock retained/i);
  assert.doesNotMatch(cleanupFailure.output, /synthetic-secret-path|cleanup data|cleanup logs/i);
  assert.deepEqual(await eventLines(eventPath), [
    'cleanup-stop|web|True',
    'cleanup-stop|core|True',
  ]);
  const retainedLockPath = join(cleanupDataDir, '.ev-dashboard.lock.json');
  assert.equal(await exists(retainedLockPath), true, 'cleanup failure removed the ownership lock');
  const retainedLock = JSON.parse(await readFile(retainedLockPath, 'utf8'));
  assert.equal(typeof retainedLock.runId, 'string');
  assert.deepEqual(retainedLock.children.map((child) => child.role), ['core', 'web']);

  await writeFile(eventPath, '');
  const retainedLockAdapter = await writeAdapter(root, eventPath, 'existing-lock');
  const retainedDuplicate = runPowerShellFile(launcher, launcherArgs({
    repoRoot,
    dataDir: cleanupDataDir,
    logDir: cleanupLogDir,
    adapterPath: retainedLockAdapter,
    extra: ['-RunOnce'],
  }));
  assert.notEqual(retainedDuplicate.status, 0, `retained lock unexpectedly permitted a duplicate:\n${retainedDuplicate.output}`);
  assert.match(retainedDuplicate.output, /lock|running|duplicate/i);
  assert.deepEqual(await eventLines(eventPath), []);

  const unverifiableLockAdapter = await writeAdapter(root, eventPath, 'unverifiable-lock');
  const unverifiableLock = runPowerShellFile(launcher, launcherArgs({
    repoRoot,
    dataDir: cleanupDataDir,
    logDir: cleanupLogDir,
    adapterPath: unverifiableLockAdapter,
    extra: ['-RunOnce'],
  }));
  assert.notEqual(unverifiableLock.status, 0, `unverifiable lock unexpectedly permitted a launch:\n${unverifiableLock.output}`);
  assert.match(unverifiableLock.output, /cannot verify owned core child identity/i);
  assert.doesNotMatch(unverifiableLock.output, /synthetic-secret-path/i);
  assert.equal(await exists(retainedLockPath), true, 'unverifiable lock was removed');
  assert.deepEqual(await eventLines(eventPath), []);

  await writeFile(eventPath, '');
  const whatIfDataDir = join(root, 'whatif data');
  const whatIfLogDir = join(root, 'whatif logs');
  const whatIfAdapter = await writeAdapter(root, eventPath, 'whatif');
  const dryRun = runPowerShellFile(join(windowsScripts, 'test-launcher.ps1'), launcherArgs({
    repoRoot,
    dataDir: whatIfDataDir,
    logDir: whatIfLogDir,
    adapterPath: whatIfAdapter,
    extra: ['-WhatIf'],
  }));
  assertSucceeded(dryRun, 'WhatIf launcher check');
  assert.equal(await exists(whatIfDataDir), false, 'WhatIf created a data directory');
  assert.equal(await exists(whatIfLogDir), false, 'WhatIf created a log directory');
  assert.deepEqual(await eventLines(eventPath), []);

  for (const fileName of [
    '_ev-launcher-private.ps1',
    'ev-dashboard.ps1',
    'install-autostart.ps1',
    'uninstall-autostart.ps1',
    'test-launcher.ps1',
  ]) {
    const scriptPath = join(windowsScripts, fileName);
    const parse = runPowerShellCommand(`
      $tokens = $null
      $errors = $null
      [System.Management.Automation.Language.Parser]::ParseFile(${toPowerShellLiteral(scriptPath)}, [ref] $tokens, [ref] $errors) | Out-Null
      if ($errors.Count -gt 0) {
        $errors | ForEach-Object { Write-Error $_.Message }
        exit 1
      }
    `);
    assertSucceeded(parse, `PowerShell parser for ${fileName}`);
  }
});

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      return error.code === 'EISDIR';
    }
    throw error;
  }
}
