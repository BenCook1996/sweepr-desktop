# SWEEPR Cleaner — Product Marketing & Growth Context

This document serves as the single source of truth for all marketing, SEO, digital advertising, and conversion optimization skills in `.agents/skills/`.

## 1. Product Overview & Core Positioning
- **Product Name:** SWEEPR Cleaner (`sweeprcleaner.com`)
- **Category:** Cross-Platform Desktop System Cleaner, Storage Analyzer, RAM Optimizer & Privacy Utility (Windows 10/11, macOS, Linux + companion mobile support)
- **Tech Differentiator:** Built natively in **Rust + Tauri + Svelte** (`<15 MB` installer vs. 80–200 MB legacy Electron/C++ bloatware).
- **Unique Value Proposition (UVP):**
  - Reclaim 20+ GB of hidden disk space (`AppData`, `WinSxS`, browser/app caches, shader caches, orphaned installers) in under 60 seconds.
  - **Zero Bloatware Guarantee:** No background telemetry daemons slowing down boot times, no pop-up upsell spam, no bundled third-party adware/antivirus.
  - **Radical Transparency:** Displays exact file paths (`%LocalAppData%\...`) and byte counts before deleting anything, plus military-grade file shredding (`Shredder.svelte`), duplicate finder (`Duplicates.svelte`), startup/RAM optimizer (`Memory.svelte`, `Optimization.svelte`), and breach monitoring (`Privacy.svelte`).

## 2. Target Audience & High-Intent Personas
1. **The Frustrated "C: Drive Full" User (Urgent Problem Solver):**
   - Searching: *"why is my C drive full Windows 11"*, *"is it safe to delete AppData Local Temp"*, *"how to clean Discord/Spotify/NVIDIA shader cache"*.
   - High urgency, high download intent. Converts best via pSEO guide -> Free Scan (`/download`) -> In-App Paywall (`Paywall.svelte`).
2. **The Disillusioned Legacy Cleaner Switcher (High Commercial Intent):**
   - Searching: *"CCleaner alternative no bloatware"*, *"lightweight PC cleaner Reddit"*, *"BleachBit vs CCleaner"*, *"CleanMyPC alternative"*.
   - Already sold on the category; hates Avast/Gen Digital telemetry and pop-ups. Converts directly on `/alternatives/ccleaner`, `/vs/ccleaner`, `/pricing`, and `/order`.
3. **PC Gamers, Developers & Power Users:**
   - Searching: *"clear DirectX shader cache stuttering"*, *"free up RAM Windows 11 gaming"*, *"clean node_modules / docker / cargo cache"*.
   - Values native Rust speed, tiny memory footprint, and exact path inspection.

## 3. Pricing & Unit Economics (GBP Base — `server/src/pricing.ts`)
SWEEPR Cleaner uses localized multi-currency pricing across 30 currencies (`PRICING_BY_CURRENCY`). Base GBP (`£`) unit economics:
- **Introductory Monthly Plan (Primary Low-Friction Acquisition Offer):**
  - **Day-1 Cash Collected:** `£1.99` for the first 30 days (saves `£8.00` / 80% off regular monthly).
  - **Month-2+ Renewal:** `£9.99/month` recurring (`monthlyAmount: 999`).
- **6-Month Pro Plan:** `£38.99` billed every 6 months (`£6.49/mo` equivalent, saves 35%).
- **Annual Pro Plan (Best Value / Cash-Flow Anchor):** `£49.99/year` billed upfront (`£4.16/mo` equivalent, saves 58%).
- **License Scope:** Covers up to **3 Desktop PCs** (Windows, macOS, Linux) + 14-day money-back guarantee + 1-click self-serve cancellation in `/dashboard.html`.

## 4. Active Sales Channels & Funnel Architecture
1. **Channel 1 — Direct Web Checkout Funnel (`/` -> `/pricing` -> `/order`):**
   - High-converting checkout (`server/public/order.html`) with Stripe Elements, Apple Pay, Google Pay, 3D software box visual, dynamic geo-pricing, and exit-intent discount recovery.
   - Returning visitor sticky routing (`sweepr_visited_order` cookie routes warm undecided visitors back to `/order`).
2. **Channel 2 — Freemium Desktop Installer Funnel (`/download` -> Desktop App -> In-App Paywall):**
   - Distributes `SWEEPRCleaner.exe` / `Sweepr_Setup.msi`.
   - User runs a free system scan (`scan_started` -> `scan_completed`), sees exact GBs of reclaimable junk, and hits `Paywall.svelte` (`paywall_viewed` -> `checkout_started` -> `purchase_completed`).
3. **Channel 3 — Programmatic SEO Directory (`/clean`, `/clean/app/:slug`, `/clean/folder/:slug`):**
   - Driven by `server/src/pseo.ts` and `server/src/data/clean-items.json` with `HowTo` and `FAQPage` JSON-LD schema markup.
4. **Channel 4 — Competitor Comparison Hubs (`/vs/:competitor`, `/alternatives/:competitor`):**
   - Captures bottom-of-funnel switcher traffic (e.g., `/vs/ccleaner`, `/alternatives/ccleaner`).
5. **Channel 5 — Software Directories, PAD Syndication & Affiliates (`/pad.xml`, `?ref=`):**
   - Automated PAD XML specification at `/pad.xml` and outreach tracking in `server/src/outreach-seed.json` (MajorGeeks, Softpedia, FileHorse, FilePuma, AlternativeTo, SaaSHub, SourceForge, Heise, CHIP).

## 5. Attribution & Analytics Infrastructure
- **First-Party Attribution (`server/public/attribution.js`):** 90-day first-touch and last-touch persistence (`localStorage` + cookies) capturing `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `gclid`, `msclkid`, `fbclid`, `ttclid`, `irclickid`, and `ref`. Passed directly into Stripe metadata (`extractAttributionMeta` in `server/src/app.ts`).
- **Unified Event Tracking (`server/public/analytics.js`):** Dispatches `page_view`, `scroll_depth`, `dwell_time`, `download_click`, `view_pricing`, `initiate_checkout`, `lead`, and `purchase` to GA4, Meta Pixel, and Microsoft Clarity.
- **In-House SEO & CRM Intelligence (`/crm`, `server/src/seo/router.ts`):** Tracks Google Search Console keywords, DataForSEO rankings/backlinks, AI crawler hits (`GPTBot`, `ClaudeBot`, `PerplexityBot`), and app telemetry funnel events.
