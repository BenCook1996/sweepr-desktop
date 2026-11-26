# Competitive Pricing Review: SWEEPR Cleaner vs. Total Cleaner (and Audit #3 Benchmarks)

**Document Scope:** Deliverable R3 (Competitive Pricing Review & Commercial Assessment)  
**Compliance Guardrail (R2 & R3):** **Strictly Analytical — Zero SKU or Price Changes Executed.** `c:\Users\Benjamin\Downloads\desktop_cleaner\server\src\pricing.ts` remains **100% unmodified**.  
**SWEEPR Baseline Verified:** `pricing.ts`, `pricing.html`, `order.html`, `refund.html`, `terms.html`, `app.ts`, `db.ts`, `rules.rs`  
**Live Competitor Research Date:** `2026-11-26`

---

## 1. Executive Verdict & Scope Guardrail

### 1.1 Compliance Affirmation (R2 / R3)
Per Requirements R2 and R3, this review evaluates SWEEPR Cleaner's existing commercial catalog (`£49.99/yr`, `£38.99/6mo`, `£9.99/mo`, `£1.99` 1st-month intro, 5 unified devices) against live-researched **Total Cleaner** pricing and **Audit #3** incumbents without changing a single line of `server/src/pricing.ts`, Stripe billing logic, or RevenueCat configuration.

### 1.2 Headline Verdict
- **Where SWEEPR Wins Decisively:** **Renewal transparency, Year-2+ / 3-year Total Cost of Ownership (TCO), unified 5-device flexibility, and zero-telemetry free utility.** SWEEPR renews flat at **£49.99/yr** (`$64.99/yr` USD), making every renewal **34.4% cheaper in USD** (`$64.99` vs `$99.00`) and **~49.5% cheaper in GBP** (`£49.99` vs `£99.00` Total Security / TotalAV tier benchmark) than Total Cleaner's **5.2× renewal jump** (`$19.00 -> $99.00/yr`). With `WELCOME20` (`20%` off Year 1), SWEEPR beats Total Cleaner on cumulative TCO by **Year 2** (`$116.98` vs `$118.00`), and even at full list price beats Total Cleaner by **Year 3** (`$194.97` vs `$217.00`), while avoiding Trustpilot/Reddit billing-shock complaints.
- **Where Total Cleaner Pressures SWEEPR:** **Low Year-1 acquisition anchor (`$19.00`, ~81% off)**, a **30-day money-back guarantee on annual/biannual plans** (vs SWEEPR's uniform **14-day** guarantee), and a live **native Apple App Store iOS app** (`id6740992662`, vs SWEEPR's Safari web companion / TestFlight beta).
- **Where Audit #3 Incumbents Still Pressure SWEEPR:** For **solo 1-device buyers** who do not use cross-OS seats, CCleaner Pro (`$44.95/yr` / `~£29.95/yr`), CleanMyMac (`$39.95/yr` 1-Mac), and DaisyDisk (`$9.99` one-time lifetime) remain cheaper for a single machine—a structural trade-off documented in Section 5 for future commercial evaluation (**not implemented per R2/R3**).

---

## 2. SWEEPR Cleaner Verified Pricing & Commercial Architecture

### 2.1 Multi-Currency Catalog (`server/src/pricing.ts`)
`PRICING_BY_CURRENCY` (`pricing.ts:65-486`) supports **30 currencies** (`GBP`, `USD`, `EUR`, `CAD`, `AUD`, `NZD`, `CHF`, `SEK`, `NOK`, `DKK`, `PLN`, `CZK`, `RON`, `BGN`, `TRY`, `JPY`, `KRW`, `SGD`, `HKD`, `TWD`, `INR`, `BRL`, `MXN`, `ZAR`, `AED`, `SAR`, `ILS`, `MYR`, `THB`, `PHP`), defaulting to **UK / GBP** (`pricing.ts:597, 604, 1003`) via `resolvePricingForRequest()` (`pricing.ts:909-1004`).

