# SWEEPR Cleaner — Staged Google Search Console (GSC) Re-Indexing Execution Plan

**Document Version:** 1.0.0  
**Target File:** `docs/distribution/gsc-reindexing-plan.md`  
**Property Domain:** `https://sweeprcleaner.com`  
**Google Search Console Property:** `URL-prefix: https://sweeprcleaner.com/` or `Domain: sweeprcleaner.com`  
**Objective:** Break through the initial DR 0 indexation ceiling, resolve "Crawled - currently not indexed" status, clear legacy 404 crawl waste, and establish software authority across ~75 curated Tier-1 URLs.

---

## 1. Executive Summary & GSC Indexing Mechanics

### 1.1 The Daily Inspection Quota Constraint
Google Search Console limits manual "Request Indexing" submissions via the URL Inspection tool to approximately **10 to 12 URLs per property per rolling 24-hour window**. Exceeding this quota results in the blocking alert:
> *"Quota exceeded. Please try again tomorrow."*

Attempting to request indexation for all 75 Tier-1 URLs in a single day is mathematically impossible. A disciplined, staged rollout across 4 days is required.

### 1.2 "Crawled - currently not indexed" Root Cause & Resolution
- **The Problem:** Googlebot crawled SWEEPR's early deployment of ~377 programmatic guides on a fresh domain (DR 0) with zero external backlinks. Finding templated layouts without bespoke engineering depth or external entity validation, Google's quality algorithms placed the majority into "Crawled - currently not indexed".
- **The Remedy:**
  1. **Footprint Pruning:** ~302 zero-impression guides are flagged with `noindex, follow` in `clean-items.json` and excluded from `sitemap.xml`.
  2. **Entity Authority Inflow:** Official distribution via `microsoft/winget-pkgs`, Chocolatey, Softpedia (DR 89), MajorGeeks (DR 81), and AlternativeTo provides authoritative entity signals.
  3. **Information Gain Upgrades:** Top 25 guides feature bespoke subfolder tables, file extensions (.csd, .nvph, .dmp), and verified engineering attribution ("Tested on Windows 11 24H2 · Verified Microsoft Authenticode Publisher: Benjamin Cook").
  4. **Hierarchical Re-Indexing:** Submitting the site's primary PageRank distributors (Homepage, Pricing, Switchers, Hubs) first allows internal link equity to cascade downward to the flagship guides.

---

## 2. Phase 0: Pre-Flight Technical Verification Gate

**Prerequisite:** Complete all technical checks before submitting a single URL in GSC.

- [ ] **Check 0.1: Sitemap Footprint Verified (~75 URLs)**
  - Verify that `https://sweeprcleaner.com/sitemap.xml` returns HTTP 200 and contains strictly the ~75 Tier-1 URLs.
  - Verify zero pruned long-tail guides and zero localized routes (`/de*`, `/fr*`, `/es*`) appear in the XML.
  - Test command: `curl -sI https://sweeprcleaner.com/sitemap.xml`
- [ ] **Check 0.2: Long-Tail Guides Serve Noindex**
  - Verify that pruned guides return HTTP 200 with `<meta name="robots" content="noindex, follow">`.
  - Test URL: `https://sweeprcleaner.com/clean/app/slack-cache`
- [ ] **Check 0.3: Localized Routes Serve X-Robots-Tag**
  - Verify that `/de`, `/de/pricing`, `/fr`, `/fr/pricing`, `/es`, `/es/pricing` return header `X-Robots-Tag: noindex, follow`.
  - Test command: `curl -sI https://sweeprcleaner.com/de | grep -i x-robots-tag`
- [ ] **Check 0.4: Phantom Routes Return 301 Redirects**
  - Verify that `/month`, `/mo`, `/year`, `/yr` return HTTP 301 to `https://sweeprcleaner.com/pricing`.
  - Test command: `curl -sI https://sweeprcleaner.com/month`
- [ ] **Check 0.5: Robots.txt Configuration**
  - Verify that `https://sweeprcleaner.com/robots.txt` allows clean `/download` while disallowing `/download?` and `/download/`.
  - Verify `Sitemap: https://sweeprcleaner.com/sitemap.xml` directive is present.
- [ ] **Check 0.6: GSC Sitemap Re-Submission**
  - In GSC, navigate to **Indexing &rarr; Sitemaps**.
  - Re-submit `https://sweeprcleaner.com/sitemap.xml`.
  - Confirm status: **"Success"** with ~75 discovered URLs.

