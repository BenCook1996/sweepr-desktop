# Product Marketing Context: Sweepr

*Last updated: 2026-10-17*
*Generated using the `product-marketing` skill framework from `coreyhaines31/marketingskills`.*

---

## Product Overview
- **One-liner:** Sweepr is an ultra-lightweight, Rust-powered PC and mobile optimization suite that reclaims gigabytes of disk space, purges bloated RAM, shreds sensitive files, and accelerates startup times in under 60 seconds—without bloatware or scareware.
- **What it does:** Sweepr scans and cleans hidden system junk, browser caches, orphaned registry keys, and duplicate files while providing real-time memory optimization, smart app uninstallation, privacy trace removal, and military-grade (DoD 5220.22-M) file shredding across Windows, macOS, Linux, Android, and iOS.
- **Product category:** PC System Utilities / Disk Cleaner & Performance Optimizer (`SoftwareApplication` -> `UtilitiesApplication`).
- **Product type & tech stack:**
  - **Desktop App (`app/`):** Built on **Tauri + Rust + Svelte 5** (~10–15 MB installer vs. 100MB+ Electron/legacy C++ bloatware). Native Rust modules for high-speed scanning (`scanner.rs`), cleaning (`cleaner.rs`), RAM & startup optimization (`memory.rs`), registry repair (`registry_cleaner.rs`), deep app uninstallation (`uninstaller.rs`), duplicate file detection (`duplicates.rs`), and secure file shredding (`shredder.rs`).
  - **Mobile Companion (`mobile/android`, `mobile/ios`):** Cross-platform storage & cache cleaner synced via unified license keys and RevenueCat entitlements.
  - **Web & Licensing Backend (`server/`):** Express + SQLite/Postgres + Stripe Subscriptions + RevenueCat Webhooks + Magic-Link Customer Portal (`/dashboard`) + Built-in Referral Engine (`/r/:code`).
- **Business model:** Freemium + Tripwire Subscription:
  - **Free Tier:** Unlimited basic system temp scans & initial cleanup ("Value Before Ask").
  - **Introductory Tripwire Offer:** **£1.99 today** (1st month full Pro access via Stripe coupon `MYskiOdE`), auto-renewing at **£9.99/month** (`priceMonthly`). Discount applies strictly to month 1 and does not reduce future renewals.
  - **Annual Plan:** **£49.99/year** (~£4.16/mo, 58% savings).
  - **Lifetime License (CRM / Upsell):** **£199 one-time** (`crm.ts`).
  - **Multi-Device Entitlement:** 1 Pro license unlocks **up to 3 Desktop PCs + 2 Mobile devices** with a 30-day money-back guarantee.

---

## Target Audience & Ideal Customer Profile (ICP)

### Segment 1: The Frustrated Everyday Windows/Mac User (Primary Volume ICP)
- **Who:** Remote workers, students, freelancers, and home PC owners running laptops/desktops that are 2–5 years old or have 256GB–512GB SSDs nearing capacity.
- **Trigger moment:** Getting a *"Low Disk Space (Local Disk C: is almost full)"* warning, experiencing fan noise/freezing when opening 20+ Chrome tabs, or waiting 3+ minutes for Windows to boot.
- **Technical sophistication:** Low-to-medium. They don't know whether deleting `AppData\Local\Temp` or `WinSxS` is safe and want a trustworthy 1-click button that won't break their OS.

### Segment 2: PC Gamers & Creative Power Users (High-Intent / Tech ICP)
- **Who:** Gamers (Steam, Valorant, Warzone, Fortnite), video editors, and developers whose SSDs are choked by shader caches, old mod files, `node_modules` / build caches, and background processes eating 4–8GB of idle RAM.
- **Trigger moment:** Frame drops/stuttering mid-game, inability to install a 90GB game update, or distrust of legacy cleaners (like CCleaner/Avast) that bundle background telemetry daemons and adware popups.
- **Technical sophistication:** Medium-to-high. They care deeply about **Rust native performance**, **zero background CPU tax**, and **no bundled bloatware**.

### Segment 3: Privacy-Conscious Professionals (Security / Utility ICP)
- **Who:** Legal, finance, healthcare, and privacy-minded users who need to permanently wipe tax documents, client PDFs, browser tracking databases, and credential caches so they cannot be forensically recovered.
- **Trigger moment:** Selling/returning a laptop, handling sensitive client files, or auditing browser tracking footprints.

---

## Jobs to Be Done (JTBD) & Problems Solved

| Core Problem | Before State (Frustration) | After State (With Sweepr) | Core Module |
| :--- | :--- | :--- | :--- |
| **"My C: drive is mysteriously full"** | Deleting Downloads manually only frees 500MB; hidden browser/system caches hold 25GB+. | 60-second scan uncovers 15–40GB of safe-to-delete system & browser caches. | `scanner.rs` / `cleaner.rs` |
| **"My PC takes forever to boot and stutters"** | 18 hidden apps launch at startup; 75%+ RAM is consumed while idle. | Startup items trimmed in 2 clicks; idle RAM purged on demand. | `memory.rs` (`Optimization.svelte`) |
| **"Uninstalling an app leaves gigabytes of junk behind"** | Windows Add/Remove Programs leaves `AppData` folders and broken registry keys. | Smart Uninstaller wipes the app binary, leftover folders, and orphaned registry entries together. | `uninstaller.rs` / `registry_cleaner.rs` |
| **"Duplicate photos and downloads are eating my drive"** | Thousands of `(1).jpg` and duplicate archives scattered across folders. | Hash-verified Duplicate Finder groups and merges duplicates safely in one click. | `duplicates.rs` (`Utilities.svelte`) |
| **"Deleted files can still be recovered"** | Emptying the Recycle Bin leaves raw sectors intact on disk. | DoD 5220.22-M multi-pass File Shredder permanently zeroes out sensitive files. | `shredder.rs` (`Utilities.svelte`) |

