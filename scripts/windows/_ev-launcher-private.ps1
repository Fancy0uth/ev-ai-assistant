Set-StrictMode -Version Latest

$script:EvLauncherLockFileName = '.ev-dashboard.lock.json'
$script:EvLauncherLockSchemaVersion = 1
$script:EvAutostartTaskPath = '\EV-AI-Assistant\'
$script:EvAutostartTaskName = 'EV AI Dashboard'

function Get-EvObjectProperty {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Object,
        [Parameter(Mandatory)] [string] $Name
    )

    if ($Object -is [System.Collections.IDictionary] -and $Object.Contains($Name)) {
        return $Object[$Name]
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -ne $property) {
        return $property.Value
    }

    return $null
}

function Assert-EvAbsolutePath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Label,
        [switch] $MustExist
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "$Label must be an explicit absolute path."
    }

    if ($Path -match '^(\\\\|\\\\\?\\|\\\\\.\\)') {
        throw "$Label must not be a UNC or device path."
    }

    if ($Path -match '^[A-Za-z]:[^\\/]') {
        throw "$Label must not use a drive-relative path."
    }

    if (-not [System.IO.Path]::IsPathRooted($Path)) {
        throw "$Label must be an explicit absolute path."
    }

    try {
        $fullPath = [System.IO.Path]::GetFullPath($Path)
    }
    catch {
        throw "$Label is not a valid Windows path: $($_.Exception.Message)"
    }

    if ($fullPath -match '^(\\\\|\\\\\?\\|\\\\\.\\)') {
        throw "$Label must not resolve to a UNC or device path."
    }

    $root = [System.IO.Path]::GetPathRoot($fullPath)
    if ($fullPath.Length -gt $root.Length) {
        $fullPath = $fullPath.TrimEnd([char[]]@('\', '/'))
    }

    Assert-EvNoReparsePointAncestor -Path $fullPath -Label $Label

    if ($MustExist -and -not ([System.IO.File]::Exists($fullPath) -or [System.IO.Directory]::Exists($fullPath))) {
        throw "$Label does not exist: $fullPath"
    }

    return $fullPath
}

function Assert-EvNoReparsePointAncestor {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Label
    )

    $current = $Path
    while ($true) {
        if ([System.IO.File]::Exists($current) -or [System.IO.Directory]::Exists($current)) {
            try {
                $attributes = [System.IO.File]::GetAttributes($current)
            }
            catch {
                throw "Cannot inspect $Label for reparse points: $($_.Exception.Message)"
            }

            if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "$Label must not traverse a junction or symbolic link: $current"
            }
        }

        $parent = [System.IO.Directory]::GetParent($current)
        if ($null -eq $parent -or $parent.FullName -eq $current) {
            break
        }
        $current = $parent.FullName
    }
}

function Assert-EvContainedPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Root,
        [Parameter(Mandatory)] [string] $Label
    )

    $fullRoot = Assert-EvAbsolutePath -Path $Root -Label 'managed root'
    $fullPath = Assert-EvAbsolutePath -Path $Path -Label $Label
    $prefix = if ($fullRoot.EndsWith('\')) { $fullRoot } else { "$fullRoot\" }

    if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must remain inside its explicitly selected root."
    }

    return $fullPath
}

function Join-EvManagedPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Root,
        [Parameter(Mandatory)] [string] $Leaf,
        [Parameter(Mandatory)] [string] $Label
    )

    if ($Leaf.IndexOfAny([char[]]@('\', '/')) -ge 0) {
        throw "$Label must be a fixed child name."
    }

    $path = [System.IO.Path]::Combine($Root, $Leaf)
    return Assert-EvContainedPath -Path $path -Root $Root -Label $Label
}

function Ensure-EvManagedDirectory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string] $Label,
        [switch] $ProspectiveOnly
    )

    $fullPath = Assert-EvAbsolutePath -Path $Path -Label $Label
    if ([System.IO.File]::Exists($fullPath)) {
        throw "$Label is a file, not a directory: $fullPath"
    }
    if ([System.IO.Directory]::Exists($fullPath)) {
        return $fullPath
    }
    if ($ProspectiveOnly) {
        return $fullPath
    }

    try {
        [System.IO.Directory]::CreateDirectory($fullPath) | Out-Null
    }
    catch {
        throw "Cannot create ${Label}: $($_.Exception.Message)"
    }

    return (Assert-EvAbsolutePath -Path $fullPath -Label $Label -MustExist)
}

function Get-EvWebOrigin {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $WebOrigin)

    try {
        $uri = [System.Uri]$WebOrigin
    }
    catch {
        throw "WebOrigin must be an absolute origin: $($_.Exception.Message)"
    }

    if (-not $uri.IsAbsoluteUri -or $uri.UserInfo.Length -gt 0 -or $uri.Query.Length -gt 0 -or $uri.Fragment.Length -gt 0) {
        throw 'WebOrigin must contain only scheme, host, and port.'
    }
    if ($uri.AbsolutePath -notin @('', '/')) {
        throw 'WebOrigin must not include a path.'
    }
    if ($uri.Scheme -ne 'https') {
        throw 'Managed production launcher requires an HTTPS WebOrigin. Use the development server for an explicit loopback HTTP origin.'
    }

    $originHostName = $uri.DnsSafeHost
    $originHost = if ($originHostName.Contains(':')) { "[$originHostName]" } else { $originHostName }
    $origin = "$($uri.Scheme.ToLowerInvariant())://$originHost"
    if (-not $uri.IsDefaultPort) {
        $origin = "$origin`:$($uri.Port)"
    }

    return [pscustomobject]@{
        Origin = $origin
    }
}

function Find-EvRuntimeFile {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $RepoRoot,
        [Parameter(Mandatory)] [string[]] $RelativePaths,
        [Parameter(Mandatory)] [string] $Label
    )

    foreach ($relativePath in $RelativePaths) {
        $candidate = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($RepoRoot, $relativePath))
        Assert-EvContainedPath -Path $candidate -Root $RepoRoot -Label $Label | Out-Null
        if ([System.IO.File]::Exists($candidate)) {
            return (Assert-EvAbsolutePath -Path $candidate -Label $Label -MustExist)
        }
    }

    throw "$Label is not installed under RepoRoot. No download or install will be attempted."
}

