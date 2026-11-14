# Reddit Breakdown: r/pcmasterrace & r/OptimizedGaming

**Target Subreddits:** `r/pcmasterrace`, `r/OptimizedGaming` (Secondary: `r/nvidia`, `r/Amd`)  
**Recommended Post Flair:** `PSA / Tip` or `Guide / Benchmark`  
**Optimal Posting Window:** Tuesday or Wednesday, 13:00–15:00 UTC (9:00–11:00 AM EST)  
**Tone:** Engineering-first, highly technical, empirical benchmark data, anti-snake-oil, zero-download value up front.

---

## Title Candidates

- **Option A (Highest Intent / Problem Solver):**  
  `PSA: If you updated your GPU drivers or swapped cards, your C: drive is hoarding 10GB+ of dead DirectX shaders (and it can cause micro-stutter)`
- **Option B (Storage & Performance Hybrid):**  
  `Where 30GB+ of hidden gaming junk hides on your NVMe (Shader caches, Steam depot leftovers, crash dumps) + Read-Only PowerShell Audit Script`
- **Option C (Deep Technical / Frame Pacing Focus):**  
  `Why stale DirectX 12 / Vulkan shader caches tank your 1% low FPS after driver updates (and how to audit them safely)`

---

## Reddit Post Body (Markdown)

If you have upgraded your GPU, updated your graphics drivers recently, or noticed unexplained frame-time spikes in DirectX 12 and Unreal Engine 5 games, your primary NVMe SSD is almost certainly hoarding gigabytes of orphaned shader binaries and launcher cache residue.

Every few weeks, someone on this sub posts a WizTree or TreeSize screenshot asking: *"Why is my Windows 11 AppData folder 80GB when I only have Windows and a couple of games on my C: drive?"*

Windows Storage Sense and `cleanmgr.exe` don't touch these folders. Here is what is happening under the hood, why stale shader caches cause frame micro-stutters, the 5 biggest gaming space sinks, and a copy-paste PowerShell audit script to check your own rig in 5 seconds without downloading anything.

---

### The Technical Root Cause: Why Shader Cache Bloat Causes Micro-Stutters

In older DirectX 11 titles, the graphics driver handled shader compilation dynamically behind the scenes. In modern low-level APIs (**DirectX 12** and **Vulkan**), games are required to explicitly compile **Pipeline State Objects (PSOs)** before drawing frames. A PSO combines vertex shaders, pixel shaders, rasterization states, and blending modes into machine-specific bytecode for your GPU architecture.

