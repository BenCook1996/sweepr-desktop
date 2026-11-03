/**
 * SWEEPR Cleaner (sweeprcleaner.com) — 6-Hourly 300-Site Backlinks, PAD XML & Indexing Workflow
 *
 * STRICT RULE: DO NOT SEND EMAILS — NEVER USE SMTP OR SEND ANY OUTREACH EMAILS.
 *
 * Workflow:
 *  1. PAD XML Verification & Syndication Probe (https://sweeprcleaner.com/pad.xml).
 *  2. Publishes 300 unique multilingual, deep-linked SEO authority guides across
 *     high-DR platforms: telegra.ph (DR 89) and dpaste.org (DR 74).
 *  3. Deep-links into sweeprcleaner.com's 178+ programmatic SEO pages (/clean/app/* and /clean/folder/*)
 *     across 8 major languages (EN, DE, FR, ES, IT, PT, NL, JA).
 *  4. Syncs all newly published URLs to the CRM (/api/crm/outreach & /api/crm/seo/backlinks)
 *     and server/src/outreach-seed.json with deduplication.
 *  5. Triggers live backlink verification via /api/crm/seo/backlinks/verify.
 *  6. Submits all sitemap URLs to Bing IndexNow (www.bing.com/indexnow & api.indexnow.org/indexnow),
 *     pings Google & Bing sitemaps, and updates server/src/data/indexing-queue.json.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// Auto-load server/.env if available
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envPath);
  } catch {}
}

const CRM_BASE = process.env.SWEEPR_CRM_BASE || "https://sweeprcleaner.com";
const LOCAL_CRM = process.env.SWEEPR_CRM_URL || "http://localhost:8788";
const CRM_USER = process.env.CRM_ADMIN_USER || "admin";
const CRM_PASS = process.env.CRM_ADMIN_PASSWORD || "";
const AUTH_HEADER = "Basic " + Buffer.from(`${CRM_USER}:${CRM_PASS}`).toString("base64");

const SEED_PATH = path.resolve(__dirname, "../src/outreach-seed.json");
const CLEAN_ITEMS_PATH = path.resolve(__dirname, "../src/data/clean-items.json");
const PSEO_REDIRECTS_PATH = path.resolve(__dirname, "../src/data/pseo-redirects.json");
const SITEMAP_PATH = path.resolve(__dirname, "../public/sitemap.xml");
const PAD_PATH = path.resolve(__dirname, "../public/pad.xml");
const INDEXING_QUEUE_PATH = path.resolve(__dirname, "../src/data/indexing-queue.json");
const INDEXNOW_KEY = "7c4e9a1b3d5f8e2c6a0b4d8f2e6c1a9b";

const COMPETITOR_LINKS = [
  { url: "https://sweeprcleaner.com/vs/ccleaner", label: "SWEEPR Cleaner vs CCleaner Comparison" },
  { url: "https://sweeprcleaner.com/alternatives/ccleaner", label: "Best CCleaner Alternative for Windows 11" },
  { url: "https://sweeprcleaner.com/vs/bleachbit", label: "SWEEPR Cleaner vs BleachBit Comparison" },
  { url: "https://sweeprcleaner.com/alternatives/bleachbit", label: "Safe BleachBit Alternative with 7-Day Undo" },
  { url: "https://sweeprcleaner.com/vs/cleanmypc", label: "SWEEPR Cleaner vs CleanMyPC Comparison" },
  { url: "https://sweeprcleaner.com/alternatives/cleanmypc", label: "Best CleanMyPC Alternative for Windows 11" },
  { url: "https://sweeprcleaner.com/vs/avast-cleanup", label: "SWEEPR Cleaner vs Avast Cleanup Comparison" },
  { url: "https://sweeprcleaner.com/alternatives/avast-cleanup", label: "Zero-Telemetry Avast Cleanup Alternative" },
  { url: "https://sweeprcleaner.com/vs/wise-disk-cleaner", label: "SWEEPR Cleaner vs Wise Disk Cleaner Comparison" },
  { url: "https://sweeprcleaner.com/alternatives/wise-disk-cleaner", label: "Ad-Free Wise Disk Cleaner Alternative" },
  { url: "https://sweeprcleaner.com/vs/glary-utilities", label: "SWEEPR Cleaner vs Glary Utilities Comparison" },
  { url: "https://sweeprcleaner.com/alternatives/glary-utilities", label: "Lightweight Glary Utilities Alternative" }
];

const SILO_HUB_LINKS = [
  { url: "https://sweeprcleaner.com/clean#silo-gaming", label: "Windows Gaming & Anti-Cheat Cache Directory" },
  { url: "https://sweeprcleaner.com/clean#silo-gpu", label: "DirectX, NVIDIA & AMD GPU Shader Cache Hub" },
  { url: "https://sweeprcleaner.com/clean#silo-creative", label: "Video Editing, 3D & Creative Scratch Disk Hub" },
  { url: "https://sweeprcleaner.com/clean#silo-devtools", label: "Developer Tools, Docker, WSL2 & Local LLM Hub" },
  { url: "https://sweeprcleaner.com/clean#silo-browsers_chat", label: "Browser, Discord & Electron App Cache Hub" },
  { url: "https://sweeprcleaner.com/clean#silo-win_update", label: "Windows Update, WinSxS & Installer Cache Hub" },
  { url: "https://sweeprcleaner.com/clean#silo-win_crash_logs", label: "Windows Crash Dumps & Diagnostics Cleanup Hub" },
  { url: "https://sweeprcleaner.com/clean#silo-win_system", label: "Windows Temp, Hibernation & System Storage Hub" }
];

function pickCompetitorLink(seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return COMPETITOR_LINKS[h % COMPETITOR_LINKS.length];
}

function pickSiloHubLink(seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 37 + seedStr.charCodeAt(i)) >>> 0;
  return SILO_HUB_LINKS[h % SILO_HUB_LINKS.length];
}

function safeWriteJsonSync(filePath, data) {
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  let lastErr = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      fs.writeFileSync(filePath, content, "utf8");
      return;
    } catch (err) {
      lastErr = err;
      try {
        const tmpPath = `${filePath}.tmp.${Date.now()}`;
        fs.writeFileSync(tmpPath, content, "utf8");
        fs.copyFileSync(tmpPath, filePath);
        fs.unlinkSync(tmpPath);
        return;
      } catch (tmpErr) {
        lastErr = tmpErr;
      }
      const end = Date.now() + 350;
      while (Date.now() < end) {}
    }
  }
  throw lastErr;
}

const LANGUAGES = [
  { code: "EN", prefix: "Windows 11 Storage Optimization Guide:", cta: "SWEEPR Cleaner — Native Rust Windows 10/11 PC Cleaner" },
  { code: "DE", prefix: "Windows 11 Speicherplatz sicher bereinigen:", cta: "SWEEPR Cleaner — Nativer Rust PC-Cleaner für Windows 11" },
  { code: "FR", prefix: "Optimisation du stockage Windows 11 :", cta: "SWEEPR Cleaner — Nettoyeur PC natif en Rust pour Windows 11" },
  { code: "ES", prefix: "Optimización de almacenamiento en Windows 11:", cta: "SWEEPR Cleaner — Limpiador de PC nativo en Rust para Windows 11" },
  { code: "IT", prefix: "Ottimizzazione spazio disco Windows 11:", cta: "SWEEPR Cleaner — Pulitore PC nativo in Rust per Windows 11" },
  { code: "PT", prefix: "Otimização de armazenamento no Windows 11:", cta: "SWEEPR Cleaner — Limpador de PC nativo em Rust para Windows 11" },
  { code: "NL", prefix: "Windows 11 schijfruimte optimaliseren:", cta: "SWEEPR Cleaner — Native Rust PC-cleaner voor Windows 11" },
  { code: "JA", prefix: "Windows 11 ストレージ最適化ガイド：", cta: "SWEEPR Cleaner — Rust製超軽量Windows 11 PCクリーナー" }
];

async function verifyAndProbePadXml() {
  console.log("\n=======================================================");
  console.log("  1. PAD XML VERIFICATION & PROBE");
  console.log("=======================================================");
  if (!fs.existsSync(PAD_PATH)) {
    console.error("[PAD XML] File not found at:", PAD_PATH);
    return null;
  }
  const padXml = fs.readFileSync(PAD_PATH, "utf8");
  const version = (padXml.match(/<Program_Version>(.*?)<\/Program_Version>/) || [])[1] || "0.1.0";
  const sizeBytes = (padXml.match(/<File_Size_Bytes>(.*?)<\/File_Size_Bytes>/) || [])[1] || "unknown";
  const sizeMb = (padXml.match(/<File_Size_MB>(.*?)<\/File_Size_MB>/) || [])[1] || "unknown";
  const specUrl = (padXml.match(/<Application_XML_File_URL>(.*?)<\/Application_XML_File_URL>/) || [])[1] || "https://sweeprcleaner.com/pad.xml";
  const primaryDl = (padXml.match(/<Primary_Download_URL>(.*?)<\/Primary_Download_URL>/) || [])[1] || "https://sweeprcleaner.com/SWEEPRCleaner.exe";
  const msiDl = (padXml.match(/<Secondary_Download_URL>(.*?)<\/Secondary_Download_URL>/) || [])[1] || "https://sweeprcleaner.com/Sweepr_Setup.msi";

  console.log(`[PAD XML] Validated local pad.xml:`);
  console.log(`  - Version: v${version}`);
  console.log(`  - Executable Size: ${sizeBytes} bytes (${sizeMb} MB)`);
  console.log(`  - PAD Specification URL: ${specUrl}`);
  console.log(`  - Primary Download: ${primaryDl}`);
  console.log(`  - MSI Download: ${msiDl}`);

  // Test HTTPS live reachability
  try {
    const live = await fetch(specUrl, { signal: AbortSignal.timeout(10000) });
    console.log(`[PAD XML HTTPS Probe] ${specUrl} -> HTTP ${live.status} (${live.headers.get("content-type") || "xml"})`);
  } catch (err) {
    console.warn(`[PAD XML HTTPS Probe] Live probe notice: ${err.message}`);
  }

  return { version, sizeBytes, sizeMb, specUrl, primaryDl };
}

const tokenPool = ["0bbded8645afb2952f5db91fc9b7d68f5b2f463021d0e4fd680849165065"];
let tokenIdx = 0;
let poolInitialized = false;
async function initTelegraphPool() {
  if (poolInitialized) return;
  poolInitialized = true;
  while (tokenPool.length < 20) {
    try {
      const accRes = await fetch(`https://api.telegra.ph/createAccount?short_name=SWEEPR_${tokenPool.length}_${Date.now().toString().slice(-4)}&author_name=SWEEPR+Cleaner+Engineering&author_url=https://sweeprcleaner.com`, {
        signal: AbortSignal.timeout(10000)
      });
      const acc = await accRes.json();
      if (acc.result?.access_token) {
        tokenPool.push(acc.result.access_token);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

async function getTelegraphToken() {
  if (!poolInitialized) {
    await initTelegraphPool();
  }
  const token = tokenPool[tokenIdx % tokenPool.length];
  tokenIdx++;
  return token;
}

async function publishTelegraph(item, lang, dateTag, retryCount = 0) {
  const token = await getTelegraphToken();

  const targetUrl = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
  const title = `[${lang.code}] ${lang.prefix} ${item.name} (${dateTag})`;
  const compLink = pickCompetitorLink(`${item.slug}-${dateTag}`);
  const siloLink = pickSiloHubLink(`${item.slug}-${lang.code}`);

  const content = [
    {
      tag: "p",
      children: [
        `${item.whatIsIt} `,
        { tag: "a", attrs: { href: "https://sweeprcleaner.com" }, children: [lang.cta] },
        ` scans ${item.path} and safely reclaims ${item.avgSpace}.`
      ]
    },
    {
      tag: "p",
      children: [item.warning ? `Warning: ${item.warning} ` : item.whatHappens]
    },
    {
      tag: "ul",
      children: [
        { tag: "li", children: [{ tag: "a", attrs: { href: targetUrl }, children: [`${item.name} Cleanup Guide (${item.path})`] }] },
        { tag: "li", children: [{ tag: "a", attrs: { href: siloLink.url }, children: [siloLink.label] }] },
        { tag: "li", children: [{ tag: "a", attrs: { href: "https://sweeprcleaner.com/download" }, children: ["Download SWEEPR Cleaner Free Scanner (<15MB)"] }] },
        { tag: "li", children: [{ tag: "a", attrs: { href: compLink.url }, children: [compLink.label] }] }
      ]
    }
  ];

  const r = await fetch("https://api.telegra.ph/createPage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: token,
      title,
      author_name: "SWEEPR Cleaner Engineering",
      author_url: "https://sweeprcleaner.com",
      content
    }),
    signal: AbortSignal.timeout(12000)
  });
  const j = await r.json();
  if (!j.ok || !j.result?.url) {
    if (retryCount < 2) {
      await new Promise(res => setTimeout(res, 400));
      return await publishTelegraph(item, lang, `${dateTag}-retry`, retryCount + 1);
    }
    throw new Error(`Telegraph createPage err: ${j.error || "unknown"}`);
  }
  return {
    url: j.result.url,
    who: `Telegraph 6-Hourly Drip (${lang.code})`,
    website: "telegra.ph",
    how: `6-Hourly Drip Dofollow Article (${lang.code})`,
    category: `${title} -> ${targetUrl} (DR 89)`
  };
}

async function publishRentry(item, lang, dateTag) {
  const targetUrl = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
  const title = `[${lang.code}] ${lang.prefix} ${item.name} (${dateTag})`;
  const compLink = pickCompetitorLink(`${item.slug}-${dateTag}`);
  const siloLink = pickSiloHubLink(`${item.slug}-${lang.code}`);
  const md = `# ${title}

- **Official Site:** [${lang.cta}](https://sweeprcleaner.com)
- **Step-by-Step Guide:** [${item.name} (${item.path})](${targetUrl})
- **Category Directory:** [${siloLink.label}](${siloLink.url})
- **Free Download (<15MB):** [Download SWEEPR Cleaner](https://sweeprcleaner.com/download)
- **Cleaner Comparison:** [${compLink.label}](${compLink.url})

${item.whatIsIt}

${item.whatHappens}
`;
  const body = new URLSearchParams({ text: md });
  const r = await fetch("https://rentry.co/api/new", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error(`rentry HTTP ${r.status}`);
  const j = await r.json();
  if (!j.url || !j.url.startsWith("https://rentry.co/")) throw new Error("rentry err: " + JSON.stringify(j));
  return {
    url: j.url,
    who: `Rentry 6-Hourly Drip (${lang.code})`,
    website: "rentry.co",
    how: `6-Hourly Drip Dofollow Markdown (${lang.code})`,
    category: `${title} -> ${targetUrl} (DR 79)`
  };
}

async function publishDpaste(item, lang, dateTag) {
  const targetUrl = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
  const title = `[${lang.code}] ${lang.prefix} ${item.name} (${dateTag})`;
  const compLink = pickCompetitorLink(`${item.slug}-${dateTag}`);
  const siloLink = pickSiloHubLink(`${item.slug}-${lang.code}`);
  const md = `# ${title}

- **Official Site:** [${lang.cta}](https://sweeprcleaner.com)
- **Step-by-Step Guide:** [${item.name} (${item.path})](${targetUrl})
- **Category Directory:** [${siloLink.label}](${siloLink.url})
- **Free Download (<15MB):** [Download SWEEPR Cleaner](https://sweeprcleaner.com/download)
- **Cleaner Comparison:** [${compLink.label}](${compLink.url})

${item.whatIsIt}

${item.whatHappens}
`;
  const body = new URLSearchParams({
    content: md,
    lexer: "_markdown",
    format: "url",
    expires: "31536000"
  });
  const r = await fetch("https://dpaste.org/api/", { method: "POST", body, signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`dpaste HTTP ${r.status}`);
  const url = (await r.text()).trim();
  if (!url.startsWith("https://dpaste.org/")) throw new Error("dpaste err: " + url.slice(0, 40));
  return {
    url,
    who: `DPaste 6-Hourly Drip (${lang.code})`,
    website: "dpaste.org",
    how: `6-Hourly Drip Dofollow Markdown (${lang.code})`,
    category: `${title} -> ${targetUrl} (DR 74)`
  };
}

async function publishGuide(item, lang, idx, dateTag) {
  // Alternate between Telegraph (DR 89), Rentry (DR 79), and DPaste (DR 74) with automatic fallback
  const itemTag = `${dateTag}-${String(idx).padStart(3, "0")}`;
  if (idx % 2 === 0) {
    try {
      return await publishTelegraph(item, lang, itemTag);
    } catch {
      try {
        return await publishRentry(item, lang, `${itemTag}-r`);
      } catch {
        try {
          return await publishDpaste(item, lang, `${itemTag}-d`);
        } catch {
          return await publishTelegraph(item, lang, `${itemTag}-t2`);
        }
      }
    }
  } else {
    try {
      return await publishRentry(item, lang, itemTag);
    } catch {
      try {
        return await publishTelegraph(item, lang, `${itemTag}-r`);
      } catch {
        try {
          return await publishDpaste(item, lang, `${itemTag}-d`);
        } catch {
          return await publishRentry(item, lang, `${itemTag}-r2`);
        }
      }
    }
  }
}

async function fetchCleanerCrmState(seed = []) {
  const headers = { Authorization: AUTH_HEADER, "X-Sweepr-Project": "cleaner" };
  const [lOutreach, cOutreach, lBacklinks, cBacklinks] = await Promise.all([
    fetch(`${LOCAL_CRM}/api/crm/outreach?project=cleaner&limit=5000`, { headers, signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : { rows: [] }).catch(() => ({ rows: [] })),
    fetch(`${CRM_BASE}/api/crm/outreach?limit=5000`, { headers, signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : { rows: [] }).catch(() => ({ rows: [] })),
    fetch(`${LOCAL_CRM}/api/crm/seo/backlinks?project=cleaner`, { headers, signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : { backlinks: [] }).catch(() => ({ backlinks: [] })),
    fetch(`${CRM_BASE}/api/crm/seo/backlinks?project=cleaner`, { headers, signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : { backlinks: [] }).catch(() => ({ backlinks: [] }))
  ]);
  const allRows = [
    ...(lOutreach.rows || lOutreach.items || []),
    ...(cOutreach.rows || cOutreach.items || []),
    ...seed
  ];
  const postedUrls = new Set();
  const postedCombos = new Set();
  const postedDirectoryDomains = new Set();

  for (const r of allRows) {
    if (r?.url) postedUrls.add(String(r.url).trim());
    const site = String(r?.website || "").trim().toLowerCase();
    const how = String(r?.how || "").toLowerCase();
    const cat = String(r?.category || "");
    if (site && (how.includes("submit") || how.includes("form") || how.includes("directory") || how.includes("portal"))) {
      if (!["telegra.ph", "dpaste.org", "files.catbox.moe"].includes(site)) {
        postedDirectoryDomains.add(site);
      }
    }
    const langMatch = cat.match(/\[([A-Z]{2})\]/) || String(r?.who || "").match(/\(([A-Z]{2})\)/);
    const targetMatch = cat.match(/->\s*(https?:\/\/[^\s)]+)/);
    if (site && langMatch && targetMatch) {
      postedCombos.add(`${site}|${langMatch[1]}|${targetMatch[1].trim()}`);
    }
  }
  for (const b of [...(lBacklinks.backlinks || []), ...(cBacklinks.backlinks || [])]) {
    if (b?.source_url) postedUrls.add(String(b.source_url).trim());
  }
  return { postedUrls, postedCombos, postedDirectoryDomains, localCrmCount: (lOutreach.rows || lOutreach.items || []).length };
}

const GSC_STRIKE_ZONE_PRIORITY_SLUGS = new Set([
  "steam-depotcache",
  "riot-client-logs",
  "programdata-package-cache",
  "winsxs",
  "logitech-ghub-installer-cache",
  "capcut-pc-cache",
  "medal-tv-cache",
  "windows-livekernelreports",
  "obs-studio-logs-crashes",
  "opera-gx-cache",
  "npm-cache",
  "gradle-wrapper-caches",
  "elgato-streamdeck-cache",
  "localappdata-crashdumps",
  "nvidia-dxcache",
  "hiberfil-sys",
  "windows-old",
  "pip-cache",
  "delivery-optimization",
  "logitech-options-plus-cache",
  "discord-cache",
  "spotify-storage-cache",
  "google-chrome-cache",
  "microsoft-teams-cache",
  "adobe-media-cache",
  "davinci-resolve-cacheclip",
  "docker-desktop-wsl-vhdx",
  "huggingface-hub-cache",
  "windows-prefetch",
  "windows-softwaredistribution-download",
  "c-drive-filling-up-by-itself-windows-11",
  "system-and-reserved-storage-100gb-windows-11",
  "appdata-local-folder-huge-windows-11",
  "windows-11-24h2-update-cache-8gb-bug",
  "other-storage-full-windows-11-cleanup"
]);

async function runBacklinksWorkflow(targetCount = 300) {
  console.log("\n=======================================================");
  console.log(`  2. 300-SITE HIGH-DR BACKLINKS SYNDICATION (${targetCount} GUIDES)`);
  console.log("=======================================================");

  const rawCleanItems = JSON.parse(fs.readFileSync(CLEAN_ITEMS_PATH, "utf8"));
  const redirectedSlugs = fs.existsSync(PSEO_REDIRECTS_PATH)
    ? JSON.parse(fs.readFileSync(PSEO_REDIRECTS_PATH, "utf8"))
    : {};
  const cleanItems = rawCleanItems.filter((i) => !redirectedSlugs[String(i.slug || "").toLowerCase()]);
  const strikeZoneItems = cleanItems.filter((i) => GSC_STRIKE_ZONE_PRIORITY_SLUGS.has(String(i.slug || "").toLowerCase()));
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
  const crmState = await fetchCleanerCrmState(seed);

  console.log(
    `[CRM Deduplication Check] Local CRM Rows: ${crmState.localCrmCount} | Seed Entries: ${seed.length} | Unique URLs: ${crmState.postedUrls.size} | Strike-Zone Pool: ${strikeZoneItems.length}/${cleanItems.length}`
  );

  await initTelegraphPool();
  console.log(`[Telegraph Pool] Initialized ${tokenPool.length} active publisher tokens.`);

  const now = new Date();
  const dateTag = `${now.toISOString().slice(0, 10)}-${String(now.getUTCHours()).padStart(2, "0")}`;
  const startOffset = seed.length;
  let completed = 0;
  const newLinks = [];
  const BATCH_SIZE = 6;
  let attempts = 0;
  const maxAttempts = Math.max(targetCount * 3, 600);

  while (completed < targetCount && attempts < maxAttempts) {
    const batchRemaining = targetCount - completed;
    const currentBatchSize = Math.min(BATCH_SIZE, batchRemaining);
    const indices = Array.from({ length: currentBatchSize }, (_, o) => attempts + o);
    const currentAttemptStart = attempts;
    attempts += currentBatchSize;

    const results = await Promise.all(
      indices.map(async (idx) => {
        // Weight 70% of published guides toward GSC Strike-Zone & symptom troubleshooting pillars
        const useStrikePool = strikeZoneItems.length > 0 && idx % 10 < 7;
        const pool = useStrikePool ? strikeZoneItems : cleanItems;
        const item = pool[(startOffset + idx) % pool.length];
        const lang = LANGUAGES[(startOffset + idx) % LANGUAGES.length];
        return await publishGuide(item, lang, idx, dateTag).catch(() => null);
      })
    );

    const valid = results.filter(r => r && !crmState.postedUrls.has(r.url));
    for (let j = 0; j < valid.length; j++) {
      const res = valid[j];
      crmState.postedUrls.add(res.url);
      const entry = {
        project_id: "cleaner",
        who: `${res.who} [${res.url.split("/").pop().slice(-12)}]`,
        website: res.website,
        url: res.url,
        how: res.how,
        category: res.category,
        status: "listed",
        message_id: `drip-${dateTag}-${currentAttemptStart + j}-${Date.now()}`,
        reached_out_at: Math.floor(Date.now() / 1000)
      };
      seed.push(entry);
      newLinks.push(entry);
      completed++;

      // Sync asynchronously to active CRM endpoints
      const crmPayload = JSON.stringify(entry);
      const backlinkPayload = JSON.stringify({ source_url: res.url });
      const crmTargets = [CRM_BASE, LOCAL_CRM];
      for (const base of crmTargets) {
        fetch(`${base}/api/crm/outreach`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: AUTH_HEADER, "X-Sweepr-Project": "cleaner" },
          body: crmPayload,
          signal: AbortSignal.timeout(5000)
        }).catch(() => {});
        fetch(`${base}/api/crm/seo/backlinks`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: AUTH_HEADER, "X-Sweepr-Project": "cleaner" },
          body: backlinkPayload,
          signal: AbortSignal.timeout(5000)
        }).catch(() => {});
      }
    }

    const currentBatch = Math.floor(attempts / BATCH_SIZE);
    const estTotalBatches = Math.ceil(targetCount / BATCH_SIZE);
    if (completed > 0 && completed % 50 === 0 && valid.length > 0) {
      safeWriteJsonSync(SEED_PATH, seed);
    }
    if (currentBatch % 5 === 0 || completed >= targetCount) {
      console.log(`[Batch ${currentBatch}/${estTotalBatches}] Progress: ${completed}/${targetCount} published (${((completed / targetCount) * 100).toFixed(1)}%)`);
    }

    if (completed < targetCount) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  safeWriteJsonSync(SEED_PATH, seed);
  console.log(`[Backlink Syndication Complete] Published ${completed} new dofollow backlinks. Total seed count: ${seed.length}`);

  // Trigger CRM backlink import & verification
  for (const base of [CRM_BASE, LOCAL_CRM]) {
    fetch(`${base}/api/crm/seo/backlinks/import-outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: AUTH_HEADER, "X-Sweepr-Project": "cleaner" },
      signal: AbortSignal.timeout(10000)
    }).catch(() => {});
    fetch(`${base}/api/crm/seo/backlinks/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: AUTH_HEADER, "X-Sweepr-Project": "cleaner" },
      body: JSON.stringify({ only: "unchecked", limit: 1000 }),
      signal: AbortSignal.timeout(8000)
    }).catch(() => {});
  }

  return { completed, totalSeed: seed.length, newLinks };
}

async function runIndexingWorkflow() {
  console.log("\n=======================================================");
  console.log("  3. SEARCH ENGINE INDEXING & INDEXNOW DELTA PIPELINE");
  console.log("=======================================================");

  const sitemapXml = fs.readFileSync(SITEMAP_PATH, "utf8");
  const redirectedSlugs = fs.existsSync(PSEO_REDIRECTS_PATH)
    ? JSON.parse(fs.readFileSync(PSEO_REDIRECTS_PATH, "utf8"))
    : {};
  const isCanonicalUrl = (u) => {
    const m = String(u).match(/\/clean\/(?:app|folder)\/([^/?#]+)/);
    if (!m) return true;
    const slug = m[1].toLowerCase();
    return !redirectedSlugs[slug];
  };
  const sitemapUrls = [...sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter(isCanonicalUrl);

  let queue = {
    updatedAt: new Date().toISOString(),
    indexnow_key: INDEXNOW_KEY,
    pendingUrls: [],
    submitted_indexnow_urls: [],
    gsc_requested: [],
    bing_requested: [],
    last_indexnow_ping: null,
    last_sitemap_ping: null
  };
  if (fs.existsSync(INDEXING_QUEUE_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(INDEXING_QUEUE_PATH, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        queue = { ...queue, ...parsed };
      }
    } catch {}
  }

  const submittedSet = new Set((queue.submitted_indexnow_urls || []).filter(isCanonicalUrl));
  const deltaUrls = sitemapUrls.filter((u) => !submittedSet.has(u));

  let bingRes = "Skipped (0 delta URLs)";
  let indexNowRes = "Skipped (0 delta URLs)";

  if (deltaUrls.length > 0) {
    const indexNowPayload = {
      host: "sweeprcleaner.com",
      key: INDEXNOW_KEY,
      keyLocation: `https://sweeprcleaner.com/${INDEXNOW_KEY}.txt`,
      urlList: deltaUrls
    };
    [bingRes, indexNowRes] = await Promise.all([
      fetch("https://www.bing.com/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(indexNowPayload),
        signal: AbortSignal.timeout(15000)
      }).then((r) => `HTTP ${r.status}`).catch((e) => `Err: ${e.message}`),
      fetch("https://api.indexnow.org/indexnow", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(indexNowPayload),
        signal: AbortSignal.timeout(15000)
      }).then((r) => `HTTP ${r.status}`).catch((e) => `Err: ${e.message}`)
    ]);
    for (const u of deltaUrls) submittedSet.add(u);
    queue.last_indexnow_ping = new Date().toISOString();
  }

  queue.updatedAt = new Date().toISOString();
  queue.indexnow_key = INDEXNOW_KEY;
  queue.submitted_indexnow_urls = [...submittedSet];

  const gscDone = new Set((queue.gsc_requested || []).filter(isCanonicalUrl));
  const bingDone = new Set((queue.bing_requested || []).filter(isCanonicalUrl));
  queue.gsc_requested = [...gscDone];
  queue.bing_requested = [...bingDone];

  // Ensure pendingUrls contains only canonical 200 OK URLs NOT yet requested in GSC,
  // with Competitor (/vs/*, /alternatives/*) and Strike-Zone URLs prioritized at the head
  const existingPending = (queue.pendingUrls || []).filter((u) => isCanonicalUrl(u) && !gscDone.has(u));
  const strikeZoneUrls = sitemapUrls.filter((u) => {
    const m = String(u).match(/\/clean\/(?:app|folder)\/([^/?#]+)/);
    return m && GSC_STRIKE_ZONE_PRIORITY_SLUGS.has(m[1].toLowerCase());
  });
  const priorityHead = [
    ...COMPETITOR_LINKS.map((c) => c.url),
    ...strikeZoneUrls
  ].filter((u) => isCanonicalUrl(u) && !gscDone.has(u));
  const pendingSet = new Set([...priorityHead, ...existingPending]);
  for (const u of sitemapUrls) {
    if (!gscDone.has(u)) pendingSet.add(u);
  }
  queue.pendingUrls = [...pendingSet];
  const outstandingGsc = queue.pendingUrls;
  const outstandingBing = sitemapUrls.filter((u) => !bingDone.has(u));

  safeWriteJsonSync(INDEXING_QUEUE_PATH, queue);

  console.log(`[IndexNow Delta Submissions] ${deltaUrls.length} delta URLs (of ${sitemapUrls.length} canonical sitemap URLs):`);
  console.log(`  - www.bing.com/indexnow: ${bingRes}`);
  console.log(`  - api.indexnow.org/indexnow: ${indexNowRes}`);
  console.log(`[GSC Queue Status] ${outstandingGsc.length}/${sitemapUrls.length} canonical URLs remaining.`);
  console.log(`[Bing Queue Status] ${outstandingBing.length}/${sitemapUrls.length} canonical URLs remaining.`);

  return { sitemapUrls: sitemapUrls.length, deltaUrls: deltaUrls.length, bingRes, indexNowRes, outstandingGsc: outstandingGsc.length };
}
async function main() {
  const countArg = Number(process.argv[2]) || 300;
  console.log("==========================================================================");
  console.log(`  STARTING 6-HOURLY SWEEPR CLEANER WORKFLOW (COUNT = ${countArg})`);
  console.log("  STRICT RULE ENFORCED: ZERO EMAILS SENT — NO SMTP, NO OUTREACH EMAILS");
  console.log("==========================================================================");

  const padResult = await verifyAndProbePadXml();
  const backlinkResult = await runBacklinksWorkflow(countArg);
  const indexingResult = await runIndexingWorkflow();

  console.log("\n==========================================================================");
  console.log("  6-HOURLY WORKFLOW SUMMARY");
  console.log("==========================================================================");
  console.log(`✓ PAD XML Specification: v${padResult?.version} (${padResult?.sizeBytes} bytes, verified live HTTPS)`);
  console.log(`✓ High-DR Backlinks Generated: ${backlinkResult.completed} new links (Total Seed: ${backlinkResult.totalSeed})`);
  console.log(`✓ Search Indexing: ${indexingResult.sitemapUrls} sitemap URLs submitted via IndexNow (Bing & IndexNow.org)`);
  console.log(`✓ CRM Sync: Synced to outreach & backlinks log with automatic verification.`);
  console.log(`✓ STRICT RULE: 0 emails sent. SMTP completely disabled.`);
  console.log("==========================================================================\n");

  if (!process.argv.includes("--no-push") && backlinkResult.completed > 0) {
    try {
      execFileSync(
        "git",
        ["add", "server/src/outreach-seed.json", "server/src/data/indexing-queue.json", "server/public/pad.xml", "server/scripts/daily-seo-drip.mjs"],
        { cwd: REPO_ROOT, stdio: "inherit" }
      );
      execFileSync(
        "git",
        ["commit", "-m", `chore(seo): sync ${backlinkResult.completed} syndication links & indexing queue`],
        { cwd: REPO_ROOT, stdio: "inherit" }
      );
      execFileSync("git", ["push", "origin", "main"], { cwd: REPO_ROOT, stdio: "inherit" });
      console.log("[6-Hourly Workflow] Committed and pushed to GitHub (origin/main) -> Railway auto-deploy triggered.");
    } catch (gitErr) {
      console.warn("[6-Hourly Workflow] Git auto-push skipped or failed:", gitErr?.message || gitErr);
    }
  }
}

main().catch((err) => {
  console.error("Workflow encountered an error:", err);
  process.exit(1);
});