function Get-EvNodeExecutable {
    [CmdletBinding()]
    param()

    $command = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $source = Get-EvObjectProperty -Object $command -Name 'Source'
    if ([string]::IsNullOrWhiteSpace([string] $source)) {
        $source = Get-EvObjectProperty -Object $command -Name 'Path'
    }
    if ([string]::IsNullOrWhiteSpace([string] $source)) {
        throw 'Installed node executable cannot be resolved.'
    }

    return (Assert-EvAbsolutePath -Path ([string] $source) -Label 'node executable' -MustExist)
}

function New-EvLauncherConfiguration {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $RepoRoot,
        [Parameter(Mandatory)] [string] $DataDir,
        [Parameter(Mandatory)] [string] $LogDir,
        [Parameter(Mandatory)] [string] $WebOrigin,
        [ValidateRange(1024, 65535)] [int] $CorePort = 4311,
        [ValidateRange(1024, 65535)] [int] $WebPort = 3000,
        [switch] $ProspectiveManagedDirectories
    )

    $resolvedRepoRoot = Assert-EvAbsolutePath -Path $RepoRoot -Label 'RepoRoot' -MustExist
    if (-not [System.IO.Directory]::Exists($resolvedRepoRoot)) {
        throw "RepoRoot must be a directory: $resolvedRepoRoot"
    }

    $coreDirectory = Assert-EvContainedPath -Path ([System.IO.Path]::Combine($resolvedRepoRoot, 'apps', 'core')) -Root $resolvedRepoRoot -Label 'Core directory'
    $webDirectory = Assert-EvContainedPath -Path ([System.IO.Path]::Combine($resolvedRepoRoot, 'apps', 'web')) -Root $resolvedRepoRoot -Label 'Web directory'
    $corePackage = Assert-EvContainedPath -Path ([System.IO.Path]::Combine($coreDirectory, 'package.json')) -Root $resolvedRepoRoot -Label 'Core package manifest'
    $coreServer = Assert-EvContainedPath -Path ([System.IO.Path]::Combine($coreDirectory, 'src', 'server.ts')) -Root $resolvedRepoRoot -Label 'Core server entrypoint'
    $webPackage = Assert-EvContainedPath -Path ([System.IO.Path]::Combine($webDirectory, 'package.json')) -Root $resolvedRepoRoot -Label 'Web package manifest'
    $webBuild = Assert-EvContainedPath -Path ([System.IO.Path]::Combine($webDirectory, '.next', 'BUILD_ID')) -Root $resolvedRepoRoot -Label 'Web build marker'

    foreach ($requiredFile in @($corePackage, $coreServer, $webPackage, $webBuild)) {
        if (-not [System.IO.File]::Exists($requiredFile)) {
            throw "Required runtime or build input is missing: $requiredFile"
        }
    }

    $coreManifest = [System.IO.File]::ReadAllText($corePackage)
    if ($coreManifest -notmatch '"start"\s*:\s*"tsx\s+src/server\.ts"') {
        throw 'Core must use its actual tsx src/server.ts start entrypoint; no dist or migration CLI fallback is allowed.'
    }
    $webManifest = [System.IO.File]::ReadAllText($webPackage)
    if ($webManifest -notmatch '"start"\s*:\s*"next\s+start') {
        throw 'Web must use its actual next start entrypoint.'
    }

    $origin = Get-EvWebOrigin -WebOrigin $WebOrigin
    $resolvedDataDir = Ensure-EvManagedDirectory -Path $DataDir -Label 'DataDir' -ProspectiveOnly:$ProspectiveManagedDirectories
    $resolvedLogDir = Ensure-EvManagedDirectory -Path $LogDir -Label 'LogDir' -ProspectiveOnly:$ProspectiveManagedDirectories
    $runtimeTempCandidate = Join-EvManagedPath -Root $resolvedLogDir -Leaf 'runtime-tmp' -Label 'runtime temporary directory'
    # Scratch space is deliberately separate from LogDir's retained log payload; child stdout/stderr is never redirected here.
    $runtimeTempDir = Ensure-EvManagedDirectory -Path $runtimeTempCandidate -Label 'runtime temporary directory' -ProspectiveOnly:$ProspectiveManagedDirectories
    $tsxCli = Find-EvRuntimeFile -RepoRoot $resolvedRepoRoot -RelativePaths @('node_modules\tsx\dist\cli.mjs', 'apps\core\node_modules\tsx\dist\cli.mjs') -Label 'tsx runtime'
    $nextCli = Find-EvRuntimeFile -RepoRoot $resolvedRepoRoot -RelativePaths @('node_modules\next\dist\bin\next', 'apps\web\node_modules\next\dist\bin\next') -Label 'Next runtime'

    return [pscustomobject]@{
        RepoRoot = $resolvedRepoRoot
        DataDir = $resolvedDataDir
        LogDir = $resolvedLogDir
        RuntimeTempDir = $runtimeTempDir
        CoreDirectory = $coreDirectory
        WebDirectory = $webDirectory
        NodePath = Get-EvNodeExecutable
        TsxCliPath = $tsxCli
        NextCliPath = $nextCli
        CorePort = $CorePort
        CoreUrl = "http://127.0.0.1:$CorePort"
        WebOrigin = $origin.Origin
        WebPort = $WebPort
    }
}

