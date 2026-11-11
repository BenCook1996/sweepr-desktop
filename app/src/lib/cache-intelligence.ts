import rawIntelligence from "./cache-intelligence.json";
import type { CategoryResult } from "./api";

export interface CacheIntelligenceEntry {
  slug: string;
  category: string;
  name: string;
  owner: string;
  path: string;
  pathPatterns: string[];
  safeToDelete: boolean;
  safetyBadge: "100% Safe Automated" | "Review Recommended";
  avgSpace: string;
  whatItIs: string;
  whatHappensIfDeleted: string;
  rebuildCost: string;
  warning?: string;
}

export const CACHE_INTELLIGENCE: CacheIntelligenceEntry[] =
  rawIntelligence as CacheIntelligenceEntry[];

function normalizeLookupPath(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\\/g, "/")
    .replace(/^[a-zA-Z]:\/users\/[^/]+\/appdata\/roaming/i, "%appdata%")
    .replace(/^[a-zA-Z]:\/users\/[^/]+\/appdata\/local/i, "%localappdata%")
    .replace(/^\/users\/[^/]+\/library\/caches/i, "~/library/caches")
    .replace(/^\/users\/[^/]+\/library\/application support/i, "~/library/application support")
    .toLowerCase();
}

const RULE_ID_TO_SLUG_HINTS: Record<string, string[]> = {
  system_temp: ["windows-temp-folder", "localappdata-temp"],
  windows_logs: ["windows-logs-cbs", "windows-error-reporting"],
  windows_prefetch: ["windows-prefetch"],
  windows_update_cache: ["windows-update-download-cache", "delivery-optimization-cache"],
  directx_shader_cache: ["directx-shader-cache", "nvidia-dx-cache", "amd-dx-cache"],
  thumbnails: ["windows-thumbnail-cache"],
  crash_dumps: ["windows-memory-dump", "windows-error-reporting"],
  chrome_cache: ["chrome-service-worker-cache", "google-chrome-cache"],
  edge_cache: ["microsoft-edge-cache", "webview2-ebwebview-cache"],
  brave_cache: ["brave-browser-cache"],
  firefox_cache: ["firefox-cache2"],
  opera_cache: ["opera-gx-cache"],
  vivaldi_cache: ["vivaldi-cache"],
  discord_cache: ["discord-cache"],
  spotify_cache: ["spotify-cache"],
  steam_shader_cache: ["steam-shader-cache", "steam-depotcache"],
  steam_cache: ["steam-depotcache", "steam-shader-cache"],
  riot_valorant_logs: ["riot-client-logs"],
  genshin_hoyoplay_cache: ["genshin-impact-hoyoplay-cache", "hoyoplay-fedata-cache"],
  elgato_streamdeck_cache: ["elgato-streamdeck-cache"],
  peripheral_caches: ["logitech-ghub-installer-cache", "logitech-options-plus-cache"],
  shader_cache: ["nvidia-dxcache", "amd-shader-cache"],
  vscode_cache: ["vscode-cacheddata"],
  npm_cache: ["npm-cache"],
  pip_cache: ["pip-cache"],
  cargo_cache: ["cargo-registry-cache"],
  gradle_cache: ["gradle-caches"],
};

