import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLEAN_ITEMS_FILE = join(__dirname, "data", "clean-items.json");
const cleanItemsData = require("./data/clean-items.json");

export interface CleanItem {
  slug: string;
  category: "app" | "folder";
  name: string;
  path: string;
  safeToDelete: boolean;
  warning?: string;
  avgSpace: string;
  whatIsIt: string;
  whatHappens: string;
  manualSteps: string[];
}

export const cleanItems: CleanItem[] = cleanItemsData as CleanItem[];
let lastMtimeMs = 0;
const cleanItemsMap = new Map<string, CleanItem>();
let cachedDirectoryHtml: string | null = null;
let cachedDirectoryMtime = 0;

function rebuildCleanItemsMap() {
  cleanItemsMap.clear();
  for (const item of cleanItems) {
    cleanItemsMap.set(`${item.category}:${item.slug}`, item);
  }
}
rebuildCleanItemsMap();

export function getCleanItemBySlug(category: string, slug: string): CleanItem | undefined {
  getCleanItems();
  return cleanItemsMap.get(`${category}:${slug}`);
}

export function getCleanItems(): CleanItem[] {
  try {
    const st = statSync(CLEAN_ITEMS_FILE);
    if (st.mtimeMs > lastMtimeMs) {
      const fresh = JSON.parse(readFileSync(CLEAN_ITEMS_FILE, "utf8")) as CleanItem[];
      if (Array.isArray(fresh) && fresh.length > 0) {
        cleanItems.splice(0, cleanItems.length, ...fresh);
        rebuildCleanItemsMap();
        cachedDirectoryHtml = null;
        lastMtimeMs = st.mtimeMs;
      }
    }
  } catch {
    /* keep existing in-memory array */
  }
  return cleanItems;
}

const CUSTOM_GSC_TITLES: Record<string, string> = {
  "steam-depotcache": "Steam depotcache Folder: Safe to Delete? | SWEEPR Cleaner",
  "programdata-package-cache": "ProgramData Package Cache: Safe to Delete? (2026) | SWEEPR",
  "riot-client-logs": "Clear VALORANT & Riot Client Cache Safely (2026) | SWEEPR",
  "logitech-ghub-installer-cache": "LGHUB Cache & Depots: Safe to Delete? (2026) | SWEEPR",
  "windows-livekernelreports": "C:\\Windows\\LiveKernelReports: Safe to Delete? | SWEEPR",
  "opera-gx-service-worker-cachestorage": "How to Clear Opera GX Cache & Bloat Safely (2026) | SWEEPR",
  "medal-tv-media-blob-storage": "How to Clear Medal TV Cache (Keep Clips Safe) | SWEEPR",
  "capcut-pc-service-worker-cachestorage": "How to Clear CapCut PC Cache Safely (2026) | SWEEPR",
  "winsxs": "Windows WinSxS Folder Cleanup: Safe to Delete? | SWEEPR",
  "adobe-creative-cloud-service-worker-cachestorage": "Adobe Creative Cloud Cache: Safe to Delete? (2026) | SWEEPR",
  "adobe-creative-cloud-media-blob-storage": "Clear Adobe Creative Cloud Media Cache Safely | SWEEPR",
  "adobe-creative-cloud-crashpad-dump-logs": "Delete Adobe Creative Cloud Crashpad Logs Safely | SWEEPR",
};

const CUSTOM_GSC_DESCRIPTIONS: Record<string, string> = {
  "steam-depotcache":
    "Yes, Steam depotcache is 100% safe to delete when no updates are paused. Reclaim 2–20 GB in C:\\Program Files (x86)\\Steam\\depotcache manually or in 1 click.",
  "programdata-package-cache":
    "Can you delete C:\\ProgramData\\Package Cache? Learn which orphaned Visual C++ & MSI caches are safe to remove to free 3–18 GB without breaking uninstallers.",
  "riot-client-logs":
    "How to clear VALORANT & Riot Client cache safely on Windows 10/11. Reclaim 1–6.5 GB from %LocalAppData%\\VALORANT\\Saved\\Logs while keeping all settings safe.",
  "logitech-ghub-installer-cache":
    "Is C:\\ProgramData\\LGHUB\\depots safe to delete? Clear 1–6 GB of Logitech G HUB installer cache and crash dumps while keeping your mouse DPI & macros intact.",
  "windows-livekernelreports":
    "Is C:\\Windows\\LiveKernelReports safe to delete? Yes—reclaim 1–8 GB by removing old WATCHDOG GPU crash dump (.dmp) files on Windows 10/11 safely in 1 click.",
  "opera-gx-service-worker-cachestorage":
    "How to clear Opera GX Service Worker CacheStorage on Windows 10/11. Safely delete 1.5–8.5 GB of offline browser blobs while keeping tabs and logins intact.",
  "medal-tv-media-blob-storage":
    "How to clear Medal.tv cache without losing clips. Safely delete 2–12 GB from %AppData%\\Medal\\Cache & IndexedDB blob storage on Windows 10 and Windows 11.",
  "capcut-pc-service-worker-cachestorage":
    "How to clear CapCut PC cache on Windows 10/11 without losing video drafts. Safely remove 1.5–8.5 GB of Service Worker CacheStorage and render scratch blobs.",
  "winsxs":
    "Can you delete C:\\Windows\\WinSxS? Learn how to safely clean the Windows Side-by-Side Component Store using DISM or SWEEPR Cleaner to reclaim 6–18 GB.",
};

