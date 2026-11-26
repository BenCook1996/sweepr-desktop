# SWEEPR Cleaner

Fast, transparent Windows 11/10 disk cleaner, leftover uninstaller, startup manager, and storage analyzer built with Rust, Tauri, and Svelte.

**Website:** [https://sweeprcleaner.com](https://sweeprcleaner.com) · **Downloads:** [https://sweeprcleaner.com/download](https://sweeprcleaner.com/download) · **PAD Feed:** [https://sweeprcleaner.com/pad.xml](https://sweeprcleaner.com/pad.xml)

---

## Install on Windows

### Scoop (Official Bucket)

```powershell
scoop bucket add sweepr https://github.com/BenCook1996/scoop-sweepr
scoop install sweepr/sweepr-cleaner
```

### Windows Package Manager (`winget`)

Official [microsoft/winget-pkgs manifest](https://github.com/microsoft/winget-pkgs/tree/master/manifests/s/Sweepr/SweeprCleaner):

```powershell
winget install Sweepr.SweeprCleaner
```

### Direct Releases (`v0.1.0`)

Download signed installers directly from [sweeprcleaner.com/download](https://sweeprcleaner.com/download) or [GitHub Releases](https://github.com/BenCook1996/sweepr-desktop/releases/tag/v0.1.0).

---

## Verified Release Checksums (`v0.1.0`)

| Artifact | Platform | Size (bytes) | SHA-256 |
| --- | --- | --- | --- |
| `SWEEPRCleaner.exe` | Windows x64 (NSIS Setup, SSL.com IV signed) | 7,085,912 (6.76 MiB) | `FEAE464CA121CF897D27916C632F4DB8F84A87D4B79642403AD1B0E0F2BB706A` |
| `Sweepr_Setup.msi` | Windows x64 (MSI Installer) | 3,993,600 (3.81 MiB) | `33E5427E84AB8FC4F3D01DFD17404F7CB38B70B9731A8C2CCFBB62876711933A` |
| `SWEEPRCleaner.dmg` | macOS (Universal DMG) | 7,412,590 (7.07 MiB) | `D13A23AACA6B2AEE1BC2E5602F792C31D0CEFA147121686944FEDEC66B17AE6A` |
| `SWEEPRCleaner.apk` | Android | 3,383,176 (3.23 MiB) | `620602F6B1A61DD392130D93CCE6B87E7F861E23D0317D47797352DE69CC7098` |

`SWEEPRCleaner.exe` carries an SSL.com **Individual Validation (IV)** Authenticode signature (`CN=Benjamin Cook, O=Benjamin Cook, L=Worthing, C=GB`, thumbprint `1800DBEA6FE847D384E549D02CA372C3D45D8B81`).

---

## Key Capabilities & Guides

- **App & Cache Cleanup Guides:** [https://sweeprcleaner.com/clean](https://sweeprcleaner.com/clean)
- **Diagnostic & Storage Tools:** [https://sweeprcleaner.com/tools](https://sweeprcleaner.com/tools)
- **Safe-to-Delete Windows Folder Reference:** [https://sweeprcleaner.com/safe-to-delete](https://sweeprcleaner.com/safe-to-delete)
- **State of Windows Storage Research:** [https://sweeprcleaner.com/state-of-windows-storage](https://sweeprcleaner.com/state-of-windows-storage)
- **Comparisons:** [SWEEPR vs CCleaner](https://sweeprcleaner.com/vs/ccleaner) · [SWEEPR vs BleachBit](https://sweeprcleaner.com/vs/bleachbit)
- **Pricing & Licensing:** [https://sweeprcleaner.com/pricing](https://sweeprcleaner.com/pricing)
