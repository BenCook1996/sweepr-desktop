import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
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

function buildPseoTitle(item: CleanItem): string {
  const withoutParens = item.name.replace(/\s*\([^)]*\)/g, "").trim();
  const concise = withoutParens.length > 24 ? withoutParens.split("&")[0].trim() : withoutParens;
  const candidate = `How to Clean ${concise} Safely | SWEEPR Cleaner`;
  if (candidate.length >= 50 && candidate.length <= 60) return candidate;
  if (candidate.length < 50) {
    const withYear = `How to Clean ${concise} Safely (2026) | SWEEPR`;
    if (withYear.length <= 60) return withYear;
  }
  return candidate.slice(0, 60).trim();
}

function buildPseoDescription(item: CleanItem): string {
  const withoutParens = item.name.replace(/\s*\([^)]*\)/g, "").trim();
  const base = `Step-by-step guide to cleaning ${withoutParens} to reclaim ${item.avgSpace}. Learn whether it is safe to delete and how to clean it safely in 1 click.`;
  if (base.length <= 158) return base;
  const shorter = `How to clean ${withoutParens} and reclaim ${item.avgSpace} safely. Verified Windows cleanup guide with manual steps and 1-click automatic cleaning.`;
  return shorter.slice(0, 158).trim();
}

export function renderPseoDirectory(): string {
  const appItems = cleanItems.filter((i) => i.category === "app");
  const folderItems = cleanItems.filter((i) => i.category === "folder");

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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="color-scheme" content="light">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Windows Cache &amp; Storage Cleanup Directory | SWEEPR Cleaner</title>
  <meta name="description" content="Wondering what is filling up your hard drive? Browse verified guides to safely cleaning hidden Windows folders, app caches, and temp files in minutes.">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
  <link rel="canonical" href="https://sweeprcleaner.com/clean">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preconnect" href="https://cdn.tailwindcss.com">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="SWEEPR Cleaner">
  <meta property="og:locale" content="en_GB">
  <meta property="og:url" content="https://sweeprcleaner.com/clean">
  <meta property="og:title" content="Windows Cache &amp; Storage Cleanup Directory | SWEEPR Cleaner">
  <meta property="og:description" content="Verified guides to safely cleaning hidden Windows folders, app caches, and temporary files.">
  <meta property="og:image" content="https://sweeprcleaner.com/og-image.png">
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
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/png" href="/favicon.png" media="(prefers-color-scheme: light)">
  <link rel="icon" type="image/png" href="/favicon-dark.png" media="(prefers-color-scheme: dark)">
  <link rel="shortcut icon" href="/favicon.ico">
  <script src="https://cdn.tailwindcss.com/3.4.5"></script>
  <script src="/attribution.js"></script>
  <script src="/analytics.js" defer></script>
  <link rel="stylesheet" href="/style.css">
</head>
<body class="bg-[#fafafa] text-gray-800">
  <nav class="glass-nav px-4 md:px-6 py-4 flex items-center justify-between sticky top-0 z-50">
    <a href="/" class="flex items-center gap-3 text-inherit no-underline">
      <div class="logo-box">S</div>
      <span class="font-extrabold text-xl tracking-tight text-gray-900">SWEEPR <span class="text-emerald-600">Cleaner</span></span>
    </a>
    <div class="flex gap-3 items-center">
      <div class="relative inline-block text-left" id="langDropdownContainer">
        <button type="button" id="langDropdownBtn" class="btn btn-ghost text-sm flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer font-medium text-gray-700 hover:text-emerald-600 transition-colors" aria-expanded="false" aria-label="Select Language">
          <span class="text-base" id="currentLangFlag">🌐</span>
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
            <button type="button" onclick="setLanguage('it')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇮🇹</span> <span>Italiano</span></span><span class="text-[10px] text-gray-400 font-mono">IT</span></button>
            <button type="button" onclick="setLanguage('pt')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇵🇹</span> <span>Português</span></span><span class="text-[10px] text-gray-400 font-mono">PT</span></button>
            <button type="button" onclick="setLanguage('nl')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇳🇱</span> <span>Nederlands</span></span><span class="text-[10px] text-gray-400 font-mono">NL</span></button>
            <button type="button" onclick="setLanguage('ja')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇯🇵</span> <span>日本語</span></span><span class="text-[10px] text-gray-400 font-mono">JA</span></button>
          </div>
        </div>
      </div>
      <a href="/pricing" class="btn btn-ghost text-sm">Pricing</a>
      <a href="/download" class="btn btn-go text-sm">Get SWEEPR Cleaner</a>
    </div>
  </nav>

  <main class="max-w-5xl mx-auto px-6 py-12">
    <div class="text-center mb-12">
      <h1 class="text-3xl md:text-5xl font-black text-gray-900 mb-4">Windows Storage & Cache Directory</h1>
      <p class="text-gray-600 text-lg max-w-2xl mx-auto">
        Wondering what is filling up your hard drive? Click any app or Windows folder below to see what it does, whether it is safe to delete, and how much space you can get back.
      </p>
    </div>

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
        SWEEPR Cleaner checks all 40+ hidden folders at once and safely frees up your storage in one click—no manual steps required.
      </p>
      <a href="/download" class="btn btn-go btn-big">Download Free Scan</a>
    </div>
  </main>
  <div id="google_translate_element" style="display:none !important;"></div>
  <script src="/i18n.js"></script>
  <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" async defer></script>
</body>
</html>`;
}

export function renderPseoPage(item: CleanItem): string {
  const stepsList = item.manualSteps.map((s, idx) => `
    <li class="flex gap-3 text-gray-700">
      <span class="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center mt-0.5">${idx + 1}</span>
      <span>${s}</span>
    </li>
  `).join("");

  const pageTitle = buildPseoTitle(item);
  const pageDesc = buildPseoDescription(item);
  const canonicalUrl = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;

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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preconnect" href="https://cdn.tailwindcss.com">
  
  <!-- Open Graph -->
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="SWEEPR Cleaner">
  <meta property="og:locale" content="en_GB">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${pageTitle}">
  <meta property="og:description" content="Reclaim ${item.avgSpace} from ${item.name}. Detailed safety guide and manual steps.">
  <meta property="og:image" content="https://sweeprcleaner.com/og-image.png">
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
        mainEntity: [
          {
            "@type": "Question",
            name: `Is it safe to delete ${item.name}?`,
            acceptedAnswer: {
              "@type": "Answer",
              text: item.warning || item.whatHappens,
            },
          },
        ],
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

  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/png" href="/favicon.png" media="(prefers-color-scheme: light)">
  <link rel="icon" type="image/png" href="/favicon-dark.png" media="(prefers-color-scheme: dark)">
  <link rel="shortcut icon" href="/favicon.ico">
  <script src="https://cdn.tailwindcss.com/3.4.5"></script>
  <script src="/attribution.js"></script>
  <script src="/analytics.js" defer></script>
  <link rel="stylesheet" href="/style.css">
</head>
<body class="bg-[#fafafa] text-gray-800">
  <nav class="glass-nav px-4 md:px-6 py-4 flex items-center justify-between sticky top-0 z-50">
    <div class="flex items-center gap-4">
      <a href="/" class="flex items-center gap-3 text-inherit no-underline">
        <div class="logo-box">S</div>
        <span class="font-extrabold text-xl tracking-tight text-gray-900">SWEEPR <span class="text-emerald-600">Cleaner</span></span>
      </a>
      <a href="/clean" class="text-xs font-semibold text-gray-500 hover:text-gray-900">Directory &rarr;</a>
    </div>
    <div class="flex gap-3 items-center">
      <div class="relative inline-block text-left" id="langDropdownContainer">
        <button type="button" id="langDropdownBtn" class="btn btn-ghost text-sm flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer font-medium text-gray-700 hover:text-emerald-600 transition-colors" aria-expanded="false" aria-label="Select Language">
          <span class="text-base" id="currentLangFlag">🌐</span>
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
            <button type="button" onclick="setLanguage('it')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇮🇹</span> <span>Italiano</span></span><span class="text-[10px] text-gray-400 font-mono">IT</span></button>
            <button type="button" onclick="setLanguage('pt')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇵🇹</span> <span>Português</span></span><span class="text-[10px] text-gray-400 font-mono">PT</span></button>
            <button type="button" onclick="setLanguage('nl')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇳🇱</span> <span>Nederlands</span></span><span class="text-[10px] text-gray-400 font-mono">NL</span></button>
            <button type="button" onclick="setLanguage('ja')" class="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-emerald-50 text-gray-800 hover:text-emerald-700 transition-colors font-medium cursor-pointer"><span class="flex items-center gap-2"><span>🇯🇵</span> <span>日本語</span></span><span class="text-[10px] text-gray-400 font-mono">JA</span></button>
          </div>
        </div>
      </div>
      <a href="/pricing" class="btn btn-ghost text-sm">Pricing</a>
      <a href="/download" class="btn btn-go text-sm">Get SWEEPR Cleaner</a>
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
    </div>

    <!-- Manual Steps -->
    <div class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm mb-8">
      <h2 class="text-xl font-bold text-gray-900 mb-4">Manual Cleaning Instructions</h2>
      <ol class="space-y-4 mb-6">
        ${stepsList}
      </ol>
    </div>

    <!-- Automated 1-Click Callout -->
    <div class="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-2xl p-8 text-center shadow-lg">
      <h3 class="text-2xl font-bold mb-2">Clean ${item.name} Automatically</h3>
      <p class="text-gray-300 text-sm max-w-lg mx-auto mb-6">
        SWEEPR Cleaner safely clears ${item.name} along with 40+ other hidden app folders and leftover files in one click—with a 7-day undo safety net.
      </p>
      <div class="flex flex-col sm:flex-row justify-center gap-4">
        <a href="/download" class="btn btn-go gap-2">
          <span>Download Free Scan</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
        </a>
        <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="btn bg-white/10 hover:bg-white/20 text-white text-sm">
          Get Pro Now
        </a>
      </div>
    </div>
  </main>
  <div id="google_translate_element" style="display:none !important;"></div>
  <script src="/i18n.js"></script>
  <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" async defer></script>
</body>
</html>`;
}