| Currency | Code | Annual (`annualAmount`) | Annual `/mo` eq & Savings vs `12×mo` | 6-Month (`sixMonthAmount`) | 6-Mo `/mo` eq & Savings vs `6×mo` | Monthly (`monthlyAmount`) | 1st-Mo Intro (`introMonthlyAmount`) | Optional Add-Ons (each: `batteryCare*` & `cloudVault*`) | Source (`pricing.ts`) |
|---|---|---|---|---|---|---|---|---|---|
| **GBP (£)** | `GBP` | **£49.99/yr** (`4999`) | £4.16/mo · **58%** off £119.88 | **£38.99/6mo** (`3899`) | £6.50/mo · **35%** off £59.94 | **£9.99/mo** (`999`) | **£1.99** (saves £8.00) | +£9.99/yr · +£6.99/6mo · +£1.99/mo | `:80-93, 621-622, 670-677` |
| **USD ($)** | `USD` | **$64.99/yr** (`6499`) | $5.41/mo · **55%** off $143.88 | **$47.99/6mo** (`4799`) | $7.99/mo · **33%** off $71.94 | **$11.99/mo** (`1199`) | **$1.99** (saves $10.00) | +$9.99/yr · +$6.99/6mo · +$1.99/mo | `:66-79` |
| **EUR (€)** | `EUR` | **€59.99/yr** (`5999`) | €4.99/mo · **55%** off €131.88 | **€44.99/6mo** (`4499`) | €7.49/mo · **32%** off €65.94 | **€10.99/mo** (`1099`) | **€1.99** (saves €9.00) | +€9.99/yr · +€6.99/6mo · +€1.99/mo | `:94-107` |
| **CAD (CA$)** | `CAD` | CA$89.99/yr (`8999`) | CA$7.49/mo · 53% | CA$64.99/6mo (`6499`) | CA$10.83/mo · 32% | CA$15.99/mo (`1599`) | CA$2.99 | +CA$14.99/yr · +CA$9.99/6mo · +CA$2.99/mo | `:108-121` |
| **AUD (A$)** | `AUD` | A$99.99/yr (`9999`) | A$8.33/mo · 54% | A$74.99/6mo (`7499`) | A$12.49/mo · 31% | A$17.99/mo (`1799`) | A$2.99 | +A$15.99/yr · +A$10.99/6mo · +A$2.99/mo | `:122-135` |
| **CHF** | `CHF` | CHF 59.99/yr (`5999`) | CHF 4.99/mo · 55% | CHF 44.99/6mo (`4499`) | CHF 7.49/mo · 32% | CHF 10.99/mo (`1099`) | CHF 1.99 | +CHF 9.99/yr · +CHF 6.99/6mo · +CHF 1.99/mo | `:150-163` |
| **JPY (¥)** | `JPY` | ¥9,980/yr (`9980`) | ¥831/mo · 56% | ¥7,480/6mo (`7480`) | ¥1,246/mo · 34% | ¥1,880/mo (`1880`) | ¥290 | +¥1,580/yr · +¥980/6mo · +¥290/mo | `:276-289` |
| **INR (₹)** | `INR` | ₹5,499.99/yr (`549999`) | ₹458.33/mo · 54% | ₹3,999.99/6mo (`399999`) | ₹666.66/mo · 33% | ₹999.99/mo (`99999`) | ₹169.99 | +₹899.99/yr · +₹599.99/6mo · +₹169.99/mo | `:346-359` |

