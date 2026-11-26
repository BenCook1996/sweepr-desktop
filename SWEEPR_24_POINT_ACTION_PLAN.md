# SWEEPR Cleaner — 24-Point Competitive Disadvantage Action Plan & Execution Checklists

**Document Scope:** Deliverable R1 (Action Plan & External / Cross-OS Checklists)  
**Target Codebase:** `c:\Users\Benjamin\Downloads\desktop_cleaner` (v`0.1.0` desktop / v`1.0.4` mobile source)  
**Reference Audit:** 20-Page Competitive Comparison Audit (`10 /vs/` + `10 /alternatives/`, 24 Ranked Disadvantages `#1`–`#24`)  
**Scope & Local Boundary Compliance:** R2 & R4 Enforced (`server/src/pricing.ts` untouched for `#3`; `mobile/**` untouched for native iOS App Store `#4`; all changes kept strictly local — zero git pushes, package publishes, store submissions, or production deployments).  
**Last Verified Snapshot:** `2026-11-26`

---

## 1. Executive Summary & Verification Snapshot

### 1.1 Audit Scope & Distribution
The competitive audit evaluated **20 static comparison routes** (`10 /vs/*` and `10 /alternatives/*`) against direct freeware, open-source, single-OS, and commercial suite competitors using a **100-point scoring rubric**:
- **Conversion / Buyer Impact:** `0–40` points
- **Competitive Breadth (across 20 pages & rivals):** `0–35` points
- **Gap Severity / Structural Difficulty:** `0–25` points

Across the **24 ranked disadvantages** (`#1` at `96/100` down to `#24` at `22/100`):
- **By Severity Grade:** **3 Grade S · Critical** (`#1`–`#3`, `85–100`), **5 Grade A · Major** (`#4`–`#8`, `70–84`), **6 Grade B · Significant** (`#9`–`#14`, `55–69`), **5 Grade C · Moderate** (`#15`–`#19`, `40–54`), **5 Grade D · Minor / Niche** (`#20`–`#24`, `1–39`).
- **By Audit Fix Lane:** **5 `quick`** ("Immediate 1-Day Copy & Template Fixes": `#7`, `#11`, `#17`, `#22`, `#24`) and **19 `product`** ("High-Leverage Product, Pricing & Distribution Bets": `#1`–`#6`, `#8`–`#10`, `#12`–`#16`, `#18`–`#21`, `#23`).

### 1.2 At-a-Glance Remediation Status Matrix (`#1`–`#24`)

| Rank | Score (I/B/S) | Grade | Lane (Effort) | Pages | Title | Workspace Status | Checklist |
|---:|---|---|---|---|---|---|---|
| **#1** | `96/100` (`39/34/23`) | S · Critical | `product` (`3`) | `20/20` | Severe 500 MB Free Starter Cap vs Unlimited $0 Freeware & FOSS Rivals | **Implemented Locally** (Contract 1 Option B) | — |
| **#2** | `91/100` (`37/32/22`) | S · Critical | `product` (`4`) | `20/20` | Flagship "7-Day Undo Quarantine" Restricted (<50 MB/File, Max 300 Items) | **Implemented Locally** (Contract 2 Option A) | — |
| **#3** | `88/100` (`36/30/22`) | S · Critical | `product` (`3`) | `14/20` | Subscription-Only (£49.99/yr) — Higher Price for 1-Device Buyers & No Lifetime Tier | **Excluded from Code by R2** (`pricing.ts` untouched) | [Checklist A](#checklist-a-3--future-pricing-sku--guarantee-evaluation) |
| **#4** | `84/100` (`33/30/21`) | A · Major | `product` (`5`) | `20/20` | No Published Apple App Store iOS App Yet (Safari Web Companion / TestFlight Beta) | **Excluded from Code by R2** (Disclosure synced locally under `#7`) | [Checklist B](#checklist-b-4--native-ios-app-store--testflight-roadmap) |
| **#5** | `81/100` (`31/30/20`) | A · Major | `product` (`4`) | `20/20` | Brand Authority, Longevity & Solo-Trader Trust Deficit vs 10–20-Year Incumbents | **Partially Implemented** (Local trust docs/UI/manifests; external portals pending) | [Checklist C](#checklist-c-5-6--trust-code-signing-local-doc-hygiene--distribution-portals) |
| **#6** | `78/100` (`30/26/22`) | A · Major | `product` (`4`) | `7/20` | Closed-Source Binary + Telemetry vs 100% Open-Source Zero-Telemetry FOSS | **Partially Implemented** (`telemetry_enabled=false` + `docs/public-rules-catalog.json` local; public GitHub mirror pending) | [Checklist C](#checklist-c-5-6--trust-code-signing-local-doc-hygiene--distribution-portals) |
| **#7** | `76/100` (`33/25/18`) | A · Major | `quick` (`1`) | `4/20` | 4 Un-Migrated Legacy Pages (`4.9 / 5.0` Badges, Wrong Entity, Broken "5 Best", Missing Disclosures) | **Implemented Locally** (4 pages migrated + un-retired across routes/sitemap/tests) | — |
| **#8** | `73/100` (`29/25/19`) | A · Major | `product` (`5`) | `7/20` | No Interactive Visual Disk-Space Map (Sunburst / Treemap / Explorer Context Menu) | **Partially Implemented** (Treemap/Sunburst + HKCU Explorer + macOS APFS code; macOS runtime verification pending) | [Checklist D](#checklist-d-8-10-12-18--cross-os-macos--linux-ciruntime-verification) |
| **#9** | `69/100` (`27/24/18`) | B · Significant | `product` (`4`) | `8/20` | No Ecosystem Bundle or First-Party Store Distribution (Setapp, MS Store, Mac App Store) | **Partially Implemented** (Winget/Choco/Scoop/Homebrew manifests + site CLI cmds; external store/PR submissions pending) | [Checklist E](#checklist-e-9--package-managers--ecosystem-store-submissions) |
| **#10** | `66/100` (`26/22/18`) | B · Significant | `product` (`3`) | `4/20` | No Real-Time Malware / Antivirus / Security Protection | **Implemented Locally** (`os_security_health` Win/Mac/Linux; macOS/Linux live execution in Checklist D) | [Checklist D](#checklist-d-8-10-12-18--cross-os-macos--linux-ciruntime-verification) |
| **#11** | `63/100` (`28/20/15`) | B · Significant | `quick` (`1`) | `4/20` | Windows-Only Audit CTA & Raw HTML Tags (`<em>`, `&amp;`) Leaked in JSON-LD on Mac Pages | **Implemented Locally** (4 Mac pages + `llms-index.ts` fixed) | — |
| **#12** | `61/100` (`22/19/20`) | B · Significant | `product` (`4`) | `2/20` | No Linux Support (Native DEB / RPM / AppImage / SteamOS) | **Partially Implemented** (20 Linux rules, uninstaller, CI metadata export, web copy; Linux runner build/test pending) | [Checklist D](#checklist-d-8-10-12-18--cross-os-macos--linux-ciruntime-verification) |
| **#13** | `58/100` (`21/19/18`) | B · Significant | `product` (`3`) | `3/20` | No Headless CLI Scripting (`--clean`) or Community Rule Extensibility (`winapp2.ini`) | **Implemented Locally** (`--scan`/`--clean`/`--dry-run`/`--json` + validated `custom_rules.json`) | — |
| **#14** | `56/100` (`20/18/18`) | B · Significant | `product` (`3`) | `4/20` | No Deep Forensic Free-Space or Low-Level Metadata Wiping (ThumbCache, HDD Zeroing) | **Partially Implemented** (`thumbnails`/`recent_activity` rules + HDD-only `wipe_free_space` + NSIS fix; physical HDD test pending) | [Checklist F](#checklist-f-14-17-21-23--windows-packaging-arm64--physical-hardware-verification) |
| **#15** | `53/100` (`19/19/15`) | C · Moderate | `product` (`2`) | `5/20` | No Portable Zero-Install ZIP / USB Executable & No Native Windows ARM64 Build | **Partially Implemented** (`portable.flag`/`--portable` + CI ARM64/ZIP job; ARM64 toolchain & release upload pending) | [Checklist F](#checklist-f-14-17-21-23--windows-packaging-arm64--physical-hardware-verification), [Checklist G](#checklist-g-15--portable-distribution-packaging) |
| **#16** | `50/100` (`18/18/14`) | C · Moderate | `product` (`3`) | `7/20` | Shallower App Uninstaller Depth (No Batch, UWP/OEM Removal, or Force Removal) | **Implemented Locally** (Batch uninstall, UWP/Appx, Force Remove leftovers) | — |
| **#17** | `47/100` (`18/16/13`) | C · Moderate | `quick` (`1`) | `5/20` | Neutralized "Smallest Binary" Claim vs Lean Native Rivals | **Implemented Locally** (Repositioned on GB reclaimed + `6.76 MB` parity; NSIS/WiX local rebuild pending toolchain) | [Checklist F](#checklist-f-14-17-21-23--windows-packaging-arm64--physical-hardware-verification) |
| **#18** | `44/100` (`16/14/14`) | C · Moderate | `product` (`3`) | `5/20` | No Deep macOS System Maintenance (Spotlight / LaunchServices / DNS Flush) | **Partially Implemented** (`run_macos_maintenance` + UI + CI notarization job; `macos-latest` runtime verification pending) | [Checklist D](#checklist-d-8-10-12-18--cross-os-macos--linux-ciruntime-verification) |
| **#19** | `41/100` (`16/13/12`) | C · Moderate | `product` (`3`) | `4/20` | No Background App Suspender ("Sleep Mode") or 1-Click RAM Boost / Process Manager | **Implemented Locally** (Live `StartupItem` RSS/CPU impact + Win11 memory disclosure) | — |
| **#20** | `37/100` (`12/10/15`) | D · Minor / Niche | `product` (`4`) | `1/20` | No Enterprise / Fleet Management (MDM Deployment & Multi-Seat Admin Console) | **Partially Implemented** (Phase-1 `--activate-token` + HKLM policy + `docs/mdm-deployment.md`; Phase-2 ADMX/console deferred) | [Checklist H](#checklist-h-20--enterprise-phase-2-mdm-templates--multi-seat-admin-console) |
| **#21** | `34/100` (`12/11/11`) | D · Minor / Niche | `product` (`2`) | `3/20` | No HDD Defragmentation, Manual SSD TRIM, or Windows System Slimmer | **Partially Implemented** (`list_optimizable_drives` / `optimize_drive` + Win11 auto-TRIM disclosure; elevated host check pending) | [Checklist F](#checklist-f-14-17-21-23--windows-packaging-arm64--physical-hardware-verification) |
| **#22** | `30/100` (`12/11/7`) | D · Minor / Niche | `quick` (`1`) | `5/20` | No Registry Cleaner (Intentional Safety Exclusion — Perceived Gap) | **Implemented Locally** (Audited `registry_cleaner.rs` HKCU safe repair + truthful UI/web disclosure) | — |
| **#23** | `26/100` (`10/9/7`) | D · Minor / Niche | `product` (`2`) | `2/20` | No One-Click Windows Hibernation Toggle (`hiberfil.sys`) | **Partially Implemented** (`hibernation_status` + `set_hibernation_enabled` UAC retry; elevated host toggle pending) | [Checklist F](#checklist-f-14-17-21-23--windows-packaging-arm64--physical-hardware-verification) |
| **#24** | `22/100` (`8/8/6`) | D · Minor / Niche | `quick` (`1`) | `2/20` | No Windows Power-User Micro-Utility Suite | **Implemented Locally** (Context Menu Manager + Broken Shortcut Fixer + Empty Folder Finder aligned cleanly) | — |