function Import-EvTestAdapter {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $Path)

    $adapterPath = Assert-EvAbsolutePath -Path $Path -Label 'TestAdapterPath' -MustExist
    if (-not [System.IO.File]::Exists($adapterPath)) {
        throw "TestAdapterPath must be a file: $adapterPath"
    }

    $adapter = . $adapterPath
    if ($adapter -isnot [System.Collections.IDictionary]) {
        throw 'TestAdapterPath must return a hashtable of mock operations.'
    }

    foreach ($name in @('StartProcess', 'GetProcess', 'StopProcess', 'TestPortAvailable', 'TestCoreReady', 'GetTask', 'RegisterTask', 'RemoveTask')) {
        if (-not $adapter.Contains($name) -or $adapter[$name] -isnot [scriptblock]) {
            throw "TestAdapterPath is missing the $name mock operation."
        }
    }

    return $adapter
}

function Invoke-EvAdapter {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Adapter,
        [Parameter(Mandatory)] [string] $Operation,
        [object[]] $ArgumentList = @()
    )

    $handler = $Adapter[$Operation]
    if ($handler -isnot [scriptblock]) {
        throw "Mock operation is unavailable: $Operation"
    }

    return (& $handler @ArgumentList)
}

function Test-EvPortAvailable {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [int] $Port,
        [System.Collections.IDictionary] $Adapter
    )

    if ($null -ne $Adapter) {
        return [bool] (Invoke-EvAdapter -Adapter $Adapter -Operation 'TestPortAvailable' -ArgumentList @($Port))
    }

    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    foreach ($listener in $listeners) {
        if ($listener.Port -eq $Port) {
            return $false
        }
    }
    return $true
}

function Get-EvChildEnvironment {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [object] $Configuration)

    $systemDirectory = [System.Environment]::SystemDirectory
    $windowsDirectory = [System.IO.Directory]::GetParent($systemDirectory).FullName
    $nodeDirectory = [System.IO.Path]::GetDirectoryName($Configuration.NodePath)
    $windowsPowerShellDirectory = Join-Path $windowsDirectory 'System32\WindowsPowerShell\v1.0'

    return [ordered]@{
        SystemRoot = $windowsDirectory
        WINDIR = $windowsDirectory
        PATH = "$nodeDirectory;$systemDirectory;$windowsPowerShellDirectory"
        TEMP = $Configuration.RuntimeTempDir
        TMP = $Configuration.RuntimeTempDir
        EV_DATA_DIR = $Configuration.DataDir
        EV_LOG_DIR = $Configuration.LogDir
        EV_WEB_ORIGIN = $Configuration.WebOrigin
        EV_CORE_HOST = '127.0.0.1'
        EV_CORE_PORT = [string] $Configuration.CorePort
        EV_CORE_URL = $Configuration.CoreUrl
        EV_SECURE_COOKIES = 'true'
        NODE_ENV = 'production'
    }
}

function New-EvChildProcessSpec {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [ValidateSet('core', 'web')] [string] $Role,
        [Parameter(Mandatory)] [object] $Configuration
    )

    $environment = Get-EvChildEnvironment -Configuration $Configuration
    if ($Role -eq 'core') {
        return [pscustomobject]@{
            Role = 'core'
            FilePath = $Configuration.NodePath
            ArgumentList = @($Configuration.TsxCliPath, 'src/server.ts')
            WorkingDirectory = $Configuration.CoreDirectory
            LogDir = $Configuration.LogDir
            Environment = $environment
        }
    }

    return [pscustomobject]@{
        Role = 'web'
        FilePath = $Configuration.NodePath
        ArgumentList = @($Configuration.NextCliPath, 'start', '--hostname', '127.0.0.1', '--port', [string] $Configuration.WebPort)
        WorkingDirectory = $Configuration.WebDirectory
        LogDir = $Configuration.LogDir
        Environment = $environment
    }
}

function Set-EvChildEnvironment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [System.Diagnostics.ProcessStartInfo] $ProcessStartInfo,
        [Parameter(Mandatory)] [System.Collections.IDictionary] $Environment
    )

    if ($ProcessStartInfo.PSObject.Properties.Name -contains 'Environment') {
        $ProcessStartInfo.Environment.Clear()
        foreach ($key in $Environment.Keys) {
            $ProcessStartInfo.Environment[$key] = [string] $Environment[$key]
        }
        return
    }

    $ProcessStartInfo.EnvironmentVariables.Clear()
    foreach ($key in $Environment.Keys) {
        $ProcessStartInfo.EnvironmentVariables[$key] = [string] $Environment[$key]
    }
}

function Start-EvProcessHidden {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [object] $Spec)

    $processStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    if ($processStartInfo.PSObject.Properties.Name -notcontains 'ArgumentList') {
        throw 'PowerShell 7 / .NET with ProcessStartInfo.ArgumentList is required so child arguments are never shell-concatenated.'
    }

    $processStartInfo.FileName = $Spec.FilePath
    $processStartInfo.WorkingDirectory = $Spec.WorkingDirectory
    $processStartInfo.UseShellExecute = $false
    $processStartInfo.CreateNoWindow = $true
    $processStartInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    Set-EvChildEnvironment -ProcessStartInfo $processStartInfo -Environment $Spec.Environment

    foreach ($argument in $Spec.ArgumentList) {
        [void] $processStartInfo.ArgumentList.Add([string] $argument)
    }

    try {
        return [System.Diagnostics.Process]::Start($processStartInfo)
    }
    catch {
        throw "Cannot start hidden $($Spec.Role) child: $($_.Exception.Message)"
    }
}

function ConvertTo-EvProcessIdentity {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Process,
        [Parameter(Mandatory)] [ValidateSet('core', 'web')] [string] $Role
    )

    $idValue = Get-EvObjectProperty -Object $Process -Name 'Id'
    if ($null -eq $idValue) {
        $idValue = Get-EvObjectProperty -Object $Process -Name 'ProcessId'
    }
    if ($null -eq $idValue) {
        throw "Started $Role child did not return a process id."
    }

    $ticksValue = Get-EvObjectProperty -Object $Process -Name 'StartTimeUtcTicks'
    if ($null -eq $ticksValue) {
        $startTime = Get-EvObjectProperty -Object $Process -Name 'StartTime'
        if ($null -eq $startTime) {
            throw "Started $Role child did not return a process creation time."
        }
        $ticksValue = ([datetime] $startTime).ToUniversalTime().Ticks
    }

    try {
        $processId = [int] $idValue
        $ticks = [Int64] $ticksValue
    }
    catch {
        throw "Started $Role child returned an invalid process identity."
    }
    if ($processId -le 0 -or $ticks -le 0) {
        throw "Started $Role child returned an invalid process identity."
    }

    return [pscustomobject]@{
        Role = $Role
        ProcessId = $processId
        StartTimeUtcTicks = $ticks
    }
}