### 2.2 Promotional Rules, Suite Bundle, 5-Device Pool & Free Tier
- **1st-Month Intro Promo (`order.html:375-384, 714-725, 973-1059, 2561-2639`, `app.ts:3017-3042, 3661-3665`):** Applies strictly to the **Monthly** plan (`£1.99` / `$1.99` / `€1.99` for Month 1) when entered via `?offer=intro` / `?intro=1` / `?plan=intro` / `?variant=B`, exit-intent modal, or checkout rescue bar, with explicit upfront disclosure that Month 2+ renews at `£9.99` / `$11.99` / `€10.99` per month (`order.html:1050, 1466`).
- **Coupon Codes (`app.ts:316-328, 1857`, `order.html:1084-1092, 1547`, `renewal-recap.ts:190`, `giveaway.ts:503, 578`):** `WELCOME20` (`20%` off, emailed via `/download` backup link), `SCAN5GB20` (`20%` off), `STAY30` (`30%` off renewal loyalty), and `GOTD50` / `SWEEPR50` (`50%` off). All apply to initial checkout and disclose regular-rate auto-renewal.
- **Flat Annual & 6-Month Renewals (`order.html:906, 1433, 1450`):** Zero surprise renewal jump—checkbox consent explicitly states: *"I agree to pay £49.99 today which will auto renew at £49.99 annually"* (likewise `£38.99` every 6 months).
- **Sweepr Complete Security Suite Bundle (`pricing.html:729-743, 1044-1060`):** **£89.99/yr** (vs `£164.97/yr` standalone sum, `45%` / `£74.98` savings) bundling *Sweepr Cleaner Pro + SWEEPR DeepBlock Pro + Sweepr VPN Pro + Total Tab & RAM Tamer*.
- **Unified 5-Device Pool (`db.ts:811-858`, `app.ts:5782-5783, 6845-6955`, `licensing.rs:100-102`):** `Math.max(1, maxPc || 5)` covers up to **5 devices** across Windows 10/11, macOS, Android, and iOS (**qualified across all pages as Safari web companion / TestFlight beta**). Users can unlink seats anytime in `/dashboard`. Effective per-device cost: **£0.83/device/mo** (`£49.99 / 12 / 5`) or **$1.08/device/mo** (`$64.99 / 12 / 5`).
- **Unlimited Free Starter Tier (`rules.rs:240-327`, `commands.rs:73-142, 4012-4080`, `pricing.html:615-620, 819-856`):** Following Audit `#1` Option B remediation, `temp` (`>24h`) and standard browser cache rules (`chrome`, `edge`, `brave`, `firefox`) are **unlimited (`free: true`, no 500 MB cap)** and route to OS Recycle Bin/Trash (`use_trash = true`), while Pro unlocks deep GPU/AI/Dev/Game caches, SHA-256 duplicates, Uninstaller, Scheduler, and **7-Day Undo Quarantine (`2–10 GB` rolling budget, `5 GB` default)**.

### 2.3 Refund Policy Consistency Check
Across every public-facing SWEEPR document (`pricing.html:7, 722, 782-784`, `order.html:8, 18, 25, 35, 345, 896, 935, 1018, 1057`, `refund.html:7-8, 130, 139, 145-146, 160`, `terms.html:147-148`, `llms-index.ts:224, 271`), there are **zero conflicting refund promises**: SWEEPR provides a uniform **14-Day Money-Back Guarantee** covering both initial purchases and renewal charges across Stripe, PayPal, and Google Play (`com.sweepr.app`), processed within 1 business day (UK time) by `Benjamin Cook t/a SWEEPR Cleaner` (`support@sweeprcleaner.com`). *(Internal note: `server/src/config.ts:183` defines an unused `trialDays: 30` env fallback that is not passed to Stripe `subscriptions.create` and does not appear on any public page.)*

---

## 3. Total Cleaner Live Pricing & Commercial Model (`2026-11-26`)

*Methodology note: Direct `curl.exe -sL` requests to `totalcleaner.com`, `help.totalcleaner.com`, and `apps.apple.com` returned 205–728 byte WAF/bot-challenge stubs. All live Total Cleaner facts below were retrieved on `2026-11-26` via `search_web` queries, with every grounding redirect URL resolved via HTTP `Location` headers to verify canonical URLs.*

### 3.1 Corporate Ownership, Web Plans & Renewal Jump
- **Corporate Umbrella:** Operated by **Total Security Limited** (billing platform **Protected.net**), alongside sister suites **TotalAV**, Total Adblock, Total VPN, and Total Password.
- **Web Introductory Offer (`totalcleaner.com/buy-now?forceLang=en`):** **$19.00** for the first billing term (advertised as `$80 off` / ~81% discount off the `$99.00` regular rate).
- **Regular Renewal Rate (`totalcleaner.com/pricing`, `help.totalcleaner.com/en/billing/-/promotional-pricing-explained`):** Introductory discounts apply **strictly to the initial term**. Unless auto-renewal ("Continuous Protection", enabled by default) is disabled beforehand, annual plans automatically renew at **$99.00/yr**—a **5.2× (`+421%`) renewal price jump**.
- **Billing Cycles:** Web checkout offers **monthly, quarterly, biannual, and annual** billing cycles; annual plans send a renewal reminder email up to **30 days** prior to renewal (`help.totalcleaner.com/en/billing`).
- **Regional UK/EU Benchmarks (`totalav.com` / `help.totalav.com` / `avisvpn.com` / `privacytestlab.com`):** Localized GBP/EUR checkout figures on `totalcleaner.com` vary dynamically by campaign/region; across Protected.net's sister **TotalAV** tiers, numeric anchors mirror USD 1:1 in GBP/EUR (**£19–£49** intro -> **£99 / £129 / £149 per year** renewal; **€99/yr** baseline).

