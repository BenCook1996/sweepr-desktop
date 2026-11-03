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

# 3. Update Winget manifest SHA-256 and PAD XML size for SWEEPRCleaner.exe
$NewHash = (Get-FileHash -Path $CleanerExe -Algorithm SHA256).Hash.ToUpperInvariant()
$WingetManifest = Join-Path $RepoRoot "winget-manifests\s\SWEEPR\Cleaner\0.1.0\SWEEPR.Cleaner.installer.yaml"
if (Test-Path $WingetManifest) {
    $Content = Get-Content -Path $WingetManifest -Raw
    $Updated = $Content -replace "(?m)^(\s*InstallerSha256:\s*)[A-F0-9]{64}", "`${1}$NewHash"
    Set-Content -Path $WingetManifest -Value $Updated -NoNewline
    Write-Host "`nUpdated Winget InstallerSha256 -> $NewHash" -ForegroundColor Green
}

$PadXml = Join-Path $RepoRoot "server\public\pad.xml"
if (Test-Path $PadXml) {
    $SizeBytes = (Get-Item $CleanerExe).Length
    $SizeKB = [Math]::Round($SizeBytes / 1024)
    $SizeMB = [Math]::Round($SizeBytes / (1024 * 1024), 2).ToString("0.00", [System.Globalization.CultureInfo]::InvariantCulture)
    $PadContent = Get-Content -Path $PadXml -Raw
    $PadContent = $PadContent -replace "<File_Size_Bytes>\d+</File_Size_Bytes>", "<File_Size_Bytes>$SizeBytes</File_Size_Bytes>"
    $PadContent = $PadContent -replace "<File_Size_K>\d+</File_Size_K>", "<File_Size_K>$SizeKB</File_Size_K>"
    $PadContent = $PadContent -replace "<File_Size_MB>[0-9.]+</File_Size_MB>", "<File_Size_MB>$SizeMB</File_Size_MB>"
    Set-Content -Path $PadXml -Value $PadContent -NoNewline
    Write-Host "Updated server\public\pad.xml -> $SizeBytes bytes ($SizeMB MB)" -ForegroundColor Green
}

Write-Host "`nSWEEPRCleaner.exe signed and verified! Next step: upload signed .exe to https://www.microsoft.com/en-us/wdsi/filesubmission?persona=SoftwareDeveloper" -ForegroundColor Cyan
