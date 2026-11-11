# SWEEPR Cleaner — Zero-CAC Community Launch Playbook (`docs/ZERO_CAC_LAUNCH_PLAYBOOK.md`)

## 1. Strategic Beachhead & Zero-CAC Funnel Architecture

Google Search Console (GSC) query telemetry confirms our highest-intent, lowest-competition organic beachhead is **technical Windows 11/10 power users (PC Gamers, Local AI Builders, and Developers)** whose `C:` NVMe drives are silently choked by `%LOCALAPPDATA%` and `%USERPROFILE%\.cache` bloat that legacy cleaners (`cleanmgr.exe`, Storage Sense, CCleaner) completely ignore.

### Live Interactive Entry Points
- **Interactive Benchmark & Bloat Calculator:** `https://sweeprcleaner.com/benchmark` and `https://sweeprcleaner.com/tools/pc-cache-calculator`
- **377-Rule Directory (with embedded Calculator):** `https://sweeprcleaner.com/clean`
- **Instant Folder Path Safety Checker:** `https://sweeprcleaner.com/safe-to-delete`
- **Viral Post-Clean OpenGraph Share Card:** `https://sweeprcleaner.com/share/win?gb=42.8%20GB&culprit=NVIDIA%20DXCache%20%2F%20ComfyUI&ms=280&code=SWP-PRO30`

---

## 2. Ready-to-Post Draft: `r/pcgaming`

**Title:** We analyzed where 40+ GB of hidden shader & launcher caches hide on Windows 11 (and which folders are actually safe to delete without resetting game settings)

