---
name: paid-ads
description: Performance marketing, PPC campaign architecture, ad compliance, and micro-budget scaling skill for desktop utility software across Microsoft Ads (Bing), Google Search Ads, Reddit Ads, and Meta Retargeting. Use when planning, launching, auditing, or scaling paid ad campaigns and ROAS reinvestment loops.
---

# Paid Ads & Micro-Budget Performance Marketing Skill

Use this skill when designing, auditing, or scaling paid digital advertising campaigns for SWEEPR Cleaner, particularly when operating under a constrained daily budget (e.g., `£10/day`) with a revenue-reinvestment mandate.

Before running this skill, read `.agents/product-marketing.md` and `server/src/pricing.ts` to align offers, unit economics, and attribution parameters.

---

## 1. Core Principles for Micro-Budget Desktop Utility Ads (`£10/day` Baseline)

1. **Never Split a Micro-Budget Thinly Across Broad Networks:**
   - At `£10/day` (`£300/month`), running broad keywords like `"PC cleaner"` on Google Ads US/UK (where CPCs are `£3.50–£8.00+`) yields 1–2 clicks/day and zero statistical significance.
   - Concentrate 70–100% of initial spend into **one high-intent, low-CPC channel** (specifically **Microsoft Advertising / Bing Search** for Windows desktop users) before layering secondary retargeting or Reddit tests.
2. **Desktop-Only Device Bid Modifiers (`-100%` Mobile/Tablet):**
   - For desktop utility installers (`SWEEPRCleaner.exe` / `Sweepr_Setup.msi`), mobile clicks waste 60%+ of ad spend. Always set **Mobile = `-100%`** and **Tablet = `-100%`** bid adjustments on search campaigns driving `/download` or desktop checkout.
3. **Ad Policy & SmartScreen Compliance First (Critical for PC Cleaners):**
   - Google Ads ("Free Desktop Software" & "Unwanted Software" policies) and Microsoft Ads strictly scrutinize system cleaners.
   - **Landing Page Rules:**
     - Must clearly display the official brand name (**SWEEPR Cleaner**), exact file size (`<15 MB`), OS requirements, transparent pricing (`£1.99` 1st month / `£9.99/mo` or `£49.99/yr`), EULA/Terms (`/terms`), Privacy Policy (`/privacy`), Refund Policy (`/refund`), and easy uninstall instructions.
     - **Avoid Prohibited Scareware Copy:** Never use ad copy claiming *"Warning: Your PC has 47 critical registry errors"* or *"Virus/Malware detected"*. Frame copy around **measurable storage & performance utility**: *"Reclaim 20+ GB of Hidden AppData & Cache Bloat — Native Rust Engine (<15MB)"*.
   - **Binary Signing:** Ensure `SWEEPRCleaner.exe` and `Sweepr_Setup.msi` are signed with a valid OV/EV Authenticode or Azure Trusted Signing certificate to prevent Windows Defender SmartScreen blocks that depress post-click install rates and trigger ad disapprovals.

---

## 2. Channel Selection & Campaign Architecture

### Channel A: Microsoft Advertising (Bing / Edge / Windows Search) — Primary Engine
*Why:* Built into Windows 10/11 taskbar search and Edge. Users searching for Windows storage/slowdown fixes on Bing are almost 100% on a Windows PC, skew slightly older with higher credit-card conversion rates, and have **35%–60% lower CPCs** (`£0.35–£0.95`) than Google Search.

- **Campaign Structure (SKAG / Tight Theme Ad Groups):**
  - **Ad Group 1 — Competitor Switchers (Direct to `/vs/ccleaner` or `/alternatives/ccleaner`):**
    - Match types: Exact `[...]` & Phrase `"..."` only.
    - Keywords: `[ccleaner alternative]`, `[ccleaner alternative windows 11]`, `"pc cleaner without bloatware"`, `[lightweight ccleaner replacement]`, `[cleanmypc alternative]`, `[bleachbit alternative with gui]`.
  - **Ad Group 2 — High-Intent Storage & C-Drive Pain (Direct to `/clean` or `/download`):**
    - Keywords: `[c drive full windows 11 nothing installed]`, `[clean appdata folder safely]`, `[windows 11 junk file cleaner]`, `[delete winsxs temp files tool]`, `[free up ssd space windows 11]`.
  - **Ad Group 3 — Gaming & Developer Cache Cleanup (Direct to `/clean/app/nvidia-shader-cache` or `/`):**
    - Keywords: `[clear directx shader cache tool]`, `[windows 11 ram cleaner for gaming]`, `[clean nvidia cache windows 11]`.
