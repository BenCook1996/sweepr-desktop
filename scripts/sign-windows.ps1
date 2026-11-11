<#
.SYNOPSIS
    Signs SWEEPR Cleaner Windows binaries (inner SWEEPRCleaner.exe, uninstall.exe, outer NSIS .exe, and WiX .msi)
    using SSL.com Authenticode + signtool.exe, verifies the Authenticode signature + RFC 3161 timestamp,
    and updates Winget, Chocolatey & PAD XML metadata.

.EXAMPLE
    .\scripts\sign-windows.ps1
    .\scripts\sign-windows.ps1 -File "app\src-tauri\target\release\SWEEPRCleaner.exe"
    .\scripts\sign-windows.ps1 -CertThumbprint "1800DBEA6FE847D384E549D02CA372C3D45D8B81"
#>
param(
    [Parameter(Position = 0)]
    [string]$File = "",
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

function Invoke-SignAndVerify([string]$TargetPath) {
    if (-not (Test-Path $TargetPath)) {
        throw "Missing binary to sign: $TargetPath"
    }

    $LocalCert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $CertThumbprint } |
        Select-Object -First 1

    if ($LocalCert) {
        Write-Host "`nSigning via local cert store ($CertThumbprint): $TargetPath" -ForegroundColor Yellow
        & $SignTool sign /fd sha256 /tr $TimestampUrl /td sha256 /sha1 $CertThumbprint /v $TargetPath
        if ($LASTEXITCODE -ne 0) {
            throw "signtool.exe failed on $TargetPath (exit code $LASTEXITCODE)"
        }
    } else {
        $ExistingSig = Get-AuthenticodeSignature -FilePath $TargetPath
        if ($ExistingSig.Status -eq "Valid" -and $ExistingSig.SignerCertificate.Thumbprint -eq $CertThumbprint) {
            Write-Host "`nBinary already bears valid SSL.com Authenticode signature ($CertThumbprint): $TargetPath" -ForegroundColor Green
        } else {
            Write-Host "`nSigning: $TargetPath" -ForegroundColor Yellow
            if ($CertThumbprint) {
                & $SignTool sign /fd sha256 /tr $TimestampUrl /td sha256 /sha1 $CertThumbprint /v $TargetPath
            } else {
                & $SignTool sign /fd sha256 /tr $TimestampUrl /td sha256 /a /v $TargetPath
            }
            if ($LASTEXITCODE -ne 0) {
                throw "signtool.exe failed on $TargetPath (exit code $LASTEXITCODE)"
            }
        }
    }

    Write-Host "Verifying signature: $TargetPath" -ForegroundColor Green
    & $SignTool verify /pa /v $TargetPath
    if ($LASTEXITCODE -ne 0) {
        throw "Signature verification failed on $TargetPath"
    }
}

# 2A. Single-file mode (invoked by Tauri bundle.windows.signCommand for inner .exe, uninstall.exe, NSIS .exe, and WiX .msi)
if (-not [string]::IsNullOrWhiteSpace($File)) {
    Invoke-SignAndVerify -TargetPath $File
    exit 0
}

# 2B. Standalone release mode: sign & verify server\public\SWEEPRCleaner.exe alongside server\public\Sweepr_Setup.msi
$CleanerExe = Join-Path $RepoRoot "server\public\SWEEPRCleaner.exe"
$CleanerMsi = Join-Path $RepoRoot "server\public\Sweepr_Setup.msi"

Invoke-SignAndVerify -TargetPath $CleanerExe
Invoke-SignAndVerify -TargetPath $CleanerMsi

# 3. Update Winget manifest SHA-256, Chocolatey, and PAD XML size via A13 release syndication script
$NewExeHash = (Get-FileHash -Path $CleanerExe -Algorithm SHA256).Hash.ToUpperInvariant()
$NewMsiHash = (Get-FileHash -Path $CleanerMsi -Algorithm SHA256).Hash.ToUpperInvariant()
$TauriConfPath = Join-Path $RepoRoot "app\src-tauri\tauri.conf.json"
$ReleaseVersion = "0.1.0"
if (Test-Path $TauriConfPath) {
    $TauriConf = Get-Content -Path $TauriConfPath -Raw | ConvertFrom-Json
    if ($TauriConf.version) {
        $ReleaseVersion = $TauriConf.version
    }
}
$UpdateListingsScript = Join-Path $RepoRoot "server\scripts\update-release-listings.mjs"
if (Test-Path $UpdateListingsScript) {
    & node $UpdateListingsScript "--version=$ReleaseVersion" "--exe-sha256=$NewExeHash" "--msi-sha256=$NewMsiHash"
    Write-Host "`nUpdated Winget, Chocolatey & PAD XML via A13 update-release-listings.mjs (v$ReleaseVersion, EXE_SHA256=$NewExeHash, MSI_SHA256=$NewMsiHash)" -ForegroundColor Green
}

Write-Host "`nSWEEPRCleaner.exe and Sweepr_Setup.msi signed and verified! Next step: upload signed binaries to https://www.microsoft.com/en-us/wdsi/filesubmission?persona=SoftwareDeveloper" -ForegroundColor Cyan
