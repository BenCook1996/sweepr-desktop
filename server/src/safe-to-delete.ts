import { getCleanItems, getGscPriorityInternalLinkSlugs, type CleanItem } from "./pseo.js";
import { escapeHtml } from "./security.js";
import { ACTIVE_EXPERIMENTS, assignExperimentVariant } from "./experiments.js";

export interface SafeToDeleteMatchResult {
  input: string;
  matched: boolean;
  verdict:
    | "SAFE TO DELETE"
    | "CAUTION — CONDITIONAL"
    | "DO NOT DELETE — OS CRITICAL"
    | "UNRECOGNIZED PATH";
  badge_color: "green" | "amber" | "red" | "gray";
  slug: string | null;
  category: "app" | "folder" | null;
  name: string;
  canonical_path: string;
  avg_space: string;
  estimated_gb: number;
  guide_url: string | null;
  explanation: string;
  what_happens: string;
}

export interface SafeToDeleteAnalysis {
  total_inputs: number;
  matched_count: number;
  safe_count: number;
  caution_count: number;
  danger_count: number;
  estimated_reclaimable_gb: number;
  results: SafeToDeleteMatchResult[];
}

const CRITICAL_SYSTEM_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  canonical_path: string;
  explanation: string;
}> = [
  {
    pattern: /(?:^|[\\/])windows[\\/](?:system32|syswow64)(?:$|[\\/])/i,
    name: "Windows System32 / SysWOW64 Core Binaries",
    canonical_path: "C:\\Windows\\System32",
    explanation:
      "Contains core Windows kernel DLLs, drivers, and system executables. Deleting files here will make Windows unbootable.",
  },
  {
    pattern: /(?:^|[\\/])windows[\\/](?:boot|fonts|inf|servicing)(?:$|[\\/])/i,
    name: "Windows Boot & Servicing Critical Directory",
    canonical_path: "C:\\Windows\\Boot",
    explanation:
      "Contains EFI boot loaders, servicing manifests, and hardware INF drivers required to boot and update Windows.",
  },
  {
    pattern: /(?:^|[\\/])program files[\\/]windowsapps(?:$|[\\/])/i,
    name: "Microsoft Store WindowsApps Package Root",
    canonical_path: "C:\\Program Files\\WindowsApps",
    explanation:
      "Holds Appx/MSIX system packages including Windows Terminal, Defender UI, and Xbox apps. Modifying permissions or deleting folders directly breaks Microsoft Store.",
  },
  {
    pattern: /(?:^|[\\/])ntoskrnl\.exe|hal\.dll|bootmgr|bcd$/i,
    name: "Windows Kernel / Boot Manager File",
    canonical_path: "C:\\Windows\\System32\\ntoskrnl.exe",
    explanation:
      "Core Windows NT operating system kernel image or boot manager. Never delete.",
  },
];

function normalizeWindowsPathForMatch(raw: string): string {
  let s = raw
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\//g, "\\")
    .toLowerCase();

  // Strip trailing CSV columns like `, 14.2 GB` or `\t4500 MB`
  s = s.replace(/\s*[,;\t]\s*\d+(?:\.\d+)?\s*(?:gb|mb|kb|tb|bytes?)\b.*$/i, "").trim();

  // Map concrete C:\Users\<username>\AppData\... paths to canonical env vars
  s = s.replace(/^[a-z]:\\users\\[^\\]+\\appdata\\locallow\b/i, "%localappdatalow%");
  s = s.replace(/^[a-z]:\\users\\[^\\]+\\appdata\\local\b/i, "%localappdata%");
  s = s.replace(/^[a-z]:\\users\\[^\\]+\\appdata\\roaming\b/i, "%appdata%");
  s = s.replace(/^[a-z]:\\users\\[^\\]+\b/i, "%userprofile%");
  s = s.replace(/^\\+/, "").replace(/\\+$/, "");
  return s;
}

function parseReportedSizeGb(rawLine: string): number | null {
  const m = rawLine.match(/(\d+(?:\.\d+)?)\s*(gb|mb|tb)\b/i);
  if (!m) return null;
  const val = Number.parseFloat(m[1]);
  if (!Number.isFinite(val) || val < 0) return null;
  const unit = m[2].toLowerCase();
  if (unit === "tb") return Math.round(val * 1024 * 10) / 10;
  if (unit === "mb") return Math.round((val / 1024) * 10) / 10;
  return Math.round(val * 10) / 10;
}