- **Bidding Strategy (2026 Microsoft Ads Rule):** Microsoft phased out standalone Max CPC caps on non-portfolio automated campaigns. Always use either **Manual CPC (Enhanced CPC enabled)** or a **Portfolio Bid Strategy** (which retains the **Max CPC bid ceiling of `£0.85–£1.10`**) so a single click never consumes more than 10% of the `£10` daily budget. Switch to **Maximize Conversions (Target CPA)** only after recording 30+ conversions/month.
- **UET + `msclkid` Attribution:** SWEEPR's `server/public/attribution.js` automatically captures `msclkid` for 90 days and injects it into Stripe checkout metadata (`server/src/app.ts`) on embedded `/order` checkouts.

### Channel B: Google Search Ads — Exact-Match Problem & Switcher Sniper
*Why:* Largest search volume, but requires strict CPC caps and long-tail exact match to survive on a small budget until reinvested revenue scales daily spend to `£25–£50+/day`.
- **Strategy:** Target high-intent long-tail queries mapped 1:1 to SWEEPR's `/clean/:category/:slug` and `/vs/:competitor` pages for a **9/10–10/10 Quality Score** (which discounts CPC by up to 50%).

### Channel C: Reddit Ads — Technical Community Native Posts
*Why:* Power users on `r/Windows11`, `r/Windows10`, `r/pcmasterrace`, `r/techsupport`, and `r/software` actively hate legacy cleaners (CCleaner/Avast) and love lightweight Rust/open-transparent tools.
- **Format:** Promoted Text/Image Post with comments enabled (or Conversation Placement), Desktop-only targeting, CPC bidding (`£0.20–£0.50` clicks).
- **Hook:** Founder-led technical transparency (*"I got tired of 150MB PC cleaners acting like adware, so I built a <15MB native Rust cleaner that shows exact file paths before deleting anything"*).

### Channel D: Meta Ads (Facebook & Instagram) — Retargeting First, Desktop Video Second
*Why:* Unmatched algorithmic retargeting and visual demo reach, but carries two critical traps for desktop utilities on a micro-budget:
1. **Trap 1 — Advantage+ Mobile Leakage:** Default Advantage+ Placements send 90%+ of spend to mobile feeds where users cannot install `SWEEPRCleaner.exe`.
   - **Rule for Install Funnel (`/download`):** Use **Manual Placements -> Desktop Only (Facebook Feed & Right Column)** and uncheck all "expand delivery" opt-ins.
   - **Rule for Direct Checkout Funnel (`/order`):** If allowing mobile placements, send traffic strictly to `/order` (where Apple Pay / Google Pay converts the `£1.99` intro offer in 1 click and emails the PC installer link) or promote the mobile companion app.
2. **Trap 2 — The 50-Conversions/Week Learning Phase:** On `£5–£10/day`, an ad set optimizing for `Purchase` will stay "Learning Limited." Optimize cold Meta ad sets for **`InitiateCheckout` or `DownloadClick`** first, and reserve `Purchase` optimization for **Stage 2+ Retargeting (`£3–£5/day`)** across a single consolidated 30-day Custom Audience (`PageView` + `DownloadClick` + `InitiateCheckout` minus `Purchase`).
3. **Meta Ad Policy Compliance:** Never use "Personal Attributes" scareware (*"Does your PC have 14 critical errors?"*) or fake Windows system alert graphics. Use 15-second native UI screen recordings showing SWEEPR reclaiming 20+ GB of real cache folders (`NVIDIA DXCache`, `AppData`, `Discord`).

### Channel E: Conversational AI Advertising (ChatGPT Ads, Microsoft Copilot Ads & Claude Policy)
1. **Microsoft Copilot Ads (via Microsoft Advertising — Stage 1 Viable at `£10/day`):**
   - Standard Microsoft Search & Multimedia campaigns automatically serve contextual **Sponsored Citations** inside Windows 11 Copilot, Bing Copilot, and Edge sidebar chats with **no extra minimum spend** and low CPCs (`£0.40–£0.85`). Always attach Logo and Image extensions in Microsoft Ads to unlock Copilot chat card placements.
2. **OpenAI / ChatGPT Ads Manager (Stage 3+ Viable once Daily Spend reaches `£35+/day`):**
   - **Mechanics:** OpenAI offers a self-serve **Ads Manager** serving labeled `"Sponsored"` cards directly beneath ChatGPT responses for **Free and Go tier users** (Plus/Pro/Team/Enterprise are ad-free). Targeting is based on **conversational context hints** (e.g., users prompting *"why is my C drive full on Windows 11"* or *"safe CCleaner alternative"*) rather than legacy keywords.
   - **Unit Economics & Budget Gate:** Self-serve ChatGPT Ads require a **`~$25 USD/day` (`~£20 GBP/day`) minimum daily campaign budget** and average **`$2.50–$5.00` (`£1.95–£3.90`) CPC** (`$25–$60` CPM). Do **not** run on Day 1 with a `£10/day` total budget; unlock in **Stage 3 (Days 61–90)** once reinvested Stripe revenue supports a dedicated `£20/day` conversational troubleshooting test.
