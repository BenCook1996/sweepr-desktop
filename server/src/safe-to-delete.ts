import { getCleanItems, getGscPriorityInternalLinkSlugs, isPseoSlugNoindexed, type CleanItem } from "./pseo.js";
import { escapeHtml } from "./security.js";
import { ACTIVE_EXPERIMENTS, assignExperimentVariant } from "./experiments.js";
import { ORGANIZATION_LOGO_URL, ORGANIZATION_SAME_AS, renderEditorialHead, renderSiteFooter, renderSiteHeader } from "./ui-shell.js";

export interface SafeToDeleteMatchResult {
  input: string;
  matched: boolean;
  verdict:
    | "SAFE TO DELETE"
    | "CAUTION — CONDITIONAL"
    | "CAUTION — DO NOT DELETE WITHOUT 30-DAY AGE FILTER"
    | "DO NOT DELETE — OS CRITICAL"
    | "DO NOT DELETE — PATH TRAVERSAL BLOCKED"
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
    pattern: /(?:^|[\\/])(?:ntoskrnl\.exe|hal\.dll|bootmgr|bcd)$/i,
    name: "Windows Kernel / Boot Manager File",
    canonical_path: "C:\\Windows\\System32\\ntoskrnl.exe",
    explanation:
      "Core Windows NT operating system kernel image or boot manager. Never delete.",
  },
];

const CSV_SIZE_UNIT_RE = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(tb|tib|gb|gib|mb|mib|kb|kib|bytes?|b)\b/i;

const CSV_SAFE_SLASH_META_RE =
  /^(?:(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}\/\d{1,2}\/\d{1,2})(?:[T\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:\s*[AP]M|\s*(?:Z|[+-]\d{2}:?\d{2}))?)?|n\/a|read\/write|r\/w)$/i;

const CSV_META_CELL_RE =
  /^(?:["'][^"']*["']|(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(?:[kmgt]i?b|bytes?|b|%|files?|folders?|items?|dirs?))?|\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?|(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}\/\d{1,2}\/\d{1,2})(?:[T\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:\s*[AP]M|\s*(?:Z|[+-]\d{2}:?\d{2}))?)?|n\/a|read\/write|r\/w)$/i;