const VARIANT_SUFFIX_RE =
  /-(service-worker-cachestorage|media-blob-storage|code-bytecode-cache|gpu-shader-cache|crashpad-dump-logs|installer-cache|shader-cache|webcache|logs|cache|temp)$/;

export function getAppFamilyKey(slug: string): string {
  return slug.replace(VARIANT_SUFFIX_RE, "");
}

export function describeCacheVariantRole(slug: string): string {
  if (slug.endsWith("-service-worker-cachestorage")) return "Offline Web App & PWA Service Worker Blobs";
  if (slug.endsWith("-media-blob-storage")) return "IndexedDB & Streaming Media Blob Cache";
  if (slug.endsWith("-code-bytecode-cache")) return "Compiled V8 JavaScript / WASM Bytecode";
  if (slug.endsWith("-gpu-shader-cache")) return "DirectX 12 / Vulkan / Dawn GPU Shaders";
  if (slug.endsWith("-crashpad-dump-logs")) return "Crashpad Minidump (.dmp) & Error Telemetry";
  if (slug.endsWith("-installer-cache")) return "Downloaded Update Depots & Patch Staging";
  if (slug.endsWith("-webcache")) return "Embedded Chromium (CEF) Browser Cache";
  if (slug.endsWith("-logs")) return "Session Diagnostic & Match Event Logs";
  return "Primary Application & System Storage Cache";
}

export function getSiblingAndRelatedItems(item: CleanItem): {
  siblings: CleanItem[];
  related: CleanItem[];
} {
  const all = getCleanItems();
  const familyKey = getAppFamilyKey(item.slug);
  const siblings = all.filter((i) => i.slug !== item.slug && getAppFamilyKey(i.slug) === familyKey);
  const siblingSlugs = new Set(siblings.map((s) => s.slug));
  siblingSlugs.add(item.slug);

  const sameCat = all.filter((i) => i.category === item.category);
  const myIdx = Math.max(0, sameCat.findIndex((i) => i.slug === item.slug));
  const related: CleanItem[] = [];

  for (let offset = 1; offset < sameCat.length && related.length < 6; offset++) {
    const candidate = sameCat[(myIdx + offset * 7) % sameCat.length];
    if (candidate && !siblingSlugs.has(candidate.slug)) {
      siblingSlugs.add(candidate.slug);
      related.push(candidate);
    }
  }

  return { siblings, related };
}

export function buildPseoTitle(item: CleanItem): string {
  const custom = CUSTOM_GSC_TITLES[item.slug];
  if (custom && custom.length >= 50 && custom.length <= 60) {
    return custom;
  }

  const cleanName = item.name
    .replace(/TechSmith Snagit Screen Capture/g, "Snagit Capture")
    .replace(/Roblox Engine & Player/g, "Roblox Player")
    .replace(/RetroArch Multi-System Emulator/g, "RetroArch")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const candidates: string[] = [cleanName];
  if (cleanName.includes("&")) {
    const parts = cleanName.split("&").map((s) => s.trim());
    if (parts[0] && parts[0].length >= 10) candidates.push(parts[0]);
  }
  if (cleanName.includes("Service Worker CacheStorage")) {
    candidates.push(cleanName.replace("Service Worker CacheStorage", "Service Worker Cache"));
    const swPart = cleanName.split("&")[0].replace("Service Worker CacheStorage", "Service Worker Cache").trim();
    if (swPart.length >= 10) candidates.push(swPart);
    candidates.push(cleanName.replace(/Service Worker CacheStorage & Offline Blobs/g, "Service Worker Cache"));
  }
  if (cleanName.includes("Crashpad")) {
    candidates.push(cleanName.replace(/Crashpad Diagnostic Crash Dumps & Error Logs/g, "Crash Dumps"));
    candidates.push(cleanName.replace(/Crashpad Diagnostic Crash Dumps & Error Logs/g, "Crashpad Logs"));
    candidates.push(cleanName.replace(/Crashpad Reports & Diagnostic DMP Logs/g, "Crashpad Logs"));
    candidates.push(cleanName.replace(/Crashpad Reports & Diagnostic DMP Logs/g, "Crash Dumps"));
  }

  const brands = [
    " | SWEEPR Cleaner", // 17
    " (2026) | SWEEPR",  // 16
    " | SWEEPR",         // 9
  ];

  const templates = [
    (target: string, brand: string) => `How to Clean ${target} Safely${brand}`,
    (target: string, brand: string) => `How to Clean ${target} (2026)${brand}`,
    (target: string, brand: string) => `How to Clean ${target}${brand}`,
    (target: string, brand: string) => `How to Safely Delete ${target} on Windows 11${brand}`,
    (target: string, brand: string) => `How to Clean ${target} on Windows 11${brand}`,
    (target: string, brand: string) => `How to Clean ${target} Cache Safely${brand}`,
    (target: string, brand: string) => `Clean ${target} Safely${brand}`,
    (target: string, brand: string) => `Clean ${target}${brand}`,
  ];

  for (const cand of candidates) {
    for (const brand of brands) {
      for (const tmpl of templates) {
        const title = tmpl(cand, brand);
        if (title.length >= 50 && title.length <= 60) {
          return title;
        }
      }
    }
  }

  const shortTemplates = [
    `How to Clean ${cleanName} Safely on Windows 11 | SWEEPR`,
    `How to Clean ${cleanName} Safely (2026) | SWEEPR Cleaner`,
    `How to Safely Clean ${cleanName} on Windows 11 | SWEEPR`,
    `How to Clean ${cleanName} Cache Safely (2026) | SWEEPR`,
  ];
  for (const st of shortTemplates) {
    if (st.length >= 50 && st.length <= 60) return st;
  }

  const words = cleanName.split(" ");
  let target = "";
  for (const w of words) {
    if ((target + " " + w).trim().length <= 26) {
      target = (target + " " + w).trim();
    } else {
      break;
    }
  }

  const fallbacks = [
    `How to Clean ${target} Safely | SWEEPR`,
    `How to Clean ${target} (2026) | SWEEPR`,
    `How to Clean ${target} Safely | SWEEPR Cleaner`,
    `How to Clean ${target} | SWEEPR Cleaner`,
  ];
  for (const fb of fallbacks) {
    if (fb.length >= 50 && fb.length <= 60) return fb;
  }

  return `How to Clean ${target} | SWEEPR Cleaner`.slice(0, 60);
}

