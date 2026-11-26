<#
.SYNOPSIS
    Signs or verifies SWEEPR Cleaner Windows binaries (inner SWEEPRCleaner.exe, uninstall.exe, outer NSIS .exe, and WiX .msi)
    using SSL.com Authenticode + signtool.exe, verifies the Authenticode signature + RFC 3161 timestamp,
    and updates Winget, Chocolatey, Scoop, Homebrew & PAD XML metadata.

.EXAMPLE
    .\scripts\sign-windows.ps1
    .\scripts\sign-windows.ps1 -File "app\src-tauri\target\release\SWEEPRCleaner.exe"
    .\scripts\sign-windows.ps1 -File "server\public\SWEEPRCleaner.exe" -VerifyOnly
    .\scripts\sign-windows.ps1 -CertThumbprint "1800DBEA6FE847D384E549D02CA372C3D45D8B81"
#>
param(
    [Parameter(Position = 0)]
    [string]$File = "",
    [string]$CertThumbprint = $(if ($env:SWEEPR_CERT_THUMBPRINT) { $env:SWEEPR_CERT_THUMBPRINT } else { "1800DBEA6FE847D384E549D02CA372C3D45D8B81" }),
    [string]$TimestampUrl = "http://ts.ssl.com",
    [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not [string]::IsNullOrWhiteSpace($CertThumbprint)) {
    $CertThumbprint = ($CertThumbprint -replace '\s+', '').ToUpperInvariant()
}

function Find-SignTool {
    $kitRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (Test-Path $kitRoot) {
        $allSignTools = @(
            Get-ChildItem -Path $kitRoot -Filter "signtool.exe" -Recurse -ErrorAction SilentlyContinue
        )
        $x64Candidates = @(
            $allSignTools |
                Where-Object { $_.FullName -match "x64\\signtool\.exe$" } |
                Sort-Object FullName -Descending |
                Select-Object -ExpandProperty FullName
        )
        if ($x64Candidates.Count -gt 0) {
            return $x64Candidates[0]
        }
        $arm64Candidates = @(
            $allSignTools |
                Where-Object { $_.FullName -match "arm64\\signtool\.exe$" } |
                Sort-Object FullName -Descending |
                Select-Object -ExpandProperty FullName
        )
        if ($arm64Candidates.Count -gt 0) {
            return $arm64Candidates[0]
        }
    }

    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }

    return $null
}

$script:SignTool = $null

function Get-SignToolPath {
    if (-not $script:SignTool) {
        $script:SignTool = Find-SignTool
        if (-not $script:SignTool) {
            throw "signtool.exe not found. Please install the Windows 10/11 SDK Signing Tools."
        }
        Write-Host "Using SignTool: $($script:SignTool)" -ForegroundColor Cyan
    }
    return $script:SignTool
}

function Write-SignatureSummary([string]$TargetPath) {
    $sig = Get-AuthenticodeSignature -FilePath $TargetPath
    $hash = (Get-FileHash -Path $TargetPath -Algorithm SHA256).Hash.ToUpperInvariant()
    $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "<none>" }
    $thumb = if ($sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint } else { "<none>" }
    $tsSigner = if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Subject } else { "<none>" }
    Write-Host "  Status          : $($sig.Status)" -ForegroundColor Gray
    Write-Host "  Signer Subject  : $subject" -ForegroundColor Gray
    Write-Host "  Thumbprint      : $thumb" -ForegroundColor Gray
    Write-Host "  Timestamp Signer: $tsSigner" -ForegroundColor Gray
    Write-Host "  SHA-256         : $hash" -ForegroundColor Gray
    return $sig
}