3. **Anthropic / Claude (Strictly Ad-Free — Zero-Cost GEO Only):**
   - Anthropic enforces a strict corporate **No-Ads Policy** for Claude (*"Ads are coming to AI. But not to Claude."*). There is **no** paid ad platform or sponsored placement inventory in Claude.
   - **Capture Mechanism:** Capture Claude user recommendations for `£0` via **Generative Engine Optimization (GEO)** — keeping `ClaudeBot` / `Claude-User` unblocked (`server/src/seo/bots.ts`), maintaining `server/public/llms.txt`, and earning citations on high-authority directories (AlternativeTo, MajorGeeks, Softpedia, Reddit).

---

## 3. Mandatory Negative Keyword List (Prevent Wasted Spend)
Always attach this negative keyword list at the campaign level on Day 1:
- **Physical/Service Cleaners:** `carpet`, `vacuum`, `dyson`, `house`, `office`, `window cleaning`, `dry cleaning`, `maid`, `janitorial`, `car wash`, `pressure washer`, `keyboard spray`, `compressed air`, `microfiber`, `screen wipes`, `dust`.
- **Unrelated OS / Devices (when running Windows-specific ad groups):** `android`, `apk`, `iphone`, `ios`, `ipad`, `chromebook`, `ps5`, `xbox`, `tv`.
- **Piracy / Zero-Value Intent:** `crack`, `keygen`, `serial key`, `pirate`, `torrent`, `nulled`, `mod apk`, `open source github code`.
- **Tech Support Scams / Hardware Repair:** `screen replacement`, `battery replacement`, `repair shop near me`, `blue screen hardware fix`, `data recovery service`.

---

## 4. Attribution & Conversion Tracking Checklist
Verify that every paid ad URL uses the following UTM template so `server/public/attribution.js` and `server/src/app.ts` record the touchpoint in SQLite and Stripe metadata:
```text
https://sweeprcleaner.com/{landing-path}?utm_source={microsoft|google|reddit|meta}&utm_medium=cpc&utm_campaign={campaign_slug}&utm_term={keyword}&utm_content={ad_variant}
```
- **Primary Conversion Events (`server/public/analytics.js`):**
  1. `purchase` (Value: `1.99` GBP for intro monthly, `38.99` GBP for 6-month, `49.99` GBP for annual) — **Primary Bid Optimization Goal**.
  2. `initiate_checkout` / `lead` (Email entered on `/order`) — **Secondary Micro-Conversion Goal**.
  3. `download_click` (`SWEEPRCleaner.exe` / `Sweepr_Setup.msi` download) — **Top-of-Funnel Install Goal** (track desktop-to-checkout conversion rate via `/api/crm/telemetry`).

---

## 5. Revenue Reinvestment & Budget Scaling Formula
When advising on budget scaling from the `£10/day` baseline:
1. **Calculate Blended Gross Revenue per New Customer (Day-1 Cash vs. 60-Day LTV):**
   - Suppose product mix is **65% Intro Monthly (`£1.99` Day-1)**, **10% 6-Month (`£38.99` Day-1)**, and **25% Annual (`£49.99` Day-1)**.
   - **Immediate Day-1 Cash Collected (Blended AOV):**
     $$(0.65 \times £1.99) + (0.10 \times £38.99) + (0.25 \times £49.99) = £1.29 + £3.90 + £12.50 = £17.69 \text{ per paid checkout}$$
   - **Day-31 Renewal Cash:** Assuming 55% of `£1.99` intro users renew at `£9.99/mo` in Month 2, each cohort generates an additional $0.65 \times 0.55 \times £9.99 = £3.57$ per customer at Day 31 (**Day-31 Blended LTV = `£21.26`**; **Day-90 Blended LTV = `£26.80+`**).
2. **Reinvestment Guardrails:**
   - **Target CAC Ceiling:** Keep Blended Paid CAC $\le £12.00$ so **Day-1 Cash ROAS $\ge 1.47\times$** (immediately self-funding within the same Stripe payout window!).
   - **Weekly Reinvestment Rule:** Every 7 days, take **50%–70% of Net Stripe Payouts** (after Stripe fees of ~1.5% + 20p UK cards) and add it to the next week's daily ad budget, raising daily spend in controlled **+20% to +30% increments** every 5–7 days to avoid resetting ad-network learning phases.
