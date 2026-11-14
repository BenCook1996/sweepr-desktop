# Reddit Community Post Draft: r/Windows11

- **Target Subreddit:** `r/Windows11` (Cross-post candidates: `r/windows`, `r/sysadmin`)
- **Suggested Post Flair:** `Discussion` or `Tips and Tricks`
- **Primary Title:** Where 45GB of mystery C: drive space actually disappears on Windows 11 (2026 storage benchmark + read-only PowerShell audit script)
- **Alternative Title A:** Why Windows 11 Storage Sense misses 40GB+ of hidden cache (and how to audit your C: drive with native PowerShell)
- **Alternative Title B:** The 6 biggest hidden storage sinks on Windows 11 24H2: What is safe to delete vs. what breaks your system

---

## Post Body

Every few weeks in this sub, someone posts a TreeSize or WizTree screenshot asking:
> *"Why is my Windows 11 C: drive losing 40–80 GB when I only have Windows and two games installed?"*

The replies are almost always divided into two camps:
1. *"Never touch anything in AppData or you'll brick Windows."*
2. *"Just run Disk Cleanup / Storage Sense."*

Here is the underlying reality: **Windows Storage Sense and `cleanmgr.exe` were architected over a decade ago.** They do a solid job cleaning `%TEMP%`, old Windows Update staging folders, and the Recycle Bin. But they completely ignore modern application scratch disks, GPU shader caches, Electron media bloat, and virtualization disks.

