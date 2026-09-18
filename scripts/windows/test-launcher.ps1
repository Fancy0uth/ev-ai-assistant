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
    [string] $TaskName = 'EV AI Dashboard',
    [string] $TestAdapterPath
)

$ErrorActionPreference = 'Stop'

$common = @{
    RepoRoot = $RepoRoot
    DataDir = $DataDir
    LogDir = $LogDir
    WebOrigin = $WebOrigin
    CorePort = $CorePort
    WebPort = $WebPort
    ReadyTimeoutSeconds = $ReadyTimeoutSeconds
    MonitorIntervalMilliseconds = $MonitorIntervalMilliseconds
    WhatIf = $true
}
if (-not [string]::IsNullOrWhiteSpace($TestAdapterPath)) {
    $common.TestAdapterPath = $TestAdapterPath
}

$launcherPlan = & (Join-Path $PSScriptRoot 'ev-dashboard.ps1') @common
$taskPlan = @{}
$taskPlan.Install = & (Join-Path $PSScriptRoot 'install-autostart.ps1') @common -TaskName $TaskName
$taskPlan.Uninstall = & (Join-Path $PSScriptRoot 'uninstall-autostart.ps1') @common -TaskName $TaskName

[pscustomobject]@{
    State = 'WhatIfOnly'
    Launcher = $launcherPlan
    Autostart = $taskPlan
} | ConvertTo-Json -Depth 12 -Compress
