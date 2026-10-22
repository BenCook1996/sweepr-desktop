---
name: competitor-alternatives
description: High-intent competitor comparison (/vs/:competitor) and alternatives (/alternatives/:competitor) SEO & landing page skill for capturing users switching from legacy PC cleaners (CCleaner, BleachBit, CleanMyPC, Avast Cleanup, Wise Disk Cleaner, Glary Utilities). Use when creating or optimizing comparison pages and switcher ad landers.
---

# Competitor Comparison & Alternatives Skill (`/vs/` & `/alternatives/`)

Use this skill to research, write, and optimize high-converting bottom-of-funnel (BoFu) competitor comparison and alternative pages under `server/public/vs/` and `server/public/alternatives/`.

Before running this skill, read `.agents/product-marketing.md`, `server/public/vs/ccleaner.html`, and `server/public/alternatives/ccleaner.html`.

---

## 1. Strategic Rationale: Capturing Bottom-of-Funnel Switchers
Users searching `"[Competitor] alternative"` or `"is [Competitor] still safe in 2026"` already have **problem awareness** and **solution awareness**. They do not need to be convinced they need a PC cleaner—they are actively looking for a trustworthy replacement because legacy cleaners suffer from:
1. **Heavy Bloat & Background Daemons:** 80–200 MB installers that install persistent system services (`CCleaner64.exe`, update monitors) eating RAM 24/7.
2. **Dark Patterns & Scareware Upsells:** Constant tray pop-ups claiming *"Your privacy is exposed!"* or bundling unwanted browsers/antivirus trials.
3. **Opaque File Deletion:** Hiding which files are actually being removed or pushing risky registry cleaners that break Windows 11.

SWEEPR Cleaner wins these comparisons immediately by positioning as **The Modern Native-Rust Antidote**.

---

## 2. Priority Competitor Matrix for SWEEPR Cleaner

| Competitor | Primary Weakness / User Frustration | SWEEPR Winning Angle | Target Routes |
| :--- | :--- | :--- | :--- |
| **CCleaner** (Gen Digital/Avast) | Bundled offers, persistent background monitoring, heavy installer, historical trust erosion | `<15 MB` native Rust binary, zero background daemons, zero adware, transparent path preview | `/vs/ccleaner`, `/alternatives/ccleaner` |
| **BleachBit** | Outdated GTK2 UI from the 2000s, intimidating for average users, no modern RAM/Duplicate/Breach UI | Modern glassmorphic UI, safe guided defaults, built-in RAM optimizer, duplicate finder & Pro support | `/vs/bleachbit`, `/alternatives/bleachbit` |
| **CleanMyPC / CleanMyMac** (MacPaw) | Expensive (`£35–£85/yr`), CleanMyPC discontinued/neglected on Windows compared to macOS | Actively engineered for Windows 11 + macOS + Linux, `£1.99` 1st-month entry, 3-PC license included | `/vs/cleanmypc`, `/alternatives/cleanmypc` |
| **Avast Cleanup Premium** | Constant cross-sell popups, heavy system footprint, expensive renewal traps | Lightweight standalone utility, zero antivirus bloat, 1-click self-serve cancellation | `/vs/avast-cleanup`, `/alternatives/avast-cleanup` |
| **Wise Disk Cleaner / Glary Utilities** | Dated ad-supported freeware UI, confusing module clutter, questionable registry tweaks | Focused high-impact modules (Cleaner, Duplicates, Shredder, RAM, Startup, Privacy), zero ads | `/vs/wise-disk-cleaner`, `/vs/glary-utilities` |

---

## 3. Page Architecture Blueprint

### A. Head-to-Head Comparison Page (`/vs/[competitor]`)
1. **Hero Section:**
   - H1: `SWEEPR Cleaner vs [Competitor] (2026 Benchmark Comparison)`
   - Subheadline quantifying the core difference (Installer size, RAM usage, scan speed, telemetry).
   - Dual CTA: Primary `Download Free Scan` (`/download`) + Secondary `Try Pro for £1.99` (`/order`).
2. **At-a-Glance Benchmark Table (Above the Fold):**
   - Compare: Engine Architecture (`Native Rust` vs. `Legacy C++/Electron`), Installer Size (`<15 MB` vs. `95+ MB`), Background RAM Usage When Closed (`0 MB` vs. `120+ MB`), Bundled Adware (`Never` vs. `Yes/Upsells`), Exact File Path Preview (`Yes`), Multi-Device Coverage (`3 PCs`), Entry Price (`£1.99 1st mo`).
3. **Fair & Credible Verdict ("When to Choose Each"):**
   - Acknowledge what the competitor does well (e.g., BleachBit is free/GPL for Linux CLI fans; CCleaner has brand recognition) before explaining why modern Windows 11/Mac users switch to SWEEPR. Fairness dramatically increases E-E-A-T trust and conversion rate.
4. **FAQ Section with `FAQPage` JSON-LD Schema:**
   - Target People-Also-Ask (PAA) queries: *"Is [Competitor] safe for Windows 11?"*, *"Does SWEEPR Cleaner run in the background?"*, *"How do I switch from [Competitor] to SWEEPR?"*.

### B. Category Alternatives Roundup (`/alternatives/[competitor]`)
1. **Hero Section:** `Top 5 [Competitor] Alternatives for Windows 11 & Mac (Tested & Compared)`
2. **Quick Summary Matrix:** Rank #1 **SWEEPR Cleaner** (Best Overall Modern & Lightweight), #2 **BleachBit** (Best Open-Source Basic), #3 **Storage Sense** (Built-in Windows Basic), #4 **WizTree** (Visual Disk Map Only), #5 **Wise Disk Cleaner**.
3. **Deep-Dive Cards:** Pros, Cons, Pricing, and Safety Rating for each option, with a standout highlighted card and direct download/checkout CTA for SWEEPR Cleaner at #1.
