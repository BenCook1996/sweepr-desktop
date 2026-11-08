<#
.SYNOPSIS
    Signs SWEEPR Cleaner Windows installer (server\public\SWEEPRCleaner.exe) using SSL.com Authenticode + signtool.exe,
    verifies the Authenticode signature + RFC 3161 timestamp, and updates Winget & PAD XML metadata.

.EXAMPLE
    .\scripts\sign-windows.ps1
    .\scripts\sign-windows.ps1 -CertThumbprint "1800DBEA6FE847D384E549D02CA372C3D45D8B81"
#>
param(
    [string]$CertThumbprint = $(if ($env:SWEEPR_CERT_THUMBPRINT) { $env:SWEEPR_CERT_THUMBPRINT } else { "1800DBEA6FE847D384E549D02CA372C3D45D8B81" }),
    [string]$TimestampUrl = "http://ts.ssl.com"
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

# 2. Sign SWEEPR Cleaner Windows executable
$CleanerExe = Join-Path $RepoRoot "server\public\SWEEPRCleaner.exe"
if (-not (Test-Path $CleanerExe)) {
    throw "Missing installer: $CleanerExe"
}

Write-Host "`nSigning: $CleanerExe" -ForegroundColor Yellow
if ($CertThumbprint) {
    & $SignTool sign /fd sha256 /tr $TimestampUrl /td sha256 /sha1 $CertThumbprint /v $CleanerExe
} else {
    & $SignTool sign /fd sha256 /tr $TimestampUrl /td sha256 /a /v $CleanerExe
}
if ($LASTEXITCODE -ne 0) {
    throw "signtool.exe failed on $CleanerExe (exit code $LASTEXITCODE)"
}

Write-Host "Verifying signature: $CleanerExe" -ForegroundColor Green
& $SignTool verify /pa /v $CleanerExe
if ($LASTEXITCODE -ne 0) {
    throw "Signature verification failed on $CleanerExe"
}

# 3. Update Winget manifest SHA-256, Chocolatey, and PAD XML size via A13 release syndication script
$NewHash = (Get-FileHash -Path $CleanerExe -Algorithm SHA256).Hash.ToUpperInvariant()
$TauriConfPath = Join-Path $RepoRoot "src-tauri\tauri.conf.json"
$ReleaseVersion = "0.1.0"
if (Test-Path $TauriConfPath) {
    $TauriConf = Get-Content -Path $TauriConfPath -Raw | ConvertFrom-Json
    if ($TauriConf.version) {
        $ReleaseVersion = $TauriConf.version
    }
}
$UpdateListingsScript = Join-Path $RepoRoot "server\scripts\update-release-listings.mjs"
if (Test-Path $UpdateListingsScript) {
    & node $UpdateListingsScript --version $ReleaseVersion --exe-sha256 $NewHash
    Write-Host "`nUpdated Winget, Chocolatey & PAD XML via A13 update-release-listings.mjs (v$ReleaseVersion, SHA256=$NewHash)" -ForegroundColor Green
}

Write-Host "`nSWEEPRCleaner.exe signed and verified! Next step: upload signed .exe to https://www.microsoft.com/en-us/wdsi/filesubmission?persona=SoftwareDeveloper" -ForegroundColor Cyan
