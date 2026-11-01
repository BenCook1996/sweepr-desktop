<#
.SYNOPSIS
    Signs SWEEPR Cleaner (and optionally SWEEPR VPN) Windows executables using SSL.com eSigner CKA + signtool.exe,
    verifies the Authenticode signature + RFC 3161 timestamp, and updates Winget & PAD XML SHA-256 hashes.

.EXAMPLE
    .\scripts\sign-windows.ps1
    .\scripts\sign-windows.ps1 -CertThumbprint "YOUR_SSL_COM_CERT_THUMBPRINT"
#>
param(
    [string]$CertThumbprint = $env:SWEEPR_CERT_THUMBPRINT,
    [string]$TimestampUrl = "http://ts.ssl.com",
    [switch]$IncludeVpn = $true
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

# 1. Locate signtool.exe from Windows 10/11 SDK
$SignToolCandidates = @(
    Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter "signtool.exe" -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "x64\\signtool\.exe$" } |
        Sort-Object FullName -Descending |
        Select-Object -ExpandProperty FullName
)
if (-not $SignToolCandidates -or $SignToolCandidates.Count -eq 0) {
    throw "signtool.exe not found. Please install the Windows 10/11 SDK Signing Tools."
}
$SignTool = $SignToolCandidates[0]
Write-Host "Using SignTool: $SignTool" -ForegroundColor Cyan

# 2. Collect target executables to sign
$Targets = @(
    Join-Path $RepoRoot "server\public\SWEEPRCleaner.exe"
)

if ($IncludeVpn) {
    $VpnCandidates = @(
        "C:\Users\Benjamin\Downloads\vpn\desktop-client\SweeprVpnApp.exe",
        "C:\Users\Benjamin\Downloads\vpn\website\downloads\SWEEPRVPN.exe",
        "C:\Users\Benjamin\Downloads\vpn\website\public\SWEEPRVPN.exe",
        "C:\Users\Benjamin\Downloads\vpn\website\SWEEPRVPN.exe"
    )
    foreach ($candidate in $VpnCandidates) {
        if (Test-Path $candidate) {
            $Targets += $candidate
        }
    }
}

foreach ($exe in $Targets) {
    if (-not (Test-Path $exe)) {
        Write-Warning "Skipping missing file: $exe"
        continue
    }

    Write-Host "`nSigning: $exe" -ForegroundColor Yellow
    if ($CertThumbprint) {
        & $SignTool sign /fd sha256 /tr $TimestampUrl /td sha256 /sha1 $CertThumbprint /v $exe
    } else {
        & $SignTool sign /fd sha256 /tr $TimestampUrl /td sha256 /a /v $exe
    }
    if ($LASTEXITCODE -ne 0) {
        throw "signtool.exe failed on $exe (exit code $LASTEXITCODE)"
    }

    Write-Host "Verifying signature: $exe" -ForegroundColor Green
    & $SignTool verify /pa /v $exe
    if ($LASTEXITCODE -ne 0) {
        throw "Signature verification failed on $exe"
    }
}

# 3. Update Winget manifest SHA-256 for SWEEPRCleaner.exe
$CleanerExe = Join-Path $RepoRoot "server\public\SWEEPRCleaner.exe"
if (Test-Path $CleanerExe) {
    $NewHash = (Get-FileHash -Path $CleanerExe -Algorithm SHA256).Hash.ToUpperInvariant()
    $WingetManifest = Join-Path $RepoRoot "winget-manifests\s\SWEEPR\Cleaner\0.1.0\SWEEPR.Cleaner.installer.yaml"
    if (Test-Path $WingetManifest) {
        $Content = Get-Content -Path $WingetManifest -Raw
        $Updated = $Content -replace "(?m)^(\s*InstallerSha256:\s*)[A-F0-9]{64}", "`${1}$NewHash"
        Set-Content -Path $WingetManifest -Value $Updated -NoNewline
        Write-Host "`nUpdated Winget InstallerSha256 -> $NewHash" -ForegroundColor Green
    }
}

Write-Host "`nAll executables signed and verified! Next step: upload signed .exe files to https://www.microsoft.com/en-us/wdsi/filesubmission (Software Developer)" -ForegroundColor Cyan
