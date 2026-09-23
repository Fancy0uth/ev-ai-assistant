[CmdletBinding()]
param(
    [string] $WebOrigin,
    [string] $CoreHost,
    [ValidateRange(1, 65535)] [int] $CorePort = 4311,
    [ValidateRange(1, 65535)] [int] $WebPort = 3000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($WebOrigin)) {
    $WebOrigin = $env:EV_WEB_ORIGIN
}
if ([string]::IsNullOrWhiteSpace($CoreHost)) {
    $CoreHost = if ([string]::IsNullOrWhiteSpace($env:EV_CORE_HOST)) { '127.0.0.1' } else { $env:EV_CORE_HOST }
}

function New-PrivateAccessCheck {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [string] $Status
    )

    return [pscustomobject]@{
        name = $Name
        status = $Status
    }
}

function Test-LoopbackAddress {
    param([Parameter(Mandatory)] [System.Net.IPAddress] $Address)

    return $Address.Equals([System.Net.IPAddress]::Loopback) -or $Address.Equals([System.Net.IPAddress]::IPv6Loopback)
}

function Get-WebOriginStatus {
    param([string] $Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return 'NOT_CONFIGURED'
    }

    try {
        $uri = [System.Uri] $Value
    }
    catch {
        return 'INVALID'
    }

    $isOriginOnly = $uri.IsAbsoluteUri -and $uri.UserInfo.Length -eq 0 -and $uri.Query.Length -eq 0 -and $uri.Fragment.Length -eq 0 -and $uri.AbsolutePath -eq '/'
    if (-not $isOriginOnly -or $uri.Scheme -notin @('http', 'https')) {
        return 'INVALID'
    }

    if ($uri.Scheme -eq 'http') {
        if ($uri.DnsSafeHost -in @('127.0.0.1', 'localhost', '::1')) {
            return 'LOOPBACK_HTTP_CONFIGURED'
        }
        return 'NON_LOOPBACK_HTTP_CONFIGURED'
    }

    return 'HTTPS_CONFIGURED_NOT_PROBED'
}

function Get-ListenerStatus {
    param(
        [Parameter(Mandatory)] [System.Net.IPEndPoint[]] $Listeners,
        [Parameter(Mandatory)] [int] $Port
    )

    $matchingListeners = @($Listeners | Where-Object { $_.Port -eq $Port })
    if ($matchingListeners.Count -eq 0) {
        return 'NOT_LISTENING'
    }

    $nonLoopbackListeners = @($matchingListeners | Where-Object { -not (Test-LoopbackAddress -Address $_.Address) })
    if ($nonLoopbackListeners.Count -gt 0) {
        return 'NON_LOOPBACK_LISTENER_DETECTED'
    }

    return 'LOOPBACK_ONLY'
}

$listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
$checks = @(
    (New-PrivateAccessCheck -Name 'web_origin_configuration' -Status (Get-WebOriginStatus -Value $WebOrigin)),
    (New-PrivateAccessCheck -Name 'core_host_configuration' -Status $(if ($CoreHost -eq '127.0.0.1') { 'LOOPBACK_CONFIGURED' } else { 'NON_LOOPBACK_CONFIGURED' })),
    (New-PrivateAccessCheck -Name 'core_listener' -Status (Get-ListenerStatus -Listeners $listeners -Port $CorePort)),
    (New-PrivateAccessCheck -Name 'web_listener' -Status (Get-ListenerStatus -Listeners $listeners -Port $WebPort))
)

$requiresAttention = @($checks | Where-Object {
    $_.status -in @('INVALID', 'NON_LOOPBACK_CONFIGURED', 'NON_LOOPBACK_HTTP_CONFIGURED', 'NON_LOOPBACK_LISTENER_DETECTED')
}).Count -gt 0

[pscustomobject]@{
    mode = 'READ_ONLY_LOCAL_CONFIGURATION_AND_LISTENER_CHECK'
    overall = if ($requiresAttention) { 'ATTENTION_REQUIRED' } else { 'LOCAL_STATE_REPORTED' }
    checks = $checks
    remoteRequests = 'NOT_PERFORMED'
    privateHttpsAuthentication = 'NOT_CHECKED'
    physicalDevice = 'NOT_CHECKED'
} | ConvertTo-Json -Depth 4