function splitDelimitedCells(text: string, sep: "," | ";" | "\t"): string[] {
  const cells: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) {
          cur += ch;
          i++;
        } else {
          quote = null;
        }
      }
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === sep) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function hasPathContinuationOrTraversal(cells: string[], rest: string): boolean {
  const decodedRest = decodeTraversalEscapes(rest);
  if (rest.includes("\\") || decodedRest.includes("\\")) {
    return true;
  }
  return cells.some((c) => {
    const unquoted = c.replace(/^["']+|["']+$/g, "").trim();
    const decoded = decodeTraversalEscapes(unquoted);
    if (decoded === ".." || /(?:^|[\\/])\.\.(?:$|[\\/])/.test(decoded)) {
      return true;
    }
    return (
      (unquoted.includes("/") || decoded.includes("/")) &&
      !CSV_SAFE_SLASH_META_RE.test(unquoted)
    );
  });
}

function parseCsvPathAndMeta(raw: string): { cleanedPath: string; metaCells: string[] } {
  const s = raw.trim();
  if (!s) return { cleanedPath: "", metaCells: [] };

  // 1. Leading quoted CSV/TSV cell (handles `"C:\Path",...`, `'C:\Path',...`, `""C:\Path"",...`)
  const quotedCsv =
    s.match(/^"+([^"]+)"+\s*([,;\t])(.*)$/) ??
    s.match(/^'+([^']+)'+\s*([,;\t])(.*)$/);
  if (quotedCsv) {
    const sep = quotedCsv[2] as "," | ";" | "\t";
    return {
      cleanedPath: quotedCsv[1].trim(),
      metaCells: splitDelimitedCells(quotedCsv[3], sep).filter(Boolean),
    };
  }

  // 2. Unquoted tab-delimited (tabs are never valid path chars)
  const tabIdx = s.indexOf("\t");
  if (tabIdx > 0) {
    return {
      cleanedPath: s.slice(0, tabIdx).replace(/^["']+|["']+$/g, "").trim(),
      metaCells: splitDelimitedCells(s.slice(tabIdx + 1), "\t").filter(Boolean),
    };
  }

  // 3 & 4. Unquoted semicolon- or comma-delimited: scan left-to-right for earliest delimiter
  //        with NO path continuation/traversal (\, .., encoded escapes, or non-metadata /) after it
  //        (preserves `C:\Users\Ben\Folder, Name` and `C:/Users/Ben/Acme, Inc./Windows/System32, 2.5 GB`).
  for (const sep of [";", ","] as const) {
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== sep) continue;
      const rest = s.slice(i + 1);
      const cells = splitDelimitedCells(rest, sep).filter(Boolean);
      if (cells.length === 0) continue;
      if (hasPathContinuationOrTraversal(cells, rest)) continue;
      const prefix = s.slice(0, i).trim();
      const looksLikePath = /^(?:[a-z]:[\\/]|\\\\|\/|~|%[^%]+%)/i.test(prefix);
      const allowMultiColFallback =
        looksLikePath && cells.length >= 2 && (sep === "," || !rest.includes(","));
      if (cells.some((c) => CSV_META_CELL_RE.test(c)) || allowMultiColFallback) {
        return {
          cleanedPath: prefix.replace(/^["']+|["']+$/g, "").trim(),
          metaCells: cells,
        };
      }
    }
  }

  return {
    cleanedPath: s.replace(/^["']+|["']+$/g, "").trim(),
    metaCells: [],
  };
}

function stripCsvAndQuotes(raw: string): string {
  return parseCsvPathAndMeta(raw).cleanedPath;
}

function decodeTraversalEscapes(raw: string): string {
  let s = raw;
  for (let pass = 0; pass < 2; pass++) {
    const next = s.replace(/%(25|2e|2f|5c|20|09)/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
    if (next === s) break;
    s = next;
  }
  return s;
}

function collapseCurDirSegments(winPath: string): string {
  const isUnc = winPath.startsWith("\\\\");
  const body = isUnc ? winPath.slice(2) : winPath;
  const segments = body.split("\\").filter((seg, idx) => {
    if (isUnc && idx === 0 && seg === "") return false;
    return seg.trim() !== ".";
  });
  if (isUnc) {
    return segments.length > 0 ? "\\\\" + segments.join("\\") : "\\\\";
  }
  return segments.join("\\");
}

function normalizeSlashesAndVerbatim(rawPath: string): string {
  const decoded = decodeTraversalEscapes(rawPath.trim());
  // Strip Windows verbatim and device namespace prefixes (2+ leading slashes) matching app/src-tauri/src/safety.rs (:159-165)
  const verbatimMatch = decoded.match(/^[\\/]{2,}[?.][\\/]+(.*)$/);
  if (verbatimMatch) {
    const rest = verbatimMatch[1];
    if (/^unc[\\/]/i.test(rest)) {
      const uncBody = rest.slice(4).replace(/\//g, "\\").replace(/\\{2,}/g, "\\").replace(/^\\+/, "");
      return collapseCurDirSegments(uncBody ? "\\\\" + uncBody : "\\\\");
    }
    let body = rest.replace(/\//g, "\\").replace(/\\{2,}/g, "\\");
    if (/^\\+[a-z]:(?:\\|$)/i.test(body)) {
      body = body.replace(/^\\+/, "");
    }
    return collapseCurDirSegments(body);
  }

  // Strip accidental leading slashes on drive-letter paths (e.g. ///C:/Windows/System32, /C:/Users/Ben/Documents)
  if (/^[\\/]+[a-z]:(?:[\\/]|$)/i.test(decoded)) {
    const driveBody = decoded.replace(/\//g, "\\").replace(/^\\+/, "").replace(/\\{2,}/g, "\\");
    return collapseCurDirSegments(driveBody);
  }

  // Collapse 3+ leading forward slashes (POSIX root syntax ///etc, ///Users/...) to single slash
  if (/^\/{3,}/.test(decoded)) {
    const posixBody = decoded.replace(/^\/{3,}/, "/").replace(/\//g, "\\").replace(/\\{2,}/g, "\\");
    return collapseCurDirSegments(posixBody);
  }

  let s = decoded.replace(/\//g, "\\");
  if (s.startsWith("\\\\")) {
    // Preserve leading UNC `\\` while collapsing repeated separators in the remainder
    s = "\\\\" + s.slice(2).replace(/\\{2,}/g, "\\");
  } else {
    s = s.replace(/\\{2,}/g, "\\");
  }
  return collapseCurDirSegments(s);
}

const ROOTED_WIN_PATH_RE = /^(?:[a-z]:\\|%[a-z0-9_()]+%(?:low)?(?:\\|$))/i;

const EXTRA_ITEM_PATHS_BY_SLUG: Record<string, string[]> = {
  "rustup-toolchain-downloads": ["%UserProfile%\\.rustup\\toolchains"],
  "epic-games-webcache": [
    "%LocalAppData%\\EpicGamesLauncher\\Saved\\webcache",
    "%LocalAppData%\\EpicGamesLauncher\\Saved\\webcache_4147",
  ],
  "system-data-huge": ["%UserProfile%\\Library\\Caches"],
  "chrome-service-worker-cache": [
    "%LocalAppData%\\Google\\Chrome\\User Data\\Default\\Cache",
    "%LocalAppData%\\Google\\Chrome\\User Data\\Default\\Cache\\Cache_Data",
    "%LocalAppData%\\Google\\Chrome\\User Data\\Default\\Code Cache",
    "%LocalAppData%\\Google\\Chrome\\User Data\\*\\Cache",
    "%LocalAppData%\\Google\\Chrome\\User Data\\*\\Cache\\Cache_Data",
    "%LocalAppData%\\Google\\Chrome\\User Data\\*\\Code Cache",
    "%LocalAppData%\\Google\\Chrome\\User Data\\*\\Service Worker\\CacheStorage",
  ],
  "edge-browser-cache": [
    "%LocalAppData%\\Microsoft\\Edge\\User Data\\Default\\Code Cache",
    "%LocalAppData%\\Microsoft\\Edge\\User Data\\*\\Cache",
    "%LocalAppData%\\Microsoft\\Edge\\User Data\\*\\Cache\\Cache_Data",
    "%LocalAppData%\\Microsoft\\Edge\\User Data\\*\\Code Cache",
    "%LocalAppData%\\Microsoft\\Edge\\User Data\\*\\Service Worker\\CacheStorage",
  ],
  "brave-browser-cache": [
    "%LocalAppData%\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Code Cache",
    "%LocalAppData%\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Service Worker\\CacheStorage",
    "%LocalAppData%\\BraveSoftware\\Brave-Browser\\User Data\\*\\Cache",
    "%LocalAppData%\\BraveSoftware\\Brave-Browser\\User Data\\*\\Cache\\Cache_Data",
    "%LocalAppData%\\BraveSoftware\\Brave-Browser\\User Data\\*\\Code Cache",
    "%LocalAppData%\\BraveSoftware\\Brave-Browser\\User Data\\*\\Service Worker\\CacheStorage",
  ],
};

function splitItemPaths(rawItemPath: string, slug?: string): string[] {
  const out: string[] = [];
  if (!/\s+&\s+/.test(rawItemPath)) {
    const parts = rawItemPath
      .split(/,\s*(?:and|or)\s+|,\s*|\s+(?:and|or)\s+/i)
      .map((p) => p.trim())
      .filter(Boolean);

    let lastRooted: string | null = null;
    for (const p of parts) {
      if (ROOTED_WIN_PATH_RE.test(p)) {
        // Skip bare %Temp% secondary aliases (e.g. autodesk-autocad-temp) and parenthetical/.. annotations
        const isBareEnvOnly = /^%[a-z0-9_()]+%$/i.test(p);
        const hasParenNote = /[()]/.test(p.replace(/program files \(x86\)/gi, ""));
        if (!isBareEnvOnly && !p.includes("..") && !hasParenNote) {
          out.push(p);
        }
        lastRooted = p.replace(/\\{2,}/g, "\\").replace(/\\+$/, "");
      } else if (
        lastRooted &&
        /^[a-z0-9_.*$ -]+(?:\\[a-z0-9_.*$ -]+)*$/i.test(p) &&
        !/^wsl\b/i.test(p)
      ) {
        const idx = lastRooted.lastIndexOf("\\");
        if (idx > 0) {
          const parent = lastRooted.slice(0, idx);
          if (parent.split("\\").filter(Boolean).length >= 2) {
            out.push(`${parent}\\${p}`);
          }
        }
      }
    }
  }
  if (slug && EXTRA_ITEM_PATHS_BY_SLUG[slug]) {
    out.push(...EXTRA_ITEM_PATHS_BY_SLUG[slug]);
  }
  return out;
}

function normalizeWindowsPathForMatch(raw: string, alreadyStripped = false): string {
  const unparsed = alreadyStripped ? raw : stripCsvAndQuotes(raw);
  let s = normalizeSlashesAndVerbatim(unparsed).toLowerCase();

  // Map Unix/macOS rooted cache paths (~/.cache/..., ~/Library/Caches..., /Users/<u>/..., /home/<u>/...) before stripping leading `\`
  s = s.replace(
    /^(?:~|\$home|%home%|\\(?:users|home)\\[^\\]+)\\(\.cache\\.+|library\\caches(?:\\.*)?)$/i,
    "%userprofile%\\$1"
  );

  // Normalize Windows environment variables
  s = s.replace(/^%localappdata%low(?=\\|$)/i, "%localappdatalow%");
  s = s.replace(/^%(?:temp|tmp)%(?=\\|$)/i, "%localappdata%\\temp");
  s = s.replace(/^%(?:systemroot|windir)%(?=\\|$)/i, "c:\\windows");
  s = s.replace(/^%programdata%(?=\\|$)/i, "c:\\programdata");
  s = s.replace(/^%programfiles\(x86\)%(?=\\|$)/i, "c:\\program files (x86)");
  s = s.replace(/^%(?:programfiles|programw6432)%(?=\\|$)/i, "c:\\program files");
  s = s.replace(/^%systemdrive%(?=\\|$)/i, "c:");
  s = s.replace(/^%documents%(?=\\|$)/i, "%userprofile%\\documents");

  // Map concrete C:\Users\<username>\AppData\... and %USERPROFILE%\AppData\... paths to canonical env vars
  s = s.replace(/^[a-z]:\\users\\[^\\]+\\appdata\\locallow\b/i, "%localappdatalow%");
  s = s.replace(/^[a-z]:\\users\\[^\\]+\\appdata\\local\b/i, "%localappdata%");
  s = s.replace(/^[a-z]:\\users\\[^\\]+\\appdata\\roaming\b/i, "%appdata%");
  s = s.replace(/^%userprofile%\\appdata\\locallow\b/i, "%localappdatalow%");
  s = s.replace(/^%userprofile%\\appdata\\local\b/i, "%localappdata%");
  s = s.replace(/^%userprofile%\\appdata\\roaming\b/i, "%appdata%");
  s = s.replace(/^[a-z]:\\users\\[^\\]+\b/i, "%userprofile%");
  s = s.replace(/^\\+/, "").replace(/\\+$/, "");
  return s;
}

function parseReportedSizeGbFromMeta(metaCells: string[]): number | null {
  if (metaCells.length === 0) return null;

  // Pass 1: Explicit unit-suffixed size in any metadata cell (handles quoted `"14.2 GB"`, `GiB`/`MiB`/`KiB`/`TiB`, `bytes`)
  for (const rawCell of metaCells) {
    const cell = rawCell.replace(/^["']+|["']+$/g, "").trim();
    const m = cell.match(CSV_SIZE_UNIT_RE);
    if (!m) continue;
    const val = Number.parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(val) || val < 0) continue;
    const unit = m[2].toLowerCase();
    let gb: number;
    if (unit === "tb" || unit === "tib") gb = val * 1024;
    else if (unit === "gb" || unit === "gib") gb = val;
    else if (unit === "mb" || unit === "mib") gb = val / 1024;
    else if (unit === "kb" || unit === "kib") gb = val / (1024 * 1024);
    else gb = val / (1024 * 1024 * 1024); // bytes / b
    return Math.round(gb * 10) / 10;
  }

  // Pass 2: Raw integer byte count in the FIRST metadata cell only (e.g. WizTree/PowerShell `path,524288000,1024,2026-11-26`)
  const firstCell = metaCells[0].replace(/^["']+|["']+$/g, "").trim();
  if (/^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(firstCell)) {
    const bytes = Number.parseFloat(firstCell.replace(/,/g, ""));
    if (Number.isFinite(bytes) && bytes >= 0) {
      return Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10;
    }
  }
  return null;
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

function splitAppDataRemainder(normPath: string): string | null {
  const m = normPath.match(/^%(?:localappdata|appdata|localappdatalow)%\\(.+)$/i);
  return m ? m[1] : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wildcardMatches(normInput: string, wildcardCandidate: string): "exact" | "child" | null {
  const patternBody = wildcardCandidate
    .split("\\")
    .map((seg) => (seg.includes("*") ? seg.split("*").map(escapeRegex).join("[^\\\\]*") : escapeRegex(seg)))
    .join("\\\\");
  if (new RegExp(`^${patternBody}$`, "i").test(normInput)) return "exact";
  if (new RegExp(`^${patternBody}\\\\`, "i").test(normInput)) return "child";
  return null;
}

function scoreItemMatch(normInput: string, item: CleanItem): number {
  if (!normInput || !ROOTED_WIN_PATH_RE.test(normInput)) return 0;

  const pathCandidates = splitItemPaths(item.path, item.slug)
    .map((p) => normalizeWindowsPathForMatch(p))
    .filter((p) => p.length > 0 && ROOTED_WIN_PATH_RE.test(p));

  let best = 0;
  for (const itemPathNorm of pathCandidates) {
    if (itemPathNorm.includes("*")) {
      const w = wildcardMatches(normInput, itemPathNorm);
      if (w === "exact") best = Math.max(best, 98);
      else if (w === "child") best = Math.max(best, 86);
      continue;
    }

    // 1. Exact rooted path match
    if (normInput === itemPathNorm) return 100;

    // 2. Child path inside a canonical rooted cache directory (never endsWith, lastTwo/lastThree, or slugTokens!)
    if (normInput.startsWith(itemPathNorm + "\\")) {
      const ratio = itemPathNorm.length / Math.max(normInput.length, itemPathNorm.length);
      best = Math.max(best, 85 + Math.round(ratio * 9));
      continue;
    }

    // 3. AppData-root equivalence (%AppData% <-> %LocalAppData% <-> %LocalAppDataLow%) for >= 2-segment subpaths
    const inputAppDataRest = splitAppDataRemainder(normInput);
    const itemAppDataRest = splitAppDataRemainder(itemPathNorm);
    if (inputAppDataRest && itemAppDataRest && itemAppDataRest.includes("\\")) {
      if (inputAppDataRest === itemAppDataRest || inputAppDataRest.startsWith(itemAppDataRest + "\\")) {
        best = Math.max(best, 82);
      }
    }
  }

  return best;
}

function classifyProtectedBoundary(
  cleanedPath: string,
  items: CleanItem[]
): Omit<SafeToDeleteMatchResult, "input"> | null {
  if (!cleanedPath) return null;

  // 1. Block parent directory traversal (`..`, including whitespace-padded and %2e/%2f/%5c/%252e encoded forms) BEFORE collapsing `.` segments
  const decodedForTraversal = decodeTraversalEscapes(cleanedPath);
  const hasTraversalSegment = decodedForTraversal
    .replace(/\//g, "\\")
    .split("\\")
    .some((seg) => seg.trim() === "..");
  if (hasTraversalSegment) {
    return {
      matched: true,
      verdict: "DO NOT DELETE — PATH TRAVERSAL BLOCKED",
      badge_color: "red",
      slug: null,
      category: null,
      name: "Parent Path Traversal Blocked (..)",
      canonical_path: cleanedPath.slice(0, 512),
      avg_space: "OS Protected",
      estimated_gb: 0,
      guide_url: null,
      explanation:
        "Parent directory traversal ('..') is unconditionally rejected by app/src-tauri/src/safety.rs (has_symlink_component :112) so paths cannot escape a cache root into protected directories such as C:\\Windows\\System32.",
      what_happens:
        "SWEEPR refuses to scan or delete any path containing '..' components, symlinks, NTFS junctions, or OneDrive reparse points (FILE_ATTRIBUTE_REPARSE_POINT 0x400).",
    };
  }

  // 1b. Block raw non-drive Win32 device namespace paths before stripping `\\.\` / `\\?\`
  const slashRaw = decodedForTraversal
    .trim()
    .replace(/\//g, "\\")
    .replace(/^\\{2,}([?.])\\+/, "\\\\$1\\");
  if (/^\\\\[?.]\\(?:physicaldrive\d*|harddisk\w*|globalroot|pipe|mailslot|volume\{[^}]+\})(?:\\|$)/i.test(slashRaw)) {
    return {
      matched: true,
      verdict: "DO NOT DELETE — OS CRITICAL",
      badge_color: "red",
      slug: null,
      category: null,
      name: "Protected Win32 Raw Device Namespace",
      canonical_path: cleanedPath.slice(0, 512),
      avg_space: "OS Protected",
      estimated_gb: 0,
      guide_url: null,
      explanation:
        "Raw Win32 device namespace paths (\\\\.\\PhysicalDrive0, \\\\.\\GLOBALROOT, \\\\?\\Volume{...}) refer to physical disks or kernel object namespaces and must never be targeted for file deletion.",
      what_happens: "Deleting or writing directly to Win32 device objects can corrupt disks or crash Windows.",
    };
  }

  // 2. Unix / macOS safety.rs / rules.rs / duplicates.rs parity checks (before Windows backslash conversion)
  const unixCandidate = decodedForTraversal.trim();
  const isWinVerbatimOrDrive =
    /^[\\/]{2,}[?.][\\/]/.test(unixCandidate) ||
    /^[\\/]+[a-z]:(?:[\\/]|$)/i.test(unixCandidate);
  const isUnixLike =
    !isWinVerbatimOrDrive &&
    ((unixCandidate.startsWith("/") && (!unixCandidate.startsWith("//") || unixCandidate.startsWith("///"))) ||
      /^(?:~|\$home|%home%)(?:[\\/]|$)/i.test(unixCandidate));
  if (isUnixLike) {
    const rawUnix = unixCandidate.replace(/\\+/g, "/").replace(/\/{2,}/g, "/");
    const unixSegments = rawUnix.split("/").filter((seg, idx) => {
      if (idx === 0 && seg === "") return true;
      return seg !== "" && seg.trim() !== ".";
    });
    let unixNorm = unixSegments.join("/");
    if (rawUnix.startsWith("/") && !unixNorm.startsWith("/")) unixNorm = "/" + unixNorm;
    if (unixNorm === "") unixNorm = "/";
    const unixLower = unixNorm.toLowerCase();

    if (/^(?:~|\$home|%home%|\/(?:users|home)\/[^/]+)\/downloads(?:\/|$)/i.test(unixLower)) {
      return {
        matched: true,
        verdict: "CAUTION — DO NOT DELETE WITHOUT 30-DAY AGE FILTER",
        badge_color: "amber",
        slug: null,
        category: null,
        name: "Downloads Folder (30-Day Age Guard Required)",
        canonical_path: "~/Downloads",
        avg_space: "Age-Gated (≥30 days)",
        estimated_gb: 0,
        guide_url: null,
        explanation:
          "app/src-tauri/src/safety.rs (:28, :62-74) hard-denies download_dir in is_safe_root and permits it in is_safe_scan_root ONLY when enforcing min_age_hours >= 720 (30+ days).",
        what_happens:
          "Never bulk-delete your Downloads folder directly; personal installers, PDFs, and recent downloads under 30 days old would be lost.",
      };
    }

    if (
      /^(?:~|\$home|%home%|\/(?:users|home)\/[^/]+)\/(?:documents|desktop|pictures|videos|movies|music|audio|\.ssh|\.gnupg|\.aws|\.kube)(?:\/|$)/i.test(
        unixLower
      )
    ) {
      return {
        matched: true,
        verdict: "DO NOT DELETE — OS CRITICAL",
        badge_color: "red",
        slug: null,
        category: null,
        name: "Protected Personal User or Credential Folder",
        canonical_path: unixNorm.slice(0, 512),
        avg_space: "User Data Protected",
        estimated_gb: 0,
        guide_url: null,
        explanation:
          "Personal user directories (Documents, Desktop, Pictures, Videos, Movies, Music, Audio) and credential stores (.ssh, .gnupg, .aws, .kube) are hard-denied in app/src-tauri/src/safety.rs (:22-40) and rules.rs (:704-720).",
        what_happens: "SWEEPR never scans or deletes personal user files or SSH/GPG/cloud credentials.",
      };
    }

    const isUnixHomeOrCacheRoot =
      /^(?:~|\$home|%home%|\/home|\/home\/[^/]+|\/users|\/users\/[^/]+)$/i.test(unixLower) ||
      /^(?:~|\$home|%home%|\/(?:users|home)\/[^/]+)\/\.cache$/i.test(unixLower);
    const isUnixExactRoot = ["/", "/var", "/opt", "/volumes"].includes(unixLower);
    const isUnixProtectedSubtree =
      /^\/(?:system|usr|bin|sbin|etc|boot|lib|lib64|library|applications|dev|proc|sys|root|private\/etc|var\/log)(?:\/|$)/i.test(
        unixLower
      );
    const unixDepth = unixLower.startsWith("/") ? unixLower.split("/").filter(Boolean).length : 2;
    const isShallowUnixRoot = unixLower.startsWith("/") && unixDepth < 2 && unixLower !== "/tmp";

    if (isUnixHomeOrCacheRoot || isUnixExactRoot || isUnixProtectedSubtree || isShallowUnixRoot) {
      return {
        matched: true,
        verdict: "DO NOT DELETE — OS CRITICAL",
        badge_color: "red",
        slug: null,
        category: null,
        name: `Protected Unix/macOS Root or System Path (${unixNorm.slice(0, 128)})`,
        canonical_path: unixNorm.slice(0, 512),
        avg_space: "OS Protected",
        estimated_gb: 0,
        guide_url: null,
        explanation:
          "Unix/macOS system subtrees (/System, /usr, /bin, /sbin, /etc, /boot, /lib, /lib64, /Library, /Applications, /private/etc, /var/log, /dev, /proc, /sys, /root), home/XDG cache roots (~, /Users/<user>, /home/<user>, ~/.cache), and shallow roots (< 2 segments except /tmp) are hard-denied in app/src-tauri/src/safety.rs (:13-54), duplicates.rs (:461-477), and rules.rs (:713-781).",
        what_happens: "Deleting files at an operating system or home root can permanently break macOS or Linux.",
      };
    }

    // Genuine POSIX/Unix paths that are not OS-critical must never fall through to Windows UNC/drive checks
    return null;
  }

  const slashNormalized = normalizeSlashesAndVerbatim(cleanedPath)
    .toLowerCase()
    .replace(/^%systemdrive%(?=\\|$)/i, "c:");
  const trimmedSlash = slashNormalized.replace(/\\+$/, "");
  const expandedSystemRoot = slashNormalized
    .replace(/^%(?:systemroot|windir)%(?=\\|$)/i, "c:\\windows")
    .replace(/^%(?:programfiles|programw6432)%(?=\\|$)/i, "c:\\program files")
    .replace(/^%programfiles\(x86\)%(?=\\|$)/i, "c:\\program files (x86)");
  const rawLower = decodedForTraversal.toLowerCase();

  // 3. Hard-block OS-critical Windows system patterns BEFORE item scoring
  const critical = CRITICAL_SYSTEM_PATTERNS.find(
    (c) => c.pattern.test(expandedSystemRoot) || c.pattern.test(slashNormalized) || c.pattern.test(rawLower)
  );
  if (critical) {
    return {
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
    };
  }

  // 4. Downloads folder age-guard (safety.rs:28, 62-74: denied in is_safe_root, allowed in is_safe_scan_root ONLY when min_age_hours >= 720)
  const isDownloadsPath =
    /^[a-z]:\\users\\[^\\]+\\(?:onedrive(?: - [^\\]+)?\\)?downloads(?:\\|$)/i.test(trimmedSlash) ||
    /^%userprofile%\\(?:onedrive(?: - [^\\]+)?\\)?downloads(?:\\|$)/i.test(trimmedSlash) ||
    /^%(?:onedrive|onedrivecommercial|onedriveconsumer)%\\downloads(?:\\|$)/i.test(trimmedSlash) ||
    trimmedSlash === "downloads";
  if (isDownloadsPath) {
    return {
      matched: true,
      verdict: "CAUTION — DO NOT DELETE WITHOUT 30-DAY AGE FILTER",
      badge_color: "amber",
      slug: null,
      category: null,
      name: "Downloads Folder (30-Day Age Guard Required)",
      canonical_path: "%USERPROFILE%\\Downloads",
      avg_space: "Age-Gated (≥30 days)",
      estimated_gb: 0,
      guide_url: null,
      explanation:
        "app/src-tauri/src/safety.rs (:28, :62-74) hard-denies download_dir in is_safe_root and permits it in is_safe_scan_root ONLY when enforcing min_age_hours >= 720 (30+ days), paired with Recent\\*.lnk and non-touching access_mode(0).share_mode(0) file-lock checks.",
      what_happens:
        "Never bulk-delete your Downloads folder directly; personal installers, PDFs, and recent downloads under 30 days old would be lost.",
    };
  }

  // 5. Personal user folders & their subfolders (safety.rs:25-31), including OneDrive Known Folder Move redirects
  const personalNames =
    "(?:documents|my documents|desktop|pictures|my pictures|videos|my videos|music|my music|audio)";
  const isPersonalFolder =
    new RegExp(`^[a-z]:\\\\users\\\\[^\\\\]+\\\\(?:onedrive(?: - [^\\\\]+)?\\\\)?${personalNames}(?:\\\\|$)`, "i").test(
      trimmedSlash
    ) ||
    new RegExp(`^%userprofile%\\\\(?:onedrive(?: - [^\\\\]+)?\\\\)?${personalNames}(?:\\\\|$)`, "i").test(
      trimmedSlash
    ) ||
    new RegExp(`^%(?:onedrive|onedrivecommercial|onedriveconsumer)%\\\\${personalNames}(?:\\\\|$)`, "i").test(
      trimmedSlash
    ) ||
    /^%documents%(?:\\|$)/i.test(trimmedSlash) ||
    /^(?:documents|desktop|pictures|videos|music|audio)$/i.test(trimmedSlash);
  if (isPersonalFolder) {
    return {
      matched: true,
      verdict: "DO NOT DELETE — OS CRITICAL",
      badge_color: "red",
      slug: null,
      category: null,
      name: "Protected Personal User Folder",
      canonical_path: "%USERPROFILE%\\Documents | Desktop | Pictures | Videos | Music",
      avg_space: "User Data Protected",
      estimated_gb: 0,
      guide_url: null,
      explanation:
        "Personal user directories (Documents, Desktop, Pictures, Videos, Music/Audio) and files inside them are hard-denied by app/src-tauri/src/safety.rs (is_safe_root :22-40).",
      what_happens: "SWEEPR never scans or deletes personal user files in Documents, Desktop, Pictures, Videos, or Music.",
    };
  }

  // 6. Exact protected Windows & OneDrive roots (safety.rs:17, 22-48, 56-57)
  const isDriveRoot = /^[a-z]:$/i.test(trimmedSlash) || /^%systemdrive%$/i.test(trimmedSlash);
  const isUserHomeRoot =
    /^[a-z]:\\users$/i.test(trimmedSlash) ||
    /^[a-z]:\\users\\[^\\]+$/i.test(trimmedSlash) ||
    trimmedSlash === "%userprofile%";
  const isOneDriveRoot =
    /^[a-z]:\\users\\[^\\]+\\onedrive(?: - [^\\]+)?$/i.test(trimmedSlash) ||
    /^%userprofile%\\onedrive(?: - [^\\]+)?$/i.test(trimmedSlash) ||
    /^%(?:onedrive|onedrivecommercial|onedriveconsumer)%$/i.test(trimmedSlash);
  const isAppDataRoot =
    /^[a-z]:\\users\\[^\\]+\\appdata(?:\\(?:roaming|local|locallow))?$/i.test(trimmedSlash) ||
    /^%userprofile%\\appdata(?:\\(?:roaming|local|locallow))?$/i.test(trimmedSlash) ||
    /^%(?:appdata|localappdata|localappdatalow)%$/i.test(trimmedSlash) ||
    /^%localappdata%low$/i.test(trimmedSlash);
  const isWindowsRoot =
    /^[a-z]:\\windows$/i.test(trimmedSlash) || /^%(?:systemroot|windir)%$/i.test(trimmedSlash);
  const isProgramRoot =
    /^[a-z]:\\(?:program files|program files \(x86\)|programdata)$/i.test(trimmedSlash) ||
    /^%(?:programfiles|programfiles\(x86\)|programw6432|programdata)%$/i.test(trimmedSlash);

  if (isDriveRoot || isUserHomeRoot || isOneDriveRoot || isAppDataRoot || isWindowsRoot || isProgramRoot) {
    return {
      matched: true,
      verdict: "DO NOT DELETE — OS CRITICAL",
      badge_color: "red",
      slug: null,
      category: null,
      name: "Protected Windows System, OneDrive, or Profile Root",
      canonical_path: cleanedPath.slice(0, 512),
      avg_space: "OS Protected",
      estimated_gb: 0,
      guide_url: null,
      explanation:
        "Exact system, OneDrive, and profile roots (drive roots, C:\\Windows, Program Files, ProgramData, C:\\Users\\<user>, OneDrive, %AppData%, %LocalAppData%) are hard-denied in app/src-tauri/src/safety.rs (is_safe_root :8-57). Only targeted cache subfolders are eligible.",
      what_happens:
        "Deleting an entire root folder destroys installed programs, synced personal OneDrive files, user settings, or Windows itself. Target a specific cache subfolder such as %LocalAppData%\\Temp or C:\\Windows\\WinSxS instead.",
    };
  }

  // 7. Shallow < 2 normal segments on Windows drive paths or UNC shares (safety.rs:13-19) except temp_dir or exact clean-items entries (e.g. C:\Windows.old, C:\$Windows.~BT)
  if (/^[a-z]:\\[^\\]+$/i.test(trimmedSlash) && trimmedSlash !== "c:\\temp") {
    const normInput = normalizeWindowsPathForMatch(cleanedPath, true);
    const isKnownShallowItem = items.some((it) =>
      splitItemPaths(it.path, it.slug).some((p) => normalizeWindowsPathForMatch(p) === normInput)
    );
    if (!isKnownShallowItem) {
      return {
        matched: true,
        verdict: "DO NOT DELETE — OS CRITICAL",
        badge_color: "red",
        slug: null,
        category: null,
        name: "Shallow Drive Root (< 2 Path Segments)",
        canonical_path: cleanedPath.slice(0, 512),
        avg_space: "OS Protected",
        estimated_gb: 0,
        guide_url: null,
        explanation:
          "Paths with fewer than 2 directory segments below a drive root (other than temp_dir) are rejected by app/src-tauri/src/safety.rs (is_safe_root :13-19).",
        what_happens: "SWEEPR refuses to delete shallow top-level folders directly on a drive root.",
      };
    }
  }

  if (/^\\\\[^\\]+(?:\\[^\\]+(?:\\[^\\]+)?)?$/i.test(trimmedSlash)) {
    return {
      matched: true,
      verdict: "DO NOT DELETE — OS CRITICAL",
      badge_color: "red",
      slug: null,
      category: null,
      name: "Shallow UNC / Network Share Root (< 2 Path Segments)",
      canonical_path: cleanedPath.slice(0, 512),
      avg_space: "OS Protected",
      estimated_gb: 0,
      guide_url: null,
      explanation:
        "Network UNC share roots and shallow share folders with fewer than 2 directory segments below \\\\server\\share are rejected per app/src-tauri/src/safety.rs (is_safe_root :13-19).",
      what_happens: "SWEEPR refuses to delete UNC share roots or shallow network folders.",
    };
  }

  return null;
}

const POSIX_PROTECTED_ROOT_MULTI_SLASH_RE =
  /^\/{2,}(?:etc|usr|bin|sbin|var|lib|lib64|dev|proc|sys|root|boot|opt|tmp|home|users|system|library|applications|volumes|private)(?:$|[\\/]|[,;\t])/i;

function isCommentOrHeaderLine(l: string): boolean {
  if (l.length === 0) return true;
  if (l.startsWith("#")) return true;
  if (
    l.startsWith("//") &&
    !/^\/\/(?:\/*[.?][\\/]|\/*[^/\s]+\/)/.test(l) &&
    !POSIX_PROTECTED_ROOT_MULTI_SLASH_RE.test(l)
  ) {
    return true;
  }
  if (/^"?path"?\s*[,;\t]/i.test(l)) return true;
  if (
    /^"?(?:folder|full\s*name|file\s*name|directory)"?\s*[,;\t]\s*"?(?:size|bytes|length|allocated|files|folders|modified|percent|%)/i.test(
      l
    )
  ) {
    return true;
  }
  return false;
}

export function analyzeSafeToDeleteInput(rawInput: string): SafeToDeleteAnalysis {
  const rawStr = String(rawInput ?? "");
  let boundedRaw = rawStr;
  if (rawStr.length > 16_384) {
    const slice = rawStr.slice(0, 16_384);
    if (!/[\r\n]$/.test(slice) && !/^[\r\n]/.test(rawStr.slice(16_384))) {
      const lastNl = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf("\r"));
      boundedRaw = lastNl >= 0 ? slice.slice(0, lastNl) : slice;
    } else {
      boundedRaw = slice;
    }
  }

  const lines = boundedRaw
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => !isCommentOrHeaderLine(l))
    .slice(0, 100);

  const items = getCleanItems();
  const results: SafeToDeleteMatchResult[] = [];

  let matchedCount = 0;
  let safeCount = 0;
  let cautionCount = 0;
  let dangerCount = 0;
  let totalGb = 0;

  for (const line of lines) {
    const boundedLine = line.slice(0, 4096);
    const displayLine = line.slice(0, 512);
    const { cleanedPath, metaCells } = parseCsvPathAndMeta(boundedLine);
    const reportedGb = parseReportedSizeGbFromMeta(metaCells);

    // Enforce safety.rs traversal, critical OS, and protected exact-root guards BEFORE length cap & heuristic item matching
    const protectedBoundary = classifyProtectedBoundary(cleanedPath, items);
    if (protectedBoundary) {
      if (protectedBoundary.badge_color === "red") dangerCount++;
      else if (protectedBoundary.badge_color === "amber") cautionCount++;
      results.push({
        input: displayLine,
        ...protectedBoundary,
      });
      continue;
    }

    if (line.length > 512) {
      results.push({
        input: displayLine,
        matched: false,
        verdict: "UNRECOGNIZED PATH",
        badge_color: "gray",
        slug: null,
        category: null,
        name: "Path Exceeds 512-Character Limit",
        canonical_path: displayLine,
        avg_space: reportedGb ? `${reportedGb} GB` : "Unknown",
        estimated_gb: 0,
        guide_url: "/clean",
        explanation:
          "Lines exceeding 512 characters are not matched against cache heuristics so long inputs cannot hide or truncate trailing segments.",
        what_happens:
          "Paste a single concise Windows folder path (under 512 characters) or inspect the directory directly with SWEEPR Cleaner.",
      });
      continue;
    }

    const normInput = normalizeWindowsPathForMatch(cleanedPath, true);

    let bestItem: CleanItem | null = null;
    let bestScore = 0;
    for (const item of items) {
      const score = scoreItemMatch(normInput, item);
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
        input: displayLine,
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

    results.push({
      input: displayLine,
      matched: false,
      verdict: "UNRECOGNIZED PATH",
      badge_color: "gray",
      slug: null,
      category: null,
      name: "Unlisted Custom Path",
      canonical_path: displayLine,
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
      "%LocalAppData%\\Microsoft\\EdgeWebView\\User Data\\Default\\Cache",
      "%AppData%\\CapCut\\User Data\\Cache",
      "C:\\Windows\\System32",
    ].join("\n");

  const initialAnalysis = analyzeSafeToDeleteInput(defaultSample);
  const totalRules = getCleanItems().length;
  const verifiedReviewCount = Number(process.env.SWEEPR_VERIFIED_REVIEW_COUNT ?? 0);
  const verifiedRatingValue = String(process.env.SWEEPR_VERIFIED_RATING_VALUE ?? "").trim();

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": "https://sweeprcleaner.com/safe-to-delete#webapp",
        name: "SWEEPR Windows 'Is It Safe to Delete?' Path & Cache Checker",
        url: "https://sweeprcleaner.com/safe-to-delete",
        image: ["https://sweeprcleaner.com/og-image.png", "https://sweeprcleaner.com/icon-512.png"],
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Windows 11, Windows 10",
        description:
          "Interactive Windows folder path safety checker. Paste any AppData, ProgramData, Steam, NVIDIA, or Windows folder path to verify if it is safe to delete.",
        author: { "@id": "https://sweeprcleaner.com/#founder" },
        publisher: { "@id": "https://sweeprcleaner.com/#organization" },
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
        },
      },
      {
        "@type": "Person",
        "@id": "https://sweeprcleaner.com/#founder",
        name: "Benjamin Cook",
        url: "https://sweeprcleaner.com/about",
        sameAs: ["https://github.com/BenCook1996"],
        worksFor: { "@id": "https://sweeprcleaner.com/#organization" },
      },
      {
        "@type": "Organization",
        "@id": "https://sweeprcleaner.com/#organization",
        name: "SWEEPR Cleaner",
        legalName: "Benjamin Cook t/a SWEEPR Cleaner",
        url: "https://sweeprcleaner.com/",
        logo: {
          "@type": "ImageObject",
          url: ORGANIZATION_LOGO_URL,
          width: 512,
          height: 512,
        },
        founder: { "@id": "https://sweeprcleaner.com/#founder" },
        sameAs: ORGANIZATION_SAME_AS,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "SWEEPR Cleaner", item: "https://sweeprcleaner.com/" },
          { "@type": "ListItem", position: 2, name: "Tools", item: "https://sweeprcleaner.com/tools" },
          {
            "@type": "ListItem",
            position: 3,
            name: "Safe to Delete Checker",
            item: "https://sweeprcleaner.com/safe-to-delete",
          },
        ],
      },
    ],
  });

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
              ${r.estimated_gb > 0 ? `Typical estimate: ~${r.estimated_gb} GB (${escapeHtml(r.avg_space)})` : escapeHtml(r.avg_space)}
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
        <div>
          <label for="pathInput" style="font-weight:700;font-size:0.92rem;display:block;">Paste Windows paths or folder names (one per line):</label>
          <span style="font-size:0.78rem;color:var(--muted);">Preset buttons load illustrative example footprints; paste your own CSV/paths for actual drive sizes.</span>
        </div>
        <div class="ed-filter-pills" style="margin-top:0;">
          <button type="button" class="ed-filter-pill" onclick="loadPreset('gaming')">Gaming &amp; Shaders (Example)</button>
          <button type="button" class="ed-filter-pill" onclick="loadPreset('dev')">AppData &amp; Dev (Example)</button>
          <button type="button" class="ed-filter-pill" onclick="loadPreset('win')">Windows Update (Example)</button>
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
        <div class="ed-kpi-label" id="kpiGbLabel">TYPICAL ESTIMATE (EXAMPLE)</div>
        <div class="ed-kpi-val" style="color:var(--accent);" id="kpiGb">~${initialAnalysis.estimated_reclaimable_gb} GB</div>
        <div id="kpiGbSub" style="font-size:0.72rem;color:var(--muted);margin-top:4px;">Illustrative footprint; varies by PC</div>
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
            SWEEPR Cleaner runs in Zero-Telemetry / Offline Mode (<code class="ed-code">telemetry_enabled = false</code> by default), skips files locked by active games or Windows services, keeps logins and save files intact, and backs Pro cleanups with 7-Day Undo Quarantine (configurable 2–10 GB disk budget, 5 GB default, same-volume O(1) move; OS Recycle Bin fallback if file exceeds budget; excludes shredded files, browser DBs, and registry edits). SWEEPR Free provides Unlimited Temp &amp; Browser Cache Clean (to OS Recycle Bin) &mdash; see <a href="/pricing" style="color:var(--accent);text-decoration:underline;font-weight:700;">Pro pricing</a> (<a href="/refund" style="color:var(--accent);text-decoration:underline;">14-day refund policy</a>), <a href="/vs/ccleaner" style="color:var(--accent);text-decoration:underline;">SWEEPR vs CCleaner</a>, or the <a href="/state-of-windows-storage" style="color:var(--accent);text-decoration:underline;">2026 Storage Study</a>.
          </p>
        </div>
        <div class="ed-actions" style="margin-top:0;" data-experiment-id="checker_cta_copy_v1" data-experiment-variant="${ctaVariant}">
          <a href="/order?plan=annual&amp;utm_source=safe_to_delete_cta&amp;exp_var=${ctaVariant}" rel="nofollow" id="checkerMainProCta" class="ed-btn-primary btn-press" onclick="if(window.sweeprTrack)window.sweeprTrack('experiment_conversion',{experiment:'checker_cta_copy_v1',variant:'${ctaVariant}',action:'order_annual'})">${escapeHtml(ctaButtonCopy)}</a>
          <a href="/download?platform=windows" rel="nofollow" class="ed-btn-secondary btn-press" onclick="if(window.sweeprTrack)window.sweeprTrack('experiment_conversion',{experiment:'checker_cta_copy_v1',variant:'${ctaVariant}',action:'download_exe'})">Download Free Scanner (.exe)</a>
          <a href="/pricing" class="ed-btn-secondary btn-press">Compare Free vs. Pro</a>
        </div>
      </div>
    </section>

    <section id="what-sweepr-never-touches" class="ed-section ed-card">
      <h2 class="ed-h2" style="margin-bottom:8px;">What SWEEPR Never Touches (Hard-Coded in safety.rs)</h2>
      <p style="font-size:0.9rem;color:var(--muted);margin-bottom:10px;">
        Even if a custom path rule points to a protected folder, <code class="ed-code">app/src-tauri/src/safety.rs</code> (<code class="ed-code">:8-134</code>) enforces deterministic boundary checks:
      </p>
      <div class="ed-table-wrap" style="margin-bottom:12px;">
        <table class="ed-table">
          <thead>
            <tr>
              <th>Protected Class</th>
              <th>Exact Scope Denied</th>
              <th>Rust Guardrail (<code class="ed-code">safety.rs</code>)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Relative &amp; Shallow Roots</strong></td>
              <td>Relative paths and roots with <code class="ed-code">&lt; 2</code> normal path segments (except exact <code class="ed-code">std::env::temp_dir()</code>).</td>
              <td class="mono">is_safe_root (:8-19)</td>
            </tr>
            <tr>
              <td><strong>Personal User Folders</strong></td>
              <td><code class="ed-code">home_dir</code>, <code class="ed-code">Documents</code> (<code class="ed-code">document_dir</code>), <code class="ed-code">Desktop</code> (<code class="ed-code">desktop_dir</code>), <code class="ed-code">Pictures</code> (<code class="ed-code">picture_dir</code>), <code class="ed-code">Videos</code> (<code class="ed-code">video_dir</code>), and <code class="ed-code">Audio</code> / <code class="ed-code">Music</code> (<code class="ed-code">audio_dir</code>).</td>
              <td class="mono">is_safe_root (:22-40)</td>
            </tr>
            <tr>
              <td><strong>Downloads Age Guard</strong></td>
              <td><code class="ed-code">download_dir</code> (<code class="ed-code">Downloads</code>) is denied by <code class="ed-code">is_safe_root</code> and only allowed in <code class="ed-code">is_safe_scan_root</code> when enforcing <code class="ed-code">min_age_hours &ge; 720</code> (30-day minimum age).</td>
              <td class="mono">is_safe_scan_root (:28, 62-74)</td>
            </tr>
            <tr>
              <td><strong>Profile &amp; App Config Roots</strong></td>
              <td>Exact roots <code class="ed-code">data_dir</code> (<code class="ed-code">%AppData%</code>), <code class="ed-code">data_local_dir</code> (<code class="ed-code">%LocalAppData%</code>), and <code class="ed-code">config_dir</code> are denied; only targeted cache subfolders are permitted.</td>
              <td class="mono">is_safe_root (:32-40, 56-57)</td>
            </tr>
            <tr>
              <td><strong>Windows OS Roots</strong></td>
              <td><code class="ed-code">SystemRoot</code> (<code class="ed-code">C:\Windows</code>), <code class="ed-code">ProgramFiles</code>, <code class="ed-code">ProgramFiles(x86)</code>, and <code class="ed-code">ProgramData</code> top-level roots are hard-denied.</td>
              <td class="mono">is_safe_root (:41-48)</td>
            </tr>
            <tr>
              <td><strong>Unix/macOS OS Roots</strong></td>
              <td><code class="ed-code">/</code>, <code class="ed-code">/usr</code>, <code class="ed-code">/bin</code>, <code class="ed-code">/etc</code>, <code class="ed-code">/var</code>, <code class="ed-code">/System</code>, <code class="ed-code">/Library</code>, and <code class="ed-code">/Applications</code> are hard-denied.</td>
              <td class="mono">is_safe_root (:49-54)</td>
            </tr>
            <tr>
              <td><strong>Symlinks, Junctions &amp; OneDrive</strong></td>
              <td>Parent traversal (<code class="ed-code">..</code> / <code class="ed-code">Component::ParentDir</code>), OS <code class="ed-code">symlink</code>s, NTFS <code class="ed-code">junction</code>s, and Windows <code class="ed-code">FILE_ATTRIBUTE_REPARSE_POINT (0x400)</code> OneDrive cloud placeholders checked across <code class="ed-code">root</code> and every ancestor.</td>
              <td class="mono">is_link_like / has_symlink_component (:82-134)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p style="font-size:0.84rem;color:var(--muted);margin:0;">
        <strong>Reproducible Scan Benchmark (2026-11-26):</strong> Read-only Rust scan on <strong>Intel(R) Celeron(R) N5095 @ 2.00GHz</strong> (15.78 GB RAM, <strong>XINCUU-512GB SATA SSD</strong>, Windows 11 Pro 25H2 Build 26200) inspected <strong>98,247 files</strong> across <strong>27 Windows rules</strong> (14 non-empty categories) in <strong>544,007 ms</strong> (<strong>180.6 files/sec</strong>), identifying <strong>14.97 GB (13.94 GiB)</strong> eligible &mdash; <a href="/state-of-windows-storage#local-hardware-benchmark" style="color:var(--accent);text-decoration:underline;font-weight:700;">view full 14-category breakdown</a>.
      </p>
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
        "%LocalAppData%\\\\npm-cache\\\\_cacache, 9.2 GB",
        "%UserProfile%\\\\.gradle\\\\caches, 18.6 GB",
        "%LocalAppData%\\\\pip\\\\Cache, 11.4 GB",
        "%LocalAppData%\\\\JetBrains\\\\IntelliJIdea2025.1\\\\caches, 14.0 GB",
        "%UserProfile%\\\\.cache\\\\lm-studio\\\\models, 32.0 GB",
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
      runAudit(true);
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
        const rawFileText = String(evt.target.result || '');
        let boundedText = rawFileText.slice(0, 15000);
        if (rawFileText.length > 15000 && !/[\\r\\n]$/.test(boundedText) && !/^[\\r\\n]/.test(rawFileText.slice(15000))) {
          const lastNl = Math.max(boundedText.lastIndexOf('\\n'), boundedText.lastIndexOf('\\r'));
          if (lastNl > 0) boundedText = boundedText.slice(0, lastNl);
        }
        document.getElementById('pathInput').value = boundedText;
        runAudit();
      };
      reader.readAsText(file);
    }

    function esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    async function runAudit(isPreset) {
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
        const kpiLabel = document.getElementById('kpiGbLabel');
        const kpiSub = document.getElementById('kpiGbSub');
        if (kpiLabel) kpiLabel.textContent = isPreset ? 'EXAMPLE FOOTPRINT (PRESET)' : 'TYPICAL ESTIMATE';
        if (kpiSub) kpiSub.textContent = isPreset ? 'Illustrative sample sizes — paste your own CSV for real totals' : 'Based on matched folder averages; actual disk usage varies';
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
              '<div class="mono" style="font-size:0.84rem;font-weight:700;color:var(--accent);">' + (r.estimated_gb > 0 ? 'Typical estimate: ~' + r.estimated_gb + ' GB (' + esc(r.avg_space) + ')' : esc(r.avg_space)) + '</div>' +
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