function buildPseoDescription(item: CleanItem): string {
  const customDesc = CUSTOM_GSC_DESCRIPTIONS[item.slug];
  if (customDesc && customDesc.length >= 70 && customDesc.length <= 160) {
    return customDesc;
  }
  const withoutParens = item.name.replace(/\s*\([^)]*\)/g, "").trim();
  const base = `Step-by-step guide to cleaning ${withoutParens} to reclaim ${item.avgSpace}. Learn whether it is safe to delete and how to clean it safely in 1 click.`;
  if (base.length <= 158) return base;
  const shorter = `How to clean ${withoutParens} and reclaim ${item.avgSpace} safely. Verified Windows cleanup guide with manual steps and 1-click automatic cleaning.`;
  return shorter.slice(0, 158).trim();
}

const FEATURED_GSC_SLUGS = [
  "steam-depotcache",
  "programdata-package-cache",
  "riot-client-logs",
  "logitech-ghub-installer-cache",
  "windows-livekernelreports",
  "opera-gx-service-worker-cachestorage",
  "medal-tv-media-blob-storage",
  "capcut-pc-service-worker-cachestorage",
  "winsxs",
];

export function renderPseoDirectory(): string {
  getCleanItems();
  try {
    const st = statSync(CLEAN_ITEMS_FILE);
    if (cachedDirectoryHtml && st.mtimeMs === cachedDirectoryMtime) {
      return cachedDirectoryHtml;
    }
    cachedDirectoryMtime = st.mtimeMs;
  } catch {
    if (cachedDirectoryHtml) return cachedDirectoryHtml;
  }
  const items = cleanItems;
  const appItems = items.filter((i) => i.category === "app");
  const folderItems = items.filter((i) => i.category === "folder");
  const featuredItems = FEATURED_GSC_SLUGS.map((s) => items.find((i) => i.slug === s)).filter(
    (i): i is CleanItem => Boolean(i)
  );

  const renderCard = (i: CleanItem) => `
    <a href="/clean/${i.category}/${i.slug}" class="block bg-white border border-gray-200 rounded-xl p-6 hover:shadow-md hover:border-emerald-400 transition-all text-inherit no-underline">
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full ${
          i.safeToDelete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
        }">
          ${i.safeToDelete ? "🟢 100% Safe to Delete" : "⚠️ Use Caution"}
        </span>
        <span class="text-xs font-bold text-gray-500">Reclaim ${i.avgSpace}</span>
      </div>
      <h3 class="text-lg font-bold text-gray-900 mb-2">${i.name}</h3>
      <p class="text-xs text-gray-500 font-mono mb-3 truncate bg-gray-50 p-1.5 rounded">${i.path}</p>
      <p class="text-sm text-gray-600 line-clamp-2">${i.whatIsIt}</p>
    </a>
  `;

  const htmlResult = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="color-scheme" content="light">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Windows Cache &amp; Storage Cleanup Directory | SWEEPR Cleaner</title>
  <meta name="description" content="Wondering what is filling up your hard drive? Browse verified guides to safely cleaning hidden Windows folders, app caches, and temp files in minutes.">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <link rel="canonical" href="https://sweeprcleaner.com/clean">
  <link rel="preconnect" href="https://cdn.tailwindcss.com">
  <link rel="dns-prefetch" href="https://translate.google.com">
  <link rel="dns-prefetch" href="https://translate.googleapis.com">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="SWEEPR Cleaner">
  <meta property="og:locale" content="en_GB">
  <meta property="og:url" content="https://sweeprcleaner.com/clean">
  <meta property="og:title" content="Windows Cache &amp; Storage Cleanup Directory | SWEEPR Cleaner">
  <meta property="og:description" content="Verified guides to safely cleaning hidden Windows folders, app caches, and temporary files.">
  <meta property="og:image" content="https://sweeprcleaner.com/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="SWEEPR Cleaner Windows Storage &amp; Cache Directory">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="https://sweeprcleaner.com/clean">
  <meta name="twitter:title" content="Windows Cache &amp; Storage Cleanup Directory | SWEEPR Cleaner">
  <meta name="twitter:description" content="Browse verified guides to cleaning hidden Windows folders, app caches, and temporary files safely.">
  <meta name="twitter:image" content="https://sweeprcleaner.com/og-image.png">
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": "https://sweeprcleaner.com/clean#collection",
        url: "https://sweeprcleaner.com/clean",
        name: "Windows Cache & Storage Cleanup Directory",
        description: "Verified guides to safely cleaning hidden Windows folders, app caches, and temporary files.",
      },
      {
        "@type": "ItemList",
        name: "Windows Cache & Folder Cleanup Guides",
        numberOfItems: cleanItems.length,
        itemListElement: cleanItems.map((i, idx) => ({
          "@type": "ListItem",
          position: idx + 1,
          name: i.name,
          url: `https://sweeprcleaner.com/clean/${i.category}/${i.slug}`,
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: "https://sweeprcleaner.com/",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Storage & Cache Directory",
            item: "https://sweeprcleaner.com/clean",
          },
        ],
      },
    ],
  })}</script>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b">
  <link rel="icon" type="image/png" href="/favicon.png?v=20261031b" media="(prefers-color-scheme: light)">
  <link rel="icon" type="image/png" href="/favicon-dark.png?v=20261031b" media="(prefers-color-scheme: dark)">
  <link rel="shortcut icon" href="/favicon.ico?v=20261031b">
  <script src="https://cdn.tailwindcss.com/3.4.5"></script>
  <script src="/attribution.js" defer></script>
  <script src="/analytics.js" defer></script>
  <script src="/nav.js" defer></script>
  <link rel="stylesheet" href="/style.css">