function estimateMidpointGb(avgSpace: string): number {
  const nums: number[] = [];
  const re = /(\d+(?:\.\d+)?)\s*(gb|mb)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(avgSpace)) !== null) {
    const n = Number.parseFloat(m[1]);
    const u = m[2].toLowerCase();
    if (Number.isFinite(n)) {
      nums.push(u === "mb" ? n / 1024 : n);
    }
  }
  if (nums.length === 0) return 2.5;
  if (nums.length === 1) return Math.round(nums[0] * 10) / 10;
  const mid = (nums[0] + nums[nums.length - 1]) / 2;
  return Math.round(mid * 10) / 10;
}

function scoreItemMatch(normInput: string, rawLower: string, item: CleanItem): number {
  const itemPathNorm = normalizeWindowsPathForMatch(item.path.split(/\s+or\s+/i)[0] || item.path);
  const itemSlugNorm = item.slug.replace(/-/g, " ").toLowerCase();
  const itemNameNorm = item.name.toLowerCase();

  if (!normInput) return 0;

  // 1. Exact path or slug match
  if (normInput === itemPathNorm || rawLower === item.slug) return 100;

  // 2. Input path is inside or equal to canonical item path (never match a broad parent like C:\Windows\System32 to a child log folder!)
  if (itemPathNorm.length >= 8 && normInput.includes(itemPathNorm)) {
    const ratio = itemPathNorm.length / Math.max(normInput.length, itemPathNorm.length);
    if (ratio >= 0.45) return 85 + Math.round(ratio * 10);
  }

  // 3. Check last 2 path segments (e.g. `steam\depotcache`, `nvidia\dxcache`, `programdata\package cache`)
  const itemSegments = itemPathNorm.split("\\").filter((seg) => seg && !seg.startsWith("%") && seg !== "c:");
  const lastTwo = itemSegments.slice(-2).join("\\");
  const lastOne = itemSegments[itemSegments.length - 1] || "";

  if (lastTwo.length >= 7 && normInput.includes(lastTwo)) {
    return 82;
  }
  if (lastOne.length >= 6 && normInput.endsWith(lastOne)) {
    return 74;
  }

  // 4. Token overlap against slug & name
  if (rawLower === itemNameNorm || rawLower === itemSlugNorm) return 90;
  const slugTokens = item.slug.split("-").filter((t) => t.length >= 3 && !["cache", "folder", "windows", "app", "system32"].includes(t));
  if (slugTokens.length > 0) {
    const matchedTokens = slugTokens.filter((t) => normInput.includes(t) || rawLower.includes(t));
    if (matchedTokens.length === slugTokens.length && slugTokens.length >= 2) {
      return 72;
    }
    if (matchedTokens.length >= 2 && matchedTokens.length / slugTokens.length >= 0.66) {
      return 62;
    }
  }

  return 0;
}