### 3.2 Sister `TotalAV` Device-Tiered Suites & Mobile Store IAPs
- **TotalAV Antivirus Pro / Plus:** **$19–$29** (UK **£19–£29**) Year-1 intro -> **$99.00/yr** (**£99/yr**) renewal · **4 devices** (Win/Mac/iOS/Android; bundles system cleaner/duplicate/uninstaller tools).
- **TotalAV Internet Security:** **$39–$49** (UK **£39**) Year-1 intro -> **$129.00/yr** (**£129/yr**) renewal · **6 devices** (adds Total VPN).
- **TotalAV Total Security:** **$49–$69** (UK **£49**) Year-1 intro -> **$149.00/yr** (**£149/yr**) renewal · **8 devices** (adds Total Password + Total Adblock).
- **Apple App Store (`TotalCleaner: Optimise & Clean`, `id6740992662`):** Free download with IAPs verified at **$4.99** (add-on tier), **$7.99/mo** (Monthly Subscription), and **$47.90/yr** (Annual Subscription), auto-renewing unless cancelled `>=24h` prior in Apple ID settings.
- **Google Play (`Total Cleaner`, `com.totalcleaner.android`):** Free download offering a **7-day free trial** rolling into localized paid monthly/annual subscriptions unless cancelled `>=24h` prior in Google Play.

### 3.3 Refund Policy & Public Consumer Sentiment
- **Split Refund Windows (`help.totalcleaner.com/en/billing/-/refunds-and-money-back-guarantee`):**
  - **Annual or Biannual plans:** **30-day money-back guarantee** from initial purchase or renewal.
  - **Monthly, Quarterly, or Add-on services (even if billed annually):** **14-day money-back guarantee**.
- **Cancellation Friction:** Turning off auto-renewal inside *"My Subscriptions"* only prevents future rebilling—it **does NOT issue a refund**. Users must separately submit a full plan-termination refund request (which revokes access immediately). Mobile store purchases are governed by Apple / Google refund flows.
- **Consumer Sentiment (`trustpilot.com/review/www.totalcleaner.com`, `r/antivirus`):** Trustpilot sits at **~3.3–3.5 / 5 stars** (~100 reviews). Positive reviews praise UI simplicity; recurring complaints cite **unexpected `$99–$150+` / `£` renewal charges** after low intro offers, default auto-renewal, cancellation friction, and persistent in-app upsells after purchase.

### 3.4 Cited Live Sources Table (Accessed `2026-11-26`)

| Source Entity | Canonical URL (Verified `2026-11-26`) | Retrieved Pricing / Policy Facts |
|---|---|---|
| **Total Cleaner Home** | `https://www.totalcleaner.com/` | Total Security Limited / Protected.net consumer disk & device cleaner brand |
| **Total Cleaner Checkout** | `https://www.totalcleaner.com/buy-now?forceLang=en` | Advertises **$19.00** initial-term promo (`$80 off` vs **$99.00** regular rate) |
| **Total Cleaner Pricing** | `https://www.totalcleaner.com/pricing` | Monthly, quarterly, biannual, and annual tiers; promotional rate applies to initial term only |
| **Total Cleaner Billing Hub** | `https://help.totalcleaner.com/en/billing` | "Continuous Protection" auto-renewal enabled by default; 30-day advance reminder on annual plans |
| **Total Cleaner Promo Terms** | `https://help.totalcleaner.com/en/billing/-/promotional-pricing-explained` | Confirms auto-renewal at standard full rate (**$99.00/yr**) after initial promo period |
| **Total Cleaner Refund Policy** | `https://help.totalcleaner.com/en/billing/-/refunds-and-money-back-guarantee` | **30-day** refund on Annual/Biannual; **14-day** on Monthly/Quarterly/add-ons; canceling auto-renew != refund |
| **Total Security Terms** | `https://www.totalsecurity.com/terms` | Total Security Limited / Protected.net legal entity & subscription renewal terms |
| **TotalAV Total Security** | `https://www.totalav.com/product/total-security` | Sister Protected.net suite tiers (**4 / 6 / 8 devices**) bundling system tune-up + AV/VPN |
| **TotalAV Promo Terms** | `https://help.totalav.com/en/billing/-/promotional-pricing-explained` | Documents `$19–$49` intro -> `$99/$129/$149/yr` (`£99/£129/£149/yr`) regular renewal |
| **AllAboutCookies TotalAV** | `https://allaboutcookies.org/totalav-price` | Confirms TotalAV 4/6/8-device tiers (`$19->$99`, `$39->$129`, `$49->$149`) |
| **Security.org TotalAV** | `https://www.security.org/antivirus/totalav/` | Independent verification of TotalAV `$19–$49` Year-1 vs `$99–$149` renewal tiers |
| **AvisVPN / PrivacyTestLab** | `https://avisvpn.com/en/articles/totalav-review/`, `https://privacytestlab.com/articles/totalav-review` | UK/EU TotalAV pricing (`£19/£39/£49` -> `£99/£129/£149/yr`; `€99/yr`; add-ons up to `£99/yr`) |
| **Apple App Store** | `https://apps.apple.com/us/app/totalcleaner-optimize-clean/id6740992662` | *TotalCleaner: Optimise & Clean* IAPs (`$4.99` add-on, `$7.99/mo`, `$47.90/yr`) |
| **Google Play Store** | `https://play.google.com/store/apps/details?id=com.totalcleaner.android&hl=en` | *Total Cleaner* Android app: free download, 7-day trial -> recurring IAP |
| **Trustpilot Reviews** | `https://www.trustpilot.com/review/www.totalcleaner.com` | ~**3.3–3.5 / 5** (~100 reviews); praise for UI vs complaints over `$99–$150+` renewals & upsells |
| **Reddit (`r/antivirus`)** | `https://www.reddit.com/r/antivirus/comments/1cud8m0/totalav_has_been_hacking_our_accounts/` | Community billing/auto-renewal & cancellation friction complaints across TotalAV/Protected.net |
| **DaisyDisk Pricing** | `https://daisydiskapp.com/support/pricing/` | **$9.99 one-time** lifetime Mac license (Audit `#3` benchmark context) |

