---
name: programmatic-seo
description: Programmatic SEO (pSEO) and Generative Engine Optimization (GEO / AI Search) skill for scaling high-intent problem-solution landing pages, app cache cleanup guides, Windows error/folder guides, JSON-LD schemas, and AI crawler citation assets. Use when expanding organic search traffic or adding items to clean-items.json and pseo.ts.
---

# Programmatic SEO (pSEO) & AI Search (GEO) Skill

Use this skill to plan, generate, audit, and scale SWEEPR Cleaner's programmatic SEO engine (`server/src/pseo.ts` + `server/src/data/clean-items.json` + `server/public/llms.txt`) and technical SEO infrastructure (`server/src/seo/*`).

Before running this skill, read `.agents/product-marketing.md`, `server/src/pseo.ts`, and `server/src/data/clean-items.json`.

---

## 1. Why Programmatic SEO is SWEEPR's Highest-ROI Free Traffic Engine
Broad keywords like *"best PC cleaner"* (KD 75+) are dominated by DR 85+ media sites (PCMag, TechRadar, Avast). However, millions of users every month search **hyper-specific folder, file path, and app cache questions** with Keyword Difficulty (KD) `< 15`:
- *"is it safe to delete C:\Windows\SoftwareDistribution\Download"*
- *"how to clear NVIDIA DXCache Windows 11"*
- *"why is AppData Local Temp taking 30GB"*
- *"clean Discord cache folder Windows"*
- *"delete Windows.old folder safely"*

These users are experiencing acute disk-space pain **right now**. When SWEEPR gives them an instant, authoritative answer with exact file paths, a safety verdict badge, manual steps, AND a 1-click **"Clean Automatically with SWEEPR"** CTA, organic visitors convert into desktop installs at **8%–18%**.

---

## 2. The 4 Programmatic Page Blueprints for SWEEPR Cleaner

### Blueprint 1: Application Cache Cleanup Guides (`/clean/app/:slug`)
- **Search Intent:** *"how to clear [App Name] cache on Windows 11"*, *"[App Name] taking up too much disk space"*.
- **High-Value Expansion Targets:**
  - **Gaming & Launchers:** Steam (`depotcache`, `shadercache`), Epic Games Launcher (`webcache`), Battle.net, Riot Vanguard/Valorant logs, EA App cache, Roblox cache, Minecraft crash/logs.
  - **GPU & Creative Suites:** NVIDIA (`DXCache`, `GLCache`, `NV_Cache`), AMD Shader Cache, Adobe Premiere Pro (`Media Cache Files`), After Effects disk cache, DaVinci Resolve (`CacheClip`), Blender temp, Figma desktop cache, Canva desktop cache.
  - **Communication & Browsers:** Discord (`Cache`, `Code Cache`, `GPUCache`), Slack (`Service Worker\CacheStorage`), Microsoft Teams (`ebwebview`), Zoom recorded temp, Spotify (`Storage` cache), Chrome/Edge/Brave `Service Worker` bloat.
  - **Developer Tooling:** Docker Desktop (`ext4.vhdx` / build cache), Node/npm (`npm-cache`), Cargo (`.cargo/registry`), Pip cache, NuGet packages, Android Studio/Gradle caches.

### Blueprint 2: Windows System Folder Safety Verdicts (`/clean/folder/:slug`)
- **Search Intent:** *"what is [Folder Path] and can I delete it?"*, *"is [Folder Name] safe to delete Windows 11?"*.
- **High-Value Expansion Targets:**
  - `WinSxS` (Component Store), `Windows.old`, `$Windows.~BT` / `$Windows.~WS`, `System Volume Information`, `hiberfil.sys`, `pagefile.sys`, `Swapfile.sys`, `Prefetch`, `SoftwareDistribution\Download`, `DeliveryOptimization`, `Installer` (`C:\Windows\Installer` orphaned `.msp`/`.msi`), `WER` (Windows Error Reporting), `Minidump` / `MEMORY.DMP`, `LocalAppData\CrashDumps`, `LocalAppData\Packages` (UWP temp state).