**Body:**
```markdown
If you have a 1 TB or 2 TB NVMe SSD and keep games on a secondary drive (or even on `C:`), you’ve probably noticed your `C:\Users\<you>\AppData\Local` folder ballooning by 30–60 GB over a year—even after uninstalling games on Steam or Epic.

Windows Storage Sense and Disk Cleanup (`cleanmgr`) only touch `%Temp%` and Windows Update caches. They don't touch modern GPU driver shader caches, Chromium-embedded launcher caches, or anti-cheat crash dumps.

We benchmarked 377 cache paths across Windows 11 gaming rigs to map out what is 100% safe to purge (rebuilds automatically or is pure dead weight) vs. what will wipe your keybinds/saves if deleted.

### The Big 6 Hidden Gaming Space Hogs on `C:`

1. **NVIDIA DXCache & GLCache (`1.5 GB – 18 GB`)**
   - **Paths:**
     - `%LocalAppData%\NVIDIA\DXCache`
     - `%LocalAppData%\NVIDIA\GLCache`
     - `%LocalAppData%\NVIDIA Corporation\NV_Cache`
   - **What it is:** Compiled DirectX 11/12 & Vulkan compute shaders for every game and driver version you’ve ever launched.
   - **Safety verdict:** 🟢 **100% Safe.** Currently locked files for running processes are skipped by the OS; deleting old shader blobs reclaims up to 18 GB. Active games simply recompile shaders on next launch.

2. **AMD DirectX & Vulkan Shader Cache (`1 GB – 12 GB`)**
   - **Paths:**
     - `%LocalAppData%\AMD\DxCache`
     - `%LocalAppData%\AMD\DxcCache`
     - `%LocalAppData%\AMD\VkCache`
   - **Safety verdict:** 🟢 **100% Safe.**

3. **Steam Chromium HTMLCache & Orphaned Depot/Shader Caches (`3 GB – 22 GB`)**
   - **Paths:**
     - `%LocalAppData%\Steam\htmlcache`
     - `C:\Program Files (x86)\Steam\steamapps\shadercache`
     - `C:\Program Files (x86)\Steam\appcache\httpcache`
   - **What it is:** Steam’s embedded Chromium browser caches store video trailers and store assets indefinitely, and `shadercache` retains pre-cached Vulkan/DX pipelines ordered by Steam AppID—often for games you uninstalled months ago.
   - **Safety verdict:** 🟢 **100% Safe** (never touches `userdata` or `common`).

4. **Genshin Impact / HoYoPlay / Honkai Star Rail Web & Patch Caches (`4 GB – 14 GB`)**
   - **Paths:**
     - `%AppData%\Cognosphere\HYP\1_1\fedata\Cache`
     - `%LocalAppData%\HoYoverse\Genshin Impact\cache`
   - **What it is:** Embedded launcher webview caches and leftover zip staging artifacts.
   - **Safety verdict:** 🟢 **100% Safe.**

5. **Valorant & Riot Client Logs / Crash Dumps (`2 GB – 9 GB`)**
   - **Paths:**
     - `%LocalAppData%\VALORANT\Saved\Logs`
     - `%LocalAppData%\VALORANT\Saved\Crashes`
     - `%LocalAppData%\Riot Games\Riot Client\Logs`
   - **What it is:** Uncompressed `.dmp` memory crash dumps and verbose session logs.
   - **Safety verdict:** 🟢 **100% Safe** (keep `Saved\Config` untouched so your crosshair/settings stay intact).

6. **Epic Games Launcher Webcache & Unreal DerivedDataCache (`3 GB – 25 GB`)**
   - **Paths:**
     - `%LocalAppData%\EpicGamesLauncher\Saved\webcache_4430`
     - `%LocalAppData%\UnrealEngine\Common\DerivedDataCache`
   - **Safety verdict:** 🟢 **100% Safe.**

### Quick PowerShell One-Liner to Audit Your Own `C:` Drive (Zero Install)

Paste this read-only snippet into PowerShell to see how many GB these 6 folders are using on your machine right now:

```powershell
$paths = @(
  "$env:LOCALAPPDATA\NVIDIA\DXCache",
  "$env:LOCALAPPDATA\AMD\DxCache",
  "$env:LOCALAPPDATA\Steam\htmlcache",
  "${env:ProgramFiles(x86)}\Steam\steamapps\shadercache",
  "$env:LOCALAPPDATA\EpicGamesLauncher\Saved",
  "$env:LOCALAPPDATA\VALORANT\Saved\Crashes",
  "$env:APPDATA\Cognosphere\HYP"
)
foreach ($p in $paths) {
  if (Test-Path $p) {
    $bytes = (Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    "{0,-60} {1,8:N2} GB" -f $p, ($bytes / 1GB)
  }
}
```

If you want to check other games/apps without running scripts, we also put up a free, zero-signup **Windows Gaming & AI Cache Bloat Calculator** with all 377 folder safety rules here: https://sweeprcleaner.com/benchmark
```

---

## 3. Ready-to-Post Draft: `r/StableDiffusion`

**Title:** How ComfyUI, HuggingFace & Ollama silently eat 80+ GB of `C:` drive space on Windows (and how to clean orphaned blobs without touching your checkpoints)

**Body:**
```markdown
Even if you keep your main `ComfyUI/models/checkpoints` and `loras` on a dedicated 2 TB `D:` or `E:` drive, running local AI workflows on Windows 11 silently writes **40 GB to 120 GB of hidden cache duplicates onto your `C:` drive**.

Here are the 5 biggest culprits we found when auditing local Stable Diffusion / Flux / LLM workstations, along with how to clean them safely without deleting your active `.safetensors` weights:

### 1. `%LocalAppData%\pip\Cache` & `uv` Wheel Cache (`8 GB – 35 GB`)
Every time you install or update a ComfyUI custom node that pulls a slightly different `torch`, `xformers`, `triton`, or `onnxruntime-gpu` build, `pip` caches the entire `2.5 GB` `.whl` archive in `%LocalAppData%\pip\Cache\http-v2`.
- **Safe cleanup:** `pip cache purge` (or delete `%LocalAppData%\pip\Cache`). Your installed `venv` packages are completely unaffected.

### 2. `%UserProfile%\.cache\huggingface\hub` (`15 GB – 90 GB`)
When a custom node (like ControlNet preprocessors, Florence-2, CLIP vision, or IP-Adapter) auto-downloads weights via `huggingface_hub`, they don't go into your `ComfyUI\models` folder—they go straight to `C:\Users\<you>\.cache\huggingface\hub`! Worse, interrupted downloads leave multi-gigabyte `.incomplete` blobs inside `blobs\`.
- **Safe cleanup:** Delete any `*.incomplete` files inside `.cache\huggingface\hub\models--*\blobs\`, and remove `models--*` folders for pipelines you no longer use.

### 3. `ComfyUI\temp` & `%Temp%` Latent/Preview Buffers (`2 GB – 18 GB`)
Long batch runs and video workflows (AnimateDiff, Wan2.1, HunyuanVideo, LivePortrait) dump thousands of uncompressed PNG frames and intermediate preview tensors into `ComfyUI\temp` and `%LocalAppData%\Temp`.
- **Safe cleanup:** 100% safe to empty whenever ComfyUI is not actively generating.

### 4. `%UserProfile%\.ollama\models\blobs` Orphaned Layers (`10 GB – 60 GB`)
If you use Ollama alongside ComfyUI (for prompt enhancement or local LLMs), failed pulls or deleted manifest tags often leave multi-gigabyte `sha256-*` blob files in `.ollama\models\blobs` that aren't referenced by any file in `.ollama\models\manifests`.

### 5. NVIDIA Compute Shader Cache (`%LocalAppData%\NVIDIA\DXCache` & `ComputeCache`) (`2 GB – 15 GB`)
CUDA/DirectML/TensorRT engine caches accumulate across driver updates.

---

### Read-Only PowerShell Check for AI Workstations

```powershell
$aiPaths = @(
  "$env:LOCALAPPDATA\pip\Cache",
  "$env:USERPROFILE\.cache\huggingface\hub",
  "$env:USERPROFILE\.ollama\models\blobs",
  "$env:USERPROFILE\.cache\lm-studio",
  "$env:LOCALAPPDATA\NVIDIA\ComputeCache"
)
foreach ($p in $aiPaths) {
  if (Test-Path $p) {
    $gb = ((Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum) / 1GB
    "{0,-55} {1,8:N2} GB" -f $p, $gb
  }
}
```

We also built a free interactive **Windows Gaming & AI Cache Bloat Calculator** (no signup/email) where you can toggle ComfyUI, HuggingFace, Ollama, Docker, and Steam to see exact paths and safety verdicts: https://sweeprcleaner.com/tools/pc-cache-calculator
```

---

## 4. Ready-to-Post Draft: `r/Windows11`

**Title:** I audited 377 folders inside `%LOCALAPPDATA%` and `C:\Windows` on Windows 11 — here is a plain-English cheat sheet of what is 100% safe to delete vs. what breaks your PC

**Body:**
```markdown
Every few months someone posts a WizTree or TreeSize screenshot asking *"Why is `AppData\Local` using 95 GB on my 512 GB SSD?"* and half the replies say *"Never touch AppData"* while the other half recommend legacy cleaners that bundle adware or break registry keys.

Over the last few months, we documented **377 specific Windows 11 cache directories**—mapping out the owning app, what the folder actually stores, what happens on the next launch if you delete it, and whether it's 100% safe.

### Top 8 Safe-to-Delete Folders That Built-In Disk Cleanup Misses

| Folder Path | Typical Size | Owner | What Happens If Deleted? |
| :--- | :--- | :--- | :--- |
| `%LocalAppData%\NVIDIA\DXCache` | `2–16 GB` | NVIDIA Driver | 🟢 Safe. Old DirectX shader cache; active games recompile smoothly. |
| `%LocalAppData%\Microsoft\Edge\User Data\Default\Service Worker\CacheStorage` | `1–12 GB` | Edge / WebView2 | 🟢 Safe. Offline PWA/service-worker blobs; does **not** log you out. |
| `%LocalAppData%\Google\Chrome\User Data\Default\Service Worker\CacheStorage` | `2–18 GB` | Chrome | 🟢 Safe. Clears offline web app bloat while keeping cookies & passwords. |
| `%AppData%\discord\Cache\Cache_Data` | `1–8 GB` | Discord | 🟢 Safe. Old embedded images/videos from servers you scrolled past. |
| `%LocalAppData%\Packages\Microsoft.Windows.Search_*\LocalState\ConstraintIndex` | `1–9 GB` | Windows Search | 🟢 Safe. Rebuilds search index cleanly in the background. |
| `%LocalAppData%\CrashDumps` | `0.5–10 GB` | Windows WER | 🟢 Safe. User-mode `.dmp` crash dumps from old app crashes. |
| `%LocalAppData%\pip\Cache` | `2–30 GB` | Python / AI | 🟢 Safe. Cached `.whl` installer packages; installed packages stay intact. |
| `%AppData%\Cursor\User\workspaceStorage` | `3–18 GB` | Cursor / VS Code | 🟡 Delete stale workspaces only. Keeps active project indexes fast. |

### 4 Folders You Should NEVER Blindly Delete in File Explorer
1. **`C:\Windows\WinSxS`** — Hard-linked component store (use `Dism.exe /Online /Cleanup-Image /StartComponentCleanup` instead of manual deletion).
2. **`C:\Windows\Installer`** — Cached `.msi` & `.msp` patch packages; deleting them breaks future app uninstalls and updates.
3. **`%LocalAppData%\Google\Chrome\User Data\Default\Network` (or `Login Data`)** — Contains your active session cookies and saved credentials.
4. **`%AppData%\Roaming\...` config folders without `\Cache`** — Often holds user profiles, saved games, and settings.

You can paste any folder path from WizTree/File Explorer into our free **Instant Folder Safety Checker** (`https://sweeprcleaner.com/safe-to-delete`) or use the interactive **Cache Bloat Calculator** (`https://sweeprcleaner.com/benchmark`) to see a plain-English verdict before deleting anything.
```

---

## 5. Ready-to-Post Draft: Hacker News (`Show HN`)

**Title:** Show HN: Sweepr – A 6.5 MB Rust desktop cleaner built because CCleaner turned into bloatware

**URL:** `https://sweeprcleaner.com/benchmark`

**First Comment (Founder Technical Context):**
```markdown
Hi HN,

I built Sweepr Cleaner (`https://sweeprcleaner.com`) out of frustration with the state of desktop disk utilities on Windows and macOS.

On one side, legacy cleaners like CCleaner grew into 80+ MB Electron/C++ bundles with persistent background telemetry daemons, browser hijacks, upsell popups, and "registry cleaners" that do more harm than good. On the other side, modern developer/AI/gaming workstations lose 50–150 GB of NVMe space to directories that built-in OS tools (`Storage Sense` / `cleanmgr`) don't know exist:

- `%UserProfile%\.cache\huggingface\hub` & `%LocalAppData%\pip\Cache` (20–80 GB of orphaned wheel & model blobs)
- `%LocalAppData%\NVIDIA\DXCache` & Steam `shadercache` (10–30 GB)
- Chromium `Service Worker\CacheStorage` across Chrome, Edge, Brave, Discord, Slack, and Cursor/VS Code
- JetBrains indeks/caches, Xcode `DerivedData`, and Docker WSL2 virtual disks

### Technical Architecture
1. **6.5 MB Native Rust + Tauri v2 Binary:** No bundled Chromium runtime, zero background telemetry services when closed, and sub-350ms parallel directory traversal using Rust's `walkdir` + `rayon`.
2. **377 Explainable Rules ("Why is this safe to delete?"):** Every single rule in the scanner has a plain-English safety specification: what owns the path, what it stores, what happens on next launch if deleted, and rebuild cost. We never touch browser cookies/logins by default and we do not include a "registry cleaner."
3. **Process Conflict Detection & 7-Day Quarantine Undo:** Before touching a cache, Sweepr checks running process handles so active apps aren't disrupted, and routes deletions through a local 7-day undo quarantine (or OS Trash) so any file can be restored in one click.
4. **Free Web Tools (Zero Signup):**
   - Interactive Gaming & AI Cache Bloat Calculator: https://sweeprcleaner.com/benchmark
   - Paste-Any-Path Safety Checker (all 377 rules searchable in the browser): https://sweeprcleaner.com/safe-to-delete

The web calculators and the 500 MB desktop scanner are free without an account. Would love your feedback on the rule definitions, false-positive edge cases, or additional developer/AI cache paths we should add!
```

---

## 6. Post-Launch Viral Loop & Community Engagement Checklist

1. **Timing & Cadence:**
   - Post `r/pcgaming` and `r/StableDiffusion` on Tuesday/Wednesday between `13:00–15:00 UTC` (peak US East + EU overlap).
   - Post `Show HN` on Thursday at `14:00 UTC`.
2. **Reply with Specific Path Audits:**
   - When commenters ask *"What about `<App X>`?"*, run the path through `/safe-to-delete`, reply with the exact `%LOCALAPPDATA%` path + PowerShell check, and add the rule to `clean-items.json`.
3. **In-App & Web Viral Loop (`GET /share/win`):**
   - Every user who completes a scan/clean or runs `/benchmark` can click **"Share My Storage Win (+30 Days Free Pro)"**, generating a 1200×630 dark-emerald benchmark card (`sweeprcleaner.com/r/CODE`) that unfurls natively on X, Reddit, Slack, and Discord via `GET /share/win`.
