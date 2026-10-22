---
name: software-launch-distribution
description: Organic online marketing, software download directory syndication (PAD XML), package manager distribution (Winget/Chocolatey), Reddit/community growth, and affiliate/referral loops for desktop utility apps. Use when building non-paid traffic channels, backlinks, and launch campaigns.
---

# Software Launch, Directory Syndication & Organic Distribution Skill

Use this skill to drive high-intent organic traffic, high-DR backlinks, and community word-of-mouth for SWEEPR Cleaner across software download portals, developer/power-user package managers, Reddit/forums, and referral channels.

Before running this skill, read `.agents/product-marketing.md`, `server/public/pad.xml`, `server/src/outreach-seed.json`, and `server/public/attribution.js`.

---

## 1. Software Download Directories & PAD XML Syndication (`/pad.xml`)
Desktop utilities enjoy a massive structural SEO and referral advantage over web SaaS: **Tier-1 Software Download Portals** (DR 75–93) actively list, review, and drive thousands of daily downloads to utility apps at **zero ad cost**.

### Active PAD Specification (`https://sweeprcleaner.com/pad.xml`)
SWEEPR hosts a standardized Portable Application Description (`pad.xml`) file. Use this to automate submissions and version updates (`v0.1.0` -> `v0.2.0`, etc.) across:
1. **Tier-1 High-Traffic Download Hubs (Direct Referral Traffic + DR 80+ Backlinks):**
   - **MajorGeeks** (`majorgeeks.com` - Drive Cleaners category; highly trusted by Windows troubleshooters)
   - **Softpedia** (`softpedia.com` - grants "100% Clean" editorial badge, great for E-E-A-T social proof on `/`)
   - **FileHorse** & **FilePuma** (`filehorse.com`, `filepuma.com` - curated popular Windows utilities)
   - **SnapFiles** & **LO4D** (`snapfiles.com`, `lo4d.com` - independent editorial testing)
   - **Uptodown** & **Malavida** (massive international Windows download volume)
   - **DACH Tech Portals:** **CHIP.de**, **Heise Download (`heise.de`)**, **ComputerBild.de**, **WinFuture.de**, **Netzwelt.de** (pairs directly with SWEEPR's German localization).
2. **Comparison & Discovery Platforms (High Switcher Intent):**
   - **AlternativeTo** (`alternativeto.net` — tag SWEEPR as an alternative to *CCleaner*, *BleachBit*, *CleanMyPC*, *Glary Utilities*, *Wise Disk Cleaner*, *Avast Cleanup*). Every upvote on AlternativeTo pushes SWEEPR higher in Google's #1 ranking page for `"CCleaner alternatives"`.
   - **SaaSHub** (`saashub.com`), **Alternative.me**, **Slant.co**, **SourceForge**, **Product Hunt**, **BetaNews**.

### Version Bump Re-Syndication Tactic
Whenever SWEEPR releases a minor version update (even adding 10 new app cache rules to the scanner), update `/pad.xml` and submit the new version to Softpedia, MajorGeeks, and FileHorse. Directory sites place **"Newly Updated Software"** back onto their homepage feed, generating a fresh wave of free downloads and crawl activity every 2–4 weeks.

---

## 2. Package Managers & Storefront Distribution (Zero-CAC Power Users)
1. **Windows Package Manager (`winget-pkgs` on GitHub):**
   - Submit a manifest for `Sweepr.SweeprCleaner` to Microsoft's official `microsoft/winget-pkgs` repository.
   - Allows any Windows 11 user, IT admin, or tech YouTuber to install via `winget install Sweepr.SweeprCleaner`, and allows `/clean/*` guides to include a 1-line terminal command that installs SWEEPR directly.
2. **Chocolatey (`community.chocolatey.org`) & Scoop:**
   - High-authority backlink + trusted discovery channel for Windows power users.
3. **Microsoft Store (Win32 `.exe`/`.msi` submission):**
   - Microsoft Store now allows unmodified Win32 installers with your own billing/commerce system for non-gaming apps. Listing SWEEPR Cleaner in the Microsoft Store provides free organic Windows Store search visibility and instant trust.

---

## 3. Reddit, YouTube & Community Seeding Playbook
Never post generic promotional links on Reddit. Use the **Value-First Technical Breakdown** format:

1. **The "Data Study / Benchmark" Post (`r/Windows11`, `r/pcmasterrace`, `r/OptimizedGaming`):**
   - *Title Idea:* `"I analyzed where 45GB of mystery 'System & Reserved' storage actually hides on a 1-year-old Windows 11 gaming PC (exact folder paths + how to clear them safely)"`
   - *Body:* Provide a genuinely useful 500-word breakdown of `NVIDIA DXCache`, `Windows\Installer` orphaned patches, `AppData\Local\Temp`, `Discord/Spotify` caches, and `DeliveryOptimization`. At the bottom, mention: *"I also built a lightweight <15MB native Rust tool (SWEEPR) that scans all 40+ of these paths automatically if you don't want to run manual scripts."*
2. **Micro-Creator / Tech YouTuber Affiliate Seeding (`?ref=`):**
   - SWEEPR's `server/public/attribution.js` natively tracks `?ref=creator_name` for **90 days** across cookies and `localStorage` and attaches `ref` directly to Stripe checkout metadata (`server/src/app.ts`).
   - Recruit small-to-mid-sized Windows optimization / FPS boost / PC building YouTubers (5k–50k views/video) and tech bloggers. Offer **40%–50% recurring commission** or a `£15` CPA bounty per Pro subscriber, plus a free Pro license key generated from `/crm` to demonstrate live on video.