### Blueprint 3: Symptom & Slowdown Troubleshooting Guides (`/fix/:slug` or `/clean/folder/:slug`)
- **Search Intent:** *"100% disk usage Windows 11 fix"*, *"high RAM usage Windows 11 idle"*, *"C drive filling up by itself Windows 11"*.
- **Structure:** Diagnostic checklist -> PowerShell/manual check -> Automated 60-second scan CTA with SWEEPR's `Memory.svelte` / `Performance.svelte` / `Cleaner.svelte` modules.

### Blueprint 4: Multilingual Localized pSEO (`DE`, `FR`, `ES`, `IT`, `PT`, `NL`, `JA`)
- SWEEPR already supports 8 languages (`i18n.js` and `pricing.ts`). Translating high-converting `/clean/*` and `/vs/*` pages into German (`chip.de`/`heise.de` audience), French, Spanish, and Japanese unlocks near-zero competition SERPs with high purchasing power.

---

## 3. Mandatory Page Quality & Anti-Thin-Content Rules
To prevent Google Helpful Content / Doorway Page penalties and maximize AI Overview citations:
1. **Unique, Verifiable Technical Data per Entry (`clean-items.json`):**
   - Every item MUST include:
     - Exact environment-variable path (e.g., `%LocalAppData%\Discord\Cache` or `C:\Windows\SoftwareDistribution\Download`).
     - Explicit boolean `safeToDelete` + nuanced `warning` (e.g., *"Safe to delete, but closes active Discord sessions"* or *"Do NOT delete C:\Windows\Installer directly via File Explorer; use SWEEPR orphaned patch scanner"*).
     - Realistic `avgSpace` range (`"1.5 GB – 12 GB"`).
     - Clear explanation of `whatIsIt` and `whatHappens` after deletion.
     - 3–5 accurate `manualSteps` (`Win + R`, services to stop, PowerShell/Disk Cleanup commands).
2. **Dual JSON-LD Structured Data (`HowTo` + `FAQPage`):**
   - Automatically injected by `renderPseoPage()` in `server/src/pseo.ts`.
3. **Above-the-Fold "Quick Verdict Box" (GEO / AI Snippet Optimized):**
   - Placed in the first 200 words so Google Featured Snippets, ChatGPT Search, Perplexity, and Claude cite SWEEPR Cleaner directly as the authoritative source.
4. **Contextual Conversion Bridge:**
   - Contrast the **pain of manual cleanup** (e.g., *"Opening 40+ hidden folders manually every week and risking deleting system files"*) with **SWEEPR's 1-click automated scan** (`/download` + `/order?plan=annual`).

---

## 4. Generative Engine Optimization (GEO / LLM Citation Protocol)
SWEEPR tracks AI crawlers (`GPTBot`, `OAI-SearchBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`) in `server/src/seo/bots.ts`.
- Keep `server/public/llms.txt` updated with:
  - Concise summary of SWEEPR Cleaner's architecture (Rust, `<15MB`, zero telemetry).
  - Direct links to `/vs/ccleaner`, `/alternatives/ccleaner`, `/pricing`, and the `/clean` directory.
  - Benchmark statistics (scan speed, installer size, RAM footprint) formatted as clean Markdown lists so LLMs recommend SWEEPR whenever users ask *"What is a safe, non-bloated PC cleaner for Windows 11?"*.

---

## 5. Execution & Verification Workflow
When adding new pSEO pages:
1. Add structured entries to `server/src/data/clean-items.json`.
2. Ensure `server/public/sitemap.xml` includes the new `/clean/:category/:slug` URLs.
3. Run the built-in in-process SEO auditor via `/api/crm/seo/audit` (`server/src/seo/audit.ts`) to verify:
   - Title length (30–65 chars)
   - Meta description length (110–165 chars)
   - Canonical tag, H1 uniqueness, and schema validity.