---

## 4. Side-by-Side Comparison Tables & Financial Modeling

### 4.1 Feature & Commercial Matrix

| Dimension | SWEEPR Cleaner (Pro) | Total Cleaner (Standalone) | TotalAV Suites (Protected.net) |
|---|---|---|---|
| **Operator / Entity** | Benjamin Cook t/a SWEEPR Cleaner (UK sole trader) | Total Security Limited / Protected.net | Total Security Limited / Protected.net |
| **Year-1 Annual Promo** | **£49.99/yr** (`£39.99` w/ `WELCOME20`) · **$64.99/yr** (`$51.99` w/ `WELCOME20`) | **$19.00** Year-1 promo (USD web checkout) | **$19–$49** / **£19–£49** Year-1 promo |
| **Standard Renewal Rate** | **£49.99/yr** / **$64.99/yr** / **€59.99/yr** (**Flat — `1.0×`**) | **$99.00/yr** (**`5.2×`** vs `$19` intro) | **$99 / $129 / $149** (`£99 / £129 / £149`) (**`3.0×–5.2×`**) |
| **Other Billing Cycles** | **£38.99/6mo** (`$47.99`), **£9.99/mo** (`$11.99`; **£1.99** 1st-mo intro) | Monthly, Quarterly, Biannual, Annual | Annual primary |
| **Device Entitlement** | **5 unified devices** (Win, Mac, Android + iOS web/TestFlight) | Web standalone + Mobile IAPs separate | **4 / 6 / 8 devices** tiered by price |
| **Free Tier Utility** | **Unlimited Temp & Browser Cache Clean** (`free: true`, to OS Recycle Bin) | Scan-first / trial-gated clean (mobile 7-day trial) | Free AV scan; cleanups paywalled |
| **Rollback Safety Net** | **7-Day Undo Quarantine** (`2–10 GB` rolling budget, `5 GB` default, O(1) move) | Standard delete | Standard delete |
| **Privacy / Telemetry** | **Zero-Telemetry / Offline Mode** (`telemetry_enabled = false` default) | Standard commercial telemetry | Standard commercial + in-app upsell prompts |
| **Native iOS App Store** | Safari web companion / TestFlight beta (`mobile/ios/` deferred) | **Live** (`id6740992662`, `$4.99` add-on, `$7.99/mo`, or `$47.90/yr`) | **Live** (via TotalAV mobile app) |
| **Refund Guarantee** | **14 days** uniform (initial + renewals) | **30 days** (Annual/Biannual); **14 days** (Monthly/Quarterly/add-ons) | **30 days** (Annual); **14 days** (Monthly/add-ons) |
| **Trustpilot Signal** | Early-stage 2026 launch (Trustpilot profile pending) | **~3.3–3.5 / 5** (~100 reviews; renewal-shock complaints) | Heavy mixed billing-shock feedback |

