import { getCleanItems, getGscPriorityInternalLinkSlugs, isPseoSlugNoindexed, type CleanItem } from "./pseo.js";
import { escapeHtml } from "./security.js";
import { ACTIVE_EXPERIMENTS, assignExperimentVariant } from "./experiments.js";
import { renderEditorialHead, renderSiteFooter, renderSiteHeader } from "./ui-shell.js";

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
  category: CleanItem["category"] | null;
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
    .slice(0, 16_384)
    .split(/\r?\n/)
    .map((l) => l.trim().slice(0, 512))
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

      const hasIndexableGuide = !isPseoSlugNoindexed(bestItem.slug) && !bestItem.noindex && !bestItem.mergedIntoSlug;

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
        guide_url: hasIndexableGuide ? `/clean/${bestItem.category}/${bestItem.slug}` : null,
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
        `This path did not match our ${getCleanItems().length} pre-audited cache rules. Check if it belongs to an active project or installed application before deleting.`,
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
  const verifiedReviewCount = Number(process.env.SWEEPR_VERIFIED_REVIEW_COUNT ?? 0);
  const verifiedRatingValue = String(process.env.SWEEPR_VERIFIED_RATING_VALUE ?? "").trim();

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
      ...(verifiedReviewCount >= 5 && verifiedRatingValue
        ? {
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: verifiedRatingValue,
              reviewCount: String(verifiedReviewCount),
              bestRating: "5",
              worstRating: "1",
            },
          }
        : {}),
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
        const statusCls =
          r.badge_color === "green"
            ? "ed-status-safe"
            : r.badge_color === "amber"
              ? "ed-status-caution"
              : r.badge_color === "red"
                ? "ed-status-danger"
                : "";
        return `<article class="ed-card result-card" style="margin-bottom:12px;">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;">
              <span class="ed-status ${statusCls}"><span class="ed-dot" aria-hidden="true"></span>${escapeHtml(r.verdict)}</span>
              <strong style="font-size:1rem;color:var(--text);">${escapeHtml(r.name)}</strong>
            </div>
            <div class="mono" style="font-size:0.84rem;font-weight:700;color:var(--accent);">
              ${r.estimated_gb > 0 ? `Est. Savings: ~${r.estimated_gb} GB (${escapeHtml(r.avg_space)})` : escapeHtml(r.avg_space)}
            </div>
          </div>
          <div class="ed-path-box" style="margin:8px 0 12px;">
            Input: <strong>${escapeHtml(r.input)}</strong> &rarr; Canonical: <code>${escapeHtml(r.canonical_path)}</code>
          </div>
          <p style="font-size:0.9rem;color:var(--text);line-height:1.55;margin-bottom:6px;"><strong>Why it grows:</strong> ${escapeHtml(r.explanation)}</p>
          <p style="font-size:0.9rem;color:var(--muted);line-height:1.55;margin-bottom:10px;"><strong>If deleted:</strong> ${escapeHtml(r.what_happens)}</p>
          ${
            r.guide_url
              ? `<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;">
                  <a href="${escapeHtml(r.guide_url)}" style="font-size:0.86rem;font-weight:700;color:var(--accent);text-decoration:underline;">Read Full Safety Guide &amp; Manual Steps &rarr;</a>
                  <a href="/order?plan=annual&amp;utm_source=safe_to_delete_item" rel="nofollow" style="font-size:0.84rem;font-weight:600;color:var(--text);text-decoration:underline;">Auto-Clean with SWEEPR Pro</a>
                </div>`
              : ""
          }
        </article>`;
      })
      .join("\n");

  const trendingGuides = getGscPriorityInternalLinkSlugs()
    .map((slug) => getCleanItems().find((i) => i.slug === slug))
    .filter((i): i is CleanItem => Boolean(i))
    .filter((i) => !isPseoSlugNoindexed(i.slug) && !i.noindex && !i.mergedIntoSlug)
    .slice(0, 9);

  const pageTitle = "Is This Folder Safe to Delete? Windows Path Checker | SWEEPR";
  const pageDesc = `Paste any Windows 10/11 folder path or PowerShell disk export to check if it is safe to delete across ${totalRules} audited AppData, Steam, NVIDIA & system rules.`;

  return `<!DOCTYPE html>
<html lang="en">
${renderEditorialHead({
  title: pageTitle,
  description: pageDesc,
  canonical: "https://sweeprcleaner.com/safe-to-delete",
  jsonLd,
})}
<body>
  ${renderSiteHeader("tools")}
  <main id="main-content" class="ed-container">
    <nav class="ed-crumb" aria-label="Breadcrumb">
      <a href="/">Home</a>
      <span aria-hidden="true">/</span>
      <a href="/tools">Tools</a>
      <span aria-hidden="true">/</span>
      <span>Safe-to-Delete Checker</span>
    </nav>

    <h1 class="ed-h1">Is This Windows Folder <em>Safe to Delete?</em></h1>
    <p class="ed-lead">
      Paste any Windows 10 or Windows 11 folder path, <code class="ed-code">%LocalAppData%</code> directory, or WizTree/PowerShell CSV export below. Every line is checked against <strong>${totalRules} audited Windows storage rules</strong> with explicit protection for OS-critical system directories.
    </p>

    <section class="ed-section ed-card">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;">
        <label for="pathInput" style="font-weight:700;font-size:0.92rem;">Paste Windows paths or folder names (one per line):</label>
        <div class="ed-filter-pills" style="margin-top:0;">
          <button type="button" class="ed-filter-pill" onclick="loadPreset('gaming')">Gaming &amp; Shaders Preset</button>
          <button type="button" class="ed-filter-pill" onclick="loadPreset('dev')">AppData &amp; Dev Preset</button>
          <button type="button" class="ed-filter-pill" onclick="loadPreset('win')">Windows Update Preset</button>
          <label class="ed-filter-pill" style="display:inline-flex;align-items:center;">
            Upload .CSV / .TXT
            <input type="file" id="csvUpload" accept=".csv,.txt,.log" style="display:none" onchange="handleFileUpload(event)" />
          </label>
        </div>
      </div>

      <textarea id="pathInput" class="ed-textarea" placeholder="Example:&#10;C:\\Program Files (x86)\\Steam\\depotcache&#10;%LocalAppData%\\NVIDIA\\DXCache&#10;C:\\ProgramData\\Package Cache">${escapeHtml(defaultSample)}</textarea>

      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;">
          <button type="button" class="ed-btn-primary btn-press" onclick="runAudit()" id="auditBtn">Audit Paths Now</button>
          <button type="button" class="ed-btn-secondary btn-press" onclick="copyPowerShellHelper()" id="psCopyBtn">Copy 1-Line PowerShell Exporter</button>
        </div>
        <span style="font-size:0.82rem;color:var(--muted);">Privacy-safe: Windows usernames are stripped before matching.</span>
      </div>
    </section>

    <section class="ed-section ed-grid-4" id="kpiSummary">
      <div class="ed-kpi-card">
        <div class="ed-kpi-label">EST. RECLAIMABLE SPACE</div>
        <div class="ed-kpi-val" style="color:var(--accent);" id="kpiGb">~${initialAnalysis.estimated_reclaimable_gb} GB</div>
      </div>
      <div class="ed-kpi-card">
        <div class="ed-kpi-label">SAFE TO DELETE</div>
        <div class="ed-kpi-val" style="color:var(--accent-ink);" id="kpiSafe">${initialAnalysis.safe_count} folders</div>
      </div>
      <div class="ed-kpi-card">
        <div class="ed-kpi-label">CONDITIONAL / CAUTION</div>
        <div class="ed-kpi-val" style="color:var(--amber-ink);" id="kpiCaution">${initialAnalysis.caution_count} folders</div>
      </div>
      <div class="ed-kpi-card">
        <div class="ed-kpi-label">OS CRITICAL (PROTECTED)</div>
        <div class="ed-kpi-val" style="color:var(--red-ink);" id="kpiDanger">${initialAnalysis.danger_count} folders</div>
      </div>
    </section>

    <section class="ed-section ed-card-muted">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:16px;">
        <div style="max-width:600px;">
          <div class="ed-kpi-label" style="color:var(--accent);">AUTOMATED SAFE CLEANUP</div>
          <h2 class="ed-h2" style="margin-bottom:6px;">Skip manual File Explorer deletion</h2>
          <p style="font-size:0.92rem;color:var(--muted);">
            SWEEPR Cleaner skips files locked by active games or Windows services, keeps logins and save files intact, and protects eligible cleanups with a 7-day Undo Quarantine.
          </p>
        </div>
        <div class="ed-actions" style="margin-top:0;" data-experiment-id="checker_cta_copy_v1" data-experiment-variant="${ctaVariant}">
          <a href="/order?plan=annual&amp;utm_source=safe_to_delete_cta&amp;exp_var=${ctaVariant}" rel="nofollow" id="checkerMainProCta" class="ed-btn-primary btn-press" onclick="if(window.sweeprTrack)window.sweeprTrack('experiment_conversion',{experiment:'checker_cta_copy_v1',variant:'${ctaVariant}',action:'order_annual'})">${escapeHtml(ctaButtonCopy)}</a>
          <a href="/download?platform=windows" rel="nofollow" class="ed-btn-secondary btn-press" onclick="if(window.sweeprTrack)window.sweeprTrack('experiment_conversion',{experiment:'checker_cta_copy_v1',variant:'${ctaVariant}',action:'download_exe'})">Download Free Scanner (.exe)</a>
        </div>
      </div>
    </section>

    <section class="ed-section" id="resultsContainer" aria-live="polite">
      ${renderRowsHtml(initialAnalysis)}
    </section>

    <section id="gsc-trending-storage-fixes" class="ed-section ed-card">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:10px;margin-bottom:14px;">
        <div>
          <h2 class="ed-h2" style="margin-bottom:4px;">Frequently Audited Windows Storage Guides</h2>
          <p style="font-size:0.88rem;color:var(--muted);">Direct path audits and manual PowerShell commands for the highest-impact folders.</p>
        </div>
        <a href="/clean" class="ed-btn-secondary btn-press">All Storage Guides</a>
      </div>
      <div class="ed-grid-3">
        ${trendingGuides
          .map(
            (i) => `<a href="/clean/${i.category}/${i.slug}" class="ed-card-muted" style="display:block;padding:14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
                <span class="ed-status ${i.safeToDelete ? "ed-status-safe" : "ed-status-caution"}"><span class="ed-dot" aria-hidden="true"></span>${i.safeToDelete ? "Safe to Delete" : "Caution"}</span>
                <span class="mono" style="font-size:0.78rem;font-weight:700;color:var(--text);">${escapeHtml(i.avgSpace)}</span>
              </div>
              <div style="font-size:0.92rem;font-weight:700;color:var(--text);margin-bottom:4px;">${escapeHtml(i.name)}</div>
              <div class="ed-path-mono">${escapeHtml(i.path)}</div>
            </a>`
          )
          .join("\n")}
      </div>
    </section>
  </main>
  ${renderSiteFooter()}

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
        btn.textContent = 'Copied PowerShell Command';
        setTimeout(() => { btn.textContent = 'Copy 1-Line PowerShell Exporter'; }, 3000);
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
          const statusCls =
            r.badge_color === 'green'
              ? 'ed-status-safe'
              : r.badge_color === 'amber'
              ? 'ed-status-caution'
              : r.badge_color === 'red'
              ? 'ed-status-danger'
              : '';
          return '<article class="ed-card result-card" style="margin-bottom:12px;">' +
            '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">' +
              '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;"><span class="ed-status ' + statusCls + '"><span class="ed-dot" aria-hidden="true"></span>' + esc(r.verdict) + '</span>' +
              '<strong style="font-size:1rem;color:var(--text);">' + esc(r.name) + '</strong></div>' +
              '<div class="mono" style="font-size:0.84rem;font-weight:700;color:var(--accent);">' + (r.estimated_gb > 0 ? 'Est. Savings: ~' + r.estimated_gb + ' GB (' + esc(r.avg_space) + ')' : esc(r.avg_space)) + '</div>' +
            '</div>' +
            '<div class="ed-path-box" style="margin:8px 0 12px;">' +
              'Input: <strong>' + esc(r.input) + '</strong> &rarr; Canonical: <code>' + esc(r.canonical_path) + '</code>' +
            '</div>' +
            '<p style="font-size:0.9rem;color:var(--text);line-height:1.55;margin-bottom:6px;"><strong>Why it grows:</strong> ' + esc(r.explanation) + '</p>' +
            '<p style="font-size:0.9rem;color:var(--muted);line-height:1.55;margin-bottom:10px;"><strong>If deleted:</strong> ' + esc(r.what_happens) + '</p>' +
            (r.guide_url ? '<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;"><a href="' + esc(r.guide_url) + '" style="font-size:0.86rem;font-weight:700;color:var(--accent);text-decoration:underline;">Read Full Safety Guide &amp; Manual Steps &rarr;</a><a href="/order?plan=annual&amp;utm_source=safe_to_delete_item" rel="nofollow" style="font-size:0.84rem;font-weight:600;color:var(--text);text-decoration:underline;">Auto-Clean with SWEEPR Pro</a></div>' : '') +
          '</article>';
        }).join('');
        document.getElementById('resultsContainer').innerHTML = html;
      } catch (e) {}
      btn.textContent = 'Audit Paths Now';
    }
  </script>
</body>
</html>`;
}