---

## 3. Phase 1: Core Commercial & Switcher Hubs (Day 1 — 6 URLs)

**Target Execution Window:** Day 1 (00:00–23:59 UTC)  
**Daily Quota Allocation:** 6 of ~10–12 URLs (Leaves 40–50% safety buffer)  
**Objective:** Index the root domain and top commercial conversion assets to establish internal PageRank flow.

### Day 1 URL Batch

| # | Target Canonical URL | Page Role | Canonical Match | Meta Robots |
|---|----------------------|-----------|-----------------|-------------|
| 1 | `https://sweeprcleaner.com/` | Root Homepage (Primary PageRank Distributor) | `https://sweeprcleaner.com/` | `index, follow` |
| 2 | `https://sweeprcleaner.com/pricing` | Commercial Pricing & Plan Selection | `https://sweeprcleaner.com/pricing` | `index, follow` |
| 3 | `https://sweeprcleaner.com/download` | Desktop Installer Hub (Noindex Discovery) | `https://sweeprcleaner.com/download` | `noindex, nofollow` |
| 4 | `https://sweeprcleaner.com/vs/ccleaner` | #1 Competitor Head-to-Head Comparison | `https://sweeprcleaner.com/vs/ccleaner` | `index, follow` |
| 5 | `https://sweeprcleaner.com/vs/cleanmymac` | High-Intent Multi-Platform Switcher | `https://sweeprcleaner.com/vs/cleanmymac` | `index, follow` |
| 6 | `https://sweeprcleaner.com/vs/bleachbit` | Open-Source Power-User Comparison | `https://sweeprcleaner.com/vs/bleachbit` | `index, follow` |

### Operator Step-by-Step Execution Protocol:
1. Open Google Search Console for `https://sweeprcleaner.com`.
2. Paste the target URL into the top search bar ("Inspect any URL in 'sweeprcleaner.com'").
3. Click **"Test Live URL"** (top right button).
4. Verify the Live Test drawer:
   - **URL is available to Google** (HTTP 200).
   - **User-declared canonical** matches **Google-selected canonical**.
   - For `/download`, verify detected robots tag is `noindex, nofollow` (confirming transition out of indexable pool).
5. Click **"Request Indexing"**.
6. Wait for the confirmation modal: *"Indexing requested"*.
7. Repeat for URLs 1 through 6.
8. Log execution timestamp in Section 8 Tracking Table.

---

## 4. Phase 2: Technical Hubs & Empirical Benchmark (Day 2 — 4 URLs)

**Target Execution Window:** Day 2 (T+24h)  
**Daily Quota Allocation:** 4 of ~10–12 URLs  
**Objective:** Index high-E-E-A-T research hubs, interactive tools, and master guide directory.

### Day 2 URL Batch

| # | Target Canonical URL | Page Role | Canonical Match | Meta Robots |
|---|----------------------|-----------|-----------------|-------------|
| 7 | `https://sweeprcleaner.com/clean` | Master 75-Guide pSEO Directory Index | `https://sweeprcleaner.com/clean` | `index, follow` |
| 8 | `https://sweeprcleaner.com/tools` | Transactional Cleaner Utilities Hub | `https://sweeprcleaner.com/tools` | `index, follow` |
| 9 | `https://sweeprcleaner.com/state-of-windows-storage` | 377-Path Empirical Research Study | `https://sweeprcleaner.com/state-of-windows-storage` | `index, follow` |
| 10 | `https://sweeprcleaner.com/safe-to-delete` | Interactive Instant Path Safety Checker | `https://sweeprcleaner.com/safe-to-delete` | `index, follow` |

### Operator Step-by-Step Execution Protocol:
1. Inspect each URL in GSC URL Inspection tool.
2. Run **"Test Live URL"**. Verify structured data:
   - For `/state-of-windows-storage`: Confirm valid `Dataset` and `Report` JSON-LD schema.
   - For `/safe-to-delete`: Confirm valid `WebApplication` schema.
3. Click **"Request Indexing"**.
4. Log execution timestamp in Section 8 Tracking Table.

---

## 5. Phase 3: Flagship High-Volume Clean Guides (Day 3 — 5 URLs)

**Target Execution Window:** Day 3 (T+48h)  
**Daily Quota Allocation:** 5 of ~10–12 URLs  
**Objective:** Index top 5 highest-volume Windows, Gaming, and Hardware search demand guides.

### Day 3 URL Batch