</head>
<body class="bg-[#fafafa] text-gray-800">
  <nav class="glass-nav px-4 md:px-6 py-4 flex items-center justify-between sticky top-0 z-50">
    <a href="/" class="flex items-center gap-3 text-inherit no-underline">
      <div class="logo-box">S</div>
      <span class="font-extrabold text-xl tracking-tight text-gray-900">SWEEPR <span class="text-emerald-600">Cleaner</span></span>
    </a>
    <div class="flex gap-2 md:gap-3 items-center">
      <div class="relative inline-block text-left" id="langDropdownContainer">
        <button type="button" id="langDropdownBtn" class="btn btn-ghost text-sm flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer font-medium text-gray-700 hover:text-emerald-600 transition-colors" aria-expanded="false" aria-label="Select Language">
          <span class="text-base" id="currentLangFlag">🇬🇧</span>
          <span class="text-xs font-bold tracking-wide" id="currentLangCode">EN</span>
          <svg id="langDropdownChevron" class="w-3 h-3 text-gray-400 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        <div id="langDropdownMenu" class="hidden absolute right-0 mt-2 w-44 bg-white/95 backdrop-blur-xl border border-gray-200/90 rounded-2xl shadow-xl p-1.5 z-50 transition-all">
          <div class="space-y-0.5 text-xs">
            <button type="button" onclick="setLanguage('en')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇬🇧</span> <span>English</span></span><span class="text-[10px] text-gray-400 font-mono">EN</span></button>
            <button type="button" onclick="setLanguage('de')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇩🇪</span> <span>Deutsch</span></span><span class="text-[10px] text-gray-400 font-mono">DE</span></button>
            <button type="button" onclick="setLanguage('fr')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇫🇷</span> <span>Français</span></span><span class="text-[10px] text-gray-400 font-mono">FR</span></button>
            <button type="button" onclick="setLanguage('es')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇪🇸</span> <span>Español</span></span><span class="text-[10px] text-gray-400 font-mono">ES</span></button>
          </div>
        </div>
      </div>
      <a href="/pricing" class="hidden md:inline-flex btn btn-ghost text-sm">Pricing</a>
      <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="hidden sm:inline-flex btn btn-ghost text-sm font-bold text-emerald-700">Get Pro</a>
      <a href="/download" class="hidden sm:inline-flex btn btn-go text-sm">Download Free Scan</a>
    </div>
  </nav>

  <main class="max-w-5xl mx-auto px-6 py-12">
    <div class="text-center mb-12">
      <h1 class="text-3xl md:text-5xl font-black text-gray-900 mb-4">Windows Storage &amp; Cache Directory</h1>
      <p class="text-gray-600 text-lg max-w-2xl mx-auto">
        Wondering what is filling up your hard drive? Click any app or Windows folder below to see what it does, whether it is safe to delete, and how much space you can get back.
      </p>
    </div>

    ${
      featuredItems.length > 0
        ? `
    <div class="mb-12 bg-emerald-50/70 border border-emerald-200 rounded-2xl p-6">
      <h2 class="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <span>🔥 Most Searched Windows Cache &amp; Folder Guides (2026)</span>
      </h2>
      <p class="text-xs text-gray-600 mb-4">Direct safety verdicts and 1-click cleanup instructions for the largest hidden space hogs on Windows 10 &amp; 11:</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        ${featuredItems
          .map(
            (f) => `
          <a href="/clean/${f.category}/${f.slug}" class="block bg-white border border-emerald-200/80 rounded-xl p-4 hover:shadow-md hover:border-emerald-500 transition-all text-inherit no-underline">
            <div class="flex items-center justify-between mb-1.5">
              <span class="text-[11px] font-bold ${f.safeToDelete ? "text-emerald-700" : "text-amber-700"}">${
                f.safeToDelete ? "🟢 Safe to Delete" : "⚠️ Orphaned Only"
              }</span>
              <span class="text-[11px] font-extrabold text-gray-700">${f.avgSpace}</span>
            </div>
            <div class="text-sm font-bold text-gray-900 mb-1 line-clamp-1">${f.name}</div>
            <div class="text-[11px] font-mono text-gray-500 truncate">${f.path}</div>
          </a>
        `
          )
          .join("")}
      </div>
    </div>`
        : ""
    }

    <div class="mb-12">
      <h2 class="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
        <span>📦 Popular App Leftovers &amp; Caches</span>
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        ${appItems.map(renderCard).join("")}
      </div>
    </div>

    <div class="mb-12">
      <h2 class="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
        <span>🗂️ Hidden Windows Folders</span>
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        ${folderItems.map(renderCard).join("")}
      </div>
    </div>

    <div class="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-2xl p-8 text-center mt-12">
      <h3 class="text-2xl font-bold mb-2">Want to clean all of these in 60 seconds?</h3>
      <p class="text-gray-300 text-sm max-w-lg mx-auto mb-6">
        SWEEPR Cleaner checks all 40+ hidden folders at once and safely frees up your storage in one click—covering up to 5 devices (Windows, Mac, Android &amp; iOS) with a 7-day undo safety net.
      </p>
      <div class="flex flex-col sm:flex-row justify-center gap-4 mb-5">
        <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="btn btn-go btn-big">
          Activate Pro Now (5 Devices) &rarr;
        </a>
        <a href="/download" class="btn bg-white/10 hover:bg-white/20 text-white text-sm px-6 py-3">
          Download Free Windows / Mac Scan
        </a>
      </div>
      <div class="max-w-lg mx-auto bg-white/5 border border-white/10 rounded-xl p-3 text-left text-xs text-gray-300">
        <strong class="text-emerald-400">🛡️ Windows 10/11 First-Launch Tip:</strong> Because v0.1.0 is a freshly compiled native Rust binary, if Windows SmartScreen appears on first launch:
        <strong>1. Click "More info"</strong> &rarr; <strong>2. Click "Run anyway"</strong>.
      </div>
    </div>
  </main>
  <div id="google_translate_element" style="display:none !important;"></div>
  <script src="/i18n.js" defer></script>
  <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" async defer></script>