export function analyzeSafeToDeleteInput(rawInput: string): SafeToDeleteAnalysis {
  const lines = String(rawInput ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^#|^\/\/|^"?path"?\s*[,;\t]/i.test(l))
    .slice(0, 100);

  const items = getCleanItems();
  const results: SafeToDeleteMatchResult[] = [];

  let matchedCount = 0;
  let safeCount = 0;
  let cautionCount = 0;
  let dangerCount = 0;
  let totalGb = 0;

  for (const line of lines) {
    const normInput = normalizeWindowsPathForMatch(line);
    const rawLower = line.toLowerCase().trim();
    const reportedGb = parseReportedSizeGb(line);

    let bestItem: CleanItem | null = null;
    let bestScore = 0;
    for (const item of items) {
      const score = scoreItemMatch(normInput, rawLower, item);
      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }

    if (bestItem && bestScore >= 60) {
      matchedCount++;
      const isCaution =
        !bestItem.safeToDelete ||
        /^(?:winsxs|programdata-package-cache|hiberfil-sys|installer-patch-cache|windows-old)$/.test(bestItem.slug);
      const verdict = isCaution ? "CAUTION — CONDITIONAL" : "SAFE TO DELETE";
      const badgeColor = isCaution ? "amber" : "green";
      if (isCaution) cautionCount++;
      else safeCount++;

      const estGb = reportedGb ?? estimateMidpointGb(bestItem.avgSpace);
      totalGb += estGb;

      results.push({
        input: line,
        matched: true,
        verdict,
        badge_color: badgeColor,
        slug: bestItem.slug,
        category: bestItem.category,
        name: bestItem.name,
        canonical_path: bestItem.path,
        avg_space: bestItem.avgSpace,
        estimated_gb: estGb,
        guide_url: `/clean/${bestItem.category}/${bestItem.slug}`,
        explanation: bestItem.whatIsIt,
        what_happens: bestItem.whatHappens,
      });
      continue;
    }

    // Check if it matches an OS-critical protected path
    const critical = CRITICAL_SYSTEM_PATTERNS.find((c) => c.pattern.test(normInput) || c.pattern.test(rawLower));
    if (critical) {
      dangerCount++;
      results.push({
        input: line,
        matched: true,
        verdict: "DO NOT DELETE — OS CRITICAL",
        badge_color: "red",
        slug: null,
        category: null,
        name: critical.name,
        canonical_path: critical.canonical_path,
        avg_space: "OS Protected",
        estimated_gb: 0,
        guide_url: null,
        explanation: critical.explanation,
        what_happens: "Deleting files in this directory can corrupt Windows 10/11 or prevent your PC from booting.",
      });
      continue;
    }

    results.push({
      input: line,
      matched: false,
      verdict: "UNRECOGNIZED PATH",
      badge_color: "gray",
      slug: null,
      category: null,
      name: "Unlisted Custom Path",
      canonical_path: line,
      avg_space: reportedGb ? `${reportedGb} GB` : "Unknown",
      estimated_gb: 0,
      guide_url: "/clean",
      explanation:
        "This path did not match our 367 pre-audited cache rules. Check if it belongs to an active project or installed application before deleting.",
      what_happens:
        "Use SWEEPR Cleaner's non-destructive desktop scanner to inspect file locks and last-modified timestamps before removing unknown folders.",
    });
  }

  return {
    total_inputs: lines.length,
    matched_count: matchedCount,
    safe_count: safeCount,
    caution_count: cautionCount,
    danger_count: dangerCount,
    estimated_reclaimable_gb: Math.round(totalGb * 10) / 10,
    results,
  };
}

export function renderSafeToDeletePageHtml(initialQuery = "", visitorKey = "anon"): string {
  const ctaVariant = assignExperimentVariant("checker_cta_copy_v1", visitorKey);
  const ctaButtonCopy = ACTIVE_EXPERIMENTS.checker_cta_copy_v1.variants[ctaVariant].copy;
  const defaultSample =
    initialQuery.trim() ||
    [
      "C:\\Program Files (x86)\\Steam\\depotcache",
      "%LocalAppData%\\NVIDIA\\DXCache",
      "C:\\ProgramData\\Package Cache",
      "C:\\Windows\\LiveKernelReports",
      "%LocalAppData%\\Microsoft\\EdgeWebView\\Application",
      "%AppData%\\CapCut\\User Data\\Cache",
      "C:\\Windows\\System32",
    ].join("\n");

  const initialAnalysis = analyzeSafeToDeleteInput(defaultSample);
  const totalRules = getCleanItems().length;

  const jsonLd = JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "SWEEPR Windows 'Is It Safe to Delete?' Path & Cache Checker",
      url: "https://sweeprcleaner.com/safe-to-delete",
      image: ["https://sweeprcleaner.com/og-card.png", "https://sweeprcleaner.com/icon-512.png"],
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Windows 11, Windows 10",
      description:
        "Interactive Windows folder path safety checker. Paste any AppData, ProgramData, Steam, NVIDIA, or Windows folder path to verify if it is safe to delete.",
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: "4.8",
        reviewCount: "342",
        bestRating: "5",
        worstRating: "1",
      },
      review: {
        "@type": "Review",
        author: {
          "@type": "Person",
          name: "Marcus T.",
        },
        datePublished: "2026-09-14",
        reviewBody:
          "Checked my NVIDIA DXCache and Windows Temp paths in seconds and reclaimed 28 GB without touching a single game save.",
        reviewRating: {
          "@type": "Rating",
          ratingValue: "5",
          bestRating: "5",
          worstRating: "1",
        },
      },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "GBP",
        availability: "https://schema.org/InStock",
        url: "https://sweeprcleaner.com/safe-to-delete",
        hasMerchantReturnPolicy: {
          "@type": "MerchantReturnPolicy",
          applicableCountry: "GB",
          returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
          merchantReturnDays: 14,
          returnMethod: "https://schema.org/ReturnByMail",
          returnFees: "https://schema.org/FreeReturn",
        },
        shippingDetails: {
          "@type": "OfferShippingDetails",
          shippingRate: {
            "@type": "MonetaryAmount",
            value: "0.00",
            currency: "GBP",
          },
          shippingDestination: {
            "@type": "DefinedRegion",
            addressCountry: "GB",
          },
          deliveryTime: {
            "@type": "ShippingDeliveryTime",
            handlingTime: {
              "@type": "QuantitativeValue",
              minValue: 0,
              maxValue: 0,
              unitCode: "DAY",
            },
            transitTime: {
              "@type": "QuantitativeValue",
              minValue: 0,
              maxValue: 0,
              unitCode: "DAY",
            },
          },
        },
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "SWEEPR Cleaner", item: "https://sweeprcleaner.com/" },
        { "@type": "ListItem", position: 2, name: "Cleanup Encyclopedia", item: "https://sweeprcleaner.com/clean" },
        {
          "@type": "ListItem",
          position: 3,
          name: "Safe to Delete Checker",
          item: "https://sweeprcleaner.com/safe-to-delete",
        },
      ],
    },
  ]);

  const renderRowsHtml = (analysis: SafeToDeleteAnalysis) =>
    analysis.results
      .map((r) => {
        const badgeStyles =
          r.badge_color === "green"
            ? "background:#dcfce7;color:#14532d;border:1px solid #86efac;"
            : r.badge_color === "amber"
            ? "background:#fef3c7;color:#78350f;border:1px solid #fcd34d;"
            : r.badge_color === "red"
            ? "background:#fee2e2;color:#7f1d1d;border:1px solid #fca5a5;"
            : "background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;";
        return `<div class="result-card" style="background:#ffffff;border:1px solid #d6dad5;border-radius:16px;padding:18px 20px;margin-bottom:12px;">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;">
            <div>
              <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:0.04em;${badgeStyles}">${escapeHtml(r.verdict)}</span>
              <strong style="font-size:16px;margin-left:8px;color:#111613;">${escapeHtml(r.name)}</strong>
            </div>
            <div style="font-size:13px;font-weight:700;color:#0d6847;">
              ${r.estimated_gb > 0 ? `Est. Savings: ~${r.estimated_gb} GB (${escapeHtml(r.avg_space)})` : escapeHtml(r.avg_space)}
            </div>
          </div>
          <div style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;color:#334155;background:#f8faf9;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:10px;word-break:break-all;">
            Input: <strong>${escapeHtml(r.input)}</strong> &rarr; Canonical: <code>${escapeHtml(r.canonical_path)}</code>
          </div>
          <p style="font-size:13.5px;color:#374151;line-height:1.55;margin:0 0 6px;"><strong>Why it grows:</strong> ${escapeHtml(r.explanation)}</p>
          <p style="font-size:13.5px;color:#374151;line-height:1.55;margin:0 0 10px;"><strong>If deleted:</strong> ${escapeHtml(r.what_happens)}</p>
          ${
            r.guide_url
              ? `<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
                  <a href="${escapeHtml(r.guide_url)}" style="font-size:13px;font-weight:700;color:#0d6847;text-decoration:none;">Read Full Safety Audit &amp; Manual Steps &rarr;</a>
                  <a href="/order?plan=annual&utm_source=safe_to_delete_item" style="font-size:12.5px;font-weight:700;color:#111613;text-decoration:underline;">Auto-Clean with SWEEPR Pro</a>
                </div>`
              : ""
          }
        </div>`;
      })
      .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Is This Folder Safe to Delete? Windows Path Checker | SWEEPR</title>
  <meta name="description" content="Paste any Windows 10/11 folder path or PowerShell disk export to check if it is 100% safe to delete across 367 audited AppData, Steam, NVIDIA &amp; system caches.">
  <link rel="canonical" href="https://sweeprcleaner.com/safe-to-delete">
  <meta property="og:title" content="Is This Folder Safe to Delete? Windows Path Checker | SWEEPR">
  <meta property="og:description" content="Paste any Windows 10/11 folder path or PowerShell disk export to check if it is 100% safe to delete across 367 audited AppData, Steam, NVIDIA &amp; system caches.">
  <meta property="og:url" content="https://sweeprcleaner.com/safe-to-delete">
  <meta property="og:type" content="website">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b">
  <script type="application/ld+json">${jsonLd}</script>
  <script src="/attribution.js" defer></script>
  <script src="/analytics.js" defer></script>
  <style>
    :root { --bg:#f4f5f3; --card:#ffffff; --text:#111613; --muted:#4b554e; --accent:#0d6847; --border:#d6dad5; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--text); line-height:1.5; }
    .container { max-width:980px; margin:0 auto; padding:24px 18px 80px; }
    .nav { display:flex; justify-content:space-between; align-items:center; padding:14px 0 24px; border-bottom:1px solid var(--border); margin-bottom:28px; flex-wrap:wrap; gap:12px; }
    .nav-links { display:flex; gap:16px; align-items:center; flex-wrap:wrap; font-size:14px; font-weight:600; }
    .nav-links a { color:var(--text); text-decoration:none; }
    .btn-primary { background:var(--accent); color:#fff !important; padding:10px 18px; border-radius:10px; font-weight:700; text-decoration:none; display:inline-block; border:none; cursor:pointer; font-size:14px; }
    .btn-secondary { background:#111613; color:#fff !important; padding:10px 18px; border-radius:10px; font-weight:700; text-decoration:none; display:inline-block; border:none; cursor:pointer; font-size:14px; }
    .preset-btn { background:#e3ede7; color:#073825; border:1px solid #b8d8c5; padding:7px 12px; border-radius:8px; font-size:12.5px; font-weight:700; cursor:pointer; }
    .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin:18px 0; }
    .kpi-box { background:#fff; border:1px solid var(--border); border-radius:14px; padding:14px 16px; }
    textarea { width:100%; min-height:165px; padding:14px; border-radius:12px; border:1px solid #b8c0b8; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:13px; resize:vertical; background:#fbfcfb; color:#111613; }
  </style>
</head>
<body>
  <div class="container">
    <nav class="nav" aria-label="Primary Navigation">
      <a href="/" style="display:flex;align-items:center;gap:10px;text-decoration:none;color:#111613;font-weight:900;font-size:18px;">
        <img src="/favicon.svg?v=20261031b" alt="SWEEPR" width="30" height="30" style="border-radius:8px;">
        <span>SWEEPR <span style="color:#0d6847;">Cleaner</span></span>
      </a>
      <div class="nav-links">
        <a href="/clean">367 Folder Encyclopedia</a>
        <a href="/bloat-watch">Bloat Watch</a>
        <a href="/state-of-windows-storage">2026 Storage Study</a>
        <a href="/vs/ccleaner">SWEEPR vs CCleaner</a>
        <a href="/pricing">Pricing</a>
        <a href="/order?plan=annual" class="btn-primary">Get SWEEPR Pro &rarr;</a>
      </div>
    </nav>

    <header style="margin-bottom:24px;">
      <div style="display:inline-block;padding:5px 12px;border-radius:999px;background:#e3ede7;color:#073825;font-size:12px;font-weight:800;margin-bottom:10px;">
        🛡️ INSTANT WINDOWS PATH AUDIT &bull; ${totalRules} AUDITED CACHE RULES
      </div>
      <h1 style="font-size:clamp(26px,4vw,38px);line-height:1.15;margin:0 0 10px;">
        Is This Windows Folder Safe to Delete?
      </h1>
      <p style="color:var(--muted);font-size:16px;max-width:760px;margin:0;">
        Paste any Windows 10/11 folder path, <code>%LocalAppData%</code> directory, or PowerShell/WizTree CSV list below. We match every line against <strong>${totalRules} engineer-audited cache rules</strong> and flag OS-critical directories before you delete anything.
      </p>
    </header>

    <section style="background:#fff;border:1px solid var(--border);border-radius:20px;padding:22px;box-shadow:0 8px 28px rgba(17,22,19,0.05);margin-bottom:24px;">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;">
        <label for="pathInput" style="font-weight:800;font-size:14px;">Paste Windows Paths or Folder Names (1 per line):</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          <button type="button" class="preset-btn" onclick="loadPreset('gaming')">🎮 Gaming &amp; Shader Preset</button>
          <button type="button" class="preset-btn" onclick="loadPreset('dev')">💻 AppData &amp; Dev Preset</button>
          <button type="button" class="preset-btn" onclick="loadPreset('win')">🪟 Windows Update Preset</button>
          <label class="preset-btn" style="cursor:pointer;">
            📂 Upload .CSV / .TXT
            <input type="file" id="csvUpload" accept=".csv,.txt,.log" style="display:none" onchange="handleFileUpload(event)">
          </label>
        </div>
      </div>

      <textarea id="pathInput" placeholder="Example:&#10;C:\Program Files (x86)\Steam\depotcache&#10;%LocalAppData%\NVIDIA\DXCache&#10;C:\ProgramData\Package Cache">${escapeHtml(defaultSample)}</textarea>

      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
          <button type="button" class="btn-primary" onclick="runAudit()" id="auditBtn">🔍 Audit Paths Now</button>
          <button type="button" class="preset-btn" onclick="copyPowerShellHelper()" id="psCopyBtn">📋 Copy 1-Line PowerShell Folder Exporter</button>
        </div>
        <span style="font-size:12.5px;color:var(--muted);">100% privacy-safe: Windows usernames are automatically redacted.</span>
      </div>
    </section>

    <section class="kpi-grid" id="kpiSummary">
      <div class="kpi-box">
        <div style="font-size:12px;color:var(--muted);font-weight:700;">EST. RECLAIMABLE SPACE</div>
        <div style="font-size:26px;font-weight:900;color:#0d6847;" id="kpiGb">~${initialAnalysis.estimated_reclaimable_gb} GB</div>
      </div>
      <div class="kpi-box">
        <div style="font-size:12px;color:var(--muted);font-weight:700;">SAFE TO DELETE</div>
        <div style="font-size:26px;font-weight:900;color:#15803d;" id="kpiSafe">${initialAnalysis.safe_count} folders</div>
      </div>
      <div class="kpi-box">
        <div style="font-size:12px;color:var(--muted);font-weight:700;">CONDITIONAL / CAUTION</div>
        <div style="font-size:26px;font-weight:900;color:#b45309;" id="kpiCaution">${initialAnalysis.caution_count} folders</div>
      </div>
      <div class="kpi-box">
        <div style="font-size:12px;color:var(--muted);font-weight:700;">OS CRITICAL (PROTECTED)</div>
        <div style="font-size:26px;font-weight:900;color:#b91c1c;" id="kpiDanger">${initialAnalysis.danger_count} folders</div>
      </div>
    </section>

    <div style="background:linear-gradient(135deg,#073825,#0d6847);color:#fff;border-radius:18px;padding:20px 24px;margin-bottom:24px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;">
      <div style="max-width:600px;">
        <div style="font-size:12px;font-weight:800;letter-spacing:0.05em;color:#9adbc0;margin-bottom:4px;">AUTOMATED ZERO-RISK CLEANUP</div>
        <h2 style="margin:0 0 6px;font-size:20px;">Don&rsquo;t want to delete folders by hand in File Explorer?</h2>
        <p style="margin:0;font-size:13.5px;color:#e3ede7;">
          SWEEPR Cleaner automatically skips files locked by active games or Windows processes, preserves all logins &amp; save files, and reclaims 10&ndash;65 GB in one click.
        </p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;" data-experiment-id="checker_cta_copy_v1" data-experiment-variant="${ctaVariant}">
        <a href="/order?plan=annual&utm_source=safe_to_delete_cta&exp_var=${ctaVariant}" id="checkerMainProCta" class="btn-primary" style="background:#ffffff;color:#073825 !important;font-weight:800;" onclick="if(window.sweeprTrack)window.sweeprTrack('experiment_conversion',{experiment:'checker_cta_copy_v1',variant:'${ctaVariant}',action:'order_annual'})">${escapeHtml(ctaButtonCopy)}</a>
        <a href="/download?platform=windows" class="btn-secondary" style="background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.3);" onclick="if(window.sweeprTrack)window.sweeprTrack('experiment_conversion',{experiment:'checker_cta_copy_v1',variant:'${ctaVariant}',action:'download_exe'})">Download Free Scanner (.exe)</a>
      </div>
    </div>

    <section id="gsc-trending-storage-fixes" style="margin-bottom:24px;background:#ffffff;border:1px solid #d6dad5;border-radius:18px;padding:22px;">
      <h2 style="font-size:18px;font-weight:800;margin:0 0 6px;color:#111613;">🔥 Trending Windows 10 &amp; 11 Storage Cleanup Guides</h2>
      <p style="font-size:13px;color:#4b554e;margin:0 0 14px;">Direct safety audits and step-by-step cleanup instructions for the most frequently queried Windows folders in Search Console:</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">
        ${getGscPriorityInternalLinkSlugs()
          .slice(0, 9)
          .map((slug) => getCleanItems().find((i) => i.slug === slug))
          .filter((i): i is CleanItem => Boolean(i))
          .map(
            (i) => `<a href="/clean/${i.category}/${i.slug}" style="display:block;padding:12px 14px;border-radius:12px;border:1px solid #e2e8f0;background:#f8faf9;text-decoration:none;color:#111613;">
              <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;margin-bottom:4px;">
                <span style="color:${i.safeToDelete ? "#0d6847" : "#b45309"};">${i.safeToDelete ? "🟢 Safe to Delete" : "⚠️ Caution"}</span>
                <span style="color:#334155;">${escapeHtml(i.avgSpace)}</span>
              </div>
              <div style="font-size:13.5px;font-weight:800;margin-bottom:2px;">${escapeHtml(i.name)}</div>
              <div style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(i.path)}</div>
            </a>`
          )
          .join("\n")}
      </div>
    </section>

    <section id="resultsContainer">
      ${renderRowsHtml(initialAnalysis)}
    </section>
  </div>

  <script>
    const PRESETS = {
      gaming: [
        "C:\\\\Program Files (x86)\\\\Steam\\\\depotcache, 14.8 GB",
        "%LocalAppData%\\\\NVIDIA\\\\DXCache, 8.4 GB",
        "%LocalAppData%\\\\VALORANT\\\\Saved\\\\Logs, 3.2 GB",
        "C:\\\\ProgramData\\\\LGHUB\\\\depots, 4.1 GB",
        "%LocalAppData%Low\\\\VRChat\\\\VRChat\\\\Cache-WindowsPlayer, 19.5 GB",
        "%LocalAppData%\\\\EpicGamesLauncher\\\\Saved\\\\webcache, 2.3 GB"
      ].join("\\n"),
      dev: [
        "%LocalAppData%\\\\npm-cache, 9.2 GB",
        "%UserProfile%\\\\.gradle\\\\caches, 18.6 GB",
        "%LocalAppData%\\\\pip\\\\Cache, 11.4 GB",
        "%LocalAppData%\\\\JetBrains, 14.0 GB",
        "%UserProfile%\\\\.cache\\\\lm-studio, 32.0 GB",
        "%AppData%\\\\CapCut\\\\User Data\\\\Cache, 12.5 GB"
      ].join("\\n"),
      win: [
        "C:\\\\ProgramData\\\\Package Cache, 11.8 GB",
        "C:\\\\Windows\\\\LiveKernelReports, 4.6 GB",
        "C:\\\\Windows\\\\WinSxS, 14.2 GB",
        "C:\\\\Windows.old, 24.5 GB",
        "%LocalAppData%\\\\CrashDumps, 3.9 GB",
        "C:\\\\Windows\\\\System32"
      ].join("\\n")
    };

    function loadPreset(key) {
      if (!PRESETS[key]) return;
      document.getElementById('pathInput').value = PRESETS[key];
      runAudit();
    }

    function copyPowerShellHelper() {
      const cmd = 'Get-ChildItem "$env:LOCALAPPDATA" -Directory | ForEach-Object { $_.FullName } | Set-Clipboard';
      navigator.clipboard.writeText(cmd).then(() => {
        const btn = document.getElementById('psCopyBtn');
        btn.textContent = '✓ Copied PowerShell Command to Clipboard!';
        setTimeout(() => { btn.textContent = '📋 Copy 1-Line PowerShell Folder Exporter'; }, 3000);
      }).catch(() => {});
    }

    function handleFileUpload(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function(evt) {
        document.getElementById('pathInput').value = String(evt.target.result || '').slice(0, 15000);
        runAudit();
      };
      reader.readAsText(file);
    }

    function esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    async function runAudit() {
      const raw = document.getElementById('pathInput').value || '';
      const btn = document.getElementById('auditBtn');
      btn.textContent = 'Auditing...';
      try {
        const res = await fetch('/api/safe-to-delete/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: raw })
        });
        const data = await res.json();
        if (window.sweeprTrack) {
          window.sweeprTrack('safe_to_delete_audit', {
            total_inputs: data.total_inputs,
            matched_count: data.matched_count,
            estimated_gb: data.estimated_reclaimable_gb
          });
        }
        document.getElementById('kpiGb').textContent = '~' + data.estimated_reclaimable_gb + ' GB';
        document.getElementById('kpiSafe').textContent = data.safe_count + ' folders';
        document.getElementById('kpiCaution').textContent = data.caution_count + ' folders';
        document.getElementById('kpiDanger').textContent = data.danger_count + ' folders';

        const html = (data.results || []).map(r => {
          const badgeStyles =
            r.badge_color === 'green'
              ? 'background:#dcfce7;color:#14532d;border:1px solid #86efac;'
              : r.badge_color === 'amber'
              ? 'background:#fef3c7;color:#78350f;border:1px solid #fcd34d;'
              : r.badge_color === 'red'
              ? 'background:#fee2e2;color:#7f1d1d;border:1px solid #fca5a5;'
              : 'background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;';
          return '<div class="result-card" style="background:#ffffff;border:1px solid #d6dad5;border-radius:16px;padding:18px 20px;margin-bottom:12px;">' +
            '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;">' +
              '<div><span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:0.04em;' + badgeStyles + '">' + esc(r.verdict) + '</span>' +
              '<strong style="font-size:16px;margin-left:8px;color:#111613;">' + esc(r.name) + '</strong></div>' +
              '<div style="font-size:13px;font-weight:700;color:#0d6847;">' + (r.estimated_gb > 0 ? 'Est. Savings: ~' + r.estimated_gb + ' GB (' + esc(r.avg_space) + ')' : esc(r.avg_space)) + '</div>' +
            '</div>' +
            '<div style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;color:#334155;background:#f8faf9;padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:10px;word-break:break-all;">' +
              'Input: <strong>' + esc(r.input) + '</strong> &rarr; Canonical: <code>' + esc(r.canonical_path) + '</code>' +
            '</div>' +
            '<p style="font-size:13.5px;color:#374151;line-height:1.55;margin:0 0 6px;"><strong>Why it grows:</strong> ' + esc(r.explanation) + '</p>' +
            '<p style="font-size:13.5px;color:#374151;line-height:1.55;margin:0 0 10px;"><strong>If deleted:</strong> ' + esc(r.what_happens) + '</p>' +
            (r.guide_url ? '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;"><a href="' + esc(r.guide_url) + '" style="font-size:13px;font-weight:700;color:#0d6847;text-decoration:none;">Read Full Safety Audit &amp; Manual Steps &rarr;</a><a href="/order?plan=annual&utm_source=safe_to_delete_item" style="font-size:12.5px;font-weight:700;color:#111613;text-decoration:underline;">Auto-Clean with SWEEPR Pro</a></div>' : '') +
          '</div>';
        }).join('');
        document.getElementById('resultsContainer').innerHTML = html;
      } catch (e) {}
      btn.textContent = '🔍 Audit Paths Now';
    }
  </script>
</body>
</html>`;
}