export function resolveRuleSafetyIntelligence(cat: CategoryResult): CacheIntelligenceEntry {
  const idLower = (cat.id || "").toLowerCase();
  const nameLower = (cat.name || "").toLowerCase();
  const rootsJoined = (cat.roots || []).join(" · ");

  // 1. Direct slug hint lookup
  const hints = RULE_ID_TO_SLUG_HINTS[idLower];
  if (hints) {
    for (const slug of hints) {
      const hit = CACHE_INTELLIGENCE.find((item) => item.slug === slug);
      if (hit) {
        return {
          ...hit,
          path: rootsJoined || hit.path,
        };
      }
    }
  }

  // 2. Match by normalized scanned root paths or category tokens
  const normRoots = (cat.roots || []).map(normalizeLookupPath);
  const idWords = idLower.replace(/_cache$|_temp$|_logs$/g, "").split(/[_\s-]+/).filter((w) => w.length >= 3);

  let bestEntry: CacheIntelligenceEntry | null = null;
  let bestScore = 0;

  for (const entry of CACHE_INTELLIGENCE) {
    let score = 0;
    const entrySlug = entry.slug.toLowerCase();
    const entryName = entry.name.toLowerCase();
    const entryPathNorm = normalizeLookupPath(entry.path);

    for (const r of normRoots) {
      if (r && entryPathNorm && (r.includes(entryPathNorm) || entryPathNorm.includes(r))) {
        score += 45;
      }
      for (const pat of entry.pathPatterns) {
        const patLower = pat.toLowerCase();
        if (patLower.length >= 4 && r.includes(patLower)) {
          score += 30;
        }
      }
    }

    for (const w of idWords) {
      if (entrySlug.includes(w)) score += 20;
      if (entryName.includes(w)) score += 15;
    }

    if (nameLower && entryName.includes(nameLower)) {
      score += 25;
    }

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (bestEntry && bestScore >= 20) {
    return {
      ...bestEntry,
      path: rootsJoined || bestEntry.path,
    };
  }

  // 3. Fallback using CategoryResult metadata
  const isReviewCategory = /download|old_download|remnant|winsxs|windows_old/i.test(idLower);
  const isShader = /shader|gpu|nv_cache|dxcache/i.test(idLower + " " + nameLower);
  const isBrowser = /chrome|edge|brave|firefox|safari|opera|vivaldi|arc|browser|webview/i.test(
    idLower + " " + nameLower
  );

  return {
    slug: idLower,
    category: cat.group || "app",
    name: cat.name,
    owner:
      cat.group === "system"
        ? "Operating System Cache"
        : cat.group === "browsers"
        ? "Web Browser Engine"
        : cat.group === "developer"
        ? "Developer Toolchain"
        : cat.name.split(/\s+/)[0] || "Application Cache",
    path: rootsJoined || "%LocalAppData% / System Cache",
    pathPatterns: cat.roots || [],
    safeToDelete: !isReviewCategory,
    safetyBadge: isReviewCategory ? "Review Recommended" : "100% Safe Automated",
    avgSpace: "500 MB – 5.0 GB",
    whatItIs:
      cat.description ||
      "Temporary cache and staging files written automatically to accelerate app or OS operations.",
    whatHappensIfDeleted: isShader
      ? "Safe: game and GPU shaders recompile automatically on next launch; active logins and save files are never touched."
      : isBrowser
      ? "Safe: static web cache is cleared while keeping your active logins, saved passwords, bookmarks, and history intact."
      : isReviewCategory
      ? "Review recommended: verify no needed installers or personal archives are inside before cleaning."
      : "Safe: temporary cache files regenerate automatically on next launch; active logins, settings, and personal files are never touched.",
    rebuildCost: isShader
      ? "Low (1–3s on next game launch as shaders recompile)"
      : isBrowser
      ? "Negligible (web assets re-cache transparently as you browse)"
      : "Zero to Low (recreated automatically when needed)",
  };
}

export function resolveFilePathSafetyIntelligence(
  rawInput: string,
  parentCat?: CategoryResult
): {
  matched: CacheIntelligenceEntry;
  otherMatches: CacheIntelligenceEntry[];
} {
  const trimmed = String(rawInput || "").trim();
  const norm = normalizeLookupPath(trimmed);

  // Guardrail check for sensitive personal / critical OS paths
  if (
    /(?:^|\/)(?:documents|pictures|photos|desktop|music|videos|saved games|\.ssh|\.gnupg|\.aws|id_rsa|wallet\.dat)(?:\/|$)/i.test(
      norm
    ) &&
    !/cache|temp|tmp|log|thumb|shadercache/i.test(norm)
  ) {
    const protectedEntry: CacheIntelligenceEntry = {
      slug: "protected-personal-folder",
      category: "folder",
      name: "Protected Personal Folder / Credentials",
      owner: "User Personal Data (Protected by SWEEPR Guardrails)",
      path: trimmed,
      pathPatterns: [trimmed],
      safeToDelete: false,
      safetyBadge: "Review Recommended",
      avgSpace: "Varies",
      whatItIs:
        "This path points inside a personal user directory or credential store rather than a temporary application cache.",
      whatHappensIfDeleted:
        "SWEEPR never auto-deletes personal documents, photos, SSH keys, or save files. Only delete files here if you have manually reviewed them.",
      rebuildCost: "Permanent user data — cannot be regenerated automatically",
      warning: "Protected personal path — excluded from automated cache cleanup.",
    };
    return { matched: protectedEntry, otherMatches: [] };
  }

  const scored: { entry: CacheIntelligenceEntry; score: number }[] = [];
  const queryTokens = norm
    .replace(/[^a-z0-9_.-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  for (const entry of CACHE_INTELLIGENCE) {
    let score = 0;
    const entryPathNorm = normalizeLookupPath(entry.path);
    const entryNameLower = entry.name.toLowerCase();
    const entrySlugLower = entry.slug.toLowerCase();
    const entryOwnerLower = entry.owner.toLowerCase();

    if (norm.length >= 3) {
      if (entryPathNorm === norm || entrySlugLower === norm) score += 100;
      else if (entryPathNorm.includes(norm) || norm.includes(entryPathNorm)) score += 65;

      for (const pat of entry.pathPatterns) {
        const patNorm = normalizeLookupPath(pat);
        if (patNorm.length >= 3 && (norm.includes(patNorm) || patNorm.includes(norm))) {
          score += 45;
        }
      }

      if (entryNameLower.includes(norm)) score += 40;
      if (entryOwnerLower.includes(norm)) score += 30;
    }

    for (const tok of queryTokens) {
      if (entrySlugLower.includes(tok)) score += 14;
      if (entryNameLower.includes(tok)) score += 12;
      if (entryPathNorm.includes(tok)) score += 15;
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length > 0 && scored[0].score >= 18) {
    const top = scored[0].entry;
    return {
      matched: {
        ...top,
        path: trimmed.includes("\\") || trimmed.includes("/") ? trimmed : top.path,
      },
      otherMatches: scored.slice(1, 5).map((s) => s.entry),
    };
  }

  if (parentCat) {
    const ruleIntel = resolveRuleSafetyIntelligence(parentCat);
    return {
      matched: {
        ...ruleIntel,
        path: trimmed || ruleIntel.path,
      },
      otherMatches: [],
    };
  }

  const isLikelySafeCache = /cache|gpucache|code cache|shadercache|dxcache|temp|tmp|logs|crashpad|prefetch|thumb/i.test(
    trimmed
  );

  return {
    matched: {
      slug: "custom-path-check",
      category: "folder",
      name: trimmed || "Custom Folder Path",
      owner: isLikelySafeCache ? "Detected Cache / Temp Directory" : "Unindexed Folder Path",
      path: trimmed || "Paste any folder path above",
      pathPatterns: [trimmed],
      safeToDelete: isLikelySafeCache,
      safetyBadge: isLikelySafeCache ? "100% Safe Automated" : "Review Recommended",
      avgSpace: "Varies",
      whatItIs: isLikelySafeCache
        ? "This path matches standard OS or application cache/temp naming conventions (Cache, GPUCache, ShaderCache, Temp, or Logs)."
        : "This path is not in SWEEPR's 377-item verified cache whitelist.",
      whatHappensIfDeleted: isLikelySafeCache
        ? "Safe: cached assets and temporary staging files are recreated automatically by the owning application on next launch; active logins and personal files are untouched."
        : "Review recommended: verify that this folder does not contain project source files, personal media, or game saves before deleting.",
      rebuildCost: isLikelySafeCache
        ? "Low (regenerated automatically on next app launch)"
        : "Unknown — inspect folder contents before removing",
    },
    otherMatches: scored.slice(0, 4).map((s) => s.entry),
  };
}