function Start-EvChildProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Spec,
        [System.Collections.IDictionary] $Adapter
    )

    if ($null -ne $Adapter) {
        $process = Invoke-EvAdapter -Adapter $Adapter -Operation 'StartProcess' -ArgumentList @($Spec)
    }
    else {
        $process = Start-EvProcessHidden -Spec $Spec
    }

    return (ConvertTo-EvProcessIdentity -Process $process -Role $Spec.Role)
}

function Get-EvVerifiedProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Identity,
        [System.Collections.IDictionary] $Adapter
    )

    if ($null -ne $Adapter) {
        try {
            $process = Invoke-EvAdapter -Adapter $Adapter -Operation 'GetProcess' -ArgumentList @($Identity)
        }
        catch {
            throw "Cannot verify owned $($Identity.Role) child identity."
        }
    }
    else {
        try {
            $process = Get-Process -Id $Identity.ProcessId -ErrorAction Stop
        }
        catch {
            if ($_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound) {
                return $null
            }
            throw "Cannot verify owned $($Identity.Role) child identity."
        }
    }

    if ($null -eq $process) {
        return $null
    }

    try {
        $hasExited = Get-EvObjectProperty -Object $process -Name 'HasExited'
        if ($null -ne $hasExited -and [bool] $hasExited) {
            return $null
        }
        $currentIdentity = ConvertTo-EvProcessIdentity -Process $process -Role $Identity.Role
    }
    catch {
        throw "Cannot verify owned $($Identity.Role) child identity."
    }

    if ($currentIdentity.ProcessId -ne $Identity.ProcessId -or $currentIdentity.StartTimeUtcTicks -ne $Identity.StartTimeUtcTicks) {
        return $null
    }

    return $process
}

function Stop-EvOwnedProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Identity,
        [System.Collections.IDictionary] $Adapter
    )

    $process = Get-EvVerifiedProcess -Identity $Identity -Adapter $Adapter
    if ($null -eq $process) {
        return $false
    }

    try {
        if ($null -ne $Adapter) {
            Invoke-EvAdapter -Adapter $Adapter -Operation 'StopProcess' -ArgumentList @($Identity, [pscustomobject]@{ KillTree = $true }) | Out-Null
        }
        else {
            $process.Kill($true)
            if (-not $process.WaitForExit(5000)) {
                throw 'tree exit timed out'
            }
        }
    }
    catch {
        throw "Managed tree stop failed for $($Identity.Role) child."
    }

    if ($null -ne (Get-EvVerifiedProcess -Identity $Identity -Adapter $Adapter)) {
        throw "Managed tree stop failed for $($Identity.Role) child."
    }

    return $true
}

function Test-EvCoreReady {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $CoreUrl,
        [ValidateRange(1, 600)] [int] $TimeoutSeconds,
        [System.Collections.IDictionary] $Adapter
    )

    $readyUrl = "$CoreUrl/v1/health/ready"
    if ($null -ne $Adapter) {
        return [bool] (Invoke-EvAdapter -Adapter $Adapter -Operation 'TestCoreReady' -ArgumentList @($readyUrl, $TimeoutSeconds))
    }

    $deadline = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([datetime]::UtcNow -lt $deadline) {
        try {
            $request = [System.Net.WebRequest]::Create($readyUrl)
            $request.Method = 'GET'
            $request.Timeout = 2000
            $request.ReadWriteTimeout = 2000
            $request.AllowAutoRedirect = $false
            $response = $request.GetResponse()
            try {
                if ([int] $response.StatusCode -eq 200) {
                    return $true
                }
            }
            finally {
                $response.Dispose()
            }
        }
        catch {
            # The loopback core may still be applying its normal openDatabase migrations.
        }
        Start-Sleep -Milliseconds 250
    }

    return $false
}

function Get-EvLockPath {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [object] $Configuration)

    return (Join-EvManagedPath -Root $Configuration.DataDir -Leaf $script:EvLauncherLockFileName -Label 'dashboard lock')
}

function ConvertFrom-EvLockDocument {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $Json)

    try {
        $document = $Json | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "Dashboard lock is malformed and will not be removed: $($_.Exception.Message)"
    }

    if ([int] (Get-EvObjectProperty -Object $document -Name 'schemaVersion') -ne $script:EvLauncherLockSchemaVersion) {
        throw 'Dashboard lock has an unknown schema and will not be removed.'
    }
    $runId = [string] (Get-EvObjectProperty -Object $document -Name 'runId')
    if ([string]::IsNullOrWhiteSpace($runId)) {
        throw 'Dashboard lock lacks an ownership token and will not be removed.'
    }

    $children = @()
    $rawChildren = Get-EvObjectProperty -Object $document -Name 'children'
    foreach ($child in @($rawChildren)) {
        $role = [string] (Get-EvObjectProperty -Object $child -Name 'role')
        if ($role -notin @('core', 'web')) {
            throw 'Dashboard lock has an invalid child role and will not be removed.'
        }
        try {
            $processId = [int] (Get-EvObjectProperty -Object $child -Name 'processId')
            $ticks = [Int64] (Get-EvObjectProperty -Object $child -Name 'startTimeUtcTicks')
        }
        catch {
            throw 'Dashboard lock has an invalid child identity and will not be removed.'
        }
        if ($processId -le 0 -or $ticks -le 0) {
            throw 'Dashboard lock has an invalid child identity and will not be removed.'
        }
        $children += [pscustomobject]@{
            Role = $role
            ProcessId = $processId
            StartTimeUtcTicks = $ticks
        }
    }

    return [pscustomobject]@{
        RunId = $runId
        Children = $children
    }
}