function Invoke-SignAndVerify([string]$TargetPath) {
    if (-not (Test-Path $TargetPath)) {
        throw "Missing binary to sign: $TargetPath"
    }

    $LocalCert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -and ($_.Thumbprint.ToUpperInvariant() -eq $CertThumbprint) } |
        Select-Object -First 1

    # CI Azure Artifact Signing guard: during Tauri signCommand on GitHub Actions, skip local signtool
    # if AZURE_CLIENT_ID is configured and the local SSL.com cert is absent so azure/artifact-signing-action@v1
    # signs the bundled .exe/.msi artifacts post-bundle cleanly.
    if (-not $VerifyOnly -and -not $LocalCert -and -not [string]::IsNullOrWhiteSpace($env:AZURE_CLIENT_ID) -and -not [string]::IsNullOrWhiteSpace($File)) {
        Write-Host "Skipping local signtool during Tauri bundle because AZURE_CLIENT_ID is set (Azure Artifact Signing runs post-bundle): $TargetPath" -ForegroundColor Cyan
        return
    }

    if ($VerifyOnly) {
        Write-Host "`nVerifying signature (VerifyOnly): $TargetPath" -ForegroundColor Green
        $sigToolExe = Find-SignTool
        if ($sigToolExe) {
            Write-Host "Using SignTool: $sigToolExe" -ForegroundColor Cyan
            & $sigToolExe verify /pa /v $TargetPath
            if ($LASTEXITCODE -ne 0) {
                throw "Signature verification failed on $TargetPath"
            }
        } else {
            Write-Host "signtool.exe not found; falling back to Get-AuthenticodeSignature" -ForegroundColor Yellow
        }
        $sig = Write-SignatureSummary -TargetPath $TargetPath
        if ($sig.Status -ne "Valid") {
            throw "Authenticode signature status is $($sig.Status) on $TargetPath"
        }
        if ($CertThumbprint -and (-not $sig.SignerCertificate -or $sig.SignerCertificate.Thumbprint.ToUpperInvariant() -ne $CertThumbprint)) {
            Write-Warning "Signer thumbprint ($($sig.SignerCertificate.Thumbprint)) does not match expected SSL.com thumbprint ($CertThumbprint)."
        }
        return
    }

    $sigToolExe = Get-SignToolPath

    if ($LocalCert) {
        Write-Host "`nSigning via local cert store ($CertThumbprint): $TargetPath" -ForegroundColor Yellow
        & $sigToolExe sign /fd sha256 /tr $TimestampUrl /td sha256 /sha1 $CertThumbprint /v $TargetPath
        if ($LASTEXITCODE -ne 0) {
            throw "signtool.exe failed on $TargetPath (exit code $LASTEXITCODE)"
        }
    } else {
        $ExistingSig = Get-AuthenticodeSignature -FilePath $TargetPath
        $existingThumb = if ($ExistingSig.SignerCertificate) { $ExistingSig.SignerCertificate.Thumbprint.ToUpperInvariant() } else { "" }
        if ($ExistingSig.Status -eq "Valid" -and $existingThumb -eq $CertThumbprint) {
            Write-Host "`nBinary already bears valid SSL.com Authenticode signature ($CertThumbprint): $TargetPath" -ForegroundColor Green
        } else {
            Write-Host "`nSigning: $TargetPath" -ForegroundColor Yellow
            if ($CertThumbprint) {
                & $sigToolExe sign /fd sha256 /tr $TimestampUrl /td sha256 /sha1 $CertThumbprint /v $TargetPath
            } else {
                & $sigToolExe sign /fd sha256 /tr $TimestampUrl /td sha256 /a /v $TargetPath
            }
            if ($LASTEXITCODE -ne 0) {
                throw "signtool.exe failed on $TargetPath (exit code $LASTEXITCODE)"
            }
        }
    }

    Write-Host "Verifying signature: $TargetPath" -ForegroundColor Green
    & $sigToolExe verify /pa /v $TargetPath
    if ($LASTEXITCODE -ne 0) {
        throw "Signature verification failed on $TargetPath"
    }
    [void](Write-SignatureSummary -TargetPath $TargetPath)
}

# 2A. Single-file mode (invoked by Tauri bundle.windows.signCommand for inner .exe, uninstall.exe, NSIS .exe, and WiX .msi)
if (-not [string]::IsNullOrWhiteSpace($File)) {
    Invoke-SignAndVerify -TargetPath $File
    exit 0
}

# 2B. Standalone release mode: sign or verify server\public\SWEEPRCleaner.exe alongside server\public\Sweepr_Setup.msi
$CleanerExe = Join-Path $RepoRoot "server\public\SWEEPRCleaner.exe"
$CleanerMsi = Join-Path $RepoRoot "server\public\Sweepr_Setup.msi"

Invoke-SignAndVerify -TargetPath $CleanerExe
Invoke-SignAndVerify -TargetPath $CleanerMsi

if ($VerifyOnly) {
    Write-Host "`nVerifyOnly completed for SWEEPRCleaner.exe and Sweepr_Setup.msi." -ForegroundColor Cyan
    exit 0
}

# 3. Update Winget, Chocolatey, Scoop, Homebrew & PAD XML metadata via release syndication script
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
    & node $UpdateListingsScript "--version=$ReleaseVersion"
    Write-Host "`nUpdated release manifests & listings via update-release-listings.mjs (v$ReleaseVersion, EXE_SHA256=$NewExeHash, MSI_SHA256=$NewMsiHash)" -ForegroundColor Green
}

Write-Host "`nSWEEPRCleaner.exe and Sweepr_Setup.msi signed and verified! Next steps: submit signed binaries to Microsoft WDSI (https://www.microsoft.com/en-us/wdsi/filesubmission?persona=SoftwareDeveloper) and VirusTotal, and update checksums per docs/trust-verification.md." -ForegroundColor Cyan
