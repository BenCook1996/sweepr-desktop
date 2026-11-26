# SWEEPR Cleaner — Enterprise & MDM Deployment Guide (Phase-1 Bridge)

**Target Installer:** `Sweepr_Setup.msi` (Machine-wide WiX MSI)  
**Download URL:** `https://sweeprcleaner.com/Sweepr_Setup.msi`  
**Canonical Checksum Source:** `https://sweeprcleaner.com/release-manifest.json`  
**Support:** support@sweeprcleaner.com  

---

## 1. Scope & Licensing Boundary

This document covers **Phase-1 silent deployment and policy provisioning** for IT administrators, managed labs, and small Windows fleets using Microsoft Intune, Active Directory GPO, or RMM tools.

- **Current License Model:** SWEEPR Cleaner Pro currently uses a **5-device consumer/prosumer license boundary** (`default_max_devices = 5` per account/pairing token).
- **No Dedicated B2B Multi-Seat Web Console Yet:** There is not yet a multi-tenant cloud MDM admin console or volume-seat billing portal. Organizations needing multi-seat arrangements beyond 5 devices per license should contact `support@sweeprcleaner.com`.

---

## 2. Silent MSI Deployment (`Sweepr_Setup.msi`)

`Sweepr_Setup.msi` installs machine-wide (`Scope: machine`) under `%ProgramFiles%\SWEEPRCleaner\`. Before deploying, verify the MSI SHA-256 against `https://sweeprcleaner.com/release-manifest.json` (see `docs/trust-verification.md`).

### Standard `msiexec` Commands

| Action | Command |
| --- | --- |
| **Silent install (no UI, no reboot)** | `msiexec.exe /i "Sweepr_Setup.msi" /qn /norestart` |
| **Silent install with verbose log** | `msiexec.exe /i "Sweepr_Setup.msi" /qn /norestart /L*v "%TEMP%\sweepr-install.log"` |
| **Passive progress bar only** | `msiexec.exe /i "Sweepr_Setup.msi" /qb /norestart` |
| **Silent uninstall (from MSI)** | `msiexec.exe /x "Sweepr_Setup.msi" /qn /norestart` |

### Alternative Per-User / Winget Commands

- **Winget (machine/user silent):**
  ```powershell
  winget install --id Sweepr.SweeprCleaner --exact --silent --accept-package-agreements --accept-source-agreements
  ```
- **NSIS EXE (`SWEEPRCleaner.exe`, per-user):**
  ```cmd
  SWEEPRCleaner.exe /S
  ```

### Silent Uninstall by Registry ProductCode

If the original `.msi` file is no longer cached locally, query the installed MSI ProductCode GUID:

```powershell
$app = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -like "SWEEPR*" -and $_.PSChildName -match '^\{[0-9A-Fa-f-]+\}$' } |
  Select-Object -First 1

if ($app) {
  Start-Process "msiexec.exe" -ArgumentList "/x $($app.PSChildName) /qn /norestart" -Wait
}
```

---

## 3. Headless Provisioning: Registry Policy & `--activate-token`

*(Note: `--activate-token` CLI provisioning and `HKLM\SOFTWARE\Policies\SWEEPRCleaner` policy lookup require current desktop client builds; verify target endpoints are running an updated build before rolling out automated activation.)*

### 3.1 Machine-Wide Policy Key (Recommended for Intune / GPO / `SYSTEM`)