function Read-EvLaunchLock {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $LockPath)

    if (-not [System.IO.File]::Exists($LockPath)) {
        return $null
    }

    Assert-EvAbsolutePath -Path $LockPath -Label 'dashboard lock' -MustExist | Out-Null
    try {
        $json = [System.IO.File]::ReadAllText($LockPath)
    }
    catch {
        throw "Dashboard lock cannot be read and will not be replaced: $($_.Exception.Message)"
    }

    return (ConvertFrom-EvLockDocument -Json $json)
}

function Test-EvLockHasLiveChild {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Lock,
        [System.Collections.IDictionary] $Adapter
    )

    foreach ($child in $Lock.Children) {
        if ($null -ne (Get-EvVerifiedProcess -Identity $child -Adapter $Adapter)) {
            return $true
        }
    }
    return $false
}

function Remove-EvStaleLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string] $LockPath,
        [Parameter(Mandatory)] [string] $RunId
    )

    $current = Read-EvLaunchLock -LockPath $LockPath
    if ($null -eq $current -or $current.RunId -ne $RunId) {
        throw 'Dashboard lock changed while checking ownership; it will not be removed.'
    }

    Remove-Item -LiteralPath $LockPath -Force -ErrorAction Stop
}

function Write-EvLockRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [System.IO.FileStream] $Stream,
        [Parameter(Mandatory)] [object] $Record
    )

    $json = $Record | ConvertTo-Json -Depth 6 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Stream.SetLength(0)
    $Stream.Position = 0
    $Stream.Write($bytes, 0, $bytes.Length)
    $Stream.Flush($true)
}

function Enter-EvLaunchLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Configuration,
        [System.Collections.IDictionary] $Adapter
    )

    $lockPath = Get-EvLockPath -Configuration $Configuration
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        if ([System.IO.File]::Exists($lockPath)) {
            $existing = Read-EvLaunchLock -LockPath $lockPath
            if (Test-EvLockHasLiveChild -Lock $existing -Adapter $Adapter) {
                throw 'A managed dashboard lock has a live child; duplicate launch is refused.'
            }
            Remove-EvStaleLock -LockPath $lockPath -RunId $existing.RunId
            continue
        }

        try {
            $stream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::Read)
            $record = [ordered]@{
                schemaVersion = $script:EvLauncherLockSchemaVersion
                runId = [guid]::NewGuid().ToString('N')
                createdAtUtc = [datetime]::UtcNow.ToString('o')
                children = @()
            }
            Write-EvLockRecord -Stream $stream -Record $record
            return [pscustomobject]@{
                Path = $lockPath
                Stream = $stream
                Record = $record
            }
        }
        catch [System.IO.IOException] {
            if ($attempt -eq 2) {
                throw 'Dashboard lock is concurrently held; duplicate launch is refused.'
            }
        }
    }

    throw 'Dashboard lock cannot be acquired.'
}

function Update-EvLaunchLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Lock,
        [object[]] $Children = @()
    )

    $serializedChildren = @()
    foreach ($child in $Children) {
        if ($null -ne $child) {
            $serializedChildren += [ordered]@{
                role = $child.Role
                processId = $child.ProcessId
                startTimeUtcTicks = $child.StartTimeUtcTicks
            }
        }
    }
    $Lock.Record.children = $serializedChildren
    Write-EvLockRecord -Stream $Lock.Stream -Record $Lock.Record
}

function Exit-EvLaunchLock {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [object] $Lock)

    try {
        $Lock.Stream.Dispose()
        if (-not [System.IO.File]::Exists($Lock.Path)) {
            throw 'ownership lock disappeared'
        }
        $current = Read-EvLaunchLock -LockPath $Lock.Path
        if ($null -eq $current -or $current.RunId -ne $Lock.Record.runId) {
            throw 'ownership lock changed'
        }
        Remove-Item -LiteralPath $Lock.Path -Force -ErrorAction Stop
    }
    catch {
        throw 'Managed dashboard lock could not be safely cleared.'
    }
}

function Retain-EvLaunchLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Lock,
        [Parameter(Mandatory)] [string[]] $CleanupFailures
    )

    try {
        $Lock.Record['cleanupFailedAtUtc'] = [datetime]::UtcNow.ToString('o')
        $Lock.Record['cleanupFailures'] = @($CleanupFailures)
        Write-EvLockRecord -Stream $Lock.Stream -Record $Lock.Record
    }
    catch {
        # The original ownership record remains safer than replacing it with an incomplete record.
    }

    try {
        $Lock.Stream.Dispose()
        return $true
    }
    catch {
        return $false
    }
}

function Invoke-EvDashboardCleanup {
    [CmdletBinding()]
    param(
        [object] $Web,
        [object] $Core,
        [object] $Lock,
        [System.Collections.IDictionary] $Adapter
    )

    $failures = New-Object 'System.Collections.Generic.List[string]'
    foreach ($child in @($Web, $Core)) {
        if ($null -eq $child) {
            continue
        }
        try {
            Stop-EvOwnedProcess -Identity $child -Adapter $Adapter | Out-Null
        }
        catch {
            [void] $failures.Add("$($child.Role) child")
        }
    }

    $lockRetained = $false
    if ($null -ne $Lock) {
        if ($failures.Count -eq 0) {
            try {
                Exit-EvLaunchLock -Lock $Lock
            }
            catch {
                [void] $failures.Add('lock record')
            }
        }
        if ($failures.Count -gt 0) {
            $lockRetained = Retain-EvLaunchLock -Lock $Lock -CleanupFailures $failures.ToArray()
            if (-not $lockRetained -and -not $failures.Contains('lock record')) {
                [void] $failures.Add('lock record')
            }
        }
    }

    if ($failures.Count -gt 0) {
        $lockState = if ($lockRetained) { 'lock retained' } else { 'lock ownership could not be safely verified' }
        throw "Managed cleanup failed for $($failures -join ', '); $lockState."
    }
}

