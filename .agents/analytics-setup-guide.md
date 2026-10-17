# Sweepr Cleaner — Analytics & Interaction Tracking Setup Guide

This guide walks you through setting up **Google Analytics 4**, **Meta Pixel (Facebook/Instagram)**, and **Microsoft Clarity (Heatmaps & Session Replays)** on `sweeprcleaner.com`.

The unified tracking engine [`server/public/analytics.js`](file:///c:/Users/Benjamin/Downloads/desktop_cleaner/server/public/analytics.js) is already embedded across all pages and automatically tracks user sessions, scroll depth, button clicks, downloads, checkout starts, and leads.

---

## 1. Quick Configuration: Where to Add Your IDs

You can activate all three services using **either** of the two simple methods below:

### Option A: Via Environment Variables (Recommended for Railway / Production)
Add these three lines to your `server/.env` file (or Railway Dashboard → Variables):

```env
# Google Analytics 4 Measurement ID
GA_MEASUREMENT_ID=G-XXXXXXXXXX

# Meta Pixel (Facebook / Instagram) Pixel ID
META_PIXEL_ID=123456789012345

# Microsoft Clarity Project ID
CLARITY_PROJECT_ID=abcdef1234
```

### Option B: Directly in the Frontend File
Open [`server/public/analytics.js`](file:///c:/Users/Benjamin/Downloads/desktop_cleaner/server/public/analytics.js) and paste your IDs into lines 13-17:

```javascript
window.SWEEPR_ANALYTICS_CONFIG = Object.assign(
  {
    gaMeasurementId: 'G-XXXXXXXXXX',   // Your Google Analytics ID
    metaPixelId: '123456789012345',     // Your Meta Pixel ID
    clarityProjectId: 'abcdef1234',    // Your Microsoft Clarity ID
    debug: false
  },
  window.SWEEPR_ANALYTICS_CONFIG || {}
);
```

---

## 2. How to Obtain Your Free IDs (Step-by-Step)

### A. Google Analytics 4 (GA4) — Traffic & Conversion Funnels
1. Go to [analytics.google.com](https://analytics.google.com/) and create or open your account.
2. Click **Admin** (gear icon in lower left) → **Data Streams** → **Web**.
3. Enter `https://sweeprcleaner.com` as the Website URL and `Sweepr Cleaner` as the Stream Name.
4. Copy the **Measurement ID** (starts with `G-`, e.g. `G-W3XYZ12345`).

### B. Meta Pixel (Facebook & Instagram) — Ad Tracking & Audience Building
1. Go to [Meta Events Manager](https://business.facebook.com/events_manager2).
2. Click the green **+ Connect Data Sources** button → Select **Web**.
3. Name your pixel `Sweepr Cleaner Web Pixel` and enter `https://sweeprcleaner.com`.
4. Copy your **Pixel ID** (a 15-16 digit number, e.g. `987654321012345`).

### C. Microsoft Clarity — Free Heatmaps & Video Session Recordings
> **Why Clarity?** Unlike Hotjar, Microsoft Clarity is **100% free with unlimited session recordings and heatmaps**. You can watch actual video playbacks of users navigating your site, moving their mouse, and clicking buttons.

1. Go to [clarity.microsoft.com](https://clarity.microsoft.com/) and sign in with Google or Microsoft.
2. Click **+ Add new project** → Enter Name `Sweepr Cleaner` and Domain `https://sweeprcleaner.com`.
3. Go to **Settings** → **Overview** and copy the **Project ID** (a 10-character code, e.g. `k8m9v7x2p1`).

---

## 3. What Events Are Automatically Tracked?

Without writing any additional code, [`analytics.js`](file:///c:/Users/Benjamin/Downloads/desktop_cleaner/server/public/analytics.js) automatically captures:

| Event Name | Trigger | GA4 & Meta Mapping |
|---|---|---|
| `page_view` | User visits any page | GA4 `page_view` / Meta `PageView` |
| `scroll_depth` | User reaches 25%, 50%, 75%, 90% of page | Custom Milestone Event |
| `dwell_time` | User actively stays on site for 30s, 60s, 120s | Engagement Milestone |
| `download_click` | User clicks `/download` or `.exe` installer link | Meta `DownloadClick` |
| `view_pricing` | User navigates to `/pricing` | Meta `ViewPricing` |
| `initiate_checkout` | User lands on `/order` checkout page | Meta `InitiateCheckout` (£1.99) |
| `lead` | User enters email address on `/order` | Meta `Lead` |
| `discount_modal_claimed` | User clicks "CLAIM DISCOUNT" in exit popup | High-intent conversion event |
| `language_change` | User switches language in the nav dropdown | User preference tracking |

---

## 4. How to Verify It's Working

1. **In Your Browser Console**:
   - Open Chrome Developer Tools (`F12`) → **Console**.
   - Look for the green `[Sweepr Analytics]` logs showing each event firing as you scroll and click.
2. **Meta Pixel Helper Chrome Extension**:
   - Install the official [Meta Pixel Helper](https://chromewebstore.google.com/detail/meta-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc) extension to verify green checkmarks on `PageView` and `InitiateCheckout`.
3. **GA4 Realtime Report**:
   - In Google Analytics, click **Reports** → **Realtime** to see your active test session live on the globe.