Because compiling PSOs from intermediate shader code (HLSL/SPIR-V) into GPU machine code can take anywhere from 20ms to several seconds per shader, engines pre-compile them Ahead-Of-Time (AOT) and cache the compiled binary blobs in `%LOCALAPPDATA%\NVIDIA\DXCache` (or AMD's equivalent). The driver indexes these binaries via a **Table of Contents (`.toc`) hash table**.

#### What Happens When You Update Drivers or Patch Games:
1. **Binary Incompatibility:** When you update your GPU driver (e.g., from NVIDIA 555.xx to 566.xx), the internal driver compiler changes. Shaders compiled under the old driver version are binary-incompatible with the new driver.
2. **Orphaned Index Tables:** NVIDIA and AMD drivers do not aggressively garbage-collect old cache files from previous driver versions or games you uninstalled months ago. Over a year of gaming, `%LOCALAPPDATA%\NVIDIA\DXCache` routinely swells to **10 GB – 20 GB+** across thousands of `.bin` and `.toc` files.
3. **The Cache Miss / Pipeline Stall:** When an index table becomes fragmented, corrupted by an unexpected game crash, or encounters hash collisions, the driver experiences a **Cache Miss** mid-frame.
4. **The 1% Low Crash:** The render thread is forced to synchronously block while invoking the driver compiler (`CreateGraphicsPipelineState`). Even a 40ms stall causes several dropped frames. While your average frame rate might say 120 FPS, your **1% lows and 0.1% lows crater to 15–20 FPS**. On your monitor, this feels like an abrupt hitch, stutter, or camera hitch right when combat begins.

**The Fix:** Wiping stale shader caches flushes the corrupted index tables. On next boot, the game recompiles a clean, contiguous shader cache matching your exact active driver version.

---

### The 5 Biggest Gaming Storage Sinks on Your Primary NVMe

Based on empirical benchmarks across 377 verified Windows storage paths (data from [State of Windows Storage Study](https://sweeprcleaner.com/state-of-windows-storage)):

| Component | Path | Typical Size | Can You Delete It? | What Breaks vs What Happens |
| :--- | :--- | :--- | :--- | :--- |
| **NVIDIA DXCache / AMD DxCache** | `%LOCALAPPDATA%\NVIDIA\DXCache`<br>`%LOCALAPPDATA%\AMD\DxCache` | **4 GB – 20 GB** | 🟢 **100% Safe** | Active games will rebuild fresh shaders on next boot. Any files currently in use by Windows DWM are automatically locked and skipped. |
| **Steam Depotcache Leftovers** | `C:\Program Files (x86)\Steam\depotcache` | **2 GB – 25 GB** | 🟢 **Safe** *(if no updates downloading)* | Steam stores staging chunks during pre-loads and game updates. Interrupted or cancelled downloads leave orphaned `.depot` chunks that Steam forgets to delete. |
| **Steam Shader Pre-Caching** | `C:\Program Files (x86)\Steam\steamapps\shadercache` | **3 GB – 15 GB** | 🟢 **Safe** | Pre-compiled Vulkan and DXVK pipeline caches organized by Steam AppID. Steam leaves entire gigabyte folders behind even after you uninstall the game. |
| **Unreal Engine DerivedDataCache** | `%LOCALAPPDATA%\UnrealEngine\Common\DerivedDataCache` | **2 GB – 12 GB** | 🟢 **Safe** | Stores compiled material graphs, textures, and asset caches for UE4/UE5 games (*Fortnite*, *The Finals*, *Remnant 2*). Reclaims gigabytes without touching save files. |
| **Riot Games & VALORANT Dumps** | `%LOCALAPPDATA%\VALORANT\Saved\Crashes`<br>`%LOCALAPPDATA%\Riot Games\Riot Client\Logs` | **1.5 GB – 8 GB** | 🟢 **Safe** | Verbose match telemetry and uncompressed Unreal Engine crash dumps (`.dmp` files up to 800 MB each). Zero impact on crosshairs, sensitivity, or ranks. |

*Additional notable offenders: Epic Games Launcher webcache (`%LOCALAPPDATA%\EpicGamesLauncher\Saved\webcache_4430` ~2GB), Blizzard Battle.net cache (`C:\ProgramData\Battle.net` ~1.5GB), and legacy driver unpack leftovers (`C:\NVIDIA\DisplayDriver` or `C:\AMD` ~5GB).*

---

### Copy-Paste PowerShell Storage Audit (100% Read-Only)

You don't need to install any third-party tools to see how much gaming storage bloat is sitting on your drive. Open PowerShell (no admin privileges needed) and paste this script. It calculates the byte totals non-destructively:

```powershell
$gamingPaths = [ordered]@{
  'NVIDIA DirectX Shader Cache (DXCache)'     = "$env:LOCALAPPDATA\NVIDIA\DXCache"
  'NVIDIA OpenGL/Vulkan Cache (GLCache)'      = "$env:LOCALAPPDATA\NVIDIA\GLCache"
  'AMD Radeon DirectX Shader Cache (DxCache)'  = "$env:LOCALAPPDATA\AMD\DxCache"
  'AMD Radeon Vulkan Cache (VkCache)'         = "$env:LOCALAPPDATA\AMD\VkCache"
  'Steam Depot Download Staging (depotcache)' = "${env:ProgramFiles(x86)}\Steam\depotcache"
  'Steam Vulkan/DX Shader Pipeline Cache'     = "${env:ProgramFiles(x86)}\Steam\steamapps\shadercache"
  'Epic Games Launcher Web & Cache'           = "$env:LOCALAPPDATA\EpicGamesLauncher\Saved\webcache_4430"
  'Riot Games & VALORANT Crash Dumps'         = "$env:LOCALAPPDATA\VALORANT\Saved\Crashes"
  'Unreal Engine DerivedDataCache (Global)'   = "$env:LOCALAPPDATA\UnrealEngine\Common\DerivedDataCache"
  'Battle.net Client & Agent Cache'           = "$env:ProgramData\Battle.net"
}

Write-Host "==========================================================================" -ForegroundColor Cyan
Write-Host "            PC GAMING STORAGE & SHADER CACHE AUDIT (READ-ONLY)            " -ForegroundColor Cyan
Write-Host "==========================================================================" -ForegroundColor Cyan

$totalBytes = 0
foreach ($entry in $gamingPaths.GetEnumerator()) {
  $label = $entry.Key
  $path = $entry.Value
  if (Test-Path $path) {
    $files = Get-ChildItem -Path $path -Recurse -File -Force -ErrorAction SilentlyContinue
    $bytes = ($files | Measure-Object -Property Length -Sum).Sum
    if (-not $bytes) { $bytes = 0 }
    $totalBytes += $bytes
    $gb = [math]::Round(($bytes / 1GB), 2)
    $count = ($files | Measure-Object).Count
    Write-Host ("{0,-43} : {1,6} GB ({2,5} files)" -f $label, $gb, $count) -ForegroundColor White
  } else {
    Write-Host ("{0,-43} :   NOT PRESENT (0.00 GB)" -f $label) -ForegroundColor DarkGray
  }
}
$totalGb = [math]::Round(($totalBytes / 1GB), 2)
Write-Host "--------------------------------------------------------------------------"
Write-Host ("{0,-43} : {1,6} GB" -f "TOTAL RECLAIMABLE GAMING JUNK", $totalGb) -ForegroundColor Green
Write-Host "==========================================================================" -ForegroundColor Cyan
```

---

### How to Clean Them Manually (Step-by-Step)

If you find 15GB+ of junk and want to purge it yourself:

1. **Close All Launchers:** Exit Steam, Battle.net, Epic Games, Riot Client, and any running games from the Windows taskbar tray.
2. **Clear NVIDIA DXCache:**
   - Press `Win + R`, type `%localappdata%\NVIDIA\DXCache`, and hit Enter.
   - Press `Ctrl + A` and press `Shift + Delete`.
   - **Important:** Windows will tell you a few files are "in use" (held by Desktop Window Manager). Check **"Do this for all current items"** and click **Skip**.
3. **Clear AMD DxCache (if using Radeon):**
   - In AMD Software: Adrenalin Edition, go to **Gaming > Graphics > Advanced > Reset Shader Cache**.
   - Alternatively, open `%localappdata%\AMD` and empty `DxCache` and `VkCache`.
4. **Purge Steam Depot Leftovers:**
   - Ensure no game updates are actively paused in your Steam Download queue.
   - Navigate to `C:\Program Files (x86)\Steam\depotcache` and delete the old `.depot` chunks.
5. **Delete Old Driver Installers:**
   - Check if `C:\NVIDIA\DisplayDriver` or `C:\AMD` exist. These are temporary extraction folders from manual driver updates and can be deleted entirely.

---

### What I Built to Automate This Safely

Like many of you, I got sick of legacy PC cleaners that turned into bloated 80MB adware suites running background telemetry daemons, pushing sketchy registry cleaners, and bugging you with tray popups.

I wrote **SWEEPR Cleaner** ([sweeprcleaner.com](https://sweeprcleaner.com/clean/app/nvidia-dxcache)) as an ultra-lightweight, transparent utility:
- **6.5 MB Native Rust Binary:** Uses under 40 MB of RAM while scanning and finishes in under 60 seconds.
- **0 Background Processes:** No background services, no startup tray daemons, no telemetry. When closed, its RAM footprint is 0 MB.
- **7-Day Undo Quarantine:** Any cleared cache is moved to a local recovery isolation folder for 7 days so you can roll back with 1 click if anything ever misbehaves.
- **Free Scan & Clean:** Scans and cleans shader caches, Steam staging, and 370+ Windows cache paths for free.

If you test the PowerShell script, drop your total GB in the comments—curious to see who has the biggest shader cache hoarding record!