| # | Target Canonical URL | Target Search Demand | Verified Attribution | SubLocations Depth |
|---|----------------------|----------------------|----------------------|-------------------|
| 11 | `https://sweeprcleaner.com/clean/app/steam-depotcache` | High PC Gaming Storage Sinks | Benjamin Cook (SSL.com) | `.csd`, `.csm` manifests |
| 12 | `https://sweeprcleaner.com/clean/folder/winsxs` | #1 Windows System Space Sinks | Benjamin Cook (SSL.com) | DISM Component Store |
| 13 | `https://sweeprcleaner.com/clean/app/nvidia-dxcache` | GPU Stutter & Shader Bloat | Benjamin Cook (SSL.com) | `.nvph`, `.toc` tables |
| 14 | `https://sweeprcleaner.com/clean/folder/windows-old` | Windows 11 Post-Upgrade Waste | Benjamin Cook (SSL.com) | Rollback vs safe purge |
| 15 | `https://sweeprcleaner.com/clean/folder/hiberfil-sys` | NVMe Hibernation / Fast Startup | Benjamin Cook (SSL.com) | `powercfg /h off` safety |

### Operator Step-by-Step Execution Protocol:
1. Inspect each guide in GSC URL Inspection tool.
2. Run **"Test Live URL"**.
3. Verify:
   - Engineering attribution block rendered ("Tested on Windows 11 24H2 · Verified Microsoft Authenticode Publisher: Benjamin Cook").
   - Verified `Organization` `sameAs` structured data linking GitHub and Winget.
   - Title tag front-loads disk space payoff in first 48 characters.
4. Click **"Request Indexing"**.
5. Log execution timestamp in Section 8 Tracking Table.

---

## 6. Phase 3B: Secondary High-Volume Clean Guides (Days 4–5 — 8 URLs)

**Target Execution Window:** Days 4 & 5 (T+72h and T+96h)  
**Daily Quota Allocation:** 4 URLs on Day 4, 4 URLs on Day 5  
**Objective:** Index secondary high-intent gaming, dev, and browser cache guides.

### Day 4 Batch (4 URLs):
- [ ] `https://sweeprcleaner.com/clean/app/amd-shader-cache` (AMD Radeon DirectX/Vulkan shader cache)
- [ ] `https://sweeprcleaner.com/clean/app/discord-cache` (Discord Chromium cache & video previews)
- [ ] `https://sweeprcleaner.com/clean/app/spotify-cache` (Spotify offline storage cache)
- [ ] `https://sweeprcleaner.com/clean/app/riot-client-logs` (Valorant / League crash dumps & logs)

### Day 5 Batch (4 URLs):
- [ ] `https://sweeprcleaner.com/clean/app/genshin-impact-update-cache` (HoYoverse update chunks)
- [ ] `https://sweeprcleaner.com/clean/app/medal-tv-cache` (Medal.tv video clip cache)
- [ ] `https://sweeprcleaner.com/clean/app/stremio-desktop-cache` (Stremio streaming torrent chunks)
- [ ] `https://sweeprcleaner.com/clean/app/docker-desktop-ext4-disk` (Docker ext4.vhdx unreleased space)

---

## 7. Phase 4: Verification, Site Queries, & GSC Page Indexing Transition Tracking

### 7.1 Cadence Schedule
- **T+24 Hours:** Spot-check Day 1 URLs via live inspection.
- **T+72 Hours (Day 3):** First site search verification (`site:sweeprcleaner.com/vs/`).
- **T+7 Days (Week 1):** Full GSC Page Indexing Report reconciliation.
- **T+14 Days (Week 2):** Crawled status audit and secondary guide expansion.
- **T+28 Days (Month 1):** Comprehensive CRM SEO Changelog sync and baseline rank check.

### 7.2 Diagnostic Google Search Queries

```text
# Check overall index size (target: ~60–75 indexed URLs)
site:sweeprcleaner.com

# Check commercial competitor switcher pages
site:sweeprcleaner.com/vs/

# Check alternatives pages
site:sweeprcleaner.com/alternatives/

# Check clean guides indexation
site:sweeprcleaner.com/clean/

# Verify legacy 404 paths are completely absent from Google index
site:sweeprcleaner.com inurl:month OR inurl:year
```

### 7.3 GSC "Page Indexing" Bucket Transition Targets

