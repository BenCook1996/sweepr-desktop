---
name: conversion-funnel-cro
description: Conversion Rate Optimization (CRO) skill for SWEEPR Cleaner's dual sales funnels (Web Direct Checkout /order & /pricing, and Freemium Desktop Installer /download -> In-App Paywall.svelte). Use when auditing funnel drop-offs, improving checkout conversion rates, optimizing pricing anchors, or designing A/B tests.
---

# Conversion Rate Optimization (CRO) & Dual-Funnel Monetization Skill

Use this skill to audit, diagnose, and optimize conversion rates across SWEEPR Cleaner's web sales channels (`server/public/index.html`, `pricing.html`, `order.html`), in-app desktop activation flow (`app/src/components/ActivateModal.svelte`), and Android Google Play Billing flow (`mobile/android`).

Before running this skill, read `.agents/product-marketing.md`, `server/public/order.html`, `server/public/pricing.html`, and `server/public/analytics.js`.

---

## 1. Understanding SWEEPR's Omni-Channel Funnel Architecture (v2.0)

SWEEPR converts traffic through three synchronized monetization paths:

```
                   [ Paid Ads / 1,128 pSEO Guides / Directories / ASO ]
                                            │
         ┌──────────────────────────────────┼──────────────────────────────────┐
         ▼                                  ▼                                  ▼
FUNNEL A: Direct Web Checkout      FUNNEL B: Desktop Scan-First       FUNNEL C: Mobile & Play Beta
(/, /pricing -> /order.html)       (/download .exe/.dmg -> Scan)      (Play Beta / APK / iOS Web App)
         │                                  │                                  │
Annual £49.99 Default Anchor       60s Rust Scan + 7-Day Undo         Free 30-Day Play Beta OR
+ £9.99/yr Battery & Cloud Bumps   -> ActivateModal.svelte            In-App Play Billing v8.0.0
+ 30s/Exit £1.99 Intro Downsell    (Stripe / Email OTP / QR Pair)     (Links up to 5 Devices)
         │                                  │                                  │
         └──────────────────────────────────┼──────────────────────────────────┘
                                            ▼
                    [ Unified 5-Device Pro License + Add-On Upsells ]
```

### Funnel Benchmarks & Target Conversion Rates
- **Funnel A (Direct Web Checkout):**
  - Landing Page -> `/pricing` or `/order` Click-Through Rate (CTR): **12%–22%**
  - `/order` Page -> Completed Purchase Rate: **18%–32%** (boosted by `£1.99` intro anchor + Apple/Google Pay)
- **Funnel B (Freemium Desktop Installer):**
  - Landing Page (`/clean/*` or `/`) -> `/download` Click Rate: **10%–20%**
  - Download -> App Installed & `scan_started`: **65%–80%** (heavily dependent on Authenticode signing / zero SmartScreen warning)
  - `scan_completed` -> `paywall_viewed` -> `purchase_completed`: **6%–14%**

---

## 2. High-Impact CRO Levers for Desktop Cleaner Software

### Lever 1: Quantified Loss Aversion & Personalized Scan Value
- Users rarely buy a cleaner for abstract "optimization." They buy when they see **"24.8 GB of safe-to-delete cache & 1,420 tracking files found on your PC."**
- **Web Implementation:** Use interactive storage calculators or dynamic benchmarks on `/` and `/clean/*` showing typical space reclaimed per app (e.g., NVIDIA Shader Cache + Discord + Windows Update = `14.2 GB`).
- **In-App Implementation (`Paywall.svelte`):** Always display the exact gigabytes and item count discovered during the user's live scan right inside the paywall header before presenting the `£1.99` / `£49.99` unlock options.

### Lever 2: Price Anchoring & Cash-Flow Optimization (`/pricing` & `/order`)
- **The `£1.99` Intro Offer:** Eliminates buyer hesitation on cold traffic (costs less than a cup of coffee to solve an immediate full-disk problem today).
- **The `£49.99` Annual Plan (Cash-Flow Multiplier):** Crucial for a `£10/day` ad budget with revenue reinvestment! Every customer who chooses the `£49.99` Annual plan instead of `£1.99` Intro puts **25x more immediate Day-1 cash** into your Stripe account, funding **5 full days of `£10/day` ad spend from a single sale**.
- **Optimization Tactic:**
  - On `/order`, offer a **1-Click Annual Upgrade Toggle / Order Bump** (*"Save 58% and lock in 12 months of Pro protection across 3 PCs for £49.99 — no monthly renewals"*) or present a post-checkout 1-click upsell from Monthly to Annual.

### Lever 3: Trust, Safety & Risk Reversal at Point of Action
- Because legacy PC cleaners have a reputation for dark patterns, anxious buyers look for safety proof right next to the CTA button:
  - **Near `/download` CTAs:** Display `"14MB Native Rust • Digitally Signed • Zero Background Bloat • Virustotal Clean"`.
  - **Near `/order` Submit Button:** Display `"14-Day Money-Back Guarantee • 1-Click Self-Serve Cancellation in Dashboard • 256-Bit Stripe SSL • Covers 3 PCs"`.

### Lever 4: Abandonment Recovery & Sticky Session Routing
- SWEEPR already implements `sweepr_visited_order` cookie routing (`server/src/app.ts`) and exit-intent discount recovery (`activateDiscountOffer` tracked in `analytics.js`).
- **Email Lead Capture on `/order` (`lead` event on `#email` blur):** If a user types their email on `/order` (`blur` event) but abandons before paying, trigger an automated cart-abandonment email via `server/src/email.ts` at **+30 minutes** ( reminding them of their uncleaned GBs) and **+24 hours** (with the coupon code `MYskiOdE`).

---

## 3. Diagnostic Audit Checklist (Using SWEEPR Telemetry)
When auditing conversion performance, inspect:
1. **Web Analytics (`analytics.js` / Microsoft Clarity):**
   - Check scroll depth (`25%`, `50%`, `75%`, `90%`) and rage clicks/dead clicks in Clarity on `/order` and `/pricing`.
   - Compare `checkout_cta_click` vs. `initiate_checkout` vs. `lead` (email entered) vs. `purchase`.
2. **In-App Telemetry (`/api/crm/telemetry` in `server/src/crm.ts`):**
   - Inspect funnel ratios across `scan_started` -> `scan_completed` -> `paywall_viewed` -> `checkout_started` -> `purchase_completed` -> `clean_completed`.
   - If `scan_completed` -> `paywall_viewed` is low, users aren't clicking Clean; make the primary Post-Scan CTA more prominent.
   - If `paywall_viewed` -> `checkout_started` is low, test framing the `£1.99` intro offer more prominently in `Paywall.svelte`.
