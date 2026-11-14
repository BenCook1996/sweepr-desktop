# Tier-1 Windows Download Portals Submission Kit

This document provides turnkey submission specifications, editorial pitches, metadata fields, and PAD XML feed configurations for the 6 Tier-1 Windows software download portals: **Softpedia**, **MajorGeeks**, **FileHorse**, **SnapFiles**, **Uptodown**, and **SourceForge**.

---

## 1. Universal Application Metadata & Live PAD Feed

- **Program Name:** `SWEEPR Cleaner`
- **Current Version:** `0.1.0`
- **Release Date:** `November 4, 2026`
- **Developer / Publisher:** `Benjamin Cook` (`SWEEPR Technologies`)
- **Author Email:** `support@sweeprcleaner.com`
- **Homepage:** `https://sweeprcleaner.com`
- **Live PAD XML URL:** `https://sweeprcleaner.com/pad.xml`
- **Primary Installer URL (.exe):** `https://sweeprcleaner.com/SWEEPRCleaner.exe`
  - *File Size:* `6,840,632 bytes` (6.52 MB)
  - *SHA-256:* `38E5CDF33C813709C0B4124334CD10EA797C70AAED0C598F4CCB5A5F477544AA`
  - *Installer Type:* NSIS (Nullsoft)
  - *Silent Switch:* `/S`
  - *Digital Signature:* Valid SSL.com Authenticode (`CN=Benjamin Cook, O=Benjamin Cook, L=Worthing, C=GB`)
- **Secondary Installer URL (.msi):** `https://sweeprcleaner.com/Sweepr_Setup.msi`
  - *File Size:* `3,993,600 bytes` (3.81 MB)
  - *SHA-256:* `33E5427E84AB8FC4F3D01DFD17404F7CB38B70B9731A8C2CCFBB62876711933A`
  - *Silent Switch:* `/qn /norestart`
- **License Model:** `Freemium` (Free core disk scan & basic cache clean; optional Pro upgrade at £1.99/mo entry or £49.99/yr for 5 devices)
- **Supported Operating Systems:** `Windows 11`, `Windows 10` (64-bit architectures)
- **System Requirements:** Windows 10/11 64-bit, 50 MB RAM, 25 MB free disk space
- **Visual Assets:**
  - *App Icon (32x32):* `https://sweeprcleaner.com/icon-32x32.png`
  - *App Icon (192x192):* `https://sweeprcleaner.com/icon-192.png`
  - *Screenshot:* `https://sweeprcleaner.com/screenshot.png`
  - *Open Graph Image:* `https://sweeprcleaner.com/og-image.png`

---

## 2. Standardized Editorial Copy & Descriptions

### Short Description (80 Characters)
```text
Fast PC cleaner, complete app uninstaller, speed booster & file shredder.
```

### Medium Description (250 Characters)
```text
SWEEPR Cleaner is a fast, lightweight PC cleaner and speed booster for Windows 10 and 11. Features 60-second junk cleanup, complete app uninstaller, GPU shader & game cache cleaner, duplicate finder, and a 7-day undo safety net.
```

### Expanded Description (450 Characters)
```text
SWEEPR Cleaner is a modern, lightweight PC cleaner and storage optimizer engineered in native Rust for Windows 10 and 11. Built as a clean, popup-free alternative to bloated legacy utilities, SWEEPR runs strictly on-demand—never slowing down your PC with background daemons. Includes deep Windows and browser cache cleaning, GPU shader cache purges, complete app uninstallation, duplicate finder, private file shredder, and a 7-day undo safety net.
```

### Full Long Editorial Description (2,000+ Characters)
```text
SWEEPR Cleaner is a modern, ultra-lightweight PC cleaner and storage optimization utility engineered in native Rust for Windows 10 and Windows 11.

Designed as a transparent, high-performance antidote to legacy PC cleaners that have become bloated with background telemetry daemons, adware bundles, and intrusive upsell popups, SWEEPR Cleaner frees up gigabytes of disk space and eliminates system clutter in under 60 seconds with zero resident background overhead.

Key Highlights & Features:

• ⚡ Lightweight Native Rust Architecture: Weighing just 6.5 MB, SWEEPR launches instantaneously, utilizes under 40 MB of RAM during active scans, and traverses nested directories in milliseconds using multi-threaded NVMe-optimized Rust algorithms.
• 🛑 Zero Background Processes: Runs strictly on demand. SWEEPR installs zero background daemons, zero startup tray services, and zero analytics monitors. When closed, its system memory footprint is exactly 0 MB.
• 🛡️ 7-Day Undo Quarantine: Never worry about accidental file deletions. All cleared caches and temporary files are isolated into a secure 7-day quarantine vault, allowing instant 1-click rollback if an application requires a file.
• 🔍 DeepClean Cache Scanning: Targets gigabytes of hidden bloat across Windows Temp, AppData, browser caches (Chrome, Edge, Firefox, Brave), chat applications (Discord, Teams, Slack, Telegram), and developer scratch disks.
• 🎮 GPU Shader & Game Depot Cleaner: Safely purges stale DirectX 11/12, Vulkan, NVIDIA DXCache, AMD DxCache, and Steam depot staging chunks that cause micro-stutters and hitching after driver updates.
• 🧹 Smart App Uninstaller: Completely removes stubborn software, wiping orphaned folders, leftover AppData directories, and stale registry entries that the standard Windows Add/Remove Programs wizard leaves behind.
• 📑 Cryptographic Duplicate Finder: Uses cryptographic SHA-256 byte comparisons to identify true duplicate files, photos, and videos without false positives.
• 🔒 Secure File Shredder: DoD 5220.22-M compliant permanent file deletion for sensitive confidential files, preventing forensic file recovery on both SSDs and hard drives.
• 🌐 Multi-Platform Coverage: A single Pro license covers up to 5 devices across Windows 10/11, macOS, and mobile devices.
```