</body>
</html>`;
  cachedDirectoryHtml = htmlResult;
  return htmlResult;
}

export function renderPseoPage(item: CleanItem): string {
  const stepsList = item.manualSteps
    .map(
      (s, idx) => `
    <li class="flex gap-3 text-gray-700">
      <span class="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center mt-0.5">${idx + 1}</span>
      <span>${s}</span>
    </li>
  `
    )
    .join("");

  const pageTitle = buildPseoTitle(item);
  const pageDesc = buildPseoDescription(item);
  const canonicalUrl = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
  const { siblings, related } = getSiblingAndRelatedItems(item);

  const faqItems = [
    {
      q: `Is it safe to delete ${item.name}?`,
      a: item.warning
        ? `Exercise caution: ${item.warning}`
        : `Yes, 100% safe. ${item.whatHappens} It cleans only temporary cache files, compiled scratch buffers, or stale update artifacts without modifying your personal documents.`,
    },
    {
      q: `How much storage space will cleaning ${item.name} free up?`,
      a: `Users typically reclaim between ${item.avgSpace} on Windows 10 and Windows 11 systems. On high-churn systems with frequent updates or heavy usage, savings can be significantly higher.`,
    },
    {
      q: `Will deleting this cache remove my personal accounts, saved games, or logins?`,
      a: item.safeToDelete
        ? `No. Personal documents, desktop shortcuts, account credentials, and game saves are stored in dedicated profile directories and remain completely untouched.`
        : item.warning ||
          `Personal files remain safe, but be sure to follow the manual instructions closely or use SWEEPR Cleaner's verified safe cleaning rules.`,
    },
    {
      q: `Where is ${item.name} located on Windows?`,
      a: `It is stored at ${item.path}. Windows marks many of these directories as hidden system folders by default, requiring hidden files to be visible in File Explorer to inspect manually.`,
    },
  ];

  const siblingTableSection =
    siblings.length > 0
      ? `
    <!-- Sibling App-Cache Comparison Table -->
    <div class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm mb-8">
      <h2 class="text-lg font-bold text-gray-900 mb-2">All Companion Cache &amp; Log Folders for This App</h2>
      <p class="text-xs text-gray-600 mb-4">
        Modern Windows applications split their disk footprint across multiple sub-cache directories. Compare how <strong>${item.name}</strong> differs from its companion caches below:
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-gray-200">
              <th class="py-2.5 pr-3 font-bold text-gray-700">Cache Variant &amp; Guide</th>
              <th class="py-2.5 pr-3 font-bold text-gray-700">Storage Role</th>
              <th class="py-2.5 pr-3 font-bold text-gray-700">Avg Space</th>
              <th class="py-2.5 font-bold text-gray-700">Safety</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 text-gray-600">
            <tr class="bg-emerald-50/50">
              <td class="py-2.5 pr-3 font-semibold text-gray-900">
                ${item.name} <span class="ml-1 text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">Current</span>
                <div class="font-mono text-[11px] text-gray-500 truncate max-w-xs">${item.path}</div>
              </td>
              <td class="py-2.5 pr-3">${describeCacheVariantRole(item.slug)}</td>
              <td class="py-2.5 pr-3 font-semibold text-gray-800 whitespace-nowrap">${item.avgSpace}</td>
              <td class="py-2.5 whitespace-nowrap">${item.safeToDelete ? "🟢 100% Safe" : "⚠️ Caution"}</td>
            </tr>
            ${siblings
              .map(
                (s) => `
            <tr>
              <td class="py-2.5 pr-3">
                <a href="/clean/${s.category}/${s.slug}" class="font-bold text-emerald-700 hover:underline">${s.name}</a>
                <div class="font-mono text-[11px] text-gray-400 truncate max-w-xs">${s.path}</div>
              </td>
              <td class="py-2.5 pr-3">${describeCacheVariantRole(s.slug)}</td>
              <td class="py-2.5 pr-3 font-semibold text-gray-800 whitespace-nowrap">${s.avgSpace}</td>
              <td class="py-2.5 whitespace-nowrap">${s.safeToDelete ? "🟢 100% Safe" : "⚠️ Caution"}</td>
            </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>`
      : "";

  const relatedSection =
    related.length > 0
      ? `
    <!-- Related Windows Cleanup Guides -->
    <div class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm mb-8">
      <h2 class="text-lg font-bold text-gray-900 mb-3">Related Windows Cleanup Guides &amp; Hidden Space Hogs</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${related
          .map(
            (r) => `
          <a href="/clean/${r.category}/${r.slug}" class="block p-3.5 rounded-xl border border-gray-200 hover:border-emerald-400 hover:shadow-sm transition-all text-inherit no-underline">
            <div class="flex items-center justify-between text-[11px] mb-1">
              <span class="font-bold ${r.safeToDelete ? "text-emerald-700" : "text-amber-700"}">${
                r.safeToDelete ? "🟢 Safe to Delete" : "⚠️ Caution"
              }</span>
              <span class="font-semibold text-gray-500">Reclaim ${r.avgSpace}</span>
            </div>
            <div class="text-xs font-bold text-gray-900 mb-1 line-clamp-1">${r.name}</div>
            <div class="text-[11px] font-mono text-gray-400 truncate">${r.path}</div>
          </a>
        `
          )
          .join("")}
      </div>
    </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="color-scheme" content="light">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${pageDesc}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="preconnect" href="https://cdn.tailwindcss.com">
  <link rel="dns-prefetch" href="https://translate.google.com">
  <link rel="dns-prefetch" href="https://translate.googleapis.com">
  
  <!-- Open Graph -->
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="SWEEPR Cleaner">
  <meta property="og:locale" content="en_GB">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="Reclaim ${item.avgSpace} from ${item.name}. Detailed safety guide and manual steps.">
  <meta property="og:image" content="https://sweeprcleaner.com/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="How to clean ${item.name} safely">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${canonicalUrl}">
  <meta name="twitter:title" content="${pageTitle}">
  <meta name="twitter:description" content="${pageDesc}">
  <meta name="twitter:image" content="https://sweeprcleaner.com/og-image.png">

  <!-- Schema Markup -->
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "HowTo",
        name: `How to Clean ${item.name} Safely`,
        description: `Step-by-step instructions to reclaim ${item.avgSpace} by cleaning ${item.name}.`,
        step: item.manualSteps.map((s, idx) => ({
          "@type": "HowToStep",
          position: idx + 1,
          text: s,
        })),
      },
      {
        "@type": "FAQPage",
        mainEntity: faqItems.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: f.a,
          },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Home",
            item: "https://sweeprcleaner.com/",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Storage & Cache Directory",
            item: "https://sweeprcleaner.com/clean",
          },
          {
            "@type": "ListItem",
            position: 3,
            name: item.name,
            item: canonicalUrl,
          },
        ],
      },
    ],
  })}</script>

  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b">
  <link rel="icon" type="image/png" href="/favicon.png?v=20261031b" media="(prefers-color-scheme: light)">
  <link rel="icon" type="image/png" href="/favicon-dark.png?v=20261031b" media="(prefers-color-scheme: dark)">
  <link rel="shortcut icon" href="/favicon.ico?v=20261031b">
  <script src="https://cdn.tailwindcss.com/3.4.5"></script>
  <script src="/attribution.js" defer></script>
  <script src="/analytics.js" defer></script>
  <script src="/nav.js" defer></script>
  <link rel="stylesheet" href="/style.css">
