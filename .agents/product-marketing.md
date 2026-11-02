# SWEEPR Cleaner — Product Marketing & Growth Context (v2.0 — November 2026)

This document serves as the single source of truth for all marketing, SEO, digital advertising, ASO, and conversion optimization skills in `.agents/skills/`.

## 1. Product Overview & Core Positioning
- **Product Name:** SWEEPR Cleaner (`sweeprcleaner.com`)
- **Category:** Unified 5-Device Cross-Platform Computer & Phone Storage Cleaner, Speed & Startup Booster, Duplicate Photo/File Finder, Cloud Cleaner, Battery Health Saver & Privacy Utility.
- **Supported Platforms (All Covered Under 1 Unified License — Up to 5 Devices):**
  1. **Windows 10 & 11:** Native Rust + Tauri + Svelte desktop app (`SWEEPRCleaner.exe` — `6.51 MB`, `Sweepr_Setup.msi` — `3.99 MB`, plus Microsoft WinGet manifest).
  2. **macOS 11+ (Universal Binary):** Native Universal UDIF (`SWEEPRCleaner.dmg` — `7.13 MB`).
  3. **Android (`com.sweepr.app`):** Native Kotlin/Jetpack Compose app (v1.0.4, `versionCode 5`, Target SDK 36, Google Play Billing Library 8.0.0, `SWEEPRCleaner.apk` — `3.38 MB`) + Official Google Play Beta (`https://play.google.com/apps/testing/com.sweepr.app` with 30-Day Free Pro Beta incentive).
  4. **iPhone & iPad (iOS / iPadOS):** Native Swift/SwiftUI app (`mobile/ios`) + instant `/ios-app` PWA & `.mobileconfig` installer (`/download?platform=ios&direct=1`).
  5. **Linux:** `.AppImage` support.
- **Unique Value Proposition (UVP):**
  - **One Account, 5 Devices:** Clean any combination of up to **5 computers and phones** simultaneously, linked via 6-digit email OTP or instant QR code (`ptk_...` challenge in `ActivateModal.svelte` and `/dashboard`).
  - **Radical Transparency & 7-Day / 30-Day Safety Net:** Shows every exact folder path and byte count before deleting anything. Backed by a **7-Day Undo Safety Net** on desktop and **30-Day Android System Trash** on mobile.
  - **Zero Bloatware Guarantee:** Tiny `<7 MB` Windows installer, zero background telemetry daemons slowing down boot times, and zero third-party adware or scareware popups.
  - **Full Feature Suite:**
    - *Desktop:* Deep PC & Chat App Cleanup (Discord, Slack, Teams, Zoom, Telegram + AI/dev caches like Ollama, LM Studio, Cursor, Windsurf), Speed & Gaming Booster, Complete Drag-and-Drop App Uninstaller & 1-Click Updater, Duplicate & Large File Mover (`>50 MB`), Multi-Cloud Cleaner (`CloudClean.svelte` for OneDrive, Google Drive, Dropbox, iCloud), Breach Monitor, and Military-Grade File Shredder.
    - *Mobile:* Smart Duplicate & Similar Photo Cleaner with **Best Shot AI** (64-bit dHash & Laplacian focus scoring), Blurry Photo Detector, Hardware-Accelerated Video Compressor (shrinks 4K videos by up to 72%), Batch Photo Optimizer & EXIF GPS Privacy Stripper, WhatsApp/Telegram Media Cleaner, Swipe-to-Clean Photo Triage, Contact Merger, Old Calendar Cleaner, and Live Home-Screen Storage Widget.

## 2. Pricing, Order Bumps & Unit Economics (GBP Base — `server/src/pricing.ts`)
SWEEPR Cleaner uses localized multi-currency pricing across 30 currencies (`PRICING_BY_CURRENCY`) with automatic IANA timezone (`Europe/London -> GBP`) and geo-IP parity across web, desktop, and mobile:
- **Core Pro Plans (Up to 5 Devices):**
  - **Annual Pro Plan (Default Hero & Checkout Selection — Best Value):** `£49.99/year` (`$64.99` / `€59.99`) — `£4.16/mo` equivalent, saves 58%.
  - **6-Month Pro Plan:** `£38.99` every 6 months (`$47.99` / `€44.99`) — `£6.50/mo` equivalent, saves 35%.
  - **Monthly Pro Plan:** `£9.99/month` (`$11.99` / `€10.99`), cancel anytime in 1 click.
  - **30-Second Inactivity & Exit-Intent Downsell Offer (`/order` & `ActivateModal.svelte`):** `£1.99` for the 1st month (`$1.99` / `€1.99`), saving `£8.00` (80% off month 1), auto-renewing at `£9.99/month`.
- **High-Margin Order Bump Add-Ons (`+£9.99/yr`, `+£6.99/6mo`, or `+£1.99/mo` each):**
  1. **Total Battery Care (`battery_care`):** 80% charge ceiling alert & thermal protection guard for laptops and phones.
  2. **SWEEPR Cloud Protection (`cloud_vault`):** Zero-knowledge password-protected Private File Lockbox & scheduled multi-cloud backup sync (`CloudProtection.svelte`).
- **Supported Payment Methods on `/order`:**
  - Embedded Stripe Card Elements, **Apple Pay** (`/.well-known/apple-developer-merchantid-domain-association`), **Google Pay**, **PayPal**, and **SEPA Direct Debit (IBAN)** for European buyers, plus native **Google Play Billing v8.0.0** on Android.

## 3. Active Sales Channels & Funnel Architecture
1. **Channel 1 — W3 Interactive Homepage & Pricing Configurator (`/` & `/pricing` -> `/order`):**
   - Features OS switcher chips, 3-Stage Interactive Preview Scrubber, Binary Plan Switcher (`Yearly` vs `Monthly`), and live `+£9.99/yr` add-on checkboxes that pass selected plans and add-ons directly into `/order`.
   - Returning undecided checkout visitors are automatically routed back to `/order` via the `sweepr_visited_order` cookie.
2. **Channel 2 — Multi-OS Freemium Installer & Mobile App Funnel (`/download` -> App -> `ActivateModal.svelte` / Google Play):**
   - Auto-detects Windows (`.exe`/`.msi`), macOS (`.dmg`), Android (Google Play Beta + `.apk`), iOS (`/ios-app` + `.mobileconfig`), and Linux (`.AppImage`).
   - Desktop users run a free scan and unlock Pro via `ActivateModal.svelte` (which supports direct checkout, 6-digit email OTP, or scanning a QR code with an already-logged-in phone).
3. **Channel 3 — Automated Programmatic SEO Engine (`/clean`, `/clean/app/:slug`, `/clean/folder/:slug`):**
   - **1,228 live verified guides** (`1,125` app cache guides + `103` Windows system folder guides) in `server/src/data/clean-items.json`, growing by 50 keyword-researched pages/day via `server/scripts/daily-50-seo-pages.mjs` with `100/100` technical SEO health and automatic IndexNow pinging.
4. **Channel 4 — Competitor Comparison Hubs (`/vs/ccleaner`, `/alternatives/ccleaner`):**
   - Captures high-intent switcher traffic looking for a bloat-free alternative to CCleaner, BleachBit, and CleanMyPC.
5. **Channel 5 — Automated 8-Language Syndication, PAD XML & Affiliates (`/pad.xml`, `daily-seo-drip.mjs`, `/r/:code`):**
   - **29,200+ syndication & directory entries** tracked in `server/src/outreach-seed.json`, plus `/r/:code` referral shortlinks and 90-day attribution (`server/public/attribution.js`).