### 4.2 Cumulative 1-Year, 2-Year & 3-Year TCO (USD & GBP)

| Plan Scenario | Year 1 | Year 2 (Renewal) | Year 3 (Renewal) | 2-Year Cumulative TCO | 3-Year Cumulative TCO | Renewal Shock Ratio |
|---|---|---|---|---|---|---|
| **SWEEPR Annual (USD List)** | `$64.99` | `$64.99` | `$64.99` | `$129.98` | **`$194.97`** | **`1.00×` (Flat)** |
| **SWEEPR Annual (USD + `WELCOME20`)** | `$51.99` | `$64.99` | `$64.99` | **`$116.98`** | **`$181.97`** | `1.25×` (Promo -> List) |
| **Total Cleaner Web (USD `$19 -> $99`)** | **`$19.00`** | `$99.00` | `$99.00` | `$118.00` | `$217.00` | **`5.21×` Spike** |
| **SWEEPR Security Suite Bundle (GBP)** | `£89.99` | `£89.99` | `£89.99` | `£179.98` | `£269.97` | **`1.00×` (Flat)** |
| **SWEEPR Annual (GBP List)** | `£49.99` | `£49.99` | `£49.99` | `£99.98` | **`£149.97`** | **`1.00×` (Flat)** |
| **SWEEPR Annual (GBP + `WELCOME20`)** | `£39.99` | `£49.99` | `£49.99` | **`£89.98`** | **`£139.97`** | `1.25×` (Promo -> List) |
| **TotalAV / Protected.net Pro 4-Dev (GBP Benchmark)** | `£19.00` | `£99.00` | `£99.00` | `£118.00` | `£217.00` | **`5.21×` Spike** |
| **TotalAV Total Security 8-Dev (GBP Benchmark)** | `£49.00` | `£149.00` | `£149.00` | `£198.00` | `£347.00` | **`3.04×` Spike** |

### 4.3 Effective Cost-Per-Device Economics & Audit #3 Context

