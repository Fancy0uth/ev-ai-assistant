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

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_ev-launcher-private.ps1')

$result = Start-EvDashboard `
    -RepoRoot $RepoRoot `
    -DataDir $DataDir `
    -LogDir $LogDir `
    -WebOrigin $WebOrigin `
    -CorePort $CorePort `
    -WebPort $WebPort `
    -ReadyTimeoutSeconds $ReadyTimeoutSeconds `
    -MonitorIntervalMilliseconds $MonitorIntervalMilliseconds `
    -TestAdapterPath $TestAdapterPath `
    -RunOnce:$RunOnce `
    -WhatIf:$WhatIfPreference

$result | ConvertTo-Json -Depth 8 -Compress