</head>
<body class="bg-[#fafafa] text-gray-800">
  <nav class="glass-nav px-4 md:px-6 py-4 flex items-center justify-between sticky top-0 z-50">
    <div class="flex items-center gap-3 md:gap-4">
      <a href="/" class="flex items-center gap-3 text-inherit no-underline">
        <div class="logo-box">S</div>
        <span class="font-extrabold text-xl tracking-tight text-gray-900">SWEEPR <span class="text-emerald-600">Cleaner</span></span>
      </a>
      <a href="/clean" class="hidden sm:inline-block text-xs font-semibold text-gray-500 hover:text-gray-900">Directory &rarr;</a>
    </div>
    <div class="flex gap-2 md:gap-3 items-center">
      <div class="relative inline-block text-left" id="langDropdownContainer">
        <button type="button" id="langDropdownBtn" class="btn btn-ghost text-sm flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer font-medium text-gray-700 hover:text-emerald-600 transition-colors" aria-expanded="false" aria-label="Select Language">
          <span class="text-base" id="currentLangFlag">🇬🇧</span>
          <span class="text-xs font-bold tracking-wide" id="currentLangCode">EN</span>
          <svg id="langDropdownChevron" class="w-3 h-3 text-gray-400 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        <div id="langDropdownMenu" class="hidden absolute right-0 mt-2 w-44 bg-white/95 backdrop-blur-xl border border-gray-200/90 rounded-2xl shadow-xl p-1.5 z-50 transition-all">
          <div class="space-y-0.5 text-xs">
            <button type="button" onclick="setLanguage('en')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇬🇧</span> <span>English</span></span><span class="text-[10px] text-gray-400 font-mono">EN</span></button>
            <button type="button" onclick="setLanguage('de')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇩🇪</span> <span>Deutsch</span></span><span class="text-[10px] text-gray-400 font-mono">DE</span></button>
            <button type="button" onclick="setLanguage('fr')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇫🇷</span> <span>Français</span></span><span class="text-[10px] text-gray-400 font-mono">FR</span></button>
            <button type="button" onclick="setLanguage('es')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇪🇸</span> <span>Español</span></span><span class="text-[10px] text-gray-400 font-mono">ES</span></button>
          </div>
        </div>
      </div>
      <a href="/pricing" class="hidden md:inline-flex btn btn-ghost text-sm">Pricing</a>
      <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="hidden sm:inline-flex btn btn-ghost text-sm font-bold text-emerald-700">Get Pro</a>
      <a href="/download" class="hidden sm:inline-flex btn btn-go text-sm">Get SWEEPR Cleaner</a>
    </div>
  </nav>

  <main class="max-w-3xl mx-auto px-6 py-12">
    <div class="mb-8">
      <a href="/clean" class="text-xs font-bold text-emerald-600 uppercase tracking-wider hover:underline">&larr; Back to Clean Directory</a>
      <h1 class="text-3xl md:text-4xl font-black text-gray-900 mt-2 mb-3">How to Clean ${item.name}</h1>
      <div class="flex flex-wrap gap-3 items-center text-sm">
        <span class="px-3 py-1 rounded-full font-bold text-xs ${
          item.safeToDelete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
        }">
          ${item.safeToDelete ? "🟢 100% Safe to Delete" : "⚠️ Exercise Caution"}
        </span>
        <span class="text-gray-500">Typical Space Reclaimed: <strong>${item.avgSpace}</strong></span>
      </div>
    </div>

    <!-- Quick Verdict Box (GEO / AI Snippet Optimized) -->
    <div class="bg-white border-2 border-emerald-500/30 rounded-2xl p-6 shadow-sm mb-8">
      <h2 class="text-lg font-bold text-gray-900 mb-2">Location &amp; Quick Verdict</h2>
      <p class="font-mono text-xs bg-gray-100 p-2.5 rounded-lg text-gray-800 break-all mb-4">
        ${item.path}
      </p>
      <p class="text-gray-700 text-sm leading-relaxed mb-4">
        ${item.whatIsIt}
      </p>
      ${
        item.warning
          ? `<div class="bg-red-50 border-l-4 border-red-500 p-3 text-red-800 text-xs mb-4"><strong>Warning:</strong> ${item.warning}</div>`
          : `<div class="bg-emerald-50 border-l-4 border-emerald-500 p-3 text-emerald-800 text-xs mb-4"><strong>Safety confirmation:</strong> ${item.whatHappens}</div>`
      }
      <div class="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
        <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="btn btn-go text-xs py-2 px-4">
          Activate 1-Click Pro Cleaner (5 Devices) &rarr;
        </a>
        <a href="/download" class="text-xs font-bold text-emerald-700 hover:underline">
          Or Download Free Diagnostic Scan (.exe / .dmg / .apk)
        </a>
      </div>
    </div>

    <!-- Technical Architecture & Cache Mechanics -->
    <div class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm mb-8">
      <h2 class="text-xl font-bold text-gray-900 mb-3">Why Does This Storage Cache Balloon Over Time?</h2>
      <p class="text-gray-600 text-sm leading-relaxed mb-4">
        On modern Windows 10 and Windows 11 systems, modern desktop applications, GPU graphics drivers, and system update components continuously generate temporary compilation artifacts, pre-rendered frame caches, and diagnostic logs to accelerate repeat operations. However, most software lacks an automated background pruning routine. As applications update or configurations change, superseded files remain orphaned on disk indefinitely.
      </p>
      <p class="text-gray-600 text-sm leading-relaxed mb-4">
        When drive capacity exceeds 80% utilization, Solid State Drives (SSDs and NVMe drives) experience increased write amplification, slower random I/O throughput, and elevated wear. Safely purging ${item.name} restores essential drive headroom, accelerates File Explorer search indexing, and frees up <strong>${item.avgSpace}</strong> of disk capacity.
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 pt-6 border-t border-gray-100 text-xs">
        <div class="p-4 rounded-xl bg-gray-50 border border-gray-100">
          <span class="font-bold text-gray-900 block mb-1">🛡️ What Stays 100% Protected</span>
          <span class="text-gray-600">Personal files, documents, saved game progress, browser bookmarks, and application licenses are stored in separate directories and are never touched.</span>
        </div>
        <div class="p-4 rounded-xl bg-gray-50 border border-gray-100">
          <span class="font-bold text-gray-900 block mb-1">⚡ What Gets Safely Removed</span>
          <span class="text-gray-600">Stale compilation bytecode, old error minidumps, downloaded patch staging files, and orphaned thumbnail indexes.</span>
        </div>
      </div>
    </div>

    <!-- Manual Steps -->
    <div class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm mb-8">
      <h2 class="text-xl font-bold text-gray-900 mb-4">Manual Cleaning Instructions</h2>
      <ol class="space-y-4 mb-6">
        ${stepsList}
      </ol>
      <p class="text-xs text-gray-500 italic mt-4 pt-4 border-t border-gray-100">
        Note: If Windows alerts that a file is in use or locked by a background process, close the associated task in Task Manager before deleting, or use SWEEPR Cleaner to release locked handles safely.
      </p>
    </div>

    ${siblingTableSection}

    <!-- Frequently Asked Questions -->
    <div class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm mb-8">
      <h2 class="text-xl font-bold text-gray-900 mb-4">Frequently Asked Questions</h2>
      <div class="space-y-4">
        ${faqItems
          .map(
            (f) => `
          <div class="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
            <h3 class="text-sm font-bold text-gray-900 mb-1.5">${f.q}</h3>
            <p class="text-xs text-gray-600 leading-relaxed">${f.a}</p>
          </div>
        `
          )
          .join("")}
      </div>
    </div>

    <!-- Comparison Table: Manual vs Automated -->
    <div class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm mb-8">
      <h2 class="text-lg font-bold text-gray-900 mb-4">Manual File Explorer vs. 1-Click SWEEPR Cleanup</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-gray-200">
              <th class="py-2.5 font-bold text-gray-700">Feature</th>
              <th class="py-2.5 font-bold text-gray-500">Manual Deletion</th>
              <th class="py-2.5 font-bold text-emerald-700">SWEEPR Cleaner</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 text-gray-600">
            <tr>
              <td class="py-2 font-medium text-gray-800">Locked File Handling</td>
              <td class="py-2 text-red-600">Fails on locked processes</td>
              <td class="py-2 text-emerald-700 font-semibold">Safe background release</td>
            </tr>
            <tr>
              <td class="py-2 font-medium text-gray-800">Accidental Deletion Risk</td>
              <td class="py-2 text-amber-600">Moderate (easy to delete wrong folder)</td>
              <td class="py-2 text-emerald-700 font-semibold">Zero (strict rules &amp; hashes)</td>
            </tr>
            <tr>
              <td class="py-2 font-medium text-gray-800">Safety Undo Rollback</td>
              <td class="py-2 text-gray-400">None (Shift+Del is permanent)</td>
              <td class="py-2 text-emerald-700 font-semibold">7-Day Automatic Rollback</td>
            </tr>
            <tr>
              <td class="py-2 font-medium text-gray-800">Time Required</td>
              <td class="py-2">10–20 minutes per app</td>
              <td class="py-2 text-emerald-700 font-semibold">&lt; 60 seconds across 40+ areas</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    ${relatedSection}

    <!-- Automated 1-Click Callout -->
    <div class="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-2xl p-8 text-center shadow-lg">
      <h3 class="text-2xl font-bold mb-2">Clean ${item.name} Automatically</h3>
      <p class="text-gray-300 text-sm max-w-lg mx-auto mb-6">
        SWEEPR Cleaner safely clears ${item.name} along with 40+ other hidden app folders and leftover files in one click—covering up to 5 devices (Windows, Mac, Android &amp; iOS) with a 7-day undo safety net.
      </p>
      <div class="flex flex-col sm:flex-row justify-center gap-4 mb-5">
        <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="btn btn-go gap-2">
          <span>Activate Pro Now (5 Devices)</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
        </a>
        <a href="/download" class="btn bg-white/10 hover:bg-white/20 text-white text-sm">
          Download Free Scan (.exe / .dmg)
        </a>
      </div>
      <div class="max-w-lg mx-auto bg-white/5 border border-white/10 rounded-xl p-3 text-left text-xs text-gray-300">
        <strong class="text-emerald-400">🛡️ Windows 10/11 First-Launch Walkthrough:</strong> Because v0.1.0 is a freshly compiled 5 MB native Rust app, if Windows SmartScreen appears:
        <strong>Step 1: Click "More info"</strong> &rarr; <strong>Step 2: Click "Run anyway"</strong>.
      </div>
    </div>
  </main>
  <div id="google_translate_element" style="display:none !important;"></div>
  <script src="/i18n.js" defer></script>
  <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" async defer></script>
</body>
</html>`;
}