function Start-EvDashboard {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)] [string] $RepoRoot,
        [Parameter(Mandatory)] [string] $DataDir,
        [Parameter(Mandatory)] [string] $LogDir,
        [Parameter(Mandatory)] [string] $WebOrigin,
        [ValidateRange(1024, 65535)] [int] $CorePort = 4311,
        [ValidateRange(1024, 65535)] [int] $WebPort = 3000,
        [ValidateRange(1, 600)] [int] $ReadyTimeoutSeconds = 60,
        [ValidateRange(100, 60000)] [int] $MonitorIntervalMilliseconds = 1000,
        [string] $TestAdapterPath,
        [switch] $RunOnce
    )

    $isWhatIf = [bool] $WhatIfPreference
    $configuration = New-EvLauncherConfiguration -RepoRoot $RepoRoot -DataDir $DataDir -LogDir $LogDir -WebOrigin $WebOrigin -CorePort $CorePort -WebPort $WebPort -ProspectiveManagedDirectories:$isWhatIf
    $plan = [pscustomobject]@{
        State = if ($isWhatIf) { 'WhatIf' } else { 'Planned' }
        RepoRoot = $configuration.RepoRoot
        DataDir = $configuration.DataDir
        LogDir = $configuration.LogDir
        CoreCommand = @($configuration.NodePath, $configuration.TsxCliPath, 'src/server.ts')
        WebCommand = @($configuration.NodePath, $configuration.NextCliPath, 'start', '--hostname', '127.0.0.1', '--port', [string] $configuration.WebPort)
        WebOrigin = $configuration.WebOrigin
        WebPort = $configuration.WebPort
        CoreUrl = $configuration.CoreUrl
    }

    if ($isWhatIf) {
        $PSCmdlet.ShouldProcess("dashboard at $($configuration.WebOrigin)", 'Start managed core then web') | Out-Null
        return $plan
    }

    if (-not $PSCmdlet.ShouldProcess("dashboard at $($configuration.WebOrigin)", 'Start managed core then web')) {
        return $plan
    }

    $adapter = if ([string]::IsNullOrWhiteSpace($TestAdapterPath)) { $null } else { Import-EvTestAdapter -Path $TestAdapterPath }
    $lock = $null
    $core = $null
    $web = $null
    try {
        $lock = Enter-EvLaunchLock -Configuration $configuration -Adapter $adapter
        if (-not (Test-EvPortAvailable -Port $configuration.CorePort -Adapter $adapter)) {
            throw "Core port $($configuration.CorePort) is occupied by an unowned listener; launch is refused."
        }
        if (-not (Test-EvPortAvailable -Port $configuration.WebPort -Adapter $adapter)) {
            throw "Web port $($configuration.WebPort) is occupied by an unowned listener; launch is refused."
        }

        $core = Start-EvChildProcess -Spec (New-EvChildProcessSpec -Role core -Configuration $configuration) -Adapter $adapter
        Update-EvLaunchLock -Lock $lock -Children @($core)
        if (-not (Test-EvCoreReady -CoreUrl $configuration.CoreUrl -TimeoutSeconds $ReadyTimeoutSeconds -Adapter $adapter)) {
            throw "Core did not become ready at $($configuration.CoreUrl)/v1/health/ready."
        }

        $web = Start-EvChildProcess -Spec (New-EvChildProcessSpec -Role web -Configuration $configuration) -Adapter $adapter
        Update-EvLaunchLock -Lock $lock -Children @($core, $web)
        $started = [pscustomobject]@{
            State = 'Started'
            RunId = $lock.Record.runId
            Core = $core
            Web = $web
            WebOrigin = $configuration.WebOrigin
        }
        if ($RunOnce) {
            return $started
        }

        while ($true) {
            Start-Sleep -Milliseconds $MonitorIntervalMilliseconds
            if ($null -eq (Get-EvVerifiedProcess -Identity $core -Adapter $adapter)) {
                throw 'Owned core child exited; managed dashboard will stop.'
            }
            if ($null -eq (Get-EvVerifiedProcess -Identity $web -Adapter $adapter)) {
                throw 'Owned web child exited; managed dashboard will stop.'
            }
        }
    }
    finally {
        Invoke-EvDashboardCleanup -Web $web -Core $core -Lock $lock -Adapter $adapter
    }
}

