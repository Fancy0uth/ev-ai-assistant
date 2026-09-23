[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $CaddyPath,
    [Parameter(Mandatory)] [string] $TlsDataDir,
    [Parameter(Mandatory)] [string] $TlsConfigDir,
    [Parameter(Mandatory)] [string] $LogDir
)

try {
    $ErrorActionPreference = 'Stop'
    . (Join-Path $PSScriptRoot '_ev-launcher-private.ps1')
    $caddyExecutable = Assert-EvAbsolutePath -Path $CaddyPath -Label 'Caddy executable' -MustExist
    $tlsDataDirectory = Ensure-EvManagedDirectory -Path $TlsDataDir -Label 'TLS data directory'
    $tlsConfigDirectory = Ensure-EvManagedDirectory -Path $TlsConfigDir -Label 'TLS configuration directory'
    $tlsLogDirectory = Ensure-EvManagedDirectory -Path $LogDir -Label 'TLS log directory'
    $env:XDG_DATA_HOME = $tlsDataDirectory
    $env:XDG_CONFIG_HOME = $tlsConfigDirectory
    $rootCertificate = Join-Path $tlsDataDirectory 'caddy/pki/authorities/local/root.crt'
    if (Test-Path -LiteralPath $rootCertificate) {
        $publicRoot = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($rootCertificate)
        [System.IO.File]::WriteAllText((Join-Path $tlsLogDirectory 'local-https-root-thumbprint.txt'), $publicRoot.Thumbprint)
    }
    # Trust is installed separately for the current user, never by this process.
    & $caddyExecutable run --config (Join-Path $PSScriptRoot 'Caddyfile.local-mvp') --adapter caddyfile 2>&1 |
        Out-File -LiteralPath (Join-Path $tlsLogDirectory 'local-https.log') -Append -Encoding utf8
    exit $LASTEXITCODE
} catch {
    if ([System.IO.Directory]::Exists($LogDir)) {
        $notice = @{ event = 'LOCAL_HTTPS_START_FAILED'; message = $_.Exception.Message } | ConvertTo-Json -Compress
        [System.IO.File]::AppendAllText((Join-Path $LogDir 'local-https-startup.log'), $notice + [Environment]::NewLine)
    }
    exit 1
}