As part of an engineering benchmark analyzing 377 specific Windows 10/11 cache locations (empirical dataset: https://sweeprcleaner.com/state-of-windows-storage), we measured where unindexed gigabytes actually accumulate. On a typical Windows 11 PC, median reclaimable bloat is **24.6 GB (P50)**, climbing to **61.7 GB (P90)** for power users, developers, and gamers.

Below is an exact breakdown of the 6 biggest mystery space sinks, what happens under the hood, how to clean them using built-in Windows commands, and a zero-install, read-only PowerShell script to audit your own system right now.

---

### The 6 Biggest Mystery Space Sinks on Windows 11

#### 1. NVIDIA & AMD DirectX Shader Caches
- **Paths:**
  - NVIDIA: `%LOCALAPPDATA%\NVIDIA\DXCache` (DirectX 11/12) and `%LOCALAPPDATA%\NVIDIA\GLCache`
  - AMD: `%LOCALAPPDATA%\AMD\DxCache` and `%LOCALAPPDATA%\AMD\VkCache`
- **Typical Footprint:** `4.8 GB – 16.5 GB`
- **Why it happens:** Modern games compile DirectX 12 and Vulkan shader pipelines into machine bytecode for your specific GPU architecture. Whenever you update graphics drivers or games release patches, the bytecode format changes. The old shader blobs remain orphaned in DXCache forever. Over a year of driver updates, this directory silently balloons with thousands of stale `.toc` and `.bin` files.
- **Safety Verdict:** 🟢 **100% Safe.** Windows kernel locks any shader file actively in use by running games/apps. Stale shaders can be purged without issue. Active games will simply recompile fresh shaders on their next launch.
- **Native Fix:** Close active 3D games and browsers, then manually delete the contents of `%LOCALAPPDATA%\NVIDIA\DXCache` (skip any file that reports "in use").

#### 2. The WinSxS Component Store
- **Path:** `C:\Windows\WinSxS`
- **Typical Footprint:** `6.0 GB – 20.0 GB`
- **Why it happens:** The Windows Side-by-Side (WinSxS) directory manages system assemblies, rollback packages, and optional features. Many files are NTFS hard links pointing to `System32` (causing File Explorer to overestimate the actual size), but superseded monthly cumulative updates genuinely take up physical disk space.
- **Safety Verdict:** 🔴 **NEVER delete files inside `C:\Windows\WinSxS` via File Explorer!** Doing so will break your Windows servicing stack and prevent future security updates.
- **Native Fix:** Use the official Microsoft DISM servicing tool from an Administrator terminal:
  ```powershell
  # Step 1: Analyze actual reclaimable space
  Dism.exe /Online /Cleanup-Image /AnalyzeComponentStore

  # Step 2: Prune superseded update payloads
  Dism.exe /Online /Cleanup-Image /StartComponentCleanup /ResetBase
  ```
  *(Note: `/ResetBase` permanently commits the current Windows update state and removes the ability to roll back past updates.)*

#### 3. Discord & Electron App Webview Caches
- **Paths:**
  - Discord: `%APPDATA%\discord\Cache` and `Code Cache`
  - Spotify: `%LOCALAPPDATA%\Spotify\Storage`
  - Slack: `%APPDATA%\Slack\Cache`
  - Microsoft Edge WebView2: `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Service Worker\CacheStorage`
- **Typical Footprint:** `3.5 GB – 12.0 GB`
- **Why it happens:** Most modern desktop utilities are Electron or Chromium apps in disguise. Every GIF, sticker, avatar, embedded video, and audio stream you scroll past is cached on your primary NVMe drive indefinitely.
- **Safety Verdict:** 🟢 **Safe.** Cache folders contain offline web media only. Your login tokens and server configurations live in `Local Storage` and `Cookies`, so purging `Cache` does **not** log you out of Discord or Spotify.
- **Native Fix:** Close the application completely (ensure it is closed in the system tray), navigate to the cache folder in File Explorer, and delete its contents.

#### 4. The Windows Hibernation Reservation (`hiberfil.sys`)
- **Path:** `C:\hiberfil.sys`
- **Typical Footprint:** `40% to 100% of physical RAM` (`13 GB – 32 GB` on a 32GB system)
- **Why it happens:** Windows reserves a contiguous hidden file on `C:` to dump memory state during hibernation. Even if you never manually click "Hibernate", Windows 11 enables Fast Startup by default, which relies on a partial hibernation image.
- **Safety Verdict:** 🟡 Cannot be deleted in File Explorer (kernel locked).
- **Native Fix:**
  - If you want Fast Startup enabled but don't need full hibernation, cut the file size in half using "reduced" mode:
    ```cmd
    powercfg /h /type reduced
    ```
  - If you use an NVMe SSD and prefer instant cold boots without hibernation reservations, disable it completely to reclaim 100% of the space:
    ```cmd
    powercfg /h off
    ```

#### 5. Windows DriverStore File Repository
- **Path:** `C:\Windows\System32\DriverStore\FileRepository`
- **Typical Footprint:** `3.0 GB – 25.0 GB`
- **Why it happens:** Every time Windows Update or GeForce Experience installs a new GPU or audio driver, the older driver installer package is kept in the DriverStore in case you need to roll back a problematic device.
- **Safety Verdict:** 🔴 **NEVER delete folders inside `FileRepository` in File Explorer.** Deleting folders here directly corrupts the driver catalog and device associations.
- **Native Fix:**
  - Standard method: Open **Settings > System > Storage > Temporary files**, check **Device driver packages**, and click **Remove files**.
  - Advanced CLI method: Run `pnputil /enum-drivers` to inspect superseded packages, and `pnputil /delete-driver oemXX.inf /uninstall` to remove orphaned versions safely.

#### 6. Docker Desktop WSL2 Virtual Disk (`ext4.vhdx`)
- **Path:** `%LOCALAPPDATA%\Docker\wsl\data\ext4.vhdx`
- **Typical Footprint:** `15 GB – 60 GB+`
- **Why it happens:** Docker on Windows uses a dynamic virtual hard disk (`ext4.vhdx`) in WSL2. When you pull containers or build images, the VHDX expands automatically. However, when you delete images or prune containers, Hyper-V does **not** shrink the file on your host NTFS drive.
- **Safety Verdict:** 🟡 Normal Docker prune commands only free space *inside* the virtual disk; you must compact the host VHDX to reclaim actual C: drive space.
- **Native Fix:**
  ```powershell
  # 1. Prune unused Docker layers
  docker system prune -a --volumes

  # 2. Shut down WSL completely
  wsl --shutdown

  # 3. Compact the VHDX via diskpart
  diskpart
  # In diskpart prompt:
  select vdisk file="$env:LOCALAPPDATA\Docker\wsl\data\ext4.vhdx"
  compact vdisk
  exit
  ```

---

### Read-Only PowerShell Audit Script (Zero Downloads, Zero Side-Effects)

To see exactly how much space these hidden sinks are consuming on your system right now, run this read-only PowerShell script. It performs zero modifications and only measures sizes:

```powershell
<#
.SYNOPSIS
    Windows 11 Mystery Storage Audit (Read-Only)
.DESCRIPTION
    Audits hidden cache sinks, shader depots, hibernation, and virtualization disks.
    100% read-only: does NOT delete, move, or modify any files or registry settings.
#>

$auditTargets = @(
    @{ Name = "NVIDIA DirectX Shader Cache";     Path = "$env:LOCALAPPDATA\NVIDIA\DXCache" },
    @{ Name = "AMD DirectX/Vulkan Shader Cache";  Path = "$env:LOCALAPPDATA\AMD\DxCache" },
    @{ Name = "Discord Media & Web Cache";       Path = "$env:APPDATA\discord\Cache" },
    @{ Name = "Spotify Streaming Cache";          Path = "$env:LOCALAPPDATA\Spotify\Storage" },
    @{ Name = "Edge ServiceWorker Cache";        Path = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Service Worker\CacheStorage" },
    @{ Name = "Chrome ServiceWorker Cache";      Path = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Service Worker\CacheStorage" },
    @{ Name = "Windows WER Crash Dumps";         Path = "$env:LOCALAPPDATA\CrashDumps" },
    @{ Name = "Windows Hibernation File";        Path = "C:\hiberfil.sys" },
    @{ Name = "Docker Desktop WSL2 Disk";        Path = "$env:LOCALAPPDATA\Docker\wsl\data\ext4.vhdx" }
)

Write-Host "`n=== Windows 11 Storage Bloat Audit (Read-Only) ===" -ForegroundColor Cyan

$auditResults = foreach ($target in $auditTargets) {
    if (Test-Path -LiteralPath $target.Path) {
        $item = Get-Item -LiteralPath $target.Path -Force -ErrorAction SilentlyContinue
        if ($item) {
            if ($item.PSIsContainer) {
                $measure = Get-ChildItem -LiteralPath $target.Path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
                $bytes = if ($measure.Sum) { $measure.Sum } else { 0 }
            } else {
                $bytes = $item.Length
            }
            [PSCustomObject]@{
                Target  = $target.Name
                Size_GB = [math]::Round(($bytes / 1GB), 2)
                Size_MB = [math]::Round(($bytes / 1MB), 1)
                Path    = $target.Path
            }
        }
    }
}

if ($auditResults) {
    $auditResults | Format-Table -Property Target, Size_GB, Size_MB, Path -AutoSize
    $totalGB = [math]::Round((($auditResults | Measure-Object -Property Size_GB -Sum).Sum), 2)
    Write-Host ("Total Identified Space: {0} GB`n" -f $totalGB) -ForegroundColor Yellow
} else {
    Write-Host "No targeted cache folders were found on your system.`n" -ForegroundColor Green
}
```

---

### What Storage Sense Cleans vs. What It Misses

| Storage Category | Cleaned by Windows Storage Sense? | Cleaned by Disk Cleanup (`cleanmgr`)? | Requires Manual / Scripted Clean? |
| :--- | :--- | :--- | :--- |
| `%TEMP%` and Windows Temp | ✅ Yes | ✅ Yes | No |
| Windows Update Rollback Files | ✅ Yes | ✅ Yes (Clean up system files) | No |
| Recycle Bin | ✅ Yes | ✅ Yes | No |
| **NVIDIA & AMD Shader Caches** | ❌ No | ⚠️ Partial (often misses DXCache) | **Yes** |
| **Discord / Spotify / Electron Caches** | ❌ No | ❌ No | **Yes** |
| **WinSxS Component Pruning** | ❌ No | ⚠️ Basic only (misses `/ResetBase`) | **Yes (DISM)** |
| **Hibernation Size Optimization** | ❌ No | ❌ No | **Yes (`powercfg`)** |
| **Docker WSL2 VHDX Shrink** | ❌ No | ❌ No | **Yes (`diskpart`)** |

---

### Automated Option: SWEEPR Cleaner (Indie Project Disclosure)

If you prefer not to manage DISM terminal commands, PowerShell scripts, and manual path purges, I spent the last few months building **SWEEPR Cleaner** (https://sweeprcleaner.com).

I built this specifically because legacy tools like CCleaner became bloated with background telemetry daemons, persistent tray notifications, and dangerous "registry cleaners."

How SWEEPR is engineered differently:
1. **Lightweight & Native Rust (<7 MB binary):** Written in 100% native Rust using Tauri v2. It uses under 40 MB of RAM during scans and executes in under 60 seconds across all 377 rules.
2. **0 MB Background Footprint:** Zero background services, zero startup daemons, zero telemetry tracking. When closed, it is completely out of memory.
3. **7-Day Undo Quarantine:** Any cleaned cache is moved into a local quarantine folder for 7 days so you can roll back any deletion with a single click.
4. **No Registry Cleaning:** It strictly targets explainable cache paths and never touches system registry hives.

The desktop scanner is free to download and run on Windows 10/11. You can also search any folder path or error code on our free path checker (https://sweeprcleaner.com/safe-to-delete) before deleting anything manually.

Feedback, edge cases, and questions on specific cache directories are very welcome!