| Product / Plan | Annual Renewal Price | Devices Covered | Effective Annual Cost / Device | Effective Monthly Cost / Device |
|---|---:|---:|---:|---:|
| **SWEEPR Pro Annual (GBP)** | `£49.99` | **5** | **`£10.00 / dev / yr`** | **`£0.83 / dev / mo`** |
| **SWEEPR Pro Annual (USD)** | `$64.99` | **5** | **`$13.00 / dev / yr`** | **`$1.08 / dev / mo`** |
| **Total Cleaner Annual (USD)** | `$99.00` | Desktop/account | Higher Year-2+ baseline | **`$8.25 / mo` total** |
| **TotalAV Pro (4 devices, USD/GBP)** | `$99.00` / `£99.00` | 4 | `$24.75` / `£24.75` | `$2.06` / `£2.06` |
| **TotalAV Internet Security (6 devices)** | `$129.00` / `£129.00` | 6 | `$21.50` / `£21.50` | `$1.79` / `£1.79` |
| **CCleaner Pro (1 PC, Audit #3)** | `$44.95` (`~£29.95`) | 1 | `$44.95` (`~£29.95`) | `$3.75` (`~£2.50`) |
| **CleanMyMac (1 Mac, Audit #3)** | `$39.95` | 1 | `$39.95` | `$3.33` |
| **DaisyDisk (1-time, Audit #3)** | `$9.99` (one-time) | Mac | `$9.99` once | `$0.28/mo` over 3 yrs |

---

## 5. Strengths, Vulnerabilities & Strategic Non-Executed Recommendations

### 5.1 SWEEPR Competitive Strengths vs. Total Cleaner
1. **Flat Renewal Integrity ("No 5.2× Renewal Shock"):** SWEEPR's explicit checkout consent (`£49.99 -> £49.99` / `$64.99 -> $64.99`) directly neutralizes Total Cleaner's #1 Trustpilot pain point (`$19 -> $99/yr`, `£19 -> £99/yr`).
2. **Superior Multi-Year TCO & 5-Device Value:** Across a 5-device pool, SWEEPR's per-device-slot renewal cost (`£0.83/dev/mo`, `$1.08/dev/mo`) undercuts TotalAV's 4-device (`£2.06`/`$2.06`) and 6-device (`£1.79`/`$1.79`) per-slot rates by **53.6%–59.7% in GBP** (`£0.83` vs `£1.79`–`£2.06`) and **39.7%–47.6% in USD** (`$1.08` vs `$1.79`–`$2.06`), and cuts total 2+ device household renewal spend by **49.5% in GBP** (`£49.99` vs `£99.00`) and **34.4% in USD** (`$64.99` vs `$99.00`) vs TotalAV Pro 4-device (`£99`/`$99`), while bundling `SWEEPR Complete Security Suite` at **£89.99/yr** (flat) vs TotalAV Total Security's `£149/yr` renewal.
3. **Genuine Free Tier & Zero-Telemetry Privacy:** Unlimited Free Temp + Browser Cache cleaning (to OS Recycle Bin) and default `telemetry_enabled = false` offline mode eliminate scareware/upsell fatigue common to Protected.net utilities.
4. **7-Day Undo Quarantine Safety:** Configurable `2–10 GB` rolling rollback budget (`5 GB` default) provides technical protection absent from Total Cleaner.

### 5.2 Competitive Vulnerabilities Requiring Attention
1. **Year-1 Sticker Anchor (`$64.99` / `£49.99` vs `$19.00`):** Total Cleaner's `$19.00` landing-page badge captures price-sensitive first-time clickers unless SWEEPR surfaces its **`£1.99` 1st-Month Intro**, **`WELCOME20` (`20%` off Year 1)**, and **2-year/3-year TCO math** immediately above the fold.
2. **Annual Refund Window Gap (`14 days` vs `30 days`):** On annual subscriptions, Total Cleaner's **30-day** guarantee outlasts SWEEPR's **14-day** guarantee (`refund.html`), even though SWEEPR's process is cleaner (no anti-refund auto-renew trap).
3. **Solo 1-Device & Subscription-Averse Buyers (Audit `#3`):** Single-PC/single-Mac users comparing `$64.99/yr` against CleanMyMac (`$39.95/yr`), CCleaner 1-PC (`~£29.95/yr`), or DaisyDisk (`$9.99` one-time) feel over-charged for 4 unused device slots.
4. **Mobile iOS App Store Gap (Audit `#4`):** Total Cleaner monetizes iOS natively (`id6740992662`), whereas SWEEPR currently offers a Safari web companion / TestFlight beta.

### 5.3 Strategic Recommendations
#### A. Immediate Messaging & Funnel Actions (Zero Changes to `server/src/pricing.ts`)
1. **Add a "Flat Renewal — No 5× Price Spike" Callout on `/pricing` & `/order`:** Contrast SWEEPR's flat `£49.99/yr` (`$64.99/yr`) renewal against industry `$19 -> $99/yr` introductory traps, showing 2-year (`$116.98` w/ `WELCOME20` vs `$118`) and 3-year (`$194.97` list vs `$217`) savings.
2. **Frame the 5-Device Pool by Per-Device Math:** Lead with **`£0.83/device/month`** (`$1.08/device/month`) alongside *"14-day refund applies cleanly to both initial orders and renewals—canceling never traps you."*
3. **Spotlight Unlimited Free Temp + Browser Cache Clean + 7-Day Undo Quarantine:** Make the zero-cost entry point explicit on paid-ad landing pages so switchers experience real GB reclaimed before hitting Pro deep-clean triggers.

#### B. Future SKU & Policy Backlog *(EXPLICITLY NOT IMPLEMENTED PER R2 & R3)*
1. **Evaluate 30-Day Money-Back Guarantee on Annual Plans *(NOT IMPLEMENTED)*:** Align Annual/6-Month Pro with Total Cleaner's 30-day window while retaining 14 days on Monthly (`£1.99` intro) to reduce annual buyer hesitation.
2. **Evaluate Solo 1-Device Annual SKU (`£24.99–£29.99/yr` / `$32.99–$39.99/yr`) *(NOT IMPLEMENTED)*:** Directly closes Audit `#3` against CleanMyMac (`$39.95/yr`) and CCleaner 1-PC (`~£29.95/yr`), tested via controlled A/B pricing experiment before rollout.
3. **Evaluate Optional One-Time / Lifetime License (`£69–£99`) *(NOT IMPLEMENTED)*:** Captures subscription-averse DaisyDisk/Glary/Ashampoo switchers if major-version (`v1.x`) support boundaries are modeled cleanly.