function ConvertTo-EvWindowsArgumentString {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string[]] $ArgumentList)

    $quoted = foreach ($argument in $ArgumentList) {
        if ($argument -notmatch '[\s"]') {
            $argument
            continue
        }

        $builder = New-Object System.Text.StringBuilder
        [void] $builder.Append('"')
        $backslashCount = 0
        foreach ($character in $argument.ToCharArray()) {
            if ($character -eq '\') {
                $backslashCount++
                continue
            }
            if ($character -eq '"') {
                [void] $builder.Append(('\' * (($backslashCount * 2) + 1)))
                [void] $builder.Append('"')
                $backslashCount = 0
                continue
            }
            if ($backslashCount -gt 0) {
                [void] $builder.Append(('\' * $backslashCount))
                $backslashCount = 0
            }
            [void] $builder.Append($character)
        }
        if ($backslashCount -gt 0) {
            [void] $builder.Append(('\' * ($backslashCount * 2)))
        }
        [void] $builder.Append('"')
        $builder.ToString()
    }

    return ($quoted -join ' ')
}

function Get-EvCurrentUserId {
    [CmdletBinding()]
    param()

    try {
        return [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    }
    catch {
        throw "Cannot resolve the current Windows user: $($_.Exception.Message)"
    }
}

function Get-EvPowerShellExecutable {
    [CmdletBinding()]
    param()

    $command = Get-Command pwsh -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $source = Get-EvObjectProperty -Object $command -Name 'Source'
    if ([string]::IsNullOrWhiteSpace([string] $source)) {
        $source = Get-EvObjectProperty -Object $command -Name 'Path'
    }
    if ([string]::IsNullOrWhiteSpace([string] $source)) {
        throw 'PowerShell 7 executable cannot be resolved for the managed task.'
    }
    return (Assert-EvAbsolutePath -Path ([string] $source) -Label 'PowerShell 7 executable' -MustExist)
}

function Assert-EvTaskName {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string] $TaskName)

    if ([string]::IsNullOrWhiteSpace($TaskName) -or $TaskName.Length -gt 200 -or $TaskName.IndexOfAny([char[]]@('\', '/')) -ge 0) {
        throw 'TaskName must be a simple, explicit task name.'
    }
    return $TaskName
}

function New-EvAutostartTaskDefinition {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Configuration,
        [ValidateRange(1, 600)] [int] $ReadyTimeoutSeconds = 60,
        [ValidateRange(100, 60000)] [int] $MonitorIntervalMilliseconds = 1000,
        [string] $TaskName = $script:EvAutostartTaskName
    )

    $launcherPath = Assert-EvAbsolutePath -Path (Join-Path $PSScriptRoot 'ev-dashboard.ps1') -Label 'launcher script' -MustExist
    $shellPath = Get-EvPowerShellExecutable
    $userId = Get-EvCurrentUserId
    $taskName = Assert-EvTaskName -TaskName $TaskName
    $launcherArguments = @(
        '-NoProfile',
        '-NonInteractive',
        '-File', $launcherPath,
        '-RepoRoot', $Configuration.RepoRoot,
        '-DataDir', $Configuration.DataDir,
        '-LogDir', $Configuration.LogDir,
        '-WebOrigin', $Configuration.WebOrigin,
        '-CorePort', [string] $Configuration.CorePort,
        '-WebPort', [string] $Configuration.WebPort,
        '-ReadyTimeoutSeconds', [string] $ReadyTimeoutSeconds,
        '-MonitorIntervalMilliseconds', [string] $MonitorIntervalMilliseconds
    )
    $metadata = [ordered]@{
        schemaVersion = 1
        owner = 'ev-ai-dashboard-v9-02'
        repoRoot = $Configuration.RepoRoot
        dataDir = $Configuration.DataDir
        logDir = $Configuration.LogDir
        webOrigin = $Configuration.WebOrigin
        corePort = $Configuration.CorePort
        webPort = $Configuration.WebPort
    } | ConvertTo-Json -Compress
    $description = "EV AI Assistant managed V9-02 task`n$metadata"

    return [pscustomobject]@{
        Name = $taskName
        TaskPath = $script:EvAutostartTaskPath
        Description = $description
        Execute = $shellPath
        Arguments = ConvertTo-EvWindowsArgumentString -ArgumentList $launcherArguments
        WorkingDirectory = $Configuration.RepoRoot
        UserId = $userId
        LogonType = 'Interactive'
        RunLevel = 'Limited'
        Trigger = 'AtLogOn'
    }
}

function Get-EvScheduledTask {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Definition,
        [System.Collections.IDictionary] $Adapter
    )

    if ($null -ne $Adapter) {
        return (Invoke-EvAdapter -Adapter $Adapter -Operation 'GetTask' -ArgumentList @($Definition))
    }

    try {
        return Get-ScheduledTask -TaskName $Definition.Name -TaskPath $Definition.TaskPath -ErrorAction Stop
    }
    catch {
        if ($_.Exception.Message -match 'cannot find|not found|No MSFT_ScheduledTask') {
            return $null
        }
        throw
    }
}

function Test-EvTaskDefinitionMatch {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Actual,
        [Parameter(Mandatory)] [object] $Expected
    )

    foreach ($name in @('Description', 'TaskName', 'TaskPath')) {
        $expectedName = if ($name -eq 'TaskName') { 'Name' } else { $name }
        $actualValue = Get-EvObjectProperty -Object $Actual -Name $name
        if ($null -eq $actualValue -and $name -eq 'TaskName') {
            $actualValue = Get-EvObjectProperty -Object $Actual -Name 'Name'
        }
        if ([string] $actualValue -ne [string] (Get-EvObjectProperty -Object $Expected -Name $expectedName)) {
            return $false
        }
    }

    $actions = @(Get-EvObjectProperty -Object $Actual -Name 'Actions')
    if ($actions.Count -ne 1) {
        return $false
    }
    $action = $actions[0]
    foreach ($name in @('Execute', 'Arguments', 'WorkingDirectory')) {
        if ([string] (Get-EvObjectProperty -Object $action -Name $name) -ne [string] (Get-EvObjectProperty -Object $Expected -Name $name)) {
            return $false
        }
    }

    $principal = Get-EvObjectProperty -Object $Actual -Name 'Principal'
    if ($null -eq $principal) {
        return $false
    }
    foreach ($name in @('UserId', 'LogonType', 'RunLevel')) {
        if ([string] (Get-EvObjectProperty -Object $principal -Name $name) -ne [string] (Get-EvObjectProperty -Object $Expected -Name $name)) {
            return $false
        }
    }

    $triggers = @(Get-EvObjectProperty -Object $Actual -Name 'Triggers')
    if ($triggers.Count -ne 1) {
        return $false
    }
    $trigger = $triggers[0]
    $triggerUserId = Get-EvObjectProperty -Object $trigger -Name 'UserId'
    if ([string] $triggerUserId -ne [string] $Expected.UserId) {
        return $false
    }

    return $true
}

function Register-EvScheduledTask {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Definition,
        [System.Collections.IDictionary] $Adapter
    )

    if ($null -ne $Adapter) {
        Invoke-EvAdapter -Adapter $Adapter -Operation 'RegisterTask' -ArgumentList @($Definition) | Out-Null
        return
    }

    $action = New-ScheduledTaskAction -Execute $Definition.Execute -Argument $Definition.Arguments -WorkingDirectory $Definition.WorkingDirectory
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $Definition.UserId
    $principal = New-ScheduledTaskPrincipal -UserId $Definition.UserId -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $Definition.Name -TaskPath $Definition.TaskPath -Action $action -Trigger $trigger -Principal $principal -Description $Definition.Description -ErrorAction Stop | Out-Null
}

function Remove-EvScheduledTask {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object] $Definition,
        [System.Collections.IDictionary] $Adapter
    )

    if ($null -ne $Adapter) {
        Invoke-EvAdapter -Adapter $Adapter -Operation 'RemoveTask' -ArgumentList @($Definition) | Out-Null
        return
    }

    Unregister-ScheduledTask -TaskName $Definition.Name -TaskPath $Definition.TaskPath -Confirm:$false -ErrorAction Stop
}