### 1.3 Verified Workspace Build, Test & Packaging Outcomes

| Component | Command | Verified Outcome | Scope / Notes |
|---|---|---|---|
| **Desktop Rust (`app/src-tauri`)** | `cargo check --all-targets` | **Exit `0`** | Only 1 pre-existing `dead_code` warning at `src/licensing.rs:892`; `0` new warnings |
| **Desktop Rust Unit/Integration** | `cargo test --lib` | **Exit `0` — `100 passed; 0 failed; 1 ignored`** | `scanner::tests::benchmark_local_windows_scan` is the single `#[ignore]` benchmark (`197.38s`) |
| **Desktop Frontend (`app`)** | `npx tsc --noEmit && npm run build` | **Exit `0` — `152` modules transformed** | Produces `dist/index.html`, `dist/assets/style-BHYnosYQ.css`, `dist/assets/index-Z7dBnUF0.js` |
| **Server TypeScript (`server`)** | `npm run typecheck` (`tsc --noEmit`) | **Exit `0`** | Verified directly in M2, M3, and M4 |
| **Server Unit & Integration (`server`)** | `npm test` (`tsx --test test/*.test.ts`) | **Exit `0` — `497/497` pass across `64` suites** | `0` failed, `0` skipped (`e2e-p2-p3-acceptance.test.ts` untouched) |
| **Server E2E Suites (`server`)** | `npm run test:e2e` (`test/e2e-*.test.ts`) | **Exit `0` — `188/188` pass across `35` suites** | `0` failed, `0` skipped |
| **Winget Manifest Validation** | `winget validate --manifest winget-manifests\manifests\s\Sweepr\SweeprCleaner\0.1.0` | **Exit `0`** | `"Manifest validation succeeded."` |
| **Community Packaging AST/Parity** | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-community-scripts.ps1` | **Exit `0`** | `Parse errors: 0`; validates Chocolatey, Scoop, Winget, and SHA-256 parity |
| **Windows Authenticode Check** | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sign-windows.ps1 -File "server\public\SWEEPRCleaner.exe" -VerifyOnly` | **Exit `0`** | `Status: Valid`, Thumbprint `1800DBEA6FE847D384E549D02CA372C3D45D8B81` |
| **Release Sync Script Syntax** | `node --check server/scripts/update-release-listings.mjs` | **Exit `0`** | Plus isolated `0.2.0` BOM & `winget validate` simulation PASS |
| **R2/R3/R4 Boundary Checks** | `git diff --ignore-cr-at-eol -- server/src/pricing.ts mobile/` | **Empty (`0` edits)** | Zero changes to `pricing.ts` (`#3`) or `mobile/` (`#4`) |

> **Milestone M5 Browser Verification Schedule:** Live headless Chromium verification via `chrome_devtools` MCP across all **20** `/vs/*` and `/alternatives/*` routes (checking HTTP `200`, rendered DOM layout, JSON-LD parsing, zero HTML tags in JSON-LD, legal entity `Benjamin Cook t/a SWEEPR Cleaner`, and zero console/runtime errors) is scheduled in **Milestone M5**.