Because `Sweepr_Setup.msi` deploys in `SYSTEM` context, interactive users read per-user state from `%AppData%\com.sweepr.cleaner\`. Setting a **machine-wide policy registry key** ensures every user session on the endpoint automatically picks up the managed pairing token without requiring per-user interactive login prompts:

- **Registry Path:** `HKEY_LOCAL_MACHINE\SOFTWARE\Policies\SWEEPRCleaner`
- **Value Name:** `ActivationToken`
- **Value Type:** `REG_SZ`
- **Value Data:** `ptk_...` (device-link pairing token generated from the SWEEPR Customer Portal)

#### PowerShell Provisioning Example

```powershell
$PolicyPath = "HKLM:\SOFTWARE\Policies\SWEEPRCleaner"
if (-not (Test-Path $PolicyPath)) {
  New-Item -Path $PolicyPath -Force | Out-Null
}
New-ItemProperty -Path $PolicyPath -Name "ActivationToken" -Value "ptk_REPLACE_WITH_PORTAL_TOKEN" -PropertyType String -Force | Out-Null
```

### 3.2 Headless CLI Token Activation (`--activate-token`)

For user-session login scripts, portable deployments, or scripted RMM jobs running in the **target user's session**, SWEEPR Cleaner supports headless token redemption *(note: the MSI and NSIS installers extract the main binary as `sweepr.exe`, whereas the portable ZIP packages it as `SWEEPRCleaner.exe`)*:

```cmd
"%ProgramFiles%\SWEEPRCleaner\sweepr.exe" --activate-token ptk_REPLACE_WITH_PORTAL_TOKEN
```

For portable ZIP deployments (writes credentials to `portable_data\` beside `SWEEPRCleaner.exe` when `--portable` or an adjacent `portable.flag` file is present):

```cmd
"D:\Tools\SWEEPRCleaner\SWEEPRCleaner.exe" --portable --activate-token ptk_REPLACE_WITH_PORTAL_TOKEN
```

> **Important `SYSTEM` vs. Interactive User `%AppData%` Caveat:**  
> Running `sweepr.exe --activate-token ...` (or `SWEEPRCleaner.exe --activate-token ...` from a non-portable script) directly inside an elevated Intune `SYSTEM` script writes sealed credentials (`account.json` / `entitlement.jws`) into the `SYSTEM` profile (`%SystemRoot%\System32\config\systemprofile\AppData\Roaming\com.sweepr.cleaner`) — **not** the signed-in user's `%AppData%`.  
> - Use **`HKLM\SOFTWARE\Policies\SWEEPRCleaner` (`ActivationToken`)** when deploying via Intune `SYSTEM` or GPO Computer Configuration.  
> - Use **`--activate-token`** only when executing in the interactive user context (e.g., Intune User-context script / logon script) or with **`--portable`** / **`portable.flag`** for a self-contained portable directory (`portable_data\`).

---

## 4. Deployment Checklists

### 4.1 Microsoft Intune Checklist
1. **Package App:** Upload `Sweepr_Setup.msi` as a Line-of-Business (LOB) MSI app or wrap in `.intunewin` Win32 package.
2. **Install Command:** `msiexec /i "Sweepr_Setup.msi" /qn /norestart`
3. **Uninstall Command:** `msiexec /x "{MSI-PRODUCT-CODE}" /qn /norestart`
4. **Install Behavior:** `System` (Device context).
5. **Detection Rule:** File exists at `C:\Program Files\SWEEPRCleaner\sweepr.exe` (or MSI ProductCode + Version `>= 0.1.0`). Note that MSI/NSIS installations place the executable at `sweepr.exe`, while portable ZIP builds use `SWEEPRCleaner.exe`.
6. **Activation Policy:** Deploy a PowerShell Platform Script / Proactive Remediation (running as `System`, 64-bit host) to set `HKLM:\SOFTWARE\Policies\SWEEPRCleaner\ActivationToken` (`REG_SZ`).
7. **Assignment:** Pilot on a test device group first, verify clean install and license activation (`%AppData%\com.sweepr.cleaner`), then expand within your 5-device license cap.

### 4.2 Active Directory Group Policy (GPO) Checklist
1. **Distribution Share:** Place `Sweepr_Setup.msi` on a read-accessible DFS/UNC share (e.g., `\\corp.local\NetLogon\Packages\Sweepr_Setup.msi`) with `Domain Computers` Read access.
2. **Software Installation:** Open Group Policy Management Editor → `Computer Configuration` → `Policies` → `Software Settings` → `Software installation` → `New` → `Package...` → select `Sweepr_Setup.msi` → **Assigned**.
3. **Registry Policy:** Navigate to `Computer Configuration` → `Preferences` → `Windows Settings` → `Registry` → `New` → `Registry Item`:
   - Action: `Update`
   - Hive: `HKEY_LOCAL_MACHINE`
   - Key Path: `SOFTWARE\Policies\SWEEPRCleaner`
   - Value name: `ActivationToken`
   - Value type: `REG_SZ`
   - Value data: `ptk_...`
4. **Verify on Client:** Run `gpupdate /force` and reboot, then inspect Event Viewer (`Application` log, `MsiInstaller`) and `HKLM\SOFTWARE\Policies\SWEEPRCleaner`.

---

## 5. Privacy, Zero-Telemetry & Outbound Network Transparency

- **Zero-Telemetry / Offline Mode:** SWEEPR Cleaner defaults to `telemetry_enabled: false` (opt-in only for crash/app diagnostics in `UiPreferences`). No file names, browsing history, or personal data are collected.
- **Expected Outbound Endpoints:** Only `https://sweeprcleaner.com` (HTTPS) is contacted for:
  - License pairing token redemption, device account registration & entitlement refresh (`/api/device-link/redeem`, `/v1/accounts`, `/v1/entitlement`)
  - Optional manual or scheduled update / release-manifest checks (`/v1/updates/latest.json`, `/release-manifest.json`)
- Endpoints running fully air-gapped cannot refresh short-lived Ed25519 offline entitlements beyond the 72-hour offline grace window.