function Install-EvAutostart {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)] [string] $RepoRoot,
        [Parameter(Mandatory)] [string] $DataDir,
        [Parameter(Mandatory)] [string] $LogDir,
        [Parameter(Mandatory)] [string] $WebOrigin,
        [ValidateRange(1024, 65535)] [int] $CorePort = 4311,
        [ValidateRange(1024, 65535)] [int] $WebPort = 3000,
        [ValidateRange(1, 600)] [int] $ReadyTimeoutSeconds = 60,
        [ValidateRange(100, 60000)] [int] $MonitorIntervalMilliseconds = 1000,
        [string] $TaskName = $script:EvAutostartTaskName,
        [string] $TestAdapterPath
    )

    $isWhatIf = [bool] $WhatIfPreference
    $configuration = New-EvLauncherConfiguration -RepoRoot $RepoRoot -DataDir $DataDir -LogDir $LogDir -WebOrigin $WebOrigin -CorePort $CorePort -WebPort $WebPort -ProspectiveManagedDirectories
    $definition = New-EvAutostartTaskDefinition -Configuration $configuration -ReadyTimeoutSeconds $ReadyTimeoutSeconds -MonitorIntervalMilliseconds $MonitorIntervalMilliseconds -TaskName $TaskName
    $plan = [pscustomobject]@{
        State = if ($isWhatIf) { 'WhatIf' } else { 'Planned' }
        TaskName = $definition.Name
        TaskPath = $definition.TaskPath
        UserId = $definition.UserId
        Trigger = $definition.Trigger
        RunLevel = $definition.RunLevel
        Execute = $definition.Execute
        Arguments = $definition.Arguments
    }

    if ($isWhatIf) {
        $PSCmdlet.ShouldProcess("$($definition.TaskPath)$($definition.Name)", 'Register current-user AtLogOn task') | Out-Null
        return $plan
    }

    $adapter = if ([string]::IsNullOrWhiteSpace($TestAdapterPath)) { $null } else { Import-EvTestAdapter -Path $TestAdapterPath }
    $existing = Get-EvScheduledTask -Definition $definition -Adapter $adapter
    if ($null -ne $existing) {
        if (Test-EvTaskDefinitionMatch -Actual $existing -Expected $definition) {
            return [pscustomobject]@{ State = 'AlreadyInstalled'; TaskName = $definition.Name }
        }
        throw 'A same-name task exists but does not exactly match managed ownership; it will not be overwritten.'
    }

    if (-not $PSCmdlet.ShouldProcess("$($definition.TaskPath)$($definition.Name)", 'Register current-user AtLogOn task')) {
        return $plan
    }
    Register-EvScheduledTask -Definition $definition -Adapter $adapter
    return [pscustomobject]@{ State = 'Installed'; TaskName = $definition.Name }
}

function Uninstall-EvAutostart {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)] [string] $RepoRoot,
        [Parameter(Mandatory)] [string] $DataDir,
        [Parameter(Mandatory)] [string] $LogDir,
        [Parameter(Mandatory)] [string] $WebOrigin,
        [ValidateRange(1024, 65535)] [int] $CorePort = 4311,
        [ValidateRange(1024, 65535)] [int] $WebPort = 3000,
        [ValidateRange(1, 600)] [int] $ReadyTimeoutSeconds = 60,
        [ValidateRange(100, 60000)] [int] $MonitorIntervalMilliseconds = 1000,
        [string] $TaskName = $script:EvAutostartTaskName,
        [string] $TestAdapterPath
    )

    $isWhatIf = [bool] $WhatIfPreference
    $configuration = New-EvLauncherConfiguration -RepoRoot $RepoRoot -DataDir $DataDir -LogDir $LogDir -WebOrigin $WebOrigin -CorePort $CorePort -WebPort $WebPort -ProspectiveManagedDirectories
    $definition = New-EvAutostartTaskDefinition -Configuration $configuration -ReadyTimeoutSeconds $ReadyTimeoutSeconds -MonitorIntervalMilliseconds $MonitorIntervalMilliseconds -TaskName $TaskName
    $plan = [pscustomobject]@{
        State = if ($isWhatIf) { 'WhatIf' } else { 'Planned' }
        TaskName = $definition.Name
        TaskPath = $definition.TaskPath
    }

    if ($isWhatIf) {
        $PSCmdlet.ShouldProcess("$($definition.TaskPath)$($definition.Name)", 'Remove managed current-user task') | Out-Null
        return $plan
    }

    $adapter = if ([string]::IsNullOrWhiteSpace($TestAdapterPath)) { $null } else { Import-EvTestAdapter -Path $TestAdapterPath }
    $existing = Get-EvScheduledTask -Definition $definition -Adapter $adapter
    if ($null -eq $existing) {
        return [pscustomobject]@{ State = 'NotInstalled'; TaskName = $definition.Name }
    }
    if (-not (Test-EvTaskDefinitionMatch -Actual $existing -Expected $definition)) {
        throw 'A same-name task is not an exact managed task; it will not be removed.'
    }

    if (-not $PSCmdlet.ShouldProcess("$($definition.TaskPath)$($definition.Name)", 'Remove managed current-user task')) {
        return $plan
    }
    Remove-EvScheduledTask -Definition $definition -Adapter $adapter
    return [pscustomobject]@{ State = 'Removed'; TaskName = $definition.Name }
}