### 1.4 Known Minor Polish & Environment Caveats
1. **Portal Kit Metadata Refreshed (`docs/distribution/tier1-download-portals.md:12-26+`):** Updated on `2026-11-27` to `Benjamin Cook t/a SWEEPR Cleaner`, `7,085,912 bytes (6.76 MB)`, SHA-256 `FEAE464CA121CF897D27916C632F4DB8F84A87D4B79642403AD1B0E0F2BB706A`, and Contract 1 & 2 copy ([Checklist C](#checklist-c-5-6--trust-code-signing-local-doc-hygiene--distribution-portals)).
2. **UK Correspondence Address Completed (`server/public/about.html:266`, `server/public/terms.html:167`, `server/public/order.html:968`, `index.html`, `pricing.html`, `privacy.html`, `refund.html`, `support.html`, `i18n-dict.js`):** Replaced `[UK Correspondence Address — To Be Completed]` with `87 Upper Brighton Road, Worthing, West Sussex` ([Checklist C](#checklist-c-5-6--trust-code-signing-local-doc-hygiene--distribution-portals)).
3. **On-Disk `Sweepr_Setup.msi` Signing Status (`server/public/Sweepr_Setup.msi`):** The pre-existing `v0.1.0` MSI on disk (`3,993,600` bytes, SHA-256 `33E5427E84AB8FC4F3D01DFD17404F7CB38B70B9731A8C2CCFBB62876711933A`) is Authenticode `NotSigned` on disk (verified via SHA-256 and Ed25519 `.sig` sidecar and explicitly disclosed in `docs/trust-verification.md:75,120`). In CI, `.github/workflows/build-apps.yml` Authenticode-signs both `.exe` and `.msi` via `azure/artifact-signing-action@v1` when `AZURE_SIGNING_ENABLED=true`.
4. **Minor Non-Blocking Observations:** `server/public/vs/cleanmymac.html:210` summarizes `24 macOS rule groups (114 Mac patterns)` inside `71 cross-OS rules (455 patterns)` (whereas the other 7 Mac pages break out `27 Win / 24 Mac / 20 Linux`); `server/scripts/update-release-listings.mjs:138` reads `app/src-tauri/tauri.conf.json` without `.replace(/^\uFEFF/, "")` (safe because `tauri.conf.json` has no BOM); `.github/workflows/build-apps.yml:344,349` omits explicit `$LASTEXITCODE` checks after `gh release upload`.
5. **Local Host Toolchain Scope:** The Windows x64 workstation has `cargo`, `rustc`, `rustup` (`x86_64-pc-windows-msvc` target only), `node`, `npm`, `winget`, `choco`, `git`, `gh`, and `signtool.exe` installed in Windows Kits 10 (`C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe`, off default `$env:PATH`), whereas `makensis`, WiX (`candle`/`light`/`wix`), `ruby`, `scoop`, macOS Xcode/notarytool, Linux runners, and `aarch64-pc-windows-msvc` are absent.

---

## 2. Architectural Decisions for `#1` & `#2`

### 2.1 `#1` Free Starter Cap Revision — Contract 1 (Option B Selected)

**Audit Options Considered:**
- *Option A:* Raise the lifetime cap from `500 MB` to `2–5 GB`. **Rejected:** Simply delays the same bait-and-switch friction by one or two cleanups; on modern gaming/AI/dev PCs, a single browser + temp sweep still hits a 2 GB wall and turns freeware switchers hostile.
- *Option B (Selected):* **Unlimited Free Temp & Browser Cache Clean (to OS Recycle Bin)** across Windows, macOS, and Linux, while keeping deep Pro categories (`shader_cache`, `creator_ai_caches`, `dev_caches`, `game_launchers`, `alt_browsers`, `duplicates`, `uninstaller`, `shredder`, `scheduler`, `registry_cleaner`, and 7-Day Undo Quarantine) Pro-gated.
- *Option C:* 7-day time-limited full-feature trial. **Rejected:** Creates urgency anxiety and expires to `$0` ongoing utility after day 7, hurting organic word-of-mouth against BleachBit, Pearcleaner, and Wise Disk Cleaner.

**Architectural Implementation:**
- **Rule Split (`app/src-tauri/src/rules.rs:240-327`):** `free: true` applies strictly to `temp` (`>24h` safety age) and standard browser cache rules (`chrome`, `edge`, `brave`, `firefox`) targeting non-credential, non-history, non-database cache paths only across Windows (`27` total rules, `5` free), macOS (`24` total rules, `5` free), and Linux (`20` total rules, `5` free). Enforced by `rules::tests::free_tier_includes_only_temp_and_standard_browser_caches` (`rules.rs:1184-1222`).
- **Execution & Safety (`app/src-tauri/src/commands.rs:73-142, 205-295`, `cleaner.rs:449-482`):** `compute_free_allowance_status` returns `limit_bytes: 0, remaining_bytes: 0, exhausted: false, unlimited: true`. `execute_free_clean` rejects `!r.free` with `AppError::PaymentRequired` and invokes `cleaner::clean_with_exclusions_quarantine_and_options` with `use_trash = true` and `max_bytes = None`, batch-moving deleted files (`TRASH_BATCH = 256`) to the OS Recycle Bin / Trash so free users retain OS-level undo without consuming SWEEPR's Pro quarantine engine.
- **Standardized Copy Contract:** *"SWEEPR Free: Unlimited Temp & Browser Cache Clean (to OS Recycle Bin); Pro unlocks Deep GPU/AI/Dev Caches, SHA-256 Duplicates, Uninstaller, Scheduler & 7-Day Undo Quarantine."*

### 2.2 `#2` 7-Day Undo Quarantine Revision — Contract 2 (Option A Selected)

**Audit Problem:** Hard ceilings (`QUARANTINE_MAX_FILE_BYTES = 50 MB` and `QUARANTINE_MAX_ITEMS = 300`) silently pushed large NVIDIA shader caches, Steam depots, AI/ComfyUI weights, Adobe media caches, and crash dumps out of SWEEPR's flagship 7-day rollback safety net.

**Architectural Implementation (Option A):**
- **Rolling Disk Budget (`app/src-tauri/src/cleaner.rs:14-44`):** Replaced both ceilings with `QUARANTINE_RETENTION_SECS = 7 * 24 * 3600` and `quarantine_budget_bytes` clamped between `QUARANTINE_MIN_BUDGET_BYTES` (**2 GB**) and `QUARANTINE_MAX_BUDGET_BYTES` (**10 GB**), defaulting to `QUARANTINE_DEFAULT_BUDGET_BYTES` (**5 GB** = `5 * 1024 * 1024 * 1024`) in `UiPreferences` (`commands.rs:2189-2265`).
- **O(1) Move-Before-Evict Semantics (`cleaner.rs:152-252`):** `move_to_quarantine_with_budget` checks `size > budget_bytes` first (routing oversized single files directly to OS Recycle Bin/Trash via `QuarantineMoveOutcome::FallbackTrash` without evicting existing entries). Otherwise, it attempts same-volume O(1) `std::fs::rename(path, &dest)` first (falling back to cross-volume `copy` + `remove_file`) **before** FIFO eviction—ensuring locked or unmovable files return `QuarantineMoveOutcome::Skipped` without destroying existing rollback history. When capacity is exceeded, oldest entries `(deleted_at, Reverse(idx))` are FIFO-evicted and their backing files deleted cleanly from `quarantine/files/`.
- **Telemetry & UI Transparency:** `CleanReport` (`cleaner.rs:25-34`) surfaces `quarantined_count` and `quarantine_fallback_count`; `get_quarantine_status` (`commands.rs:302-306`) feeds live usage bars and `2 / 5 / 10 GB` preset controls in `Account.svelte:643-685`, `Cleaner.svelte:2248-2269`, and `PreCleanConfirmDrawer.svelte:74-76`.
- **Standardized Copy Contract:** *"7-Day Undo Quarantine (configurable 2–10 GB disk budget, 5 GB default, same-volume O(1) move; OS Recycle Bin fallback if file exceeds budget; excludes shredded files, browser DBs, and registry edits)."*

---

## 3. Complete Point-by-Point Remediation Dossier (`#1`–`#24`)

### `#1` — Severe 500 MB Free Starter Cap vs Unlimited $0 Freeware & FOSS Rivals
- **Metadata:** Score `96/100` (Impact `39/40`, Breadth `34/35`, Severity `23/25`) · **Grade S · Critical** · Category: `Pricing & Free Tier` · Lane: `product` (Effort `3`) · **Affected Pages:** `20/20` (all `/vs/*` and `/alternatives/*` routes).
- **Audit Problem & Benchmarked Rivals:** Marketing claimed 10–65 GB savings while capping free cleans at 500 MB (~1–5% of a scan), causing immediate paywall friction against BleachBit, Wise Disk Cleaner, Pearcleaner, OnyX, AppCleaner, Windows Storage Sense, Microsoft PC Manager, WizTree, TreeSize Free, GrandPerspective, Geek Uninstaller, Revo Uninstaller Free, Bulk Crap Uninstaller, PrivaZer, CCleaner Free, Glary Utilities Free, and Ashampoo WinOptimizer Free.
- **Resolution Status:** **Implemented Locally** (Contract 1 Option B).
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/rules.rs:240-327, 1184-1222`: `free: true` exclusively on `temp`, `chrome`, `edge`, `brave`, `firefox` across Windows/macOS/Linux; `free_tier_includes_only_temp_and_standard_browser_caches` passes.
  - `app/src-tauri/src/commands.rs:73-142, 230-295, 4012-4099`: `compute_free_allowance_status` (`unlimited: true`, `limit_bytes: 0`), `execute_free_clean` (`use_trash = true`), `free_clean_is_unlimited_routes_to_trash_and_rejects_pro_rules` tests a 900 MB clean succeeding with `moved_to_trash == true`.
  - `app/src/lib/api.ts:47-55`, `app/src/components/Cleaner.svelte:637, 948-955, 1048, 1675, 2269`, `app/src/components/PreCleanConfirmDrawer.svelte:64-82`: zero `500 MB` free-tier cap strings in `app/` (only 6 benign non-cap UI/filter/comment `500 MB` references exist).
  - `server/public/{vs,alternatives}/*.html`, `index.html`, `pricing.html`, `order.html`, `about.html`, `llms.txt`, `i18n-dict.js`, `pad.xml`, `winget-manifests/.../Sweepr.SweeprCleaner.locale.en-US.yaml`, `chocolatey/sweepr-cleaner.nuspec`, `scoop/bucket/sweepr-cleaner.json`: all synchronized to unlimited Free Temp & Browser Cache Clean (`0` occurrences of `500 MB` cap).
- **Remaining External/Deferred Actions:** Update stale line 26 in `docs/distribution/tier1-download-portals.md` before portal submissions ([Checklist C](#checklist-c-5-6--trust-code-signing-local-doc-hygiene--distribution-portals)).

### `#2` — Flagship "7-Day Undo Quarantine" Heavily Restricted (<50 MB/File, Max 300 Items)
- **Metadata:** Score `91/100` (Impact `37/40`, Breadth `32/35`, Severity `22/25`) · **Grade S · Critical** · Category: `Product & Safety` · Lane: `product` (Effort `4`) · **Affected Pages:** `20/20`.
- **Audit Problem & Benchmarked Rivals:** `<50 MB/file, max 300 rolling items` undermined SWEEPR's primary paid safety differentiator when cleaning large GPU shaders, AI caches, Steam depots, and crash dumps vs BleachBit, Wise Disk Cleaner, Pearcleaner, CCleaner, CleanMyMac, and DaisyDisk.
- **Resolution Status:** **Implemented Locally** (Contract 2 Option A).
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/cleaner.rs:14-44, 89-100, 152-252, 714-768+`: `QUARANTINE_MIN_BUDGET_BYTES` (2 GB), `QUARANTINE_DEFAULT_BUDGET_BYTES` (5 GB), `QUARANTINE_MAX_BUDGET_BYTES` (10 GB); `CleanReport` `quarantined_count`/`quarantine_fallback_count`; `move_to_quarantine_with_budget` O(1) rename + FIFO eviction + Recycle Bin fallback; unit tests `quarantine_allows_more_than_300_items_and_files_over_50mb_within_budget` (321 items + 60 MB file) and `quarantine_fifo_evicts_oldest_and_deletes_backing_files` pass.
  - `app/src-tauri/src/commands.rs:261, 272, 302-306, 2189-2265` & `scheduler.rs:334, 345`: `UiPreferences.quarantine_budget_bytes` clamped `[2 GB, 10 GB]`, exposed via `get_quarantine_status`.
  - `app/src/components/{Account,Cleaner,PreCleanConfirmDrawer}.svelte`: interactive 2–10 GB range slider & presets + live usage display.
  - Website (`20/20` comparison pages + core pages + `i18n-dict.js` + `llms.txt`) and manifests (`pad.xml`, Winget, Chocolatey, Scoop): zero `<50 MB` or `max 300 rolling` strings remain.
- **Remaining External/Deferred Actions:** None locally (ensure `docs/distribution/tier1-download-portals.md` reflects 2–10 GB wording per [Checklist C](#checklist-c-5-6--trust-code-signing-local-doc-hygiene--distribution-portals)).

### `#3` — Subscription-Only (£49.99/yr, ~$63/yr) — Higher Price for Single-Device Buyers & Zero Lifetime Option
- **Metadata:** Score `88/100` (Impact `36/40`, Breadth `30/35`, Severity `22/25`) · **Grade S · Critical** · Category: `Pricing & Free Tier` · Lane: `product` (Effort `3`) · **Affected Pages:** `14/20` (`/vs/daisydisk`, `/alternatives/daisydisk`, `/vs/ccleaner`, `/alternatives/ccleaner`, `/vs/glary-utilities`, `/alternatives/glary-utilities`, `/vs/cleanmymac`, `/alternatives/cleanmymac`, `/vs/avast-cleanup`, `/alternatives/avast-cleanup`, `/vs/cleanmypc`, `/alternatives/cleanmypc`, `/vs/pearcleaner`, `/vs/wise-disk-cleaner`).
- **Audit Problem & Benchmarked Rivals:** Solo 1-device buyers face higher annual cost at £49.99/yr ($64.99/yr USD) than DaisyDisk ($9.99 one-time), Ashampoo WinOptimizer (perpetual), CleanMyPC (legacy lifetime), CCleaner Pro (£29.95/yr / $44.95/yr 1-PC), Glary Utilities Pro ($39.95/yr 3-PC, promos ~$19.97/yr), Avast Cleanup (~$32.99–$49.99/yr intro), and CleanMyMac ($39.95/yr 1-Mac).
- **Resolution Status:** **Excluded from Code by R2** (`server/src/pricing.ts` strictly untouched; `git diff --ignore-cr-at-eol -- server/src/pricing.ts` is empty).
- **Verified Workspace Evidence:** Current catalog confirmed at `£49.99/yr`, `£38.99/6mo`, `£9.99/mo`, `£1.99` 1st-mo intro, unified 5-device pool (`£0.83/device/mo`), `WELCOME20` / `SCAN5GB20` / `STAY30` / `GOTD50` coupons, and 14-day refund guarantee across `server/src/pricing.ts`, `pricing.html`, `order.html`, `refund.html`, `terms.html`.
- **Remaining External/Deferred Actions:** Strategic evaluation of a 1-device annual tier (`£24.99–£29.99/yr`), optional lifetime SKU (`£69–£99`), and 30-day annual refund alignment — documented in [Checklist A](#checklist-a-3--future-pricing-sku--guarantee-evaluation) and analyzed in full inside `SWEEPR_VS_TOTAL_CLEANER_PRICING_REVIEW.md`.

### `#4` — No Published Apple App Store iOS App Yet (Safari Web Companion / TestFlight Beta Only)
- **Metadata:** Score `84/100` (Impact `33/40`, Breadth `30/35`, Severity `21/25`) · **Grade A · Major** · Category: `Platform & Distribution` · Lane: `product` (Effort `5`) · **Affected Pages:** `20/20`.
- **Audit Problem & Benchmarked Rivals:** Unqualified `"Windows, Mac, Android & iOS"` claims on the 4 legacy pages risked misleading buyers given iOS is not yet on the Apple App Store.
- **Resolution Status:** **Excluded from Native iOS Implementation by R2** (`mobile/**` strictly untouched; immediate 4-page disclosure fix **Implemented Locally** under `#7`).
- **Verified Workspace Evidence:**
  - `mobile/ios/` (`16` files): `project.yml` (`com.sweepr.app` v`1.0.4` build `5`, iOS `16.0+`, RevenueCat `5.0.0+`), `11` Swift files in `Sources/App/`, `AccountService+RevenueCat.swift`, `Assets.xcassets/AppIcon.appiconset`, and `.github/workflows/ci.yml:110-130` unsigned simulator build. Zero edits (`git diff --ignore-cr-at-eol -- mobile/` empty).
  - All `20/20` comparison pages (`server/public/{vs,alternatives}/*.html`) plus `pricing.html`, `terms.html`, `refund.html`, and `llms-index.ts` now consistently qualify iOS as `"Safari web companion / TestFlight beta"`.
- **Remaining External/Deferred Actions:** Complete [Checklist B](#checklist-b-4--native-ios-app-store--testflight-roadmap) (`PrivacyInfo.xcprivacy`, `Secrets.xcconfig`, Distribution cert/provisioning, `xcodebuild archive`, TestFlight, App Store Connect IAP review) when authorized to ship native iOS.

### `#5` — Brand Authority, Longevity & Solo-Trader Trust Deficit vs 10–20-Year Incumbents
- **Metadata:** Score `81/100` (Impact `31/40`, Breadth `30/35`, Severity `20/25`) · **Grade A · Major** · Category: `Privacy & Trust` · Lane: `product` (Effort `4`) · **Affected Pages:** `20/20` (vs Microsoft, MacPaw, Piriform/Gen Digital, Titanium Software, Software Ambience, Andrew Ziem, Glarysoft, WiseCleaner, Freemacsoft).
- **Resolution Status:** **Partially Implemented Locally + External Checklist**.
- **Verified Workspace Evidence:**
  - `docs/trust-verification.md` (152 lines): documents sole-trader legal identity `Benjamin Cook t/a SWEEPR Cleaner`, SSL.com Individual Validation (IV) thumbprint `1800DBEA6FE847D384E549D02CA372C3D45D8B81`, Azure Artifact Signing (`sweepr-signing` / `sweepr-prod-profile`), PowerShell/`certutil`/`shasum`/`codesign`/`spctl` commands, `DEFAULT_PUBKEY_B64` (`t04hn-7TfW5RIemEhi4mKbZy6rHRYBO6HxeN5OOIR_8`), and explicit disclosure that on-disk `v0.1.0` `Sweepr_Setup.msi` is `NotSigned` (signed in CI).
  - `scripts/sign-windows.ps1` (197 lines): verified `-VerifyOnly` exit `0` against `server/public/SWEEPRCleaner.exe` (`7,085,912` B, SHA-256 `FEAE464CA121CF897D27916C632F4DB8F84A87D4B79642403AD1B0E0F2BB706A`, `Valid`).
  - `server/public/{vs,alternatives}/*.html` (`20/20` pages), `about.html`, `llms.txt`: include `<a href="/about">`, `Benjamin Cook t/a SWEEPR Cleaner`, `Individual Validation (IV)`, `1800DBEA6FE847D384E549D02CA372C3D45D8B81`, and exact `12`-URL `ORGANIZATION_SAME_AS` JSON-LD.
- **Remaining External/Deferred Actions:** VirusTotal permalink capture, WDSI SmartScreen submission, OV/EV cert upgrade, Trustpilot/G2/Softpedia/AlternativeTo profiles, `docs/distribution/tier1-download-portals.md:12-26` refresh, and `server/public/about.html:266` address completion ([Checklist C](#checklist-c-5-6--trust-code-signing-local-doc-hygiene--distribution-portals)).

### `#6` — Closed-Source Proprietary Binary + Anonymized Telemetry vs 100% Open-Source Zero-Telemetry FOSS Rivals
- **Metadata:** Score `78/100` (Impact `30/40`, Breadth `26/35`, Severity `22/25`) · **Grade A · Major** · Category: `Privacy & Trust` · Lane: `product` (Effort `4`) · **Affected Pages:** `7/20` (`/vs/bleachbit`, `/alternatives/bleachbit`, `/vs/pearcleaner`, `/alternatives/pearcleaner`, `/alternatives/cleanmymac`, `/alternatives/avast-cleanup`, `/vs/cleanmypc` vs BleachBit, Pearcleaner, Bulk Crap Uninstaller, GrandPerspective).
- **Resolution Status:** **Partially Implemented Locally** (desktop privacy mode & open rule catalog implemented locally; external GitHub repo push deferred per R4).
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/commands.rs:215, 2191-2225, 2379, 2431, 2538, 2565, 2622`, `lib.rs:218-273`, `licensing.rs:757-771`: `UiPreferences.telemetry_enabled` defaults to `false`, blocking startup `/v1/accounts` & `/v1/entitlement` calls (when unactivated), `app_installed`, `send_telemetry_event`, crash report uploads, and passive `/api/pricing` & `/api/experiments/assign` calls across `Account.svelte:616-640`, `App.svelte`, `ActivateModal.svelte`, `CloudProtection.svelte`, `Performance.svelte`.
  - `docs/public-rules-catalog.json` (SHA-256 `D64BE71CB83693E251CB6B664D6A302EC838C2803D704A22308BB45E77A5F835`): `schema_version: 1`, `telemetry_default_enabled: false`, **`71`** rules (`27` Windows, `24` macOS, `20` Linux), **`455`** patterns (`225` Windows, `114` macOS, `116` Linux), and **`9`** `network_calls` entries (`rules.rs:420-493`); enforced byte-for-byte by `rules::tests::public_rules_catalog_json_matches_rules_rs` (`rules.rs:1224-1242`).
  - Website (`20/20` comparison pages + `llms.txt` + `i18n-dict.js`): highlights `Zero-Telemetry / Offline Mode` (`telemetry_enabled = false`) and transparent rule/network documentation.
- **Remaining External/Deferred Actions:** Publish `docs/public-rules-catalog.json` mirror and verification README to a dedicated public GitHub repository ([Checklist C](#checklist-c-5-6--trust-code-signing-local-doc-hygiene--distribution-portals)).

### `#7` — 4 Un-Migrated Legacy Pages With Self-Awarded "4.9 / 5.0" Badges, Wrong Legal Entity, Broken "5 Best" Lists & Missing Disclosures
- **Metadata:** Score `76/100` (Impact `33/40`, Breadth `25/35`, Severity `18/25`) · **Grade A · Major** · Category: `Page Credibility (Quick Fix)` · Lane: `quick` (Effort `1`) · **Affected Pages:** `4/20` (`/vs/onyx`, `/alternatives/pearcleaner`, `/alternatives/onyx`, `/alternatives/daisydisk`).
- **Resolution Status:** **Implemented Locally**.
- **Verified Workspace Evidence:**
  - All 4 files (`server/public/vs/onyx.html`, `server/public/alternatives/{pearcleaner,onyx,daisydisk}.html`) migrated to `/sweepr-editorial.css`, `Benjamin Cook t/a SWEEPR Cleaner` (`0` `SWEEPR Cleaner Inc.`), `0` self-awarded `4.9 / 5.0` badges, complete `"When to choose SWEEPR Cleaner"` + `"When to keep <Competitor>"` honesty blocks, Contract 1 & 2 disclosures, `#4` `Safari web companion / TestFlight beta` qualification, macOS `/clean/mac/system-data-huge` CTAs, and `CleanMyMac` naming.
  - All 3 migrated `/alternatives/` pages render `5` `<article>` ranked cards matching `5`-item `ItemList` JSON-LD (restoring `#5 BleachBit` on `alternatives/onyx.html` and `#5 Wise Disk Cleaner` on `alternatives/daisydisk.html`, and aligning `alternatives/pearcleaner.html` schema with DOM).
  - Un-retired routes in `server/src/app.ts:965-966` (`RETIRED_VS_REDIRECTS = {}`, `RETIRED_ALTERNATIVES_REDIRECTS = {}`), `server/public/sitemap.xml` (`101` `<loc>` entries, `0` overlap with `1,411`-URL `sitemap-cleanup.xml`), `server/src/pseo.ts:1423-1443`, and `server/test/editorial-redesign-audit.test.ts` + 6 test suites.

### `#8` — No Interactive Visual Disk-Space Map (Sunburst / MFT Treemap / File Explorer Right-Click Integration)
- **Metadata:** Score `73/100` (Impact `29/40`, Breadth `25/35`, Severity `19/25`) · **Grade A · Major** · Category: `Product & Safety` · Lane: `product` (Effort `5`) · **Affected Pages:** `7/20` (`/vs/daisydisk`, `/alternatives/daisydisk`, `/alternatives/cleanmymac`, `/alternatives/ccleaner`, `/alternatives/bleachbit`, `/alternatives/cleanmypc`, `/alternatives/wise-disk-cleaner` vs DaisyDisk, WizTree, TreeSize Free, GrandPerspective, CleanMyMac).
- **Resolution Status:** **Partially Implemented Locally** (Windows/Svelte/Rust Treemap + Sunburst + HKCU Explorer integration + `#[cfg(target_os = "macos")]` APFS helper implemented; macOS runtime execution in Checklist D).
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/duplicates.rs:60-80, 216-344`: `DiskTreeNode`, `build_disk_tree` (`TREE_MAX_DEPTH=4`, `TREE_MAX_CHILDREN=14`), plus `#[cfg(target_os = "macos")]` `parse_diskutil_apfs_purgeable`, `parse_tmutil_local_snapshots`, `macos_apfs_space_info`.
  - `app/src/lib/disk-viz.ts`, `app/src/components/DiskSpaceMap.svelte`, `Duplicates.svelte:22, 81-146, 701, 811-834`, `App.svelte:189`: zero-dependency interactive Treemap & Sunburst chart with Folders vs File Extensions view, breadcrumbs, `Up`, `Scan This Folder`, and keyboard navigation.
  - `app/src-tauri/src/cli.rs:108-129` (`--scan-dir`), `commands.rs:29, 3708-3800` (`take_initial_scan_dir`, `get_explorer_context_menu_enabled`, `set_explorer_context_menu_enabled` on `HKCU\Software\Classes\Directory\shell\SWEEPRScan`).
- **Remaining External/Deferred Actions:** Verify `diskutil`/`tmutil` output parsing on live Apple hardware / `macos-latest` CI ([Checklist D](#checklist-d-8-10-12-18--cross-os-macos--linux-ciruntime-verification)).

### `#9` — No Ecosystem Bundle or First-Party Store Distribution (Setapp, Avast One, Windows Pre-Install, Mac App Store)
- **Metadata:** Score `69/100` (Impact `27/40`, Breadth `24/35`, Severity `18/25`) · **Grade B · Significant** · Category: `Platform & Distribution` · Lane: `product` (Effort `4`) · **Affected Pages:** `8/20` (`/vs/cleanmymac`, `/vs/avast-cleanup`, `/alternatives/avast-cleanup`, `/alternatives/ccleaner`, `/alternatives/bleachbit`, `/alternatives/cleanmypc`, `/alternatives/wise-disk-cleaner`, `/alternatives/glary-utilities`).
- **Resolution Status:** **Partially Implemented Locally + External Submission Checklist**.
- **Verified Workspace Evidence:**
  - `scoop/bucket/sweepr-cleaner.json` (`53` lines, `!scoop/bucket/*.json` in `.gitignore:32`), `homebrew/Casks/sweepr-cleaner.rb` (`28` lines), `winget-manifests/manifests/s/Sweepr/SweeprCleaner/0.1.0/` (`winget validate` exit `0`), `chocolatey/*` (`0` PowerShell AST errors), `server/public/pad.xml` (`85` lines), `server/public/release-manifest.json` (`17` lines), `server/scripts/update-release-listings.mjs` (`349` lines), `.github/workflows/release-syndication.yml` (`161` lines).
  - Website comparison pages, download pages, and `llms.txt` surface 1-line `winget` / `choco` / `scoop` / `brew` commands.
- **Remaining External/Deferred Actions:** Submit PRs/pushes to `winget-pkgs`, Chocolatey Community Feed, Scoop bucket, Homebrew tap, plus Setapp, Microsoft Store, and Mac App Store applications ([Checklist E](#checklist-e-9--package-managers--ecosystem-store-submissions)).

### `#10` — No Real-Time Malware / Antivirus / Security Protection
- **Metadata:** Score `66/100` (Impact `26/40`, Breadth `22/35`, Severity `18/25`) · **Grade B · Significant** · Category: `Product & Safety` · Lane: `product` (Effort `3`) · **Affected Pages:** `4/20` (`/vs/cleanmymac`, `/alternatives/cleanmymac`, `/vs/avast-cleanup`, `/alternatives/avast-cleanup` vs CleanMyMac Moonlock, Microsoft PC Manager Defender checks, Avast One).
- **Resolution Status:** **Implemented Locally** (read-only cross-platform OS Security Health Check; macOS/Linux live execution in Checklist D).
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/security_health.rs` (`1,331` lines): `os_security_health` (`local_only: true`, zero network calls), `parse_windows_security_json` (Defender `Get-MpComputerStatus`, `SecurityCenter2`, `Get-NetFirewallProfile` handling PowerShell `GpoBoolean` `0`/`1`), `inspect_windows_run_entry` (`Run`/`RunOnce` LOLBin/script checks), `#[cfg(target_os = "macos")]` Gatekeeper/XProtect/`socketfilterfw`/`LaunchAgents`, and Linux `ufw`/`firewalld`/autostart checks; registered at `lib.rs:408` and rendered in `Privacy.svelte:2, 8, 64-79, 284-287`.
  - Comparison pages updated to explain SWEEPR's non-bloated OS Security Health Check alongside Windows Defender / macOS XProtect.
- **Remaining External/Deferred Actions:** Live macOS (`spctl`/`socketfilterfw`) & Linux (`ufw`/`firewalld`) execution in CI/hardware ([Checklist D](#checklist-d-8-10-12-18--cross-os-macos--linux-ciruntime-verification)).

### `#11` — Windows-Only Audit CTA Block & Raw HTML Tags (`<em>`, `&amp;`) Leaked in JSON-LD on Mac Comparison Pages
- **Metadata:** Score `63/100` (Impact `28/40`, Breadth `20/35`, Severity `15/25`) · **Grade B · Significant** · Category: `Page Credibility (Quick Fix)` · Lane: `quick` (Effort `1`) · **Affected Pages:** `4/20` (`/vs/cleanmymac`, `/vs/pearcleaner`, `/vs/daisydisk`, `/alternatives/cleanmymac`).
- **Resolution Status:** **Implemented Locally**.
- **Verified Workspace Evidence:**
  - All 4 Mac pages render macOS `#switcher-interactive-audit-cta` (`"Audit Your Mac System Data & ~/Library/Caches Safely First"` linking to `/clean/mac/system-data-huge`, `/safe-to-delete`, `/tools/pc-cache-calculator`; `0` instances of `"Audit Your Suspicious Windows Folders"`).
  - All 4 JSON-LD `headline` fields stripped of raw HTML/`&amp;` leaks (`"SWEEPR Cleaner vs CleanMyMac"`, `"SWEEPR vs Pearcleaner"`, `"SWEEPR vs DaisyDisk: From Sunburst Map to Safe Cleanup"`, `"5 Best CleanMyMac Alternatives for Mac (Free & Paid, 2026)"`).
  - `0` instances of `CleanMyMac X` across all 20 comparison pages; `server/src/seo/llms-index.ts:365-405` (`normalizeCompetitorHtmlClaims`) branches on `isMacCompetitor` for Mac-specific fallback CTAs.

### `#12` — No Linux Support (Native DEB / RPM / AppImage / SteamOS)
- **Metadata:** Score `61/100` (Impact `22/40`, Breadth `19/35`, Severity `20/25`) · **Grade B · Significant** · Category: `Platform & Distribution` · Lane: `product` (Effort `4`) · **Affected Pages:** `2/20` (`/vs/bleachbit`, `/alternatives/bleachbit` vs BleachBit).
- **Resolution Status:** **Partially Implemented Locally + Cross-OS Linux Checklist**.
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/rules.rs:303-327, 1245-1320`: `linux_specs()` (`20` rules, `116` patterns covering Mesa/RADV/AMDVLK `shader_cache`, SteamOS/Proton `game_launchers`, `flatpak_snap_caches`, `docker_caches`, `dev_caches`) verified by `linux_rules_parity_and_safety`.
  - `app/src-tauri/src/uninstaller.rs:10-12, 373-976, 1316-1495, 2487-2970`: `#[cfg(all(unix, not(target_os = "macos")))]` `.desktop` (`DESKSYS:`/`DESKLOC:`/`DESKUSR:`), Flatpak (`FLATPAK:`), Snap (`SNAP:`), home AppImage trash, and `dpkg`/`rpm`/`pacman` + `pkexec` removal.
  - `.github/workflows/build-apps.yml:193-233`: `Export Linux Package Metadata (DEB, RPM, AppImage)` -> `linux-metadata.json`; synced in `server/scripts/update-release-listings.mjs:163, 172, 340` and `/vs/bleachbit` + `/alternatives/bleachbit` copy.
- **Remaining External/Deferred Actions:** Compile, run `cargo test`, and smoke-test `.deb`/`.rpm`/`.AppImage` bundles on `ubuntu-22.04` CI & SteamOS ([Checklist D](#checklist-d-8-10-12-18--cross-os-macos--linux-ciruntime-verification)).

### `#13` — No Headless CLI Scripting (`--clean`) or Community Rule Extensibility (`winapp2.ini`)
- **Metadata:** Score `58/100` (Impact `21/40`, Breadth `19/35`, Severity `18/25`) · **Grade B · Significant** · Category: `Product & Safety` · Lane: `product` (Effort `3`) · **Affected Pages:** `3/20` (`/vs/bleachbit`, `/alternatives/bleachbit`, `/alternatives/wise-disk-cleaner` vs BleachBit, CCleaner).
- **Resolution Status:** **Implemented Locally**.
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/cli.rs` (`885` lines): `parse_cli_args` (`:168-295`), `execute_scan_clean_in` (`:347-538`, exit code `2` on unlicensed Pro `--clean`), `run_if_requested` (`:540-669`), Windows `AttachConsole(ATTACH_PARENT_PROCESS)` (`:69-90`) supporting `--scan`, `--clean`, `--dry-run`, `--json`, `--category <id>`, `--trash`, `--data-dir <path>`.
  - `app/src-tauri/src/rules.rs:577-1125`, `commands.rs:620-649`, `Cleaner.svelte:101-219, 2438-2582`: `custom_rules.json` import/validation (`validate_custom_rule_path`, `import_custom_rules_in`, `all_with_custom` enforcing `free: false`, `safety::is_safe_root`, symlink/reparse & personal-folder rejection).
  - Documented on `/vs/bleachbit`, `/alternatives/bleachbit`, and `/alternatives/wise-disk-cleaner`.

### `#14` — No Deep Forensic Free-Space or Low-Level Metadata Wiping (ThumbCache, RecentDocs, HDD-Only Free-Space Zeroing)
- **Metadata:** Score `56/100` (Impact `20/40`, Breadth `18/35`, Severity `18/25`) · **Grade B · Significant** · Category: `Privacy & Trust` · Lane: `product` (Effort `3`) · **Affected Pages:** `4/20` (`/vs/bleachbit`, `/alternatives/bleachbit`, `/alternatives/wise-disk-cleaner`, `/alternatives/glary-utilities` vs BleachBit, PrivaZer, Ashampoo WinOptimizer).
- **Resolution Status:** **Partially Implemented Locally** (rules, shredder guard, NSIS fix, and web docs complete; physical rotational HDD runtime test in Checklist F).
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/rules.rs:219-238, 244, 268`: `FileGlobTarget` rules `thumbnails` (`thumbcache_*.db`) and `recent_activity` (`Recent/*.lnk`, `min_age_hours: 24`).
  - `app/src-tauri/src/shredder.rs:118-264, 394-660`, `lib.rs:426-430`, `Shredder.svelte:129-195, 434`: `list_wipeable_drives`, Pro-gated `wipe_free_space`, `cancel_wipe_free_space`, strict `sysinfo::DiskKind::HDD && !is_removable && matched_mount` gate blocking SSD/NVMe wear-leveling damage, 1 MiB zero streaming + 32 MiB OS headroom + RAII `TempWipeFileGuard::drop`.
  - `app/src-tauri/installer.nsi:170`: DoD wording replaced with `"SSD-aware 1-pass / HDD 3-pass file shredding and optional HDD free-space zeroing"`.
  - SSD wear-leveling rationale & trace cleanup reflected across `/vs/bleachbit`, `/alternatives/bleachbit`, `/alternatives/wise-disk-cleaner`, `/alternatives/glary-utilities`, and `i18n-dict.js`.
- **Remaining External/Deferred Actions:** Verify `wipe_free_space` on physical rotational `DiskKind::HDD` hardware ([Checklist F](#checklist-f-14-17-21-23--windows-packaging-arm64--physical-hardware-verification)).

### `#15` — No Portable Zero-Install ZIP / USB Executable & No Native Windows ARM64 Build
- **Metadata:** Score `53/100` (Impact `19/40`, Breadth `19/35`, Severity `15/25`) · **Grade C · Moderate** · Category: `Platform & Distribution` · Lane: `product` (Effort `2`) · **Affected Pages:** `5/20` (`/vs/wise-disk-cleaner`, `/alternatives/wise-disk-cleaner`, `/alternatives/ccleaner`, `/alternatives/bleachbit`, `/alternatives/glary-utilities` vs Wise Disk Cleaner, BleachBit, WizTree, PrivaZer, Geek Uninstaller).
- **Resolution Status:** **Partially Implemented Locally + CI/Toolchain Checklists**.
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/lib.rs:28-83, 192-206, 469-521`, `scheduler.rs`, `duplicates.rs`: `resolve_data_dirs_with` detects `portable.flag` beside `current_exe()` or `--portable` flag and stores config, quarantine, custom rules, and logs in `portable_data`.
  - `.github/workflows/build-apps.yml:37-41, 266-356`: adds `aarch64-pc-windows-msvc` ARM64 build matrix and `Package Portable Windows ZIP & Upload Signed Assets` (`SWEEPRCleaner-portable-$ARCH_LABEL.zip` containing `portable.flag`, with `$ExeBin` `SWEEPRCleaner.exe` -> `sweepr.exe` fallback matching `Cargo.toml:2`).
- **Remaining External/Deferred Actions:** Cross-compile/test `aarch64-pc-windows-msvc` on ARM64 Windows 11 hardware, build/upload release portable ZIPs with SHA-256 checksums ([Checklist F](#checklist-f-14-17-21-23--windows-packaging-arm64--physical-hardware-verification), [Checklist G](#checklist-g-15--portable-distribution-packaging)).

### `#16` — Shallower App Uninstaller Depth vs Dedicated Uninstallers (No Batch, UWP/OEM Removal, or Force Removal)
- **Metadata:** Score `50/100` (Impact `18/40`, Breadth `18/35`, Severity `14/25`) · **Grade C · Moderate** · Category: `Product & Safety` · Lane: `product` (Effort `3`) · **Affected Pages:** `7/20` (`/vs/pearcleaner`, `/alternatives/pearcleaner`, `/alternatives/ccleaner`, `/alternatives/bleachbit`, `/alternatives/cleanmypc`, `/alternatives/avast-cleanup`, `/alternatives/glary-utilities` vs Revo Uninstaller Free, Bulk Crap Uninstaller, Geek Uninstaller, Pearcleaner, AppCleaner).
- **Resolution Status:** **Implemented Locally**.
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/uninstaller.rs:8-20, 47-211, 1504, 1689, 2350, 2387`: `AppInfo.kind` + `can_force_remove`, UWP/Appx `parse_uwp_app_id`/`is_safe_removable_appx`/`query_appx_packages`, sequential `uninstall_apps_batch` (cap `50`, `"uninstaller://batch-progress"` events), `is_protected_force_remove_path`, `preview_force_remove_app`, and `force_remove_app` (verified `34/34` in M1.3).
  - `app/src/components/Apps.svelte:18, 52-63, 116-139, 220-317, 659, 705, 772` & `lib.rs:414-418`: multi-select batch toolbar, UWP filter/removal, Force Remove Leftovers modal; reflected across the 7 comparison pages.

### `#17` — Neutralized "Smallest Binary" Claim Against Lean Native Rivals
- **Metadata:** Score `47/100` (Impact `18/40`, Breadth `16/35`, Severity `13/25`) · **Grade C · Moderate** · Category: `Positioning & Technical (Quick Copy Fix)` · Lane: `quick` (Effort `1`) · **Affected Pages:** `5/20` (`/vs/pearcleaner`, `/alternatives/cleanmymac`, `/vs/wise-disk-cleaner`, `/alternatives/wise-disk-cleaner`, `/alternatives/glary-utilities` vs Pearcleaner, Geek Uninstaller, Wise Disk Cleaner).
- **Resolution Status:** **Implemented Locally** (repositioned copy + binary size alignment; local NSIS/WiX rebuild deferred to Checklist F due to absent `makensis`/WiX).
- **Verified Workspace Evidence:**
  - Copy across all 5 affected pages (and sitewide) shifts primary differentiation from binary megabytes to GB reclaimed across 71 rules (455 patterns) + safety guardrails, while accurately stating `6.76 MB` (`7,085,912` bytes) matching `SWEEPRCleaner.exe` on disk (`server/public/pad.xml`, `release-manifest.json`, `update-release-listings.mjs`, `winget-manifests/...`, `chocolatey/...`, `analytics.js:704`, `pseo.ts:289-357`, `giveaway.ts:844`).

### `#18` — No Deep macOS System Maintenance (Spotlight / LaunchServices Index Rebuild & Hidden OS Tweaks)
- **Metadata:** Score `44/100` (Impact `16/40`, Breadth `14/35`, Severity `14/25`) · **Grade C · Moderate** · Category: `Product & Safety` · Lane: `product` (Effort `3`) · **Affected Pages:** `5/20` (`/vs/onyx`, `/alternatives/onyx`, `/alternatives/cleanmymac`, `/alternatives/pearcleaner`, `/alternatives/daisydisk` vs OnyX).
- **Resolution Status:** **Partially Implemented Locally + macOS CI/Runtime Checklist**.
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/system_tools.rs:21-215`, `lib.rs:409`, `Performance.svelte:64-65, 242-260, 761-793`: Pro-gated `run_macos_maintenance` (`MacosMaintenanceTask` / `build_macos_maintenance_spec`) supporting Spotlight (`mdutil -E /`), LaunchServices (`lsregister`), and DNS cache flush (`dscacheutil -flushcache` + `killall -HUP mDNSResponder`), gated under `#[cfg(target_os = "macos")]`.
  - `.github/workflows/build-apps.yml:89-163` adds Apple Developer ID `codesign`, `hdiutil`, `xcrun notarytool submit`, and `xcrun stapler`; `.github/workflows/ci.yml:76` adds `npx tsc --noEmit`.
  - Migrated `/vs/onyx` and `/alternatives/onyx` pages updated with accurate Spotlight/LaunchServices/DNS maintenance capabilities.
- **Remaining External/Deferred Actions:** Runtime execution & notarized DMG verification on `macos-latest` / Apple hardware ([Checklist D](#checklist-d-8-10-12-18--cross-os-macos--linux-ciruntime-verification)).

### `#19` — No Background App Suspender ("Sleep Mode") or 1-Click RAM Boost / Process Manager
- **Metadata:** Score `41/100` (Impact `16/40`, Breadth `13/35`, Severity `12/25`) · **Grade C · Moderate** · Category: `Product & Safety` · Lane: `product` (Effort `3`) · **Affected Pages:** `4/20` (`/vs/avast-cleanup`, `/alternatives/avast-cleanup`, `/alternatives/cleanmypc`, `/alternatives/glary-utilities` vs Avast Cleanup, Microsoft PC Manager).
- **Resolution Status:** **Implemented Locally**.
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/memory.rs:103-113, 384-437, 469-577`, `app/src/lib/api.ts:117-126`, `Performance.svelte`: enriches `StartupItem` with live two-sample `sysinfo` `rss_bytes`, `cpu_percent`, and `running_processes` count, plus honest Windows 11 memory compression/Standby List explanation vs placebo RAM boosters.
  - Synchronized across `/vs/avast-cleanup`, `/alternatives/avast-cleanup`, `/alternatives/cleanmypc`, and `/alternatives/glary-utilities`.

### `#20` — No Enterprise / Fleet Management (MDM Deployment & Multi-Seat Admin Console)
- **Metadata:** Score `37/100` (Impact `12/40`, Breadth `10/35`, Severity `15/25`) · **Grade D · Minor / Niche** · Category: `Platform & Distribution` · Lane: `product` (Effort `4`) · **Affected Pages:** `1/20` (`/vs/ccleaner` vs CCleaner Business Edition).
- **Resolution Status:** **Partially Implemented Locally** (Phase-1 CLI/policy bridge + MDM doc complete; Phase-2 ADMX/console deferred to Checklist H).
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/cli.rs:23, 210-218, 278-280, 593-621`: `--activate-token <TOKEN>` CLI flag.
  - `app/src-tauri/src/licensing.rs:500-547, 604-619, 1429-1470`: `read_enterprise_policy_token` reading `HKLM\Software\Policies\SWEEPRCleaner` (`LicenseToken`/`ActivationToken`), offline `EnterpriseJws` & `PairingToken` (`ptk_...`), and `policy_token.sha256` deduplication.
  - `docs/mdm-deployment.md` (`134` lines): documents silent MSI `/qn /norestart`, `--activate-token`, Intune/GPO steps, 72-hour offline grace, 5-device pool, and exact endpoints (`/api/device-link/redeem`, `/v1/accounts`, `/v1/entitlement`, `/v1/updates/latest.json`, `/release-manifest.json`); surfaced on `/vs/ccleaner`.
- **Remaining External/Deferred Actions:** ADMX/ADML templates, Jamf `.mobileconfig`, and B2B multi-seat admin console ([Checklist H](#checklist-h-20--enterprise-phase-2-mdm-templates--multi-seat-admin-console)).

### `#21` — No HDD Defragmentation, Manual SSD TRIM, or Windows System Slimmer
- **Metadata:** Score `34/100` (Impact `12/40`, Breadth `11/35`, Severity `11/25`) · **Grade D · Minor / Niche** · Category: `Product & Safety` · Lane: `product` (Effort `2`) · **Affected Pages:** `3/20` (`/vs/wise-disk-cleaner`, `/alternatives/wise-disk-cleaner`, `/alternatives/glary-utilities` vs Wise Disk Cleaner).
- **Resolution Status:** **Partially Implemented Locally** (Rust/UI/web complete; elevated host UAC verification in Checklist F).
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/system_tools.rs:363-536`, `lib.rs:410-411`, `Performance.svelte:196-213, 693`: `list_optimizable_drives` and Pro-gated `optimize_drive` (`Optimize-Volume -DriveLetter X -ReTrim` for SSDs / `defrag X: /O` for HDDs) plus clear Windows 11 automatic weekly TRIM disclosure in UI and the 3 comparison pages.
- **Remaining External/Deferred Actions:** Elevated UAC host verification across SSD & HDD drives ([Checklist F](#checklist-f-14-17-21-23--windows-packaging-arm64--physical-hardware-verification)).

### `#22` — No Registry Cleaner (Intentional Safety Exclusion — Still a Perceived Feature Gap for Legacy Switchers)
- **Metadata:** Score `30/100` (Impact `12/40`, Breadth `11/35`, Severity `7/25`) · **Grade D · Minor / Niche** · Category: `Positioning & Perceived Gap (Quick Copy Fix)` · Lane: `quick` (Effort `1`) · **Affected Pages:** `5/20` (`/vs/ccleaner`, `/alternatives/ccleaner`, `/vs/glary-utilities`, `/alternatives/glary-utilities`, `/vs/cleanmypc` vs CCleaner, Glary Utilities, CleanMyPC, Wise Registry Cleaner).
- **Resolution Status:** **Implemented Locally** (audit discrepancy reconciled truthfully).
- **Verified Workspace Evidence:**
  - Audited `app/src-tauri/src/registry_cleaner.rs:10, 56, 84-173, 229-340`: SWEEPR intentionally avoids aggressive whole-registry wiping, while offering scoped HKCU-only broken `App Paths`/`Run` entry repair with collision-free `BACKUP_SEQ`, `try_create_restore_point`, automatic backup in `registry_backups.json`, and 1-click `restore_registry_backup` (`"Backed Up (1-Click Restore)"` in `Apps.svelte` & `PreCleanConfirmDrawer.svelte:69-80`).
  - Website comparison tables (`/vs/ccleaner`, `/alternatives/ccleaner`, `/vs/glary-utilities`, `/alternatives/glary-utilities`, `/vs/cleanmypc`) align copy honestly (`Excluded by design` for aggressive registry wiping, noting Microsoft guidance and scoped HKCU broken-path/Run backup).

### `#23` — No One-Click Windows Hibernation Toggle (`hiberfil.sys`)
- **Metadata:** Score `26/100` (Impact `10/40`, Breadth `9/35`, Severity `7/25`) · **Grade D · Minor / Niche** · Category: `Product & Safety` · Lane: `product` (Effort `2`) · **Affected Pages:** `2/20` (`/vs/cleanmypc`, `/vs/wise-disk-cleaner` vs CleanMyPC).
- **Resolution Status:** **Partially Implemented Locally** (Rust/UI/web complete; elevated host UAC verification in Checklist F).
- **Verified Workspace Evidence:**
  - `app/src-tauri/src/system_tools.rs:542-707`, `lib.rs:412-413`, `Performance.svelte:215-240, 731`: `hibernation_status` (`hiberfil.sys` size + `powercfg /a`) and Pro-gated `set_hibernation_enabled` (`run_windows_admin_command` UAC elevation retry + Fast Startup trade-off notice); documented on `/vs/cleanmypc` and `/vs/wise-disk-cleaner`.
- **Remaining External/Deferred Actions:** Elevated UAC host toggle check (`powercfg /hibernate off` -> `on`) ([Checklist F](#checklist-f-14-17-21-23--windows-packaging-arm64--physical-hardware-verification)).

### `#24` — No Windows Power-User Micro-Utility Suite
- **Metadata:** Score `22/100` (Impact `8/40`, Breadth `8/35`, Severity `6/25`) · **Grade D · Minor / Niche** · Category: `Product & Safety` · Lane: `quick` (Effort `1`) · **Affected Pages:** `2/20` (`/vs/glary-utilities`, `/alternatives/glary-utilities` vs Glary Utilities, Ashampoo WinOptimizer).
- **Resolution Status:** **Implemented Locally** (audit discrepancy reconciled truthfully).
- **Verified Workspace Evidence:**
  - Desktop app already provides a focused power-user subset without bloat: Context Menu Manager (`app/src-tauri/src/memory.rs:1527-1625` with `LegacyDisable` handling) and separated Broken Shortcut Fixer vs Empty Folder Finder (`app/src-tauri/src/uninstaller.rs:3311-3510`, `Apps.svelte:141-150`, `Performance.svelte:171-194`).
  - `/vs/glary-utilities` and `/alternatives/glary-utilities` accurately reflect these storage-focused utilities while maintaining focused high-GB specialist positioning.

---

## 4. Ready-to-Execute External, Cross-OS & Deferred Checklists

### Checklist A (`#3`) — Future Pricing, SKU & Guarantee Evaluation
*(**Status: Deferred per R2/R3 — `server/src/pricing.ts` is strictly unmodified.** Cross-reference `SWEEPR_VS_TOTAL_CLEANER_PRICING_REVIEW.md` for full financial modeling.)*

- [ ] **A1. Evaluate Solo 1-Device Annual SKU (`£24.99–£29.99/yr` / `$32.99–$39.99/yr`):** Compare conversion uplift against CCleaner Pro (`$44.95/yr` / `~£29.95/yr`) and CleanMyMac (`$39.95/yr`) vs ARPU cannibalization on the 5-device `£49.99/yr` tier (`£0.83/device/mo`).
- [ ] **A2. Evaluate Optional One-Time / Lifetime License (`£69–£99` 1-device or household):** Model support/update horizon and cannibalization for subscription-averse switchers from DaisyDisk (`$9.99` one-time), Ashampoo, and Glary (`$99.95` lifetime).
- [ ] **A3. Evaluate 30-Day Money-Back Guarantee Parity on Annual Plans:** Total Cleaner grants `30` days on Annual/Biannual plans (`14` days on Monthly/Quarterly/add-ons); SWEEPR currently grants `14` days across all plans (`refund.html`). Test `30`-day Annual guarantee messaging without altering `pricing.ts` SKUs.
- [ ] **A4. Non-SKU Copy Optimizations (Safe Without Changing `pricing.ts`):** Emphasize 2-year/3-year cumulative TCO, `"Flat Renewal — Zero 5× Price Spike"`, and `£0.83/device/mo` (`$1.08/device/mo`) across `/pricing` and `/vs/` tables.

---

### Checklist B (`#4`) — Native iOS App Store & TestFlight Roadmap
*(**Status: Deferred per R2 — `mobile/ios/` is untouched.** Current verified baseline: `mobile/ios/project.yml` XcodeGen spec `com.sweepr.app`, `MARKETING_VERSION: "1.0.4"`, `CURRENT_PROJECT_VERSION: "5"`, iOS `16.0+`, RevenueCat `purchases-ios` `5.0.0+`, `12` Swift files across `Sources/App/` & `Sources/Services/`, `AppIcon.appiconset`, and unsigned simulator CI build in `.github/workflows/ci.yml:110-130`.)*

- [ ] **B1. Apple Privacy Manifest (`mobile/ios/Sources/PrivacyInfo.xcprivacy`):** Create & reference in `project.yml` declaring Required Reason APIs used by `SweeprApp.swift` / `AccountService.swift` / `PhotoScanner.swift`:
  - `NSPrivacyAccessedAPICategoryUserDefaults` (`CA92.1` — `@AppStorage` preferences)
  - `NSPrivacyAccessedAPICategoryDiskSpace` (`E174.1` / `85F4.1` — storage reclaim estimator)
  - `NSPrivacyAccessedAPICategoryFileTimestamp` (`C617.1` / `0A2A.1` — photo/vault file scanning)
  - `NSPrivacyTracking = false` & accurate `NSPrivacyCollectedDataTypes` aligned with `telemetry_enabled` / `AccountService`.
- [ ] **B2. Secrets, Entitlements & Signing Assets:**
  - Supply `Secrets.xcconfig` (ignored by git) with production `REVENUECAT_API_KEY = appl_...` (enforced by `SweeprApp.swift` Release guard).
  - Add `Sweepr.entitlements` (Keychain Access Groups if shared, Associated Domains if Universal Links enabled).
  - Provision Apple Distribution Certificate (`.p12`), App ID `com.sweepr.app`, and App Store provisioning profile in Apple Developer Portal & GitHub Secrets.
- [ ] **B3. Archive & TestFlight CI Workflow (`macos-latest`):**
  - Generate project (`xcodegen generate`), run `xcodebuild -project Sweepr.xcodeproj -scheme Sweepr -configuration Release -archivePath build/Sweepr.xcarchive archive`, export IPA via `ExportOptions.plist` (`method: app-store-connect`), and upload via `xcrun altool --upload-app`, Apple Transporter, or App Store Connect API key (`AuthKey_<KEY_ID>.p8`).
- [ ] **B4. App Store Connect & RevenueCat Store Wiring:**
  - Configure matching iOS IAP products (`Monthly`, `6 Months`, `Yearly`, plus `BatteryCare` / `CloudVault` add-ons) in App Store Connect and map them in RevenueCat under `appl_` public SDK key.
  - Capture `6.9"` / `6.7"` / `6.5"` iPhone screenshots, verify Guideline `3.1.2(c)` auto-renewal disclosures in `PaywallView.swift`, and attach demo credentials & privacy notes for App Review.
- [ ] **B5. Post-Approval Website Update:** Only after App Store approval is live, remove the `"Safari web companion / TestFlight beta"` caveat across the 20 comparison pages, `pricing.html`, `terms.html`, `refund.html`, and `llms-index.ts`, and link the live App Store URL.

---

### Checklist C (`#5`, `#6`) — Trust, Code Signing, Local Doc Hygiene & Distribution Portals

- [x] **C1. Local Doc & Legal Address Hygiene (Completed `2026-11-27`):**
  - Updated `docs/distribution/tier1-download-portals.md:12-26+`: `Benjamin Cook (SWEEPR Technologies)` -> `Benjamin Cook t/a SWEEPR Cleaner`; `6,840,632 bytes (6.52 MB)` -> `7,085,912 bytes (6.76 MB)`; SHA-256 `38E5CDF...` -> `FEAE464CA121CF897D27916C632F4DB8F84A87D4B79642403AD1B0E0F2BB706A`; and Contract 1 & 2 copy.
  - Completed `server/public/about.html:266`, `server/public/terms.html:167`, `server/public/order.html:968`, `index.html`, `pricing.html`, `privacy.html`, `refund.html`, `support.html`, and `i18n-dict.js`: replaced `[UK Correspondence Address — To Be Completed]` with `87 Upper Brighton Road, Worthing, West Sussex`.
- [ ] **C2. CI Azure Artifact Signing & OV/EV Upgrade:**
  - Verify `AZURE_SIGNING_ENABLED=true` secrets (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`, `sweepr-signing` / `sweepr-prod-profile`) in GitHub Actions so `.github/workflows/build-apps.yml` Authenticode-signs **both** `SWEEPRCleaner.exe` and `Sweepr_Setup.msi` (replacing the `NotSigned` v0.1.0 MSI on disk).
  - Schedule upgrade from SSL.com Individual Validation (`1800DBEA6FE847D384E549D02CA372C3D45D8B81`) to an OV/EV Organization Validation or Azure Trusted Signing profile to accelerate Microsoft SmartScreen reputation.
- [ ] **C3. Microsoft Defender / SmartScreen (WDSI) & VirusTotal:**
  - Submit signed `SWEEPRCleaner.exe`, `Sweepr_Setup.msi`, and portable `.zip` binaries to **Microsoft Security Intelligence (WDSI)** as software developer submissions (`Incorrectly detected` / `Clean file` pre-clearance).
  - Upload release binaries to **VirusTotal**, capture canonical permalinks for each SHA-256 (`FEAE464...` `.exe`, `33E5427...` `.msi`, `88F3DF5...` `.dmg`), and publish links on `/about` and `docs/trust-verification.md`.
- [ ] **C4. Public Rule-Audit GitHub Repository (`#6`):**
  - Create public GitHub repo (e.g., `sweepr-cleaner/public-rules-catalog`), push `docs/public-rules-catalog.json` (`71` rules, `455` patterns, `9` `network_calls`, SHA-256 `D64BE71CB83693E251CB6B664D6A302EC838C2803D704A22308BB45E77A5F835`) plus verification instructions (`sweepr.exe --export-rules-catalog` diff check), and link from `/vs/bleachbit`, `/alternatives/bleachbit`, and `/about`.
- [ ] **C5. Third-Party Review & Tier-1 Download Portals:**
  - Claim vendor profiles on **Trustpilot**, **G2**, **Capterra**, and **AlternativeTo**; enable organic post-clean / post-purchase review invitations (never gated or incentivized).
  - Submit `https://sweeprcleaner.com/pad.xml` (`7,085,912` B, `6.76` MB) and signed binaries to **Softpedia**, **MajorGeeks**, **FileHippo**, **FileHorse**, **SnapFiles**, **Uptodown**, and **SourceForge**.

---

### Checklist D (`#8`, `#10`, `#12`, `#18`) — Cross-OS (macOS & Linux) CI/Runtime Verification

#### macOS (`macos-latest` CI & Physical Apple Silicon / Intel Mac)
- [ ] **D1. Build & Notarization (`.github/workflows/build-apps.yml:89-163`):**
  - Install Rust targets `aarch64-apple-darwin` and `x86_64-apple-darwin`, configure Apple Developer ID secrets, verify `codesign --deep --options runtime`, `hdiutil`, `xcrun notarytool submit --wait`, and `xcrun stapler staple` on `SWEEPRCleaner.dmg`.
  - Verify `spctl -a -vvv -t install /Applications/SWEEPRCleaner.app` passes Gatekeeper with zero warnings.
- [ ] **D2. Runtime Verification (`#8`, `#10`, `#18`):**
  - Run `cargo test --lib` on macOS runner (`rules.rs` `macos_specs()` `24` rules / `114` patterns).
  - Test `macos_apfs_space_info` (`diskutil apfs list` & `tmutil listlocalsnapshots /`) in `Duplicates.svelte` (`#8`).
  - Test `os_security_health` Gatekeeper (`spctl --status`), XProtect, `socketfilterfw --getglobalstate`, and `~/Library/LaunchAgents` inspection (`#10`).
  - Test `run_macos_maintenance` (`mdutil -E /`, `lsregister -kill -r -domain local -domain system -domain user`, `dscacheutil -flushcache` + `killall -HUP mDNSResponder`) in `Performance.svelte` (`#18`).
- [ ] **D3. Future macOS UX Enhancement:** Scope optional Finder Sync extension / Quick Action (`"Scan with SWEEPR"`) for parity with Windows HKCU File Explorer integration (`#8`).

#### Linux (`ubuntu-22.04` CI & Desktop / SteamOS Hardware)
- [ ] **D4. Build & Package Export (`.github/workflows/build-apps.yml:193-233`):**
  - Run `cargo test --lib` on `ubuntu-22.04` (`linux_specs()` `20` rules / `116` patterns + `uninstaller.rs` `.desktop`/Flatpak/Snap tests).
  - Verify Tauri bundle generation for `.deb`, `.rpm`, and `.AppImage` plus `linux-metadata.json` SHA-256 export.
- [ ] **D5. Runtime Verification (`#10`, `#12`):**
  - Install `.deb` (Ubuntu/Debian), `.rpm` (Fedora), and `.AppImage` (SteamOS / Arch / Steam Deck Desktop Mode).
  - Verify Mesa/RADV/AMDVLK shader cache detection, Steam Proton safe subdir scanning, Flatpak/Snap app listing & `pkexec` removal, and `ufw`/`firewall-cmd` detection in `os_security_health`.

---

### Checklist E (`#9`) — Package Managers & Ecosystem Store Submissions

- [ ] **E1. Post-Build Metadata Sync:** Run `node server/scripts/update-release-listings.mjs` against release artifacts so `release-manifest.json`, `pad.xml`, Winget, Chocolatey, Scoop, Homebrew, `README.md`, and `support.html` stay hash-locked.
- [ ] **E2. Winget (`microsoft/winget-pkgs`):**
  - Re-run `winget validate --manifest winget-manifests\manifests\s\Sweepr\SweeprCleaner\<version>` and sandbox install (`winget install --manifest ...`).
  - Configure `WINGET_TOKEN` in `.github/workflows/release-syndication.yml` and submit PR to `microsoft/winget-pkgs`.
- [ ] **E3. Chocolatey Community Repository:**
  - Verify `chocolatey/tools/chocolateyInstall.ps1` & `VERIFICATION.txt`, run `choco pack` inside `chocolatey/`, test local `choco install sweepr-cleaner -s .`, and push via `CHOCOLATEY_API_KEY`.
- [ ] **E4. Scoop Bucket (`scoop/bucket/sweepr-cleaner.json`):**
  - Publish dedicated GitHub bucket repository (e.g., `sweepr-cleaner/scoop-bucket`) containing `bucket/sweepr-cleaner.json`, then test `scoop bucket add sweepr <repo-url>` and `scoop install sweepr/sweepr-cleaner` + `scoop uninstall sweepr-cleaner`.
- [ ] **E5. Homebrew Cask (`homebrew/Casks/sweepr-cleaner.rb`):**
  - On macOS (`ruby` available), run `ruby -c homebrew/Casks/sweepr-cleaner.rb` and `brew audit --cask --strict`.
  - Publish `homebrew-tap` repository (`brew tap sweepr-cleaner/tap && brew install --cask sweepr-cleaner`) using the notarized DMG SHA-256; later submit to `homebrew/homebrew-cask` once traction thresholds are met.
- [ ] **E6. First-Party Ecosystem Stores (Setapp, Microsoft Store, Mac App Store):**
  - **Microsoft Store Partner Center:** Package MSIX or Win32 installer submission (`SWEEPRCleaner.exe` / MSI silent `/qn`), pass WACK validation, and submit listing.
  - **Setapp:** Submit Mac app partner application highlighting `71`-rule engine, Disk Space Map (`#8`), and macOS maintenance (`#18`).
  - **Mac App Store:** Evaluate sandboxed companion build (since full system-wide `/Library/Caches` & `mdutil` require non-sandboxed DMG outside MAS; cross-link DMG edition on website).

---

### Checklist F (`#14`, `#17`, `#21`, `#23`) — Windows Packaging, ARM64 & Physical Hardware Verification

- [ ] **F1. Local Windows Installer Toolchain Rebuild (`makensis` & WiX):**
  - Install NSIS (`makensis`), WiX Toolset (`candle`/`light`/`wix`), and Windows SDK (`signtool.exe`) on release build host (or run via CI).
  - Rebuild `app/src-tauri/installer.nsi` (verifying line `170` SSD/HDD wording & dynamic `${VERSION}`) and `Sweepr_Setup.msi`, then sign both and regenerate `.sig` Ed25519 sidecars.
- [ ] **F2. Windows ARM64 Build & Hardware Test (`#15`):**
  - Install `rustup target add aarch64-pc-windows-msvc` (or trigger `.github/workflows/build-apps.yml` CI job) and verify `SWEEPRCleaner` + `sweepr.exe` fallback on a physical Windows 11 ARM64 device (Snapdragon X / Parallels ARM64).
- [ ] **F3. Physical Rotational HDD Free-Space Zeroing Test (`#14`):**
  - Attach a physical rotational drive (`sysinfo::DiskKind::HDD`, non-removable) on Windows, confirm `list_wipeable_drives` permits it while blocking NVMe/SATA SSDs (`DiskKind::SSD`) and USB flash drives, run `wipe_free_space`, and test mid-run `cancel_wipe_free_space` + `TempWipeFileGuard::drop` cleanup.
- [ ] **F4. Elevated UAC Windows System Tools Test (`#21`, `#23`):**
  - Run `optimize_drive` (`#21`) in an interactive UAC session against both an SSD (`Optimize-Volume -DriveLetter X -ReTrim`) and an HDD (`defrag X: /O`).
  - Run `set_hibernation_enabled` (`#23`) (`powercfg /hibernate off` -> verify `hiberfil.sys` reclaimed -> `powercfg /hibernate on` -> verify Fast Startup notice).

---

### Checklist G (`#15`) — Portable Distribution Packaging

- [ ] **G1. CI Portable ZIP Execution (`.github/workflows/build-apps.yml:266-356`):**
  - Verify `SWEEPRCleaner-portable-x64.zip` and `SWEEPRCleaner-portable-arm64.zip` include `SWEEPRCleaner.exe` (or `sweepr.exe`), zero-byte `portable.flag`, and required runtime DLLs.
- [ ] **G2. USB / Read-Only-Adjacent Runtime Smoke Test:**
  - Extract portable ZIP onto a secondary drive / USB stick, launch `SWEEPRCleaner.exe`, run a scan + free clean, and verify **all** state (`ui_preferences.json`, `quarantine/`, `custom_rules.json`, logs) is written strictly to `portable_data\` beside the executable with zero writes to `%APPDATA%` or `%LOCALAPPDATA%`.
- [ ] **G3. Checksum Publication:** Record ZIP SHA-256 hashes in `server/public/release-manifest.json`, `docs/trust-verification.md`, and `/download` checksum verification modal.

---

### Checklist H (`#20`) — Enterprise Phase 2 (MDM Templates & Multi-Seat Admin Console)

- [ ] **H1. Windows ADMX / ADML Group Policy Templates:**
  - Author `SWEEPRCleaner.admx` and `en-US\SWEEPRCleaner.adml` mapping `HKLM\SOFTWARE\Policies\SWEEPRCleaner` (`ActivationToken` / `LicenseToken`, plus optional `TelemetryEnabled = 0` policy lock) for Microsoft Intune Custom OMA-URI / ADMX ingestion and on-prem Active Directory GPOs.
- [ ] **H2. macOS Jamf / Kandji `.mobileconfig` Profile:**
  - Author signed `.mobileconfig` payload deploying enterprise activation token and `telemetry_enabled: false` enforcement to `/Library/Managed Preferences/com.sweepr.app.plist`.
- [ ] **H3. Multi-Seat Admin Console & Volume Licensing SKUs (B2B Demand-Gated):**
  - Add seat-pool tiers (`10` / `25` / `100+` endpoints) in Stripe/CRM only if B2B demand materializes, with domain-level device revocation, bulk CSV fleet report export, and optional opt-in fleet compliance reporting.