| GSC Indexing Bucket | Baseline (Pre-Rollout) | Target (T+14 Days) | Target (T+28 Days) | Action if Off-Target |
|---------------------|------------------------|--------------------|--------------------|----------------------|
| **Crawled - currently not indexed** | ~320+ URLs | < 50 URLs | < 10 URLs | Check live URL test for duplicate canonical or low content signals. |
| **Excluded by ‘noindex’ tag** | ~10 URLs | ~250 URLs | ~315 URLs | Normal and healthy. Confirms Googlebot recognized pruned guides. |
| **Not found (404)** | ~5–10 URLs | 0 URLs | 0 URLs | Verify 301 redirects in `server/src/app.ts:851-854` are active. |
| **Indexed** | ~15–20 URLs | ~45–55 URLs | ~70–75 URLs | Continue internal link building and Winget distribution. |

---

## 8. Master Execution & Tracking Table

| URL | Phase | Target Date | Inspected By | HTTP Status | Google Canonical Match | Request Indexing Clicked | GSC Status (T+7d) |
|---|---|---|---|---|---|---|---|
| `https://sweeprcleaner.com/` | Phase 1 | Day 1 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/pricing` | Phase 1 | Day 1 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/download` | Phase 1 | Day 1 | Operator | 200 OK (noindex) | Match | [ ] | Excluded (noindex) |
| `https://sweeprcleaner.com/vs/ccleaner` | Phase 1 | Day 1 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/vs/cleanmymac` | Phase 1 | Day 1 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/vs/bleachbit` | Phase 1 | Day 1 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/clean` | Phase 2 | Day 2 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/tools` | Phase 2 | Day 2 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/state-of-windows-storage` | Phase 2 | Day 2 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/safe-to-delete` | Phase 2 | Day 2 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/clean/app/steam-depotcache` | Phase 3 | Day 3 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/clean/folder/winsxs` | Phase 3 | Day 3 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/clean/app/nvidia-dxcache` | Phase 3 | Day 3 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/clean/folder/windows-old` | Phase 3 | Day 3 | Operator | 200 OK | Match | [ ] | Pending |
| `https://sweeprcleaner.com/clean/folder/hiberfil-sys` | Phase 3 | Day 3 | Operator | 200 OK | Match | [ ] | Pending |

---

## 9. Operator Troubleshooting & Edge-Case Playbook

### Scenario A: "Quota exceeded. Please try again tomorrow."
- **Cause:** More than 10–12 URLs were submitted in a rolling 24-hour period.
- **Remedy:** Stop immediately. Do not click repeatedly (this can lengthen the throttle window). Note the exact URL where the quota triggered and resume at that URL after 24 hours.

### Scenario B: "Google-selected canonical is different from user-declared canonical"
- **Cause:** Google considers a different page to be the canonical source (e.g. root homepage or an alternative URL).
- **Remedy:** Inspect internal linking anchors. Ensure all internal links point to the exact canonical URL (no trailing slash, strict HTTPS). Verify `<link rel="canonical">` tag in `<head>` is identical.

### Scenario C: "URL is unknown to Google"
- **Cause:** Google has never discovered the URL via crawling or sitemaps.
- **Remedy:** Expected for newly created URLs. Click **"Request Indexing"** to place it into the discovery queue. Verify the URL is present in `server/public/sitemap.xml`.

### Scenario D: "Discovered - currently not indexed"
- **Cause:** Google knows the URL exists but has postponed crawling due to crawl budget constraints.
- **Remedy:** Trigger a manual inspection and live test. This bumps the priority from standard discovery crawl to active crawl queue.

---

## 10. CRM SEO Changelog Integration

Upon completing each phase, record the action in the CRM SEO Changelog (`server/src/seo/store.ts` and `sweepr_crm`):

```bash
# Example API Log Call:
curl -X POST http://localhost:8787/api/crm/seo/changelog \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic YWRtaW46cGFzc3dvcmQ=" \
  -d '{
    "project_id": "cleaner",
    "category": "gsc_indexing",
    "title": "GSC Staged Re-Indexing Phase 1 Executed",
    "description": "Submitted 6 core commercial and switcher hubs (/ , /pricing, /download, /vs/ccleaner, /vs/cleanmymac, /vs/bleachbit) via GSC URL Inspection.",
    "affected_urls": ["/", "/pricing", "/download", "/vs/ccleaner", "/vs/cleanmymac", "/vs/bleachbit"],
    "metrics_baseline": "Crawled - currently not indexed: 324 URLs",
    "status": "in_progress"
  }'
```
