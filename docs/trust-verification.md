# SWEEPR Cleaner — Trust, Code Signing & Verification Guide

**Publisher / Legal Entity:** Benjamin Cook t/a SWEEPR Cleaner  
**Support Contact:** support@sweeprcleaner.com  
**Official Website:** https://sweeprcleaner.com  
**Source & Issue Tracker:** https://github.com/BenCook1996/sweepr-desktop  
**Canonical Checksum Manifest:** https://sweeprcleaner.com/release-manifest.json  

---

## 1. Three-Layer Integrity & Authenticity Model

Every official SWEEPR Cleaner binary is protected by three independent, publicly verifiable trust layers:

1. **OS Code Signing (Authenticode on Windows / Hardened Runtime on macOS)** — proves publisher identity and detects any tampering after build.
2. **Published SHA-256 Checksums (`release-manifest.json`)** — allows offline or pre-execution hash comparison against canonical release metadata.
3. **In-App Ed25519 Update Signatures (`.sig`)** — detached Base64 Ed25519 signatures verified by the desktop app against a compiled-in public key before applying updates.

---

## 2. Code-Signing Certificates & Build Identities

### 2.1 Windows Authenticode (SSL.com — Release & Local Builds)
- **Signer Subject:** `CN=Benjamin Cook, O=Benjamin Cook, L=Worthing, C=GB`
- **Issuer:** `CN=SSL.com Code Signing Intermediate CA RSA R1, O=SSL Corp, L=Houston, S=Texas, C=US`
- **Certificate Thumbprint (SHA-1):** `1800DBEA6FE847D384E549D02CA372C3D45D8B81`
- **Digest Algorithm:** `SHA-256`
- **RFC 3161 Timestamp Authority:** `http://ts.ssl.com`

### 2.2 Windows CI Signing (Azure Artifact Signing — GitHub Actions)
When automated CI builds run with Azure Artifact Signing configured in `.github/workflows/build-apps.yml`:
- **Endpoint:** `https://eus.codesigning.azure.net/`
- **Account / Profile:** `sweepr-signing` / `sweepr-prod-profile`
- **Digest Algorithm:** `SHA-256`
- **RFC 3161 Timestamp Authority:** `http://timestamp.acs.microsoft.com`

### 2.3 macOS Code Signing & Notarization
- **Hardened Runtime:** Enabled (`--options runtime`) with `app/src-tauri/entitlements.plist`
- **Signing Identity:** Apple Developer ID Application certificate (`SWEEPRCleaner.app` and `SWEEPRCleaner.dmg`)
- **Notarization & Stapling:** Submitted via `xcrun notarytool submit ... --wait` and stapled via `xcrun stapler staple` (when Apple Developer credentials are configured in CI)

---

## 3. Verifying Downloads Yourself

### 3.1 Windows — PowerShell (`Get-AuthenticodeSignature` + `Get-FileHash`)

Verify the digital signature, certificate thumbprint, timestamp, and SHA-256 checksum of the downloaded installer:

```powershell
# 1. Verify Authenticode signature & certificate thumbprint
Get-AuthenticodeSignature "$env:USERPROFILE\Downloads\SWEEPRCleaner.exe" |
  Format-List Status, StatusMessage,
    @{ N = 'Subject'; E = { $_.SignerCertificate.Subject } },
    @{ N = 'Thumbprint'; E = { $_.SignerCertificate.Thumbprint } },
    @{ N = 'TimestampSigner'; E = { $_.TimeStamperCertificate.Subject } }

# Expected for SSL.com release builds:
#   Status     : Valid
#   Subject    : CN=Benjamin Cook, O=Benjamin Cook, L=Worthing, C=GB
#   Thumbprint : 1800DBEA6FE847D384E549D02CA372C3D45D8B81
# (CI Azure Artifact Signing builds show Status : Valid with a Microsoft/Azure Artifact Signing chain.)

# 2. Verify SHA-256 checksum
Get-FileHash "$env:USERPROFILE\Downloads\SWEEPRCleaner.exe" -Algorithm SHA256
Get-FileHash "$env:USERPROFILE\Downloads\Sweepr_Setup.msi" -Algorithm SHA256
```

Maintainers and IT administrators can also run the repository verification script in read-only mode:

```powershell
.\scripts\sign-windows.ps1 -File "server\public\SWEEPRCleaner.exe" -VerifyOnly
```

> **Current `v0.1.0` MSI Note:** On disk, `server/public/SWEEPRCleaner.exe` (`v0.1.0`) carries the SSL.com Authenticode signature (`1800DBEA6FE847D384E549D02CA372C3D45D8B81`), whereas the initial `v0.1.0` `server/public/Sweepr_Setup.msi` installer on disk does not yet embed an Authenticode signature and is verified via its published SHA-256 (`release-manifest.json`) and Ed25519 `.sig` sidecar (`Sweepr_Setup.msi.sig`). In CI release builds (`.github/workflows/build-apps.yml`), Azure Artifact Signing (`azure/artifact-signing-action@v1`) signs both `.exe` and `.msi` outputs.

### 3.2 Windows — Command Prompt (`certutil`)

```cmd
certutil -hashfile "%USERPROFILE%\Downloads\SWEEPRCleaner.exe" SHA256
certutil -hashfile "%USERPROFILE%\Downloads\Sweepr_Setup.msi" SHA256
```