---

## Competitive Landscape & Switching Dynamics

| Competitor | Category | Why Users Hate Them (Vulnerability) | How Sweepr Wins |
| :--- | :--- | :--- | :--- |
| **CCleaner (Gen Digital / Avast)** | Direct Incumbent | Acquired by Avast; infamous for bundled browser/antivirus offers, persistent background monitoring agents, pop-up upsells, and past supply-chain security controversies. | **Zero bloatware, Rust-native (<15MB), privacy-first.** Sweepr runs when you tell it to and never sells your telemetry or bundles third-party adware. |
| **CleanMyPC / CleanMyMac (MacPaw)** | Direct Premium | CleanMyPC was sunset/neglected compared to CleanMyMac; expensive single-OS licensing (£35–£80/yr). | **Cross-platform license (3 PCs + 2 Mobile devices)** included in one plan, starting with a £1.99 1st-month introductory Pro offer. |
| **BleachBit** | Open-Source Alternative | Extremely dated Windows 95-style UI; dangerous checkboxes that can accidentally wipe needed user data; no RAM optimizer, duplicate visual merger, or smart uninstaller. | **Modern consumer UX with safety guardrails.** Sweepr gives BleachBit-level transparency with a polished dark-mode UI and safe defaults. |
| **Windows Storage Sense / Disk Cleanup** | Status Quo (Built-in) | Misses third-party browser caches (Chrome/Edge/Brave/Discord/Spotify/Steam), doesn't remove leftover app folders, doesn't find duplicate files, and doesn't shred files. | **Finds 3–5x more reclaimable space** across third-party apps, duplicates, and startup bloat. |
| **Avast Cleanup / Iolo System Mechanic** | Legacy Scareware | Uses aggressive red "CRITICAL ALERT: 4,821 ISSUES FOUND!" scareware tactics and slows down the machine with heavy background services. | **Honest diagnostics ("Anti-Scareware").** Shows exact file paths and byte counts before you clean. |

### The 4 Forces of Switching (JTBD)
1. **Push (Away from current state):** Disk full alerts, sluggish boot/gaming performance, and annoyance at CCleaner/Avast popup spam.
2. **Pull (Toward Sweepr):** Instant free scan showing exact gigabytes recoverable, modern Rust speed, all-in-one toolkit (Cleaner + Uninstaller + Duplicates + Shredder), and low-risk £1.99 Pro trial.
3. **Habit (Keeping them stuck):** *"I already have CCleaner installed"* or *"I'll just manually delete old Downloads."*
4. **Anxiety (Stopping the switch):** *"Will a PC cleaner delete my important files or break Windows?"* and *"Is this subscription hard to cancel?"*

---

## Objections & Rebuttals (Must Address on Landing & Paywall Pages)
1. **"Are PC cleaners snake oil or malware?"**
   - *Rebuttal:* Legacy cleaners gave the industry a bad name by inventing fake "registry errors" to scare users. Sweepr shows you the **exact file paths and byte sizes** of every cache, log, and duplicate file before deleting a single byte. Built in memory-safe Rust.
2. **"What if it deletes something important?"**
   - *Rebuttal:* Sweepr separates safe system/browser caches from user documents by default and never touches personal folders unless explicitly selected in Duplicate Finder or Shredder.
3. **"Why £1.99 today and £9.99/mo after? Can I cancel easily?"**
   - *Rebuttal:* You get 7 full days of Sweepr Pro across 3 PCs and 2 phones for £1.99 so you can deep-clean your entire setup. Cancel in 1 click anytime from your self-serve `/dashboard` (no phone calls, no dark patterns) plus a 30-day money-back guarantee.

---

## Customer Language & Verbatim Phrases
- **How they describe the problem:** *"Why is my C drive full when I have nothing installed"*, *"Windows 11 using 50% RAM idle"*, *"CCleaner keeps popping up ads"*, *"How to completely uninstall stubborn programs on Windows"*, *"Free up SSD space for Steam games"*.
- **Words to USE:** *Reclaim gigabytes, zero bloatware, native Rust speed, exact file paths, one-click startup boost, DoD file shredder, self-serve cancellation.*
- **Words to AVOID:** *CRITICAL SYSTEM DAMAGE, 10,000+ Registry Threats Detected, Boost PC Speed by 500% (scareware language), AI-powered quantum optimization (vague buzzwords).*

---

## Brand Voice & Proof Points
- **Tone:** Transparent, technical yet accessible, fast, anti-scareware, confident.
- **Visual Identity:** Sleek dark-mode engineering aesthetic (`#090A0F` obsidian background, `#6366F1` indigo & `#10B981` emerald accents, `Outfit` + `Plus Jakarta Sans` typography).
- **Key Proof Points:**
  - **28.5 GB** average disk space reclaimed per user (`index.html`).
  - **< 60 seconds** full system scan time (`index.html`).
  - **4.8★ rating** across 12,400+ downloads (`index.html` / `order.html`).
  - **3 PCs + 2 Mobile Devices** covered per license (`pricing.html`).