---

## 3. Portal-by-Portal Submission Specifications

### 1. Softpedia (Domain Rating: 89)
- **Portal URL:** [https://www.softpedia.com/](https://www.softpedia.com/)
- **Developer Submission Portal:** [https://www.softpedia.com/developer/](https://www.softpedia.com/developer/)
- **Target Category:** `System / System Cleaners` (or `System / File Cleaners`)
- **Submission Mode:** PAD File Submission & Direct Executable Upload
- **Form Field Values:**
  - *Program Title:* `SWEEPR Cleaner`
  - *Version:* `0.1.0`
  - *License:* `Freemium` / `Demo` (Free core clean)
  - *Price:* `$11.99` (or £1.99/mo Pro entry / free core scan)
  - *PAD URL:* `https://sweeprcleaner.com/pad.xml`
  - *Download URL:* `https://sweeprcleaner.com/SWEEPRCleaner.exe`
  - *Publisher Name:* `Benjamin Cook`
  - *Company:* `SWEEPR Technologies`
  - *Operating System:* `Windows 11, Windows 10 64-bit`
  - *Category:* `System Maintenance / Disk Cleaners`
- **Softpedia "100% Clean" Award Strategy:**
  - Softpedia tests submitted binaries in an isolated sandbox against 50+ antivirus engines.
  - SWEEPR Cleaner is Authenticode-signed by Benjamin Cook (SSL.com) with 0 adware, 0 bundled toolbars, and 0 third-party installers.
  - Request the Softpedia "100% Clean" editorial badge for inclusion on `https://sweeprcleaner.com/`.

---

## 2. MajorGeeks (Domain Rating: 81)
- **Portal URL:** [https://www.majorgeeks.com/](https://www.majorgeeks.com/)
- **Target Category:** `Drive Cleaners` / `System Tools`
- **Submission Method:** Direct Editorial Email to MajorGeeks Editors
- **Editorial Contacts:** `tim@majorgeeks.com`, `jim@majorgeeks.com`
- **Email Subject:**
  `Software Submission: SWEEPR Cleaner v0.1.0 (6.5MB Native Rust PC Cleaner)`
- **Email Body:**
```text
Hi Tim & Jim,

I would like to submit SWEEPR Cleaner v0.1.0 for listing under MajorGeeks' Drive Cleaners section.

SWEEPR Cleaner is an ultra-lightweight (6.5 MB), modern PC cleaner and storage optimizer engineered in native Rust for Windows 10 and 11. I built it specifically as a fast, clean alternative to CCleaner and legacy cleaning suites that have become bogged down with background daemons, adware offers, and tray nagware.

Key Technical Highlights for MajorGeeks Readers:
• 6.5 MB native Rust binary — launches instantly, uses under 40 MB active RAM.
• 0 MB background RAM when closed: Zero background services, zero startup tray monitors, zero telemetry.
• 7-Day Undo Quarantine: All cleared cache files are held in a recovery vault so users can roll back any deletion with 1 click.
• Targets modern bloat: Cleans NVIDIA/AMD DirectX shader caches, Steam depotcache leftovers, Discord/Spotify Electron bloat, and Windows Update leftovers.
• Includes complete drag-and-drop app uninstaller, SHA-256 duplicate finder, and DoD-grade file shredder.
• Digitally signed with a valid Authenticode certificate (Benjamin Cook / SSL.com). 100% clean installer with zero bundled toolbars or third-party offers.

Submission & File Details:
• Program Name: SWEEPR Cleaner
• Version: 0.1.0
• File Size: 6,840,632 bytes (6.52 MB)
• SHA-256: 38E5CDF33C813709C0B4124334CD10EA797C70AAED0C598F4CCB5A5F477544AA
• Direct Download URL: https://sweeprcleaner.com/SWEEPRCleaner.exe
• MSI Installer: https://sweeprcleaner.com/Sweepr_Setup.msi
• Live PAD XML Feed: https://sweeprcleaner.com/pad.xml
• Website: https://sweeprcleaner.com
• License: Freemium (Free core disk scan and basic cache clean; optional £1.99/mo Pro upgrade)
• Author: Benjamin Cook (support@sweeprcleaner.com)

Thank you for your time and for everything you do for the Windows community!

Best regards,
Benjamin Cook
Creator of SWEEPR Cleaner
support@sweeprcleaner.com
https://sweeprcleaner.com
```

---

## 3. FileHorse (Domain Rating: 78)
- **Portal URL:** [https://www.filehorse.com/](https://www.filehorse.com/)
- **Submission Form:** [https://www.filehorse.com/send-software/](https://www.filehorse.com/send-software/)
- **Target Category:** `Cleaning and Tweaking`
- **Form Field Values:**
  - *Software Name:* `SWEEPR Cleaner`
  - *Version:* `0.1.0`
  - *License:* `Freemium`
  - *Developer:* `Benjamin Cook / SWEEPR Technologies`
  - *Homepage URL:* `https://sweeprcleaner.com`
  - *Direct Download Link:* `https://sweeprcleaner.com/SWEEPRCleaner.exe`
  - *Changelog / Release Notes URL:* `https://sweeprcleaner.com/state-of-windows-storage`
  - *Description:* Use the 450-character Expanded Description above.

---

## 4. SnapFiles (Domain Rating: 82)
- **Portal URL:** [https://www.snapfiles.com/](https://www.snapfiles.com/)
- **Developer Submission URL:** [https://www.snapfiles.com/developer/submit.php](https://www.snapfiles.com/developer/submit.php)
- **Target Category:** `System Utilities - Disk Cleaning`
- **Submission Method:** PAD XML File submission
- **Field Values:**
  - *PAD URL:* `https://sweeprcleaner.com/pad.xml`
  - *Product Name:* `SWEEPR Cleaner`
  - *Direct URL:* `https://sweeprcleaner.com/SWEEPRCleaner.exe`
  - *License:* `Freeware / Freemium`
- **SnapFiles Editorial Compliance Note:**
  - SnapFiles strictly enforces a "No Toolbars / No Third-Party Bundles" policy.
  - SWEEPR's installer is completely standalone and passes SnapFiles' green compliance criteria.

---

## 5. Uptodown (Domain Rating: 90)
- **Portal URL:** [https://en.uptodown.com/windows](https://en.uptodown.com/windows)
- **Developer Console:** [https://developers.uptodown.com/](https://developers.uptodown.com/)
- **Target Category:** `Utilities > Maintenance`
- **Platform:** `Windows (64-bit)`
- **Multilingual Listing Support (Matching SWEEPR UI Locales):**
  - **English:** Use the 2,000-character description above.
  - **German (Deutsch):**
    `SWEEPR Cleaner ist ein moderner, ultraschlanker PC-Reiniger und Speicheroptimierer in nativem Rust für Windows 10 und 11. Befreit Gigabytes an Speicherplatz in unter 60 Sekunden ohne Hintergrunddienste, inklusive 7-Tage-Wiederherstellung (Quarantäne), App-Deinstallationsprogramm, Duplikatfinder und Dateishredder.`
  - **French (Français):**
    `SWEEPR Cleaner est un nettoyeur de PC moderne et ultra-léger conçu en Rust natif pour Windows 10 et 11. Libérez des gigaoctets d'espace disque en moins de 60 secondes sans aucun processus en arrière-plan, avec quarantaine d'annulation de 7 jours, désinstallateur d'applications et destructeur de fichiers.`
  - **Spanish (Español):**
    `SWEEPR Cleaner es un limpiador de PC moderno y ultraligero diseñado en Rust nativo para Windows 10 y 11. Libera gigabytes de espacio en menos de 60 segundos sin procesos en segundo plano, con cuarentena de deshacer de 7 días, desinstalador de aplicaciones y triturador seguro de archivos.`

---

## 6. SourceForge (Domain Rating: 93)
- **Portal URL:** [https://sourceforge.net/](https://sourceforge.net/)
- **Software Vendor Listing Portal:** [https://sourceforge.net/software/vendors/new](https://sourceforge.net/software/vendors/new)
- **Target Category:** `System Administration > System Maintenance > Disk Cleanup`
- **Listing Profile:**
  - *Product Name:* `SWEEPR Cleaner`
  - *Vendor / Company Name:* `SWEEPR Technologies`
  - *Official Website:* `https://sweeprcleaner.com`
  - *Pricing:* Free scan & basic cleaning · Pro plans starting at £1.99/mo
  - *Operating System:* Windows 11, Windows 10, macOS, Linux
  - *Download URL:* `https://sweeprcleaner.com/SWEEPRCleaner.exe`
  - *Alternatives:* Tagged against `CCleaner`, `BleachBit`, `CleanMyMac`

---

## 4. Re-Syndication & Version Update Workflow

Whenever a new minor version (e.g. `0.2.0`) is published:
1. Update `Program_Version` and `Program_Release_Date` in `server/public/pad.xml`.
2. Update installer byte sizes and SHA-256 hashes in `server/public/pad.xml`.
3. Ping Softpedia, MajorGeeks, and SnapFiles with the updated PAD feed.
4. Portals automatically display SWEEPR Cleaner on their **"Recently Updated"** homepage feeds, capturing recurring high-authority backlink spikes and organic downloads at zero cost.