### 3.3 macOS — Terminal (`shasum`, `codesign`, `spctl`)

```bash
# 1. Verify DMG SHA-256 checksum
shasum -a 256 ~/Downloads/SWEEPRCleaner.dmg

# 2. Inspect code signature & Hardened Runtime flags
codesign -dv --verbose=4 /Applications/SWEEPRCleaner.app

# 3. Verify Gatekeeper / notarization assessment
spctl --assess --type execute --verbose=4 /Applications/SWEEPRCleaner.app
```

### 3.4 Comparing Against the Live Release Manifest

Compare your computed SHA-256 and byte count directly against `https://sweeprcleaner.com/release-manifest.json`:

```powershell
$manifest = Invoke-RestMethod "https://sweeprcleaner.com/release-manifest.json"
$localExe = (Get-FileHash "$env:USERPROFILE\Downloads\SWEEPRCleaner.exe" -Algorithm SHA256).Hash
if ($localExe -eq $manifest.exe.sha256) {
  Write-Host "MATCH: SWEEPRCleaner.exe v$($manifest.version) ($($manifest.exe.bytes) bytes)" -ForegroundColor Green
} else {
  throw "MISMATCH! Expected $($manifest.exe.sha256), got $localExe"
}
```

---

## 4. Verified Release Checksums (`v0.1.0`)

Matches `server/public/release-manifest.json` and `README.md`:

| Artifact | Platform | Size (bytes) | SHA-256 | Current `v0.1.0` Verification |
| --- | --- | ---: | --- | --- |
| `SWEEPRCleaner.exe` | Windows (NSIS Setup, x64) | `7,085,912` | `FEAE464CA121CF897D27916C632F4DB8F84A87D4B79642403AD1B0E0F2BB706A` | Authenticode (`1800DBEA6FE847D384E549D02CA372C3D45D8B81`) + SHA-256 + `.sig` (Ed25519) |
| `Sweepr_Setup.msi` | Windows (WiX MSI, x64) | `3,993,600` | `33E5427E84AB8FC4F3D01DFD17404F7CB38B70B9731A8C2CCFBB62876711933A` | SHA-256 + `.sig` (Ed25519); CI release builds also apply Azure Artifact Signing |
| `SWEEPRCleaner.dmg` | macOS (Universal DMG) | `7,420,734` | `88F3DF54147B629AFBC636274B215871871C8BB510BFFCC7095956E790EBE952` | SHA-256 (Developer ID / notarized in CI when Apple credentials configured) |
| `SWEEPRCleaner.apk` | Android | `3,383,176` | `620602F6B1A61DD392130D93CCE6B87E7F861E23D0317D47797352DE69CC7098` | SHA-256 |

---

## 5. In-App Ed25519 Auto-Update Verification (`.sig`)

When SWEEPR Cleaner downloads an update binary (`SWEEPRCleaner.exe` or `Sweepr_Setup.msi`), it also fetches the corresponding `.sig` sidecar (`SWEEPRCleaner.exe.sig` / `Sweepr_Setup.msi.sig`) and checks:

1. **PE Header Check:** Confirms the downloaded binary begins with a valid `MZ` header (`app/src-tauri/src/commands.rs`).
2. **SHA-256 Parity:** Matches the live `release-manifest.json` SHA-256 digest.
3. **Ed25519 Signature Verification:** Verifies the Base64 Ed25519 signature against the compiled-in public key:
   - `DEFAULT_PUBKEY_B64`: `t04hn-7TfW5RIemEhi4mKbZy6rHRYBO6HxeN5OOIR_8` (`app/src-tauri/src/licensing.rs`).

An update whose signature or SHA-256 fails verification is rejected and deleted before execution.

---

## 6. Microsoft SmartScreen (WDSI) & VirusTotal Submission Workflow

Because new releases of niche native utilities can encounter initial SmartScreen or heuristic AV warnings before download volume builds reputation, every signed release should follow this verification workflow:

1. **Sign & Verify Locally or via CI:**
   - Run `.\scripts\sign-windows.ps1` (or verify CI `azure/artifact-signing-action@v1` completed cleanly).
   - Confirm `Get-AuthenticodeSignature` reports `Status : Valid` with a valid RFC 3161 timestamp.
2. **Submit Signed Binaries to Microsoft WDSI:**
   - Portal: `https://www.microsoft.com/en-us/wdsi/filesubmission?persona=SoftwareDeveloper`
   - Submit both `SWEEPRCleaner.exe` and `Sweepr_Setup.msi` under the Software Developer persona so Microsoft Defender and SmartScreen analyze and whitelist the signed release hash.
3. **Publish VirusTotal Scan Reports:**
   - Upload `SWEEPRCleaner.exe`, `Sweepr_Setup.msi`, and `SWEEPRCleaner.dmg` to [VirusTotal](https://www.virustotal.com/) and record the exact SHA-256 analysis URLs (`https://www.virustotal.com/gui/file/<sha256>`) in release notes and trust documentation.
4. **Public Rule Transparency:**
   - Cleanup paths, exclusions, and network call transparency are documented in `docs/public-rules-catalog.json` for independent community and security audit.
