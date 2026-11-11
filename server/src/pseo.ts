import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getActiveTelemetryTruthForSlug } from "./seo/telemetry-truth.js";
import { getPublishedBloatWatchForCleanSlug } from "./seo/bloat-watch.js";
import { escapeHtml as esc } from "./security.js";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLEAN_ITEMS_FILE = join(__dirname, "data", "clean-items.json");
const cleanItemsData = require("./data/clean-items.json");
const pseoRedirectsData: Record<string, string> = require("./data/pseo-redirects.json");

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
  metaTitle?: string;
  metaDescription?: string;
  customFaqs?: Array<{ q: string; a: string }>;
  subLocations?: Array<{ subPath: string; role: string; avgSpace: string; safe: string }>;
  competitorBlueprint?: {
    sourceDomain: string;
    sourceUrl?: string;
    replicatedPatterns: string[];
    superiorityFixes: string[];
  };
  noindex?: boolean;
  mergedIntoSlug?: string;
  retiredReason?: string;
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

const RETIRED_VARIANT_SUFFIX_RE =
  /-(service-worker-cachestorage|media-blob-storage|code-bytecode-cache|gpu-shader-cache|crashpad-dump-logs)$/;

export function getPseoRedirectTarget(category: string, slug: string): string | undefined {
  getCleanItems();
  const key = `${category}:${slug}`;
  if (cleanItemsMap.has(key)) {
    return undefined;
  }
  const direct = pseoRedirectsData[key];
  if (direct) {
    return direct;
  }
  if (slug === "nvidia-shader-cache" || slug === "nvidia-dx-cache") {
    return "/clean/app/nvidia-dxcache";
  }
  if (slug === "livekernelreports") {
    return "/clean/folder/windows-livekernelreports";
  }
  if (slug === "vivaldi-cache") {
    return "/clean/app/vivaldi-browser-cache";
  }
  if (slug === "intellij-idea-caches" || slug === "intellij-cache") {
    return "/clean/app/jetbrains-intellij-cache";
  }
  if (
    slug === "elgato-stream-deck-cache" ||
    slug === "elgato-stream-deck-media-blob-storage" ||
    slug === "elgato-stream-deck-code-bytecode-cache" ||
    slug === "elgato-stream-deck-service-worker-cachestorage" ||
    slug === "elgato-stream-deck-gpu-shader-cache" ||
    slug === "elgato-stream-deck-crashpad-dump-logs" ||
    (slug.startsWith("elgato-streamdeck-") && slug !== "elgato-streamdeck-cache")
  ) {
    return "/clean/app/elgato-streamdeck-cache";
  }
  // Cross-category canonical redirect (e.g. /clean/folder/<slug> when item is /clean/app/<slug>)
  const otherCategory = category === "app" ? "folder" : "app";
  const crossMatch = cleanItemsMap.get(`${otherCategory}:${slug}`);
  if (crossMatch) {
    return `/clean/${crossMatch.category}/${crossMatch.slug}`;
  }
  if (RETIRED_VARIANT_SUFFIX_RE.test(slug)) {
    const base = slug.replace(RETIRED_VARIANT_SUFFIX_RE, "");
    const candidates = [`${base}-cache`, base, `${base}-logs`, `${base}-installer-cache`];
    for (const cand of candidates) {
      const match = cleanItemsMap.get(`app:${cand}`) || cleanItemsMap.get(`folder:${cand}`);
      if (match) {
        return `/clean/${match.category}/${match.slug}`;
      }
    }
  }
  return undefined;
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
  "steam-depotcache": "Can I Delete Steam depotcache? YES — Safe Cleanup Guide (Reclaim 2–25 GB)",
  "riot-client-logs": "Can I Delete Riot Client Logs? YES — Safe Cleanup Guide (Reclaim 1.5–8 GB)",
  "logitech-ghub-installer-cache": "Can I Delete LGHUB Depots Cache? YES — Safe Cleanup Guide (Reclaim 1.5–8 GB)",
  "stremio-desktop-cache": "Can I Delete Stremio Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9.5 GB)",
  "amd-shader-cache": "Can I Delete AMD DxCache? YES — Safe Cleanup Guide (Reclaim 2–12 GB)",
  "comfyui-temp-output-cache": "Can I Delete ComfyUI Temp Cache? YES — Safe Cleanup Guide (Reclaim 2–18 GB)",
  "genshin-impact-update-cache": "Can I Delete Genshin Impact Temp? YES — Safe Cleanup Guide (Reclaim 3–22 GB)",
  "winsxs": "Can I Delete C:\\Windows\\WinSxS? YES — Safe Cleanup Guide (Reclaim 6–20 GB)",
  "programdata-package-cache": "Can I Delete ProgramData Package Cache? YES — Safe Cleanup Guide (Reclaim 3.5–22 GB)",
  "windows-livekernelreports": "Can I Delete LiveKernelReports? YES — Safe Cleanup Guide (Reclaim 1.5–10 GB)",
  "livekernelreports": "Can I Delete LiveKernelReports? YES — Safe Cleanup Guide (Reclaim 1.5–10 GB)",
  "logitech-options-plus-cache": "Can I Delete LogiOptionsPlus Cache? YES — Safe Cleanup Guide (Reclaim 1.2–6.5 GB)",
  "elgato-streamdeck-cache":
    "Can I Delete %APPDATA%\\Elgato\\StreamDeck? YES — Safe Cleanup Guide (Reclaim 1–4 GB)",
  "vivaldi-browser-cache": "Can I Delete Vivaldi Browser Cache? YES — Safe Cleanup Guide (Reclaim 1–5 GB)",
  "vivaldi-cache": "Can I Delete Vivaldi Browser Cache? YES — Safe Cleanup Guide (Reclaim 1–5 GB)",
  "jetbrains-intellij-cache": "Can I Delete IntelliJ IDEA Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9.5 GB)",
  "intellij-idea-caches": "Can I Delete IntelliJ IDEA Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9.5 GB)",
  "dolphin-emulator-cache": "Can I Delete Dolphin Emulator Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9.5 GB)",
  "zen-browser-cache": "Can I Delete Zen Browser Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9.5 GB)",
  "opera-gx-cache": "Can I Delete Opera GX Cache? YES — Safe Cleanup Guide (Reclaim 1.8–12 GB)",
  "medal-tv-cache": "Can I Delete Medal TV Cache? YES — Safe Cleanup Guide (Reclaim 2–14 GB)",
  "capcut-desktop-cache": "Can I Delete CapCut PC Cache? YES — Safe Cleanup Guide (Reclaim 2.5–18 GB)",
  "capcut-pc-cache": "Can I Delete CapCut PC Cache? YES — Safe Cleanup Guide (Reclaim 2.5–18 GB)",
  "obs-studio-logs-crashes": "Can I Delete OBS Studio Logs & Cache? YES — Safe Cleanup Guide (Reclaim 1–6.5 GB)",
  "adobe-media-cache": "Can I Delete Adobe Media Cache? YES — Safe Cleanup Guide (Reclaim 10–80 GB)",
  "creative-cloud-installer-cache": "Can I Delete Adobe Creative Cloud Cache? YES — Safe Cleanup Guide (Reclaim 2–12 GB)",
  "nvidia-dxcache": "Can I Delete NVIDIA DXCache? YES — Safe Cleanup Guide (Reclaim 2–14 GB)",
  "npm-cache": "Can I Delete %LOCALAPPDATA%\\npm-cache? YES — Safe Cleanup Guide (Reclaim 2–18 GB)",
  "gradle-wrapper-caches": "Can I Delete .gradle\\caches? YES — Safe Cleanup Guide (Reclaim 4–35 GB)",
  "localappdata-crashdumps": "Can I Delete %LOCALAPPDATA%\\CrashDumps? YES — Safe Cleanup Guide (Reclaim 1–15 GB)",
  "hiberfil-sys": "Can I Delete C:\\hiberfil.sys? YES — Safe Cleanup Guide (Reclaim 6–32 GB)",
  "windows-old": "Can I Delete C:\\Windows.old? YES — Safe Cleanup Guide (Reclaim 15–35 GB)",
  "pip-cache": "Can I Delete %LOCALAPPDATA%\\pip\\Cache? YES — Safe Cleanup Guide (Reclaim 2–20 GB)",
  "delivery-optimization": "Can I Delete DeliveryOptimization Cache? YES — Safe Cleanup Guide (Reclaim 3–20 GB)",
  "c-drive-filling-up-by-itself-windows-11": "Can I Delete Hidden C: Drive Bloat? YES — Safe Cleanup Guide (Reclaim 12–65 GB)",
  "system-and-reserved-storage-100gb-windows-11": "Can I Delete System & Reserved Bloat? YES — Safe Cleanup Guide (Reclaim 10–60 GB)",
  "appdata-local-folder-huge-windows-11": "Can I Delete %LOCALAPPDATA% Cache Bloat? YES — Safe Cleanup Guide (Reclaim 10–50 GB)",
  "windows-11-24h2-update-cache-8gb-bug": "Can I Delete Windows 11 24H2 Update Cache? YES — Safe Cleanup Guide (Reclaim 8.6 GB)",
  "other-storage-full-windows-11-cleanup": "Can I Delete Windows 11 Temporary Files? YES — Safe Cleanup Guide (Reclaim 6–45 GB)",
  "localappdata-webview2-ebwebview-cache": "Can I Delete WebView2 EBWebView Cache? YES — Safe Cleanup Guide (Reclaim 1.5–9 GB)",
  "ea-app-cache": "Can I Delete EA App Cache? YES — Safe Cleanup Guide (Reclaim 1.5–6 GB)",
  "epic-games-webcache": "Can I Delete Epic Games webcache? YES — Safe Cleanup Guide (Reclaim 1–5 GB)",
  "chrome-gpu-shader-cache": "Can I Delete Chrome GPUCache? YES — Safe Cleanup Guide (Reclaim 1–6 GB)",
  "vrchat-cache": "Can I Delete VRChat Cache-WindowsPlayer? YES — Safe Cleanup Guide (Reclaim 10–30 GB)",
  "lm-studio-models-cache": "Can I Delete LM Studio Models Cache? YES — Safe Cleanup Guide (Reclaim 10–80 GB)",
};

export const CUSTOM_GSC_TITLE_SLUGS: readonly string[] = Object.keys(CUSTOM_GSC_TITLES);

const CUSTOM_GSC_DESCRIPTIONS: Record<string, string> = {
  "steam-depotcache":
    "Can I delete C:\\Program Files (x86)\\Steam\\depotcache? YES (2–25 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "riot-client-logs":
    "Can I delete %LOCALAPPDATA%\\VALORANT\\Saved\\Logs? YES (1.5–8 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "logitech-ghub-installer-cache":
    "Can I delete C:\\ProgramData\\LGHUB\\depots? YES (1.5–8 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "stremio-desktop-cache":
    "Can I delete %APPDATA%\\stremio\\Cache? YES (1.5–9.5 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "amd-shader-cache":
    "Can I delete %LOCALAPPDATA%\\AMD\\DxCache? YES (2–12 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "comfyui-temp-output-cache":
    "Can I delete C:\\ComfyUI\\temp & %LOCALAPPDATA%\\Temp\\comfyui? YES (2–18 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "genshin-impact-update-cache":
    "Delete C:\\Program Files\\HoYoPlay\\games\\Genshin Impact game\\Temp (3–22 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "winsxs":
    "Can I clean C:\\Windows\\WinSxS via DISM? YES (6–20 GB). Zero save files or active logins lost. Manual DISM steps + 1-click free 6.5 MB Sweepr scan.",
  "programdata-package-cache":
    "Can I delete orphaned C:\\ProgramData\\Package Cache? YES (3.5–22 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "windows-livekernelreports":
    "Can I delete C:\\Windows\\LiveKernelReports\\WATCHDOG? YES (1.5–10 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "livekernelreports":
    "Can I delete C:\\Windows\\LiveKernelReports\\WATCHDOG? YES (1.5–10 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "logitech-options-plus-cache":
    "Can I delete %LOCALAPPDATA%\\LogiOptionsPlus\\cache? YES (1.2–6.5 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "elgato-streamdeck-cache":
    "Can I delete %APPDATA%\\Elgato\\StreamDeck cache? YES (1–4 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "vivaldi-browser-cache":
    "Can I delete %LOCALAPPDATA%\\Vivaldi\\User Data\\Default\\Cache? YES (1–5 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "vivaldi-cache":
    "Can I delete %LOCALAPPDATA%\\Vivaldi\\User Data\\Default\\Cache? YES (1–5 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "jetbrains-intellij-cache":
    "Can I delete %LOCALAPPDATA%\\JetBrains\\IntelliJIdea caches? YES (1.5–9.5 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "intellij-idea-caches":
    "Can I delete %LOCALAPPDATA%\\JetBrains\\IntelliJIdea caches? YES (1.5–9.5 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "dolphin-emulator-cache":
    "Can I delete %APPDATA%\\Dolphin Emulator\\cache? YES (1.5–9.5 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "zen-browser-cache":
    "Can I delete %APPDATA%\\zen\\Profiles\\Cache? YES (1.5–9.5 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "opera-gx-cache":
    "Can I delete %LOCALAPPDATA%\\Opera Software\\Opera GX Stable\\Cache? YES (1.8–12 GB). Zero save files or active logins lost. Manual + 1-click 6.5 MB Sweepr scan.",
  "medal-tv-cache":
    "Can I delete %APPDATA%\\Medal\\Cache? YES (2–14 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "capcut-desktop-cache":
    "Can I delete %LOCALAPPDATA%\\CapCut\\User Data\\Cache? YES (2.5–18 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "capcut-pc-cache":
    "Can I delete %LOCALAPPDATA%\\CapCut\\User Data\\Cache? YES (2.5–18 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "obs-studio-logs-crashes":
    "Can I delete %APPDATA%\\obs-studio\\logs & Cache? YES (1–6.5 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "adobe-media-cache":
    "Can I delete %APPDATA%\\Adobe\\Common\\Media Cache Files? YES (10–80 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "creative-cloud-installer-cache":
    "Can I delete %LOCALAPPDATA%\\Adobe\\Creative Cloud? YES (2–12 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "nvidia-dxcache":
    "Can I delete %LOCALAPPDATA%\\NVIDIA\\DXCache? YES (2–14 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "npm-cache":
    "Can I delete %LOCALAPPDATA%\\npm-cache? YES (2–18 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "gradle-wrapper-caches":
    "Can I delete %USERPROFILE%\\.gradle\\caches? YES (4–35 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "localappdata-crashdumps":
    "Can I delete %LOCALAPPDATA%\\CrashDumps? YES (1–15 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "hiberfil-sys":
    "Can I delete C:\\hiberfil.sys on Windows 11? YES (6–32 GB). Zero save files or active logins lost. Manual powercfg steps + 1-click free 6.5 MB Sweepr scan.",
  "windows-old":
    "Can I delete C:\\Windows.old on Windows 11? YES (15–35 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "pip-cache":
    "Can I delete %LOCALAPPDATA%\\pip\\Cache? YES (2–20 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "delivery-optimization":
    "Can I delete Windows DeliveryOptimization cache? YES (3–20 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "c-drive-filling-up-by-itself-windows-11":
    "C: drive filling up in %LOCALAPPDATA% & C:\\Windows\\Temp? Reclaim 12–65 GB. Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "system-and-reserved-storage-100gb-windows-11":
    "System & Reserved taking 100GB in C:\\Windows\\WinSxS? Reclaim 10–60 GB. Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "appdata-local-folder-huge-windows-11":
    "Can I delete %LOCALAPPDATA%\\Temp & GPUCache bloat? YES (10–50 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "windows-11-24h2-update-cache-8gb-bug":
    "Fix Windows 11 24H2 8.63 GB cache in C:\\Windows\\WinSxS\\Temp. Zero save files or active logins lost. Manual DISM steps + 1-click free 6.5 MB Sweepr scan.",
  "other-storage-full-windows-11-cleanup":
    "Clean 'Other' storage in C:\\ProgramData\\Package Cache (6–45 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "localappdata-webview2-ebwebview-cache":
    "Can I delete %LOCALAPPDATA%\\Microsoft\\EdgeWebView\\User Data? YES (1.5–9 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "ea-app-cache":
    "Can I delete %LOCALAPPDATA%\\Electronic Arts\\EA Desktop\\cache? YES (1.5–6 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "epic-games-webcache":
    "Can I delete %LOCALAPPDATA%\\EpicGamesLauncher\\Saved\\webcache? YES (1–5 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "chrome-gpu-shader-cache":
    "Can I delete %LOCALAPPDATA%\\Google\\Chrome\\User Data\\ShaderCache? YES (1–6 GB). Zero save files or active logins lost. Manual + 1-click 6.5 MB Sweepr scan.",
  "vrchat-cache":
    "Can I delete %LOCALAPPDATA%Low\\VRChat\\VRChat\\Cache-WindowsPlayer? YES (10–30 GB). Zero save files or active logins lost. Manual + 1-click 6.5 MB Sweepr scan.",
  "lm-studio-models-cache":
    "Can I delete %USERPROFILE%\\.cache\\lm-studio\\models? YES (10–80 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
};

export type PseoClusterId =
  | "gaming"
  | "gpu"
  | "creative"
  | "devtools"
  | "browsers_chat"
  | "win_update"
  | "win_crash_logs"
  | "win_system";

export function classifyPseoCluster(item: CleanItem): PseoClusterId {
  const s = `${item.slug} ${item.name} ${item.path}`.toLowerCase();
  if (item.category === "folder") {
    if (
      /winsxs|softwaredistribution|package-cache|installer-patch|delivery-optimization|windows-old|catroot2|servicing|wuau|rempl|sihclient|usoclient|waasmedic/.test(
        s
      )
    ) {
      return "win_update";
    }
    if (/livekernelreports|wer|minidump|memory-dmp|crashdumps|cbs-logs|panther|dism-logs|winevt|sru|perflogs|etl/.test(s)) {
      return "win_crash_logs";
    }
    return "win_system";
  }

  if (
    /nvidia|amd-dx|intel-shader|directx-shader|vulkan|shader|geforce|adrenalin|msi-afterburner|rivatuner|3dmark|furmark/.test(
      s
    )
  ) {
    return "gpu";
  }
  if (
    /steam|epic-games|riot|valorant|battlenet|ea-app|ubisoft|gog-galaxy|xbox|minecraft|roblox|genshin|honkai|fortnite|call-of-duty|apex|overwatch|fivem|curseforge|overwolf|modrinth|vortex|nexus-mods|playnite|retroarch|rpcs3|yuzu|ryujinx|dolphin|pcsx2|cemu|ppsspp|duckstation|medal|parsec|moonlight|sunshine|razer|corsair|steelseries|logitech-ghub|armoury-crate|nzxt|lian-li|signalrgb|openrgb|vrchat|oculus|steamvr|faceit|esea|we-mod|plitch/.test(
      s
    )
  ) {
    return "gaming";
  }
  if (
    /adobe|creative-cloud|premiere|after-effects|photoshop|lightroom|illustrator|indesign|audition|davinci|capcut|obs-studio|streamlabs|elgato|figma|canva|affinity|blender|unreal-engine|unity|godot|maya|3ds-max|cinema-4d|zbrush|substance|houdini|autocad|revit|solidworks|sketchup|rhino|lumion|enscape|twinmotion|handbrake|topaz|vlc|plex|jellyfin|kodi|ableton|fl-studio|reaper|cubase|studio-one|pro-tools|native-instruments|splice|musescore|audacity|kdenlive|shotcut|clip-studio|krita|gimp|inkscape|pureref|eagle|gyroflow|snagit|camtasia/.test(
      s
    )
  ) {
    return "creative";
  }
  if (
    /npm|pnpm|yarn|bun|pip|conda|poetry|uv-python|cargo|rustup|go-build|gradle|maven|nuget|composer|cocoapods|vcpkg|conan|huggingface|ollama|lm-studio|pytorch|vs-code|cursor|windsurf|zed|visual-studio|jetbrains|intellij|pycharm|webstorm|rider|clion|goland|android-studio|docker|podman|vagrant|virtualbox|vmware|wsl|gitkraken|sourcetree|github-desktop|fork|postman|insomnia|bruno|dbeaver|datagrip|pgadmin|mongodb|tableplus|wireshark|fiddler|charles|ngrok|Tailscale|cloudflare|putty|mobaxterm|winscp|filezilla|termius|tabby|wezterm|alacritty|cypress|playwright|puppeteer|electron-cache|node-gyp|storybook|nx-workspace|turborepo|expo/.test(
      s
    )
  ) {
    return "devtools";
  }
  return "browsers_chat";
}

interface ClusterProfile {
  id: PseoClusterId;
  label: string;
  badge: string;
  sectionTitle: (item: CleanItem) => string;
  leadParagraph: (item: CleanItem) => string;
  mechanicsParagraph: (item: CleanItem) => string;
  protectedSummary: string;
  removedSummary: string;
  extraFaq: (item: CleanItem) => { q: string; a: string };
}

const CLUSTER_PROFILES: Record<PseoClusterId, ClusterProfile> = {
  gaming: {
    id: "gaming",
    label: "PC Gaming Launchers, Depots & Peripherals",
    badge: "🎮 Gaming & Launcher Storage",
    sectionTitle: (item) => `Why ${item.name} Balloons After Game Patches & Season Updates`,
    leadParagraph: (item) =>
      `Modern PC game launchers, anti-cheat engines, and peripheral daemons write encrypted chunk depots, delta-patch staging archives, and Embedded Chromium (CEF) storefront assets directly into ${item.path}. Whenever a download pauses, switches branches, or applies a major seasonal update, uncommitted delta chunks and superseded installer archives are frequently left orphaned on disk because launchers prioritize patch speed over post-install garbage collection.`,
    mechanicsParagraph: (item) =>
      `Leaving ${item.avgSpace} of stale depot chunks and session telemetry sitting on your primary NVMe SSD reduces free block headroom and slows down Steam/Epic/Riot delta-patching I/O. Purging ${item.name} while no game update is actively downloading frees ${item.avgSpace} immediately without touching installed game binaries, local save files, or controller/mouse macro profiles.`,
    protectedSummary:
      "Installed games, Steam Cloud / local save files, keybinds, mouse DPI stages, and anti-cheat certificates stay 100% untouched.",
    removedSummary:
      "Orphaned depot chunk files (.chunk), uncommitted patch staging archives, CEF storefront webcache, and old match/session logs.",
    extraFaq: (item) => ({
      q: `Will cleaning ${item.name} force my games to re-download or reset my settings?`,
      a: `No. Game binaries live in your main library directory (such as steamapps\\common) and user settings live in separate configuration profiles. Deleting ${item.name} only removes temporary update staging chunks, cached storefront media, and rotated session logs.`,
    }),
  },
  gpu: {
    id: "gpu",
    label: "GPU Shader Caches & Graphics Drivers",
    badge: "🖥️ DirectX / Vulkan GPU Cache",
    sectionTitle: (item) => `How Compiled DirectX 12, Vulkan & Driver Pipelines Accumulate in ${item.name}`,
    leadParagraph: (item) =>
      `Every time a modern DirectX 12, Vulkan, or OpenGL title launches, your graphics driver compiles hardware-specific Pipeline State Objects (PSOs) and compute shaders into binary cache buckets at ${item.path}. Across dozens of driver updates and game patches, shaders compiled for retired driver versions remain on disk alongside active pipelines—and corrupted shader buckets are a primary cause of micro-stutter and DXGI_ERROR_DEVICE_HUNG crashes.`,
    mechanicsParagraph: (item) =>
      `When you clear ${item.name}, the graphics driver automatically allocates a clean, defragmented shader cache directory on next launch and compiles only the active pipeline states required by your current driver version. Note that any files locked by the Desktop Window Manager (dwm.exe) or active tray overlays are safely skipped.`,
    protectedSummary:
      "Display driver installations, custom resolution profiles, G-SYNC / FreeSync settings, and fan curves remain completely intact.",
    removedSummary:
      "Superseded DirectX 11/12 bytecode (.bin/.toc), Vulkan pipeline caches, WebGPU Dawn blobs, and unpacked driver installer folders.",
    extraFaq: (item) => ({
      q: `Will deleting ${item.name} cause shader compilation stutter in games?`,
      a: `Only briefly on the very first launch of a game while your GPU compiles fresh shaders for your current driver version. In fact, clearing bloated or corrupted shader caches often resolves persistent frame-time spikes and driver crashes after GPU driver updates.`,
    }),
  },
  creative: {
    id: "creative",
    label: "Video Editing, Streaming, 3D & Creative Apps",
    badge: "🎬 Creative & Media Scratch",
    sectionTitle: (item) => `How Timeline Previews, Conform Audio & Render Scratch Fill ${item.name}`,
    leadParagraph: (item) =>
      `Non-linear video editors (NLEs), streaming encoders, 3D DCC tools, and DAWs continuously write uncompressed audio conform files (.cfa), waveform peak indexes (.pek), proxy transcodes, and frame-accurate undo scratch into ${item.path}. Even after you finish exporting and archiving a client project, gigabytes of intermediate timeline render caches remain permanently allocated on your scratch disk.`,
    mechanicsParagraph: (item) =>
      `On 4K/8K timelines or multi-scene streaming setups, ${item.name} routinely consumes ${item.avgSpace} of high-speed SSD space. Safely pruning stale media caches reclaims scratch bandwidth immediately; if you ever reopen an older project file, the application simply regenerates audio waveforms and timeline previews in the background.`,
    protectedSummary:
      "Project files (.prproj, .drp, .blend, .als), original camera footage, exported renders, LUTs, plugins, and scene collections are never touched.",
    removedSummary:
      "Conformed audio (.cfa), waveform peaks (.pek), orphaned timeline render previews, browser-source CEF caches, and crash minidumps.",
    extraFaq: (item) => ({
      q: `Will clearing ${item.name} delete my video projects, drafts, or saved recordings?`,
      a: `No. Project timelines, source media clips, and exported videos are stored in your project folders—not in ${item.path}. If you reopen an active project after cleaning, the software automatically rebuilds any needed waveform peaks or preview frames.`,
    }),
  },
  devtools: {
    id: "devtools",
    label: "Developer Package Managers, IDEs & Containers",
    badge: "🛠️ Developer & Build Cache",
    sectionTitle: (item) => `Why Package Tarballs, Symbol Indexes & Build Artifacts Pile Up in ${item.name}`,
    leadParagraph: (item) =>
      `Developer toolchains, language package managers, and modern IDEs cache every downloaded dependency version, pre-compiled wheel/crate tarball, C++/Rust incremental build target, and Language Server Protocol (LSP) AST index inside ${item.path}. Because dependency lockfiles evolve every week, historical versions from old branches remain cached indefinitely—turning ${item.name} into a multi-gigabyte graveyard of thousands of small files.`,
    mechanicsParagraph: (item) =>
      `Thousands of small cache entries inside ${item.path} also degrade Windows Defender real-time filesystem scanning and slow down backup indexing. Cleaning ${item.name} reclaims ${item.avgSpace} of SSD capacity while preserving your active source code repositories, .env secrets, SSH keys, and workspace configurations.`,
    protectedSummary:
      "Source code repositories, uncommitted Git changes, .env files, SSH keys, IDE keymaps, and active project node_modules/venvs stay safe.",
    removedSummary:
      "Cached registry tarballs/wheels, orphaned content-addressable store blobs, stale LSP symbol indexes, and old extension versions.",
    extraFaq: (item) => ({
      q: `Will cleaning ${item.name} break my active local development projects?`,
      a: `No. Installed dependencies inside your project workspaces remain intact. Cleaning ${item.name} only clears the global download cache and historical build artifacts; any package needed in the future is transparently fetched on demand.`,
    }),
  },
  browsers_chat: {
    id: "browsers_chat",
    label: "Browsers, Desktop Chat & Productivity Apps",
    badge: "🌐 Chromium / Electron App Cache",
    sectionTitle: (item) => `How Embedded Chromium (Electron / CEF) Caches Bloated ${item.name}`,
    leadParagraph: (item) =>
      `Modern web browsers and desktop apps built on Electron, Chromium Embedded Framework (CEF), or WebView2 run a full browser storage engine inside ${item.path}. Every inline video preview, animated sticker, PWA offline bundle, and compiled V8 JavaScript script is written into disk-backed Cache_Data, Code Cache, Service Worker CacheStorage, and IndexedDB LevelDB tables without strict disk quotas.`,
    mechanicsParagraph: (item) =>
      `Over months of daily usage, ${item.name} accumulates ${item.avgSpace} of expired media blobs and stale Service Worker caches that are never evicted automatically. Clearing these cache subdirectories forces a clean storage state without deleting your saved passwords, active session cookies, bookmarks, or local databases.`,
    protectedSummary:
      "Saved logins, session cookies, bookmarks, open tabs, local notes/databases, and workspace preferences remain 100% intact.",
    removedSummary:
      "HTTP media cache blobs, Service Worker CacheStorage offline bundles, compiled V8 bytecode caches, and Dawn/GPU shader caches.",
    extraFaq: (item) => ({
      q: `Will clearing ${item.name} sign me out of my accounts or delete my chat history?`,
      a: `No. Authentication tokens, cookies, and bookmarks live in separate profile files (such as Cookies, Login Data, and Local Storage). Cleaning the cache subfolders inside ${item.path} only removes temporary media and script caches.`,
    }),
  },
  win_update: {
    id: "win_update",
    label: "Windows Update, Servicing & Installer Caches",
    badge: "🪟 Windows Servicing & Update Store",
    sectionTitle: (item) => `How Windows Servicing & Installer Packages Accumulate in ${item.name}`,
    leadParagraph: (item) =>
      `Windows Component-Based Servicing (CBS), the Windows Update Agent (wuauserv), and WiX/Burn MSI bootstrapper engines stage compressed cabinet (.cab), express delta (.esd), and superseded side-by-side assemblies inside ${item.path}. Windows retains many of these payload packages so you can roll back recent cumulative updates or repair installed Visual C++ / .NET runtimes without internet access.`,
    mechanicsParagraph: (item) =>
      `However, once cumulative updates are superseded by newer monthly rollups—or after MSI applications are uninstalled—gigabytes of orphaned payloads remain behind in ${item.path}. Following the verified cleanup procedure for ${item.name} reclaims ${item.avgSpace} while preserving active servicing manifests and currently registered uninstaller packages.`,
    protectedSummary:
      "Active Windows system binaries, registered MSI repair manifests for installed apps, and current security update state stay intact.",
    removedSummary:
      "Superseded WinSxS component versions, downloaded SoftwareDistribution update payloads, Delivery Optimization P2P caches, and orphaned installer caches.",
    extraFaq: (item) => ({
      q: `Can I simply press Shift+Delete on ${item.name} in File Explorer?`,
      a: item.safeToDelete
        ? `Yes, once any associated Windows Update or Delivery Optimization service handles are released, the cached payload files in ${item.path} can be safely removed.`
        : `No—do not blindly delete the entire folder. ${item.warning || "Always use the built-in Windows servicing command (such as DISM /Cleanup-Image) or SWEEPR Cleaner's orphan-aware rules so active uninstaller and servicing links remain intact."}`,
    }),
  },
  win_crash_logs: {
    id: "win_crash_logs",
    label: "Windows Kernel Dumps, Crash Reports & Diagnostics",
    badge: "🩺 Windows Crash Dumps & Telemetry",
    sectionTitle: (item) => `Why Kernel Minidumps, WER Archives & ETW Traces Fill ${item.name}`,
    leadParagraph: (item) =>
      `Whenever a hardware driver times out (TDR), a background service faults, or Windows Servicing installs a patch, the Windows Error Reporting (WER) pipeline and kernel crash handler write uncompressed memory snapshots (.dmp) and verbose text logs into ${item.path}. A single full or kernel memory dump or LiveKernelReports WATCHDOG snapshot can consume 500 MB to 4 GB of disk space immediately.`,
    mechanicsParagraph: (item) =>
      `Unless you are actively debugging a recurring Blue Screen of Death (BSOD) with WinDbg right now, historical crash dumps and rotated CBS/DISM log archives inside ${item.path} serve zero runtime purpose. Deleting ${item.name} safely reclaims ${item.avgSpace} without affecting Windows stability or future error reporting.`,
    protectedSummary:
      "Active Windows kernel drivers, system services, Event Viewer configuration, and OS stability are completely unaffected.",
    removedSummary:
      "Historical kernel/user minidumps (.dmp), WATCHDOG GPU timeout snapshots, Windows Error Reporting (.wer) queues, and rotated servicing logs.",
    extraFaq: (item) => ({
      q: `Does Windows need the files in ${item.name} to boot or run properly?`,
      a: `No. Files inside ${item.path} are strictly post-mortem diagnostic snapshots and historical logs written for troubleshooting. Windows never reads them during normal startup or runtime operation.`,
    }),
  },
  win_system: {
    id: "win_system",
    label: "Hidden Windows System Folders & Virtual Storage",
    badge: "🗄️ Windows System & Storage Internals",
    sectionTitle: (item) => `How Windows Manages ${item.name} on NTFS & NVMe Drives`,
    leadParagraph: (item) =>
      `Windows 10 and Windows 11 maintain hidden system directories and root-level allocation files at ${item.path} to handle shell thumbnail databases, prefetcher launch traces, hibernation power states, and user-profile scratch storage. Because many of these paths are marked with +H (Hidden) or +S (System) attributes or guarded by SYSTEM ACL permissions, standard folder size scans often miss them entirely.`,
    mechanicsParagraph: (item) =>
      `Over time, orphaned temporary files, stale Explorer DataCache_* buckets, and uncompacted virtual storage allocations inside ${item.path} lock up ${item.avgSpace} of primary C: drive space. Cleaning ${item.name} using the proper administrative method restores drive headroom safely.`,
    protectedSummary:
      "User documents, desktop files, Windows registry hives, boot configuration, and active system locks remain 100% protected.",
    removedSummary:
      "Unlocked temporary scratch files, stale Explorer thumbnail/icon caches, obsolete prefetch traces, and reclaimable system allocations.",
    extraFaq: (item) => ({
      q: `Why does Windows say some files in ${item.name} are "In Use" when I try to delete them?`,
      a: `Active background processes (such as explorer.exe, svchost.exe, or running desktop apps) hold open file handles to current session scratch files. Skipping locked files—or letting SWEEPR Cleaner clean unlocked items automatically—is normal and completely safe.`,
    }),
  },
};

function buildPowerShellInspectionSnippet(item: CleanItem): string {
  const rawPath = item.path.split(/\s+(?:or|and)\s+/i)[0].trim();
  const psPath = rawPath
    .replace(/%LocalAppData%/gi, "$env:LOCALAPPDATA")
    .replace(/%AppData%/gi, "$env:APPDATA")
    .replace(/%ProgramData%/gi, "$env:ProgramData")
    .replace(/%WinDir%/gi, "$env:windir")
    .replace(/%Temp%/gi, "$env:TEMP")
    .replace(/%UserProfile%/gi, "$env:USERPROFILE")
    .replace(/<[^>]+>/g, "*");
  return `# Inspect current disk footprint of ${item.name} (Read-Only)\n$target = "${psPath}"\nGet-ChildItem -Path $target -Recurse -Force -ErrorAction SilentlyContinue |\n  Measure-Object -Property Length -Sum |\n  Select-Object Count, @{Name="SizeGB";Expression={[math]::Round($_.Sum / 1GB, 2)}}`;
}

const VARIANT_SUFFIX_RE =
  /-(service-worker-cachestorage|media-blob-storage|code-bytecode-cache|gpu-shader-cache|crashpad-dump-logs|installer-cache|shader-cache|webcache|logs-crashes|logs|cache|temp)$/;

export function getAppFamilyKey(slug: string): string {
  return slug.replace(VARIANT_SUFFIX_RE, "");
}

export function describeCacheVariantRole(slug: string): string {
  if (slug.endsWith("-installer-cache")) return "Downloaded Update Depots & Patch Staging";
  if (slug.endsWith("-shader-cache") || slug.endsWith("-gpu-shader-cache")) return "DirectX 12 / Vulkan / Dawn GPU Shaders";
  if (slug.endsWith("-webcache")) return "Embedded Chromium (CEF) Browser Cache";
  if (slug.endsWith("-service-worker-cachestorage")) return "Service Worker CacheStorage & Offline PWA Bundles";
  if (slug.endsWith("-media-blob-storage")) return "Media Blob Storage & IndexedDB LevelDB Assets";
  if (slug.endsWith("-code-bytecode-cache")) return "V8 Compiled JavaScript & WebAssembly Code/Bytecode Cache";
  if (slug.endsWith("-logs-crashes") || slug.endsWith("-logs") || slug.endsWith("-crashpad-dump-logs"))
    return "Diagnostic Logs & Crashpad Minidumps (.dmp)";
  return "Primary Application & System Storage Cache";
}

export function getAbsorbedRedirectVariants(item: CleanItem): Array<{
  slug: string;
  label: string;
  subPath: string;
  role: string;
}> {
  const canonicalTarget = `/clean/${item.category}/${item.slug}`;
  const matchedSlugs: string[] = [];
  for (const [key, target] of Object.entries(pseoRedirectsData)) {
    if (target === canonicalTarget) {
      const idx = key.indexOf(":");
      const s = idx >= 0 ? key.slice(idx + 1) : key;
      matchedSlugs.push(s);
    }
  }
  const basePath = item.path.split(/\s+(?:or|and|&)\s+/i)[0].trim().replace(/\\+$/, "");
  const variants: Array<{ slug: string; label: string; subPath: string; role: string }> = [];
  const seenLabels = new Set<string>();

  const addVariant = (slug: string, label: string, subPath: string, role: string) => {
    if (seenLabels.has(label)) return;
    seenLabels.add(label);
    variants.push({ slug, label, subPath, role });
  };

  for (const s of matchedSlugs) {
    if (s.endsWith("-media-blob-storage")) {
      addVariant(
        s,
        "Media Blob Storage",
        `${basePath}\\blob_storage & IndexedDB`,
        "Cached video/audio media blobs, high-DPI icon previews, and IndexedDB binary attachments"
      );
    } else if (s.endsWith("-service-worker-cachestorage")) {
      addVariant(
        s,
        "Service Worker CacheStorage",
        `${basePath}\\Service Worker\\CacheStorage`,
        "Offline web bundles, background-sync assets, and embedded CEF/WebView2 storefront scripts"
      );
    } else if (s.endsWith("-code-bytecode-cache")) {
      addVariant(
        s,
        "Code & Bytecode Cache",
        `${basePath}\\Code Cache\\js & wasm`,
        "Precompiled V8 JavaScript bytecode and WebAssembly execution caches"
      );
    } else if (s.endsWith("-gpu-shader-cache")) {
      addVariant(
        s,
        "GPU Shader Cache",
        `${basePath}\\GPUCache, GrShaderCache & DawnCache`,
        "Hardware-accelerated Skia, ANGLE, DirectX, and WebGPU Dawn compiled shader pipelines"
      );
    } else if (s.endsWith("-crashpad-dump-logs")) {
      addVariant(
        s,
        "Crashpad Dump Logs",
        `${basePath}\\Crashpad\\reports & Logs`,
        "Post-mortem process minidumps (.dmp) and rotating session diagnostic telemetry"
      );
    }
  }

  if (item.category === "app" && variants.length === 0) {
    const prefix = getAppFamilyKey(item.slug);
    addVariant(
      `${prefix}-media-blob-storage`,
      "Media Blob Storage",
      `${basePath}\\blob_storage & IndexedDB`,
      "Cached media blobs, thumbnail previews, and IndexedDB binary objects"
    );
    addVariant(
      `${prefix}-service-worker-cachestorage`,
      "Service Worker CacheStorage",
      `${basePath}\\Service Worker\\CacheStorage`,
      "Offline PWA bundles and embedded Chromium Service Worker caches"
    );
    addVariant(
      `${prefix}-code-bytecode-cache`,
      "Code & Bytecode Cache",
      `${basePath}\\Code Cache\\js & wasm`,
      "Precompiled V8 JavaScript and WebAssembly bytecode"
    );
    addVariant(
      `${prefix}-gpu-shader-cache`,
      "GPU Shader Cache",
      `${basePath}\\GPUCache & DawnCache`,
      "Compiled DirectX / Vulkan / WebGPU UI shader pipelines"
    );
    addVariant(
      `${prefix}-crashpad-dump-logs`,
      "Crashpad Dump Logs",
      `${basePath}\\Crashpad\\reports & Logs`,
      "Historical crash minidump (.dmp) snapshots and rotating logs"
    );
  }

  return variants;
}

export function buildSubLocationsForItem(
  item: CleanItem,
  clusterId: PseoClusterId
): Array<{ subPath: string; role: string; avgSpace: string; safe: string }> {
  if (Array.isArray(item.subLocations) && item.subLocations.length > 0) {
    return item.subLocations;
  }
  const basePath = item.path.split(/\s+(?:or|and|&)\s+/i)[0].trim().replace(/\\+$/, "");
  switch (clusterId) {
    case "gaming":
      return [
        { subPath: `${basePath}`, role: "Primary Update Staging, Patch Depots & Chunk Cache", avgSpace: item.avgSpace, safe: item.safeToDelete ? "🟢 100% Safe (When Game Closed)" : "⚠️ Caution" },
        { subPath: `${basePath}\\ShaderCache / GPUCache`, role: "Compiled DirectX 12 / Vulkan / CEF Shader Pipelines", avgSpace: "350 MB – 3.5 GB", safe: "🟢 100% Safe (Rebuilds on Launch)" },
        { subPath: `${basePath}\\webcache / Service Worker\\CacheStorage`, role: "Embedded Launcher Storefront & News Feed Web Assets", avgSpace: "250 MB – 2.0 GB", safe: "🟢 100% Safe" },
        { subPath: `${basePath}\\Logs & Crashpad\\reports`, role: "Rotating Session Telemetry & Crash Minidumps (.dmp)", avgSpace: "150 MB – 4.0 GB", safe: "🟢 100% Safe" },
        { subPath: "%UserProfile%\\Saved Games & Config.json", role: "Player Save Files, Keybinds, Profiles & Loadouts", avgSpace: "Protected", safe: "🔒 Protected — Never Touched" },
      ];
    case "gpu":
      return [
        { subPath: `${basePath} (*.bin / *.toc / *.nvph)`, role: "Compiled DirectX 11/12 & Vulkan Shader Pipeline Binaries", avgSpace: item.avgSpace, safe: "🟢 100% Safe (Unlocked Entries)" },
        { subPath: "%LocalAppData%\\D3DSCache", role: "Windows Direct3D Shared Driver Shader Cache", avgSpace: "500 MB – 4.0 GB", safe: "🟢 100% Safe" },
        { subPath: "%LocalAppData%\\NVIDIA\\GLCache / AMD\\GLCache", role: "OpenGL & Legacy Shader Compilation Cache", avgSpace: "250 MB – 2.5 GB", safe: "🟢 100% Safe" },
        { subPath: "Driver Display Profiles & Control Panel Settings", role: "Custom 3D Settings, G-Sync/FreeSync & Color Calibration", avgSpace: "Protected", safe: "🔒 Protected — Never Touched" },
      ];
    case "creative":
      return [
        { subPath: `${basePath}`, role: "Primary Media Cache, Proxy Scratch & Render Previews", avgSpace: item.avgSpace, safe: item.safeToDelete ? "🟢 100% Safe (Re-renders on Demand)" : "⚠️ Caution" },
        { subPath: `${basePath}\\Media Cache Files (*.cfa, *.pek)`, role: "Conformed Audio Waveforms & Timeline Peak Files", avgSpace: "2.0 GB – 25.0 GB", safe: "🟢 100% Safe" },
        { subPath: `${basePath}\\GPUCache & Code Cache`, role: "Hardware-Accelerated Viewport & UI Plugin Cache", avgSpace: "300 MB – 3.0 GB", safe: "🟢 100% Safe" },
        { subPath: `${basePath}\\logs & Crashpad\\reports`, role: "Render Session Logs & Crash Dump Archives (.dmp)", avgSpace: "200 MB – 4.5 GB", safe: "🟢 100% Safe" },
        { subPath: "Project Timelines (.prproj / .drp / .blend) & LUTs", role: "Source Footage, Edit Timelines, Presets & Exported Renders", avgSpace: "Protected", safe: "🔒 Protected — Never Touched" },
      ];
    case "devtools":
      return [
        { subPath: `${basePath}`, role: "Content-Addressable Package Tarballs, Wheels & Build Artifacts", avgSpace: item.avgSpace, safe: item.safeToDelete ? "🟢 100% Safe (Re-downloads on Build)" : "⚠️ Caution" },
        { subPath: `${basePath}\\wrapper\\dists / _cacache`, role: "Historical Toolchain Distributions & Integrity Blobs", avgSpace: "1.5 GB – 15.0 GB", safe: "🟢 100% Safe" },
        { subPath: `${basePath}\\logs & crashpad`, role: "Compiler Diagnostics, Daemon Logs & Crash Snapshots", avgSpace: "150 MB – 2.5 GB", safe: "🟢 100% Safe" },
        { subPath: "Source Repositories, .env Files & SSH/API Keys", role: "Working Git Trees, Local Databases & Credentials", avgSpace: "Protected", safe: "🔒 Protected — Never Touched" },
      ];
    case "win_update":
      return [
        { subPath: `${basePath}`, role: "Superseded Component Packages & Update Staging Payloads", avgSpace: item.avgSpace, safe: item.safeToDelete ? "🟢 100% Safe" : "⚠️ Use DISM / SWEEPR Orphan Rule" },
        { subPath: "C:\\Windows\\SoftwareDistribution\\Download", role: "Downloaded Windows Update CAB/ESD Installation Packages", avgSpace: "2.0 GB – 16.0 GB", safe: "🟢 100% Safe" },
        { subPath: "C:\\Windows\\WinSxS\\Temp\\PendingDeletes", role: "Orphaned Servicing Checkpoint Staging Files", avgSpace: "1.0 GB – 9.0 GB", safe: "🟢 100% Safe via DISM" },
        { subPath: "Active Windows 11 System32 Binaries & MSI Manifests", role: "Live OS Kernel Files & Active Uninstaller Packages", avgSpace: "Protected", safe: "🔒 Protected — Never Touched" },
      ];
    case "win_crash_logs":
      return [
        { subPath: `${basePath} (*.dmp / *.hdmp / *.mdmp)`, role: "Uncompressed Kernel & User-Mode Memory Crash Dumps", avgSpace: item.avgSpace, safe: "🟢 100% Safe" },
        { subPath: "C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportArchive", role: "Queued & Archived Windows Error Reporting Bundles", avgSpace: "300 MB – 4.0 GB", safe: "🟢 100% Safe" },
        { subPath: "C:\\Windows\\Logs\\CBS & DISM", role: "Rotated Servicing & Component Store Text Logs", avgSpace: "250 MB – 3.5 GB", safe: "🟢 100% Safe" },
        { subPath: "Active Windows Drivers & Event Viewer Channels", role: "Live System Services & Security Audit Configuration", avgSpace: "Protected", safe: "🔒 Protected — Never Touched" },
      ];
    case "win_system":
      return [
        { subPath: `${basePath}`, role: "Primary System Scratch, Thumbnail/Icon DB or Virtual Allocation", avgSpace: item.avgSpace, safe: item.safeToDelete ? "🟢 100% Safe (Unlocked Files)" : "⚠️ System Managed" },
        { subPath: "%LocalAppData%\\Temp & C:\\Windows\\Temp", role: "Orphaned Installer Extraction & Session Scratch Files", avgSpace: "1.5 GB – 18.0 GB", safe: "🟢 100% Safe" },
        { subPath: "%LocalAppData%\\Microsoft\\Windows\\Explorer (thumbcache_*.db)", role: "Cached File Explorer Image & Video Thumbnail Databases", avgSpace: "250 MB – 3.0 GB", safe: "🟢 100% Safe (Rebuilds Automatically)" },
        { subPath: "User Documents, Desktop & Registry Hives", role: "Personal Files, Boot Configuration & System Certificates", avgSpace: "Protected", safe: "🔒 Protected — Never Touched" },
      ];
    case "browsers_chat":
    default:
      return [
        { subPath: `${basePath}\\Cache\\Cache_Data`, role: "HTTP Disk Cache, Web Bundles & Static Media Chunks", avgSpace: item.avgSpace, safe: "🟢 100% Safe" },
        { subPath: `${basePath}\\Service Worker\\CacheStorage`, role: "Offline PWA Assets, Background Sync & Media Blob Storage", avgSpace: "500 MB – 6.5 GB", safe: "🟢 100% Safe" },
        { subPath: `${basePath}\\Code Cache\\js & wasm`, role: "V8 Compiled JavaScript & WebAssembly Bytecode Cache", avgSpace: "250 MB – 2.5 GB", safe: "🟢 100% Safe" },
        { subPath: `${basePath}\\GPUCache & DawnCache`, role: "Chromium Skia/ANGLE/WebGPU Compiled Shader Cache", avgSpace: "200 MB – 2.0 GB", safe: "🟢 100% Safe" },
        { subPath: `${basePath}\\Crashpad\\reports`, role: "Historical Process Minidump (.dmp) Telemetry Files", avgSpace: "150 MB – 3.0 GB", safe: "🟢 100% Safe" },
        { subPath: "Cookies, Login Data, Bookmarks & Local Storage (leveldb)", role: "Active Account Sessions, Saved Passwords & User Preferences", avgSpace: "Protected", safe: "🔒 Protected — Never Touched" },
      ];
  }
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

  const myCluster = classifyPseoCluster(item);
  const clusterPeers = all.filter((i) => classifyPseoCluster(i) === myCluster);
  const pool = clusterPeers.length >= 7 ? clusterPeers : all.filter((i) => i.category === item.category);
  const myIdx = Math.max(0, pool.findIndex((i) => i.slug === item.slug));
  const related: CleanItem[] = [];

  // A19: Prioritize active GSC Strike-Zone pages inside the same cluster first (up to 3), then top cross-cluster GSC winners (up to 2)
  const prioritySlugs = getGscPriorityInternalLinkSlugs();
  for (const pSlug of prioritySlugs) {
    if (related.length >= 3) break;
    if (siblingSlugs.has(pSlug)) continue;
    const match = clusterPeers.find((i) => i.slug === pSlug);
    if (match) {
      siblingSlugs.add(match.slug);
      related.push(match);
    }
  }
  for (const pSlug of prioritySlugs) {
    if (related.length >= 4) break;
    if (siblingSlugs.has(pSlug)) continue;
    const match = all.find((i) => i.slug === pSlug);
    if (match) {
      siblingSlugs.add(match.slug);
      related.push(match);
    }
  }

  for (let offset = 1; offset < pool.length && related.length < 6; offset++) {
    const candidate = pool[(myIdx + offset * 3) % pool.length];
    if (candidate && !siblingSlugs.has(candidate.slug)) {
      siblingSlugs.add(candidate.slug);
      related.push(candidate);
    }
  }

  return { siblings, related };
}

export interface ApprovedIntentGapOverride {
  title?: string;
  metaDescription?: string;
  noindex?: boolean;
  mergedIntoSlug?: string;
  retiredReason?: string;
  approvedAt: string;
}

const approvedIntentGapOverrides = new Map<string, ApprovedIntentGapOverride>();

export function setApprovedIntentGapSeoOverride(
  slug: string,
  opts: {
    title?: string;
    metaDescription?: string;
    noindex?: boolean;
    mergedIntoSlug?: string;
    retiredReason?: string;
    approvedAt?: string;
  } | null
) {
  const cleanSlug = String(slug || "").trim().toLowerCase();
  if (!cleanSlug) return;
  if (!opts) {
    approvedIntentGapOverrides.delete(cleanSlug);
    return;
  }
  const existing = approvedIntentGapOverrides.get(cleanSlug) ?? { approvedAt: new Date().toISOString() };
  approvedIntentGapOverrides.set(cleanSlug, {
    title: opts.title && opts.title.length >= 30 && opts.title.length <= 115 ? opts.title : existing.title,
    metaDescription:
      opts.metaDescription && opts.metaDescription.length >= 70 && opts.metaDescription.length <= 160
        ? opts.metaDescription
        : existing.metaDescription,
    noindex: opts.noindex !== undefined ? Boolean(opts.noindex) : existing.noindex,
    mergedIntoSlug: opts.mergedIntoSlug !== undefined ? opts.mergedIntoSlug : existing.mergedIntoSlug,
    retiredReason: opts.retiredReason !== undefined ? opts.retiredReason : existing.retiredReason,
    approvedAt: opts.approvedAt || new Date().toISOString(),
  });
}

export function getApprovedIntentGapSeoOverride(slug: string): ApprovedIntentGapOverride | null {
  return approvedIntentGapOverrides.get(String(slug || "").trim().toLowerCase()) ?? null;
}

export function isPseoSlugNoindexed(slug: string): boolean {
  const cleanSlug = String(slug || "").trim().toLowerCase();
  const override = approvedIntentGapOverrides.get(cleanSlug);
  if (override?.noindex || override?.mergedIntoSlug) return true;
  const item = getCleanItems().find((i) => i.slug === cleanSlug);
  return Boolean(item?.noindex || item?.mergedIntoSlug);
}

export function formatCompactSpaceRange(avgSpace: string): string {
  const raw = String(avgSpace || "").trim();
  if (!raw) return "1–10 GB";
  const gbMatches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(GB|MB)/gi)];
  if (gbMatches.length >= 2) {
    const u1 = gbMatches[0][2].toUpperCase();
    const u2 = gbMatches[1][2].toUpperCase();
    if (u1 === "GB" && u2 === "GB") {
      return `${Number(Number(gbMatches[0][1]).toFixed(1))}–${Number(Number(gbMatches[1][1]).toFixed(1))} GB`;
    }
    if (u1 === "MB" && u2 === "GB") {
      return `${gbMatches[0][1]} MB–${Number(Number(gbMatches[1][1]).toFixed(1))} GB`;
    }
  }
  return raw.replace(/\.0\b/g, "");
}

export function extractPrimaryDisplayPath(rawPath: string): string {
  const firstPart = String(rawPath || "")
    .split(/\s+(?:and|or)\s+|,\s+/i)[0]
    .trim()
    .replace(/^%localappdata%low/i, "%LOCALAPPDATA%Low")
    .replace(/^%localappdata%/i, "%LOCALAPPDATA%")
    .replace(/^%appdata%/i, "%APPDATA%")
    .replace(/^%programdata%/i, "%PROGRAMDATA%")
    .replace(/^%userprofile%/i, "%USERPROFILE%")
    .replace(/^%windir%/i, "%WINDIR%")
    .replace(/^%temp%/i, "%TEMP%");
  return firstPart || "%LOCALAPPDATA%\\Temp";
}

export function buildPseoTitle(item: CleanItem): string {
  const approved = approvedIntentGapOverrides.get(item.slug)?.title;
  if (approved && approved.length >= 30 && approved.length <= 115) {
    return approved;
  }
  const custom = CUSTOM_GSC_TITLES[item.slug] || item.metaTitle;
  if (custom && custom.length >= 30 && custom.length <= 115) {
    return custom;
  }

  let cleanName = item.name
    .replace(/TechSmith Snagit Screen Capture/g, "Snagit Capture")
    .replace(/MuseScore Studio Notation Software/g, "MuseScore Studio")
    .replace(/Roblox Engine & Player/g, "Roblox Player")
    .replace(/RetroArch Multi-System Emulator/g, "RetroArch")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanName.length > 48) {
    const words = cleanName.split(" ");
    let acc = "";
    for (const w of words) {
      if ((acc + " " + w).trim().length <= 48) {
        acc = (acc + " " + w).trim();
      } else {
        break;
      }
    }
    cleanName = acc.replace(/[&:,\-–—]+$/, "").trim() || cleanName.slice(0, 48).trim();
  }

  const telemetry = getActiveTelemetryTruthForSlug(item.slug);
  const spaceLabel = telemetry ? `${telemetry.median_gb}–${telemetry.p90_gb} GB` : formatCompactSpaceRange(item.avgSpace);
  return `Can I Delete ${cleanName}? YES — Safe Cleanup Guide (Reclaim ${spaceLabel})`;
}

export function buildPseoDescription(item: CleanItem): string {
  const approvedDesc = approvedIntentGapOverrides.get(item.slug)?.metaDescription;
  if (approvedDesc && approvedDesc.length >= 70 && approvedDesc.length <= 160) {
    return approvedDesc;
  }
  const customDesc = CUSTOM_GSC_DESCRIPTIONS[item.slug] || item.metaDescription;
  if (customDesc && customDesc.length >= 70 && customDesc.length <= 160) {
    return customDesc;
  }
  const telemetry = getActiveTelemetryTruthForSlug(item.slug);
  const spaceLabel = telemetry ? `${telemetry.median_gb}–${telemetry.p90_gb} GB` : formatCompactSpaceRange(item.avgSpace);
  let primaryPath = extractPrimaryDisplayPath(item.path);

  let desc = `Can I delete ${primaryPath}? YES (${spaceLabel}). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.`;
  if (desc.length > 158) {
    desc = `Delete ${primaryPath} (${spaceLabel}). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.`;
  }
  if (desc.length > 158) {
    desc = `Delete ${primaryPath} (${spaceLabel}). Zero save files or active logins lost. Manual + 1-click 6.5 MB Sweepr scan.`;
  }
  if (desc.length > 158) {
    const maxP = 158 - `Delete  (${spaceLabel}). Zero save files or active logins lost. Manual + 1-click 6.5 MB Sweepr scan.`.length;
    primaryPath = primaryPath.slice(0, Math.max(18, maxP));
    desc = `Delete ${primaryPath} (${spaceLabel}). Zero save files or active logins lost. Manual + 1-click 6.5 MB Sweepr scan.`;
  }
  return desc;
}

function matchTransactionalToolForItem(
  item: CleanItem,
  clusterId: string
): { slug: string; label: string; savings: string } {
  const s = item.slug.toLowerCase();
  const p = item.path.toLowerCase();
  if (s.includes("discord")) {
    return { slug: "discord-cache-cleaner", label: "Discord Cache & GPU Blob Cleaner", savings: "2–15 GB" };
  }
  if (s.includes("steam") || p.includes("steam")) {
    return { slug: "steam-cache-cleaner", label: "Steam depotcache & Shader Cache Cleaner", savings: "5–40 GB" };
  }
  if (s.includes("logitech") || s.includes("lghub") || p.includes("lghub") || p.includes("logioptions")) {
    return { slug: "logitech-ghub-cleaner", label: "Logitech G HUB & Options+ Depots Cleaner", savings: "2–10 GB" };
  }
  if (s.includes("elgato") || s.includes("streamdeck")) {
    return { slug: "elgato-streamdeck-cleaner", label: "Elgato Stream Deck Cache & Logs Cleaner", savings: "1–5 GB" };
  }
  if (s.includes("riot") || s.includes("valorant") || s.includes("league")) {
    return { slug: "valorant-logs-cleaner", label: "Valorant & Riot Client Logs Cleaner", savings: "2–12 GB" };
  }
  if (s.includes("nvidia") || s.includes("amd-shader") || s.includes("dxcache") || clusterId === "gpu_drivers") {
    return { slug: "nvidia-shader-cleaner", label: "NVIDIA DXCache & DirectX Shader Cleaner", savings: "2–15 GB" };
  }
  if (
    s.includes("comfyui") ||
    s.includes("lm-studio") ||
    s.includes("ollama") ||
    s.includes("huggingface") ||
    s.includes("cursor") ||
    s.includes("vllm") ||
    s.includes("fooocus") ||
    s.includes("invokeai") ||
    s.includes("kobold")
  ) {
    return { slug: "ai-model-cache-cleaner", label: "ComfyUI, LM Studio & AI Model Cache Cleaner", savings: "15–90 GB" };
  }
  if (s.includes("adobe") || s.includes("davinci") || s.includes("capcut") || clusterId === "creative") {
    return { slug: "adobe-media-cache-cleaner", label: "Adobe Media Cache & Creative Cloud Cleaner", savings: "10–80 GB" };
  }
  if (clusterId === "devtools") {
    return { slug: "jetbrains-gradle-cleaner", label: "IntelliJ IDEA, Gradle & Developer Cache Cleaner", savings: "10–55 GB" };
  }
  if (clusterId === "gaming") {
    return { slug: "steam-cache-cleaner", label: "Steam & PC Game Shader Cache Cleaner", savings: "5–40 GB" };
  }
  if (clusterId === "browsers_comms") {
    return { slug: "discord-cache-cleaner", label: "Discord & Chromium App Cache Cleaner", savings: "2–15 GB" };
  }
  return { slug: "windows-24h2-update-cleaner", label: "Windows 11 24H2 Update & WinSxS Cleaner", savings: "10–45 GB" };
}

export const FEATURED_GSC_SLUGS = [
  "steam-depotcache",
  "genshin-impact-update-cache",
  "riot-client-logs",
  "logitech-ghub-installer-cache",
  "stremio-desktop-cache",
  "amd-shader-cache",
  "winsxs",
  "windows-livekernelreports",
  "comfyui-temp-output-cache",
  "programdata-package-cache",
  "brave-browser-cache",
  "medal-tv-cache",
  "nvidia-nv-cache",
  "nvidia-dxcache",
  "battlenet-cache",
  "capcut-desktop-cache",
  "zen-browser-cache",
  "opera-gx-cache",
  "jetbrains-intellij-cache",
  "windows-old",
  "elgato-streamdeck-cache",
  "logitech-options-plus-cache",
  "vivaldi-browser-cache",
  "localappdata-webview2-ebwebview-cache",
  "dolphin-emulator-cache",
  "obs-studio-logs-crashes",
  "creative-cloud-installer-cache",
  "npm-cache",
  "gradle-wrapper-caches",
  "localappdata-crashdumps",
  "hiberfil-sys",
  "c-drive-filling-up-by-itself-windows-11",
  "system-and-reserved-storage-100gb-windows-11",
  "appdata-local-folder-huge-windows-11",
  "windows-11-24h2-update-cache-8gb-bug",
  "other-storage-full-windows-11-cleanup",
  "ea-app-cache",
  "epic-games-webcache",
  "vrchat-cache",
  "lm-studio-models-cache",
  "discord-cache",
  "spotify-cache",
  "steam-shader-cache",
  "chrome-service-worker-cache",
  "huggingface-hub-cache",
  "windows-temp",
  "appdata-temp",
  "nvidia-glcache",
  "intel-arc-shader-cache",
  "ubisoft-connect-cache",
  "roblox-http-cache",
];

let gscPriorityInternalLinkSlugs: string[] = [...FEATURED_GSC_SLUGS];

export function setGscPriorityInternalLinkSlugs(slugs: string[]) {
  const cleaned = Array.from(
    new Set(
      (slugs || [])
        .map((s) => String(s || "").trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 50);
  if (cleaned.length > 0) {
    gscPriorityInternalLinkSlugs = cleaned;
    cachedDirectoryHtml = null;
  }
}

export function getGscPriorityInternalLinkSlugs(): string[] {
  return gscPriorityInternalLinkSlugs.length > 0 ? gscPriorityInternalLinkSlugs : FEATURED_GSC_SLUGS;
}

export function renderGamingAndAiCacheBloatCalculatorWidget(): string {
  return `
    <section id="pc-cache-bloat-calculator" class="mb-12 bg-[#062017] text-emerald-50 border border-emerald-500/40 rounded-2xl p-6 md:p-8 shadow-xl">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <span class="text-xs font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300">
          ⚡ Zero-Signup Interactive Benchmark Tool
        </span>
        <span class="text-xs font-mono text-emerald-300/90">GSC-Verified Windows 11/10 Paths · 6.5 MB Native Rust Engine</span>
      </div>
      <h2 class="text-2xl md:text-3xl font-black text-white mb-2">
        Windows Gaming &amp; AI Cache Bloat Calculator
      </h2>
      <p class="text-sm text-emerald-100/85 mb-6 max-w-3xl">
        Check the games, AI tools, and IDEs installed on your PC to see the exact <code class="bg-black/30 px-1.5 py-0.5 rounded text-emerald-300">%LOCALAPPDATA%</code> folders silently eating your C: drive and your estimated reclaimable GB:
      </p>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6" id="bloatCalcGrid">
        <label class="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#04150f] border border-emerald-500/30 cursor-pointer hover:border-emerald-400 transition-all">
          <input type="checkbox" class="bloat-calc-cb mt-1 accent-emerald-500" data-id="steam" data-name="Steam &amp; NVIDIA DXCache" data-gb="12.5" data-paths="%LocalAppData%\\NVIDIA\\DXCache|C:\\Program Files (x86)\\Steam\\steamapps\\shadercache|%LocalAppData%\\Steam\\htmlcache" checked />
          <span>
            <strong class="block text-sm text-white">Steam &amp; NVIDIA DXCache</strong>
            <span class="text-xs text-emerald-300 font-mono">~12.5 GB avg bloat</span>
          </span>
        </label>
        <label class="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#04150f] border border-emerald-500/30 cursor-pointer hover:border-emerald-400 transition-all">
          <input type="checkbox" class="bloat-calc-cb mt-1 accent-emerald-500" data-id="genshin" data-name="Genshin Impact / HoYoPlay" data-gb="8.4" data-paths="%AppData%\\Cognosphere\\HYP\\1_1\\fedata\\Cache|%LocalAppData%\\HoYoverse\\Genshin Impact\\cache" />
          <span>
            <strong class="block text-sm text-white">Genshin / HoYoPlay</strong>
            <span class="text-xs text-emerald-300 font-mono">~8.4 GB avg bloat</span>
          </span>
        </label>
        <label class="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#04150f] border border-emerald-500/30 cursor-pointer hover:border-emerald-400 transition-all">
          <input type="checkbox" class="bloat-calc-cb mt-1 accent-emerald-500" data-id="valorant" data-name="Valorant &amp; Riot Client" data-gb="4.8" data-paths="%LocalAppData%\\VALORANT\\Saved\\Logs|%LocalAppData%\\VALORANT\\Saved\\Crashes|%LocalAppData%\\Riot Games\\Riot Client\\Logs" />
          <span>
            <strong class="block text-sm text-white">Valorant &amp; Riot</strong>
            <span class="text-xs text-emerald-300 font-mono">~4.8 GB avg bloat</span>
          </span>
        </label>
        <label class="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#04150f] border border-emerald-500/30 cursor-pointer hover:border-emerald-400 transition-all">
          <input type="checkbox" class="bloat-calc-cb mt-1 accent-emerald-500" data-id="comfyui" data-name="ComfyUI &amp; HuggingFace" data-gb="34.0" data-paths="%UserProfile%\\.cache\\huggingface\\hub|%LocalAppData%\\pip\\Cache|ComfyUI\\temp" checked />
          <span>
            <strong class="block text-sm text-white">ComfyUI &amp; HuggingFace</strong>
            <span class="text-xs text-emerald-300 font-mono">~34.0 GB avg bloat</span>
          </span>
        </label>
        <label class="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#04150f] border border-emerald-500/30 cursor-pointer hover:border-emerald-400 transition-all">
          <input type="checkbox" class="bloat-calc-cb mt-1 accent-emerald-500" data-id="ollama" data-name="Ollama &amp; LM Studio" data-gb="26.5" data-paths="%UserProfile%\\.ollama\\models\\blobs|%UserProfile%\\.cache\\lm-studio" checked />
          <span>
            <strong class="block text-sm text-white">Ollama &amp; LM Studio</strong>
            <span class="text-xs text-emerald-300 font-mono">~26.5 GB avg bloat</span>
          </span>
        </label>
        <label class="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#04150f] border border-emerald-500/30 cursor-pointer hover:border-emerald-400 transition-all">
          <input type="checkbox" class="bloat-calc-cb mt-1 accent-emerald-500" data-id="docker" data-name="Docker Desktop &amp; WSL2" data-gb="28.0" data-paths="%LocalAppData%\\Docker\\wsl\\data\\ext4.vhdx|%LocalAppData%\\Temp\\docker-scout" />
          <span>
            <strong class="block text-sm text-white">Docker &amp; WSL2</strong>
            <span class="text-xs text-emerald-300 font-mono">~28.0 GB avg bloat</span>
          </span>
        </label>
        <label class="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#04150f] border border-emerald-500/30 cursor-pointer hover:border-emerald-400 transition-all">
          <input type="checkbox" class="bloat-calc-cb mt-1 accent-emerald-500" data-id="jetbrains" data-name="JetBrains IDEs &amp; Cursor" data-gb="14.2" data-paths="%LocalAppData%\\JetBrains|%AppData%\\Cursor\\User\\workspaceStorage|%AppData%\\Code\\Cache" checked />
          <span>
            <strong class="block text-sm text-white">JetBrains &amp; Cursor</strong>
            <span class="text-xs text-emerald-300 font-mono">~14.2 GB avg bloat</span>
          </span>
        </label>
        <label class="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#04150f] border border-emerald-500/30 cursor-pointer hover:border-emerald-400 transition-all">
          <input type="checkbox" class="bloat-calc-cb mt-1 accent-emerald-500" data-id="adobe" data-name="Adobe Premiere &amp; After Effects" data-gb="22.0" data-paths="%AppData%\\Adobe\\Common\\Media Cache Files|%AppData%\\Adobe\\Common\\Peak Files" />
          <span>
            <strong class="block text-sm text-white">Adobe Media Cache</strong>
            <span class="text-xs text-emerald-300 font-mono">~22.0 GB avg bloat</span>
          </span>
        </label>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch bg-[#03110c] border border-emerald-500/35 rounded-xl p-5">
        <div class="flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-emerald-500/20 pb-4 lg:pb-0 lg:pr-5">
          <div>
            <div class="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">Estimated Hidden Cache Wasted</div>
            <div id="bloatCalcTotalGb" class="text-4xl md:text-5xl font-black text-emerald-300 tabular-nums">87.2 GB</div>
            <div id="bloatCalcCountLabel" class="text-xs text-emerald-100/75 mt-1">Across 4 selected gaming/AI workloads on C:</div>
          </div>
          <div class="mt-4 flex flex-col gap-2">
            <a href="/download" rel="nofollow" class="inline-block text-center bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-extrabold text-sm py-3 px-4 rounded-xl no-underline transition-all">
              ⚡ Scan &amp; Reclaim with SWEEPR (6.5 MB Rust App) &rarr;
            </a>
            <a id="bloatCalcShareWinLink" href="/share/win?gb=87.2%20GB&amp;culprit=ComfyUI%20%2F%20Ollama%20%2F%20NVIDIA%20DXCache&amp;ms=280" rel="nofollow" class="inline-block text-center bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 border border-emerald-500/40 font-bold text-xs py-2.5 px-3 rounded-lg no-underline transition-all">
              Share My Benchmark Card (+30d Free Pro)
            </a>
          </div>
        </div>
        <div class="lg:col-span-2 flex flex-col justify-between">
          <div class="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2">
            Exact Windows <code class="text-emerald-200">%LOCALAPPDATA%</code> &amp; <code class="text-emerald-200">%USERPROFILE%</code> Target Paths:
          </div>
          <div id="bloatCalcPathsList" class="space-y-1.5 font-mono text-xs text-emerald-100 bg-black/40 p-3.5 rounded-lg border border-emerald-500/20 max-h-48 overflow-y-auto"></div>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-200/80">
            <span>🟢 100% Non-Destructive: Saved logins, game saves &amp; active checkpoints stay untouched.</span>
            <a href="/tools/pc-cache-calculator" class="text-emerald-300 underline font-bold">Permalink: /tools/pc-cache-calculator</a>
          </div>
        </div>
      </div>

      <script>
        (function(){
          var cbs = document.querySelectorAll('.bloat-calc-cb');
          var totalEl = document.getElementById('bloatCalcTotalGb');
          var countEl = document.getElementById('bloatCalcCountLabel');
          var listEl = document.getElementById('bloatCalcPathsList');
          var shareEl = document.getElementById('bloatCalcShareWinLink');
          function updateBloatCalc() {
            var total = 0;
            var count = 0;
            var names = [];
            var rows = [];
            for (var i = 0; i < cbs.length; i++) {
              var cb = cbs[i];
              if (cb.checked) {
                var gb = parseFloat(cb.getAttribute('data-gb') || '0') || 0;
                var nm = cb.getAttribute('data-name') || '';
                var rawPaths = (cb.getAttribute('data-paths') || '').split('|');
                total += gb;
                count++;
                names.push(nm);
                for (var j = 0; j < rawPaths.length; j++) {
                  if (rawPaths[j]) {
                    rows.push('<div class="flex items-center justify-between gap-2 py-0.5 border-b border-emerald-500/10"><span>' + rawPaths[j] + '</span><span class="text-emerald-400 font-bold">' + nm + '</span></div>');
                  }
                }
              }
            }
            var gbStr = total.toFixed(1) + ' GB';
            if (totalEl) totalEl.textContent = gbStr;
            if (countEl) countEl.textContent = 'Across ' + count + ' selected gaming/AI workload' + (count === 1 ? '' : 's') + ' on C:';
            if (listEl) listEl.innerHTML = rows.length ? rows.join('') : '<div class="text-emerald-400/70">Select at least one game or AI tool above to inspect its exact cache paths.</div>';
            if (shareEl) {
              var culpritStr = names.slice(0, 2).join(' / ') || 'NVIDIA DXCache / ComfyUI';
              shareEl.setAttribute('href', '/share/win?gb=' + encodeURIComponent(gbStr) + '&culprit=' + encodeURIComponent(culpritStr) + '&ms=280');
            }
          }
          for (var k = 0; k < cbs.length; k++) {
            cbs[k].addEventListener('change', updateBloatCalc);
          }
          updateBloatCalc();
        })();
      </script>
    </section>
  `;
}

export function renderGamingAndAiCacheBloatCalculatorPage(): string {
  const widgetHtml = renderGamingAndAiCacheBloatCalculatorWidget();
  const calcJsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        headline: "Windows Gaming & AI Cache Bloat Calculator (2026 Benchmark)",
        description:
          "Interactive Windows 11/10 storage calculator measuring hidden %LOCALAPPDATA% and %USERPROFILE% cache footprints across Steam, Genshin Impact, Valorant, ComfyUI, Ollama, Docker, JetBrains, and Adobe.",
        url: "https://sweeprcleaner.com/tools/pc-cache-calculator",
        author: { "@type": "Organization", name: "SWEEPR Storage Research Lab" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://sweeprcleaner.com/" },
          { "@type": "ListItem", position: 2, name: "Cleaner Tools", item: "https://sweeprcleaner.com/tools" },
          {
            "@type": "ListItem",
            position: 3,
            name: "PC Cache Calculator",
            item: "https://sweeprcleaner.com/tools/pc-cache-calculator",
          },
        ],
      },
    ],
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Windows Gaming &amp; AI Cache Bloat Calculator | SWEEPR</title>
  <meta name="description" content="Free Windows 11/10 Gaming &amp; AI Cache Bloat Calculator. Check Steam, Genshin, Valorant, ComfyUI, Ollama, Docker &amp; JetBrains %LOCALAPPDATA% paths." />
  <link rel="canonical" href="https://sweeprcleaner.com/tools/pc-cache-calculator" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Windows Gaming &amp; AI Cache Bloat Calculator | SWEEPR" />
  <meta property="og:description" content="See exact %LOCALAPPDATA% shader, HuggingFace, Ollama, and IDE cache paths and calculate how many GB are hiding on your C: drive." />
  <meta property="og:url" content="https://sweeprcleaner.com/tools/pc-cache-calculator" />
  <meta property="og:image" content="https://sweeprcleaner.com/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">${calcJsonLd}</script>
  <script src="/vendor/tailwindcss-3.4.5.js"></script>
  <script src="/analytics.js" defer></script>
  <link rel="stylesheet" href="/style.css" />
</head>
<body class="bg-[#03110c] text-emerald-50 min-h-screen flex flex-col">
  <nav class="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between w-full">
    <a href="/" class="font-extrabold text-xl text-white no-underline">SWEEPR <span class="text-emerald-400">Cleaner</span></a>
    <div class="flex items-center gap-4 text-sm">
      <a href="/tools" class="text-emerald-200 hover:text-white no-underline">Cleaner Tools</a>
      <a href="/clean" class="text-emerald-200 hover:text-white no-underline">377-Rule Directory</a>
      <a href="/safe-to-delete" class="text-emerald-200 hover:text-white no-underline">Path Safety Checker</a>
      <a href="/download" rel="nofollow" class="bg-emerald-500 text-gray-950 font-extrabold px-4 py-2 rounded-xl no-underline">Download 6.5 MB App</a>
    </div>
  </nav>
  <main class="max-w-5xl mx-auto px-6 py-8 flex-1 w-full">
    <header class="mb-8">
      <h1 class="text-3xl md:text-4xl font-black text-white mb-3">Windows Gaming &amp; AI Cache Bloat Calculator (2026 Benchmark)</h1>
      <p class="text-sm md:text-base text-emerald-100/85 max-w-3xl leading-relaxed">
        Modern PC games, GPU shader compilers, local AI inference tools, and developer IDEs silently store tens of gigabytes inside hidden <code class="text-emerald-300">%LOCALAPPDATA%</code>, <code class="text-emerald-300">%USERPROFILE%</code>, and <code class="text-emerald-300">C:\ProgramData</code> directories that Windows Storage Sense completely misses. Select the apps installed on your PC below to inspect exact folder paths and estimate how much disk space you can safely reclaim without losing save files, logins, or active projects.
      </p>
    </header>
    ${widgetHtml}
    <section class="mt-8 bg-[#062017] border border-emerald-500/30 rounded-2xl p-6 md:p-8 text-sm text-emerald-100/85 leading-relaxed space-y-4">
      <h2 class="text-xl font-bold text-white">Benchmark Methodology &amp; Non-Destructive Cleanup Guarantees</h2>
      <p>
        Every workload profile in this calculator is calibrated against SWEEPR Storage Research Lab measurements on Windows 10 (22H2) and Windows 11 (23H2 / 24H2) workstations. Unlike legacy registry cleaners, SWEEPR Cleaner targets strictly disposable staging depots, compiled DirectX/Vulkan shader caches, orphaned MSI/EXE patch payloads, and temporary preview buffers—never touching saved game progress, browser passwords, session cookies, or active model weights unless explicitly selected.
      </p>
      <p>
        For manual verification before running an automated scan, inspect our step-by-step safety audits for the largest C: drive culprits:
        <a href="/clean/app/steam-depotcache" class="text-emerald-300 underline font-semibold">Steam depotcache</a>,
        <a href="/clean/app/genshin-impact-update-cache" class="text-emerald-300 underline font-semibold">Genshin Impact Update Cache</a>,
        <a href="/clean/app/comfyui-temp-output-cache" class="text-emerald-300 underline font-semibold">ComfyUI Temp &amp; Output Cache</a>,
        <a href="/clean/app/amd-shader-cache" class="text-emerald-300 underline font-semibold">AMD Radeon DXCache</a>,
        <a href="/clean/app/nvidia-dxcache" class="text-emerald-300 underline font-semibold">NVIDIA DXCache</a>, and
        <a href="/clean/folder/winsxs" class="text-emerald-300 underline font-semibold">Windows WinSxS Component Store</a>.
        You can also compare SWEEPR against legacy utilities in <a href="/vs/ccleaner" class="text-emerald-300 underline font-semibold">SWEEPR vs CCleaner</a> and <a href="/vs/cleanmymac" class="text-emerald-300 underline font-semibold">SWEEPR vs CleanMyMac X</a>.
      </p>
    </section>
  </main>
  <footer class="mt-auto py-8 text-center text-emerald-200/70 text-xs border-t border-emerald-500/20">
    <div class="flex flex-wrap justify-center gap-6 mb-3 font-medium">
      <a href="/pricing" class="hover:text-emerald-300 transition-colors">Pricing</a>
      <a href="/vs/ccleaner" class="hover:text-emerald-300 transition-colors">vs CCleaner</a>
      <a href="/refund" class="hover:text-emerald-300 transition-colors">Refund Policy</a>
      <a href="/terms" class="hover:text-emerald-300 transition-colors">Terms of Service</a>
      <a href="/privacy" class="hover:text-emerald-300 transition-colors">Privacy Policy</a>
      <a href="/support" class="hover:text-emerald-300 transition-colors">Support &amp; Help</a>
      <a href="#cookie-preferences" data-cookie-preferences="true" onclick="if(window.sweeprOpenCookiePreferences){window.sweeprOpenCookiePreferences();return false;}" class="hover:text-emerald-300 transition-colors">Cookie Preferences</a>
    </div>
    <p>&copy; 2026 SWEEPR Cleaner Inc. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

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
  const priorityList = Array.from(new Set([...getGscPriorityInternalLinkSlugs(), ...FEATURED_GSC_SLUGS])).slice(0, 50);
  const featuredItems = priorityList
    .slice(0, 20)
    .map((s) => items.find((i) => i.slug === s))
    .filter((i): i is CleanItem => Boolean(i));

  const siloOrder: PseoClusterId[] = [
    "gaming",
    "gpu",
    "creative",
    "devtools",
    "browsers_chat",
    "win_update",
    "win_crash_logs",
    "win_system",
  ];
  const siloGroups = siloOrder.map((cid) => ({
    profile: CLUSTER_PROFILES[cid],
    items: items.filter((i) => classifyPseoCluster(i) === cid),
  }));

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
  <script src="/vendor/tailwindcss-3.4.5.js"></script>
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
      <a href="/tools" class="hidden md:inline-flex btn btn-ghost text-sm">Cleaner Tools</a>
      <a href="/safe-to-delete" class="hidden md:inline-flex btn btn-ghost text-sm">Path Checker</a>
      <a href="/bloat-watch" class="hidden md:inline-flex btn btn-ghost text-sm">Bloat Watch</a>
      <a href="/state-of-windows-storage" class="hidden lg:inline-flex btn btn-ghost text-sm">2026 Storage Study</a>
      <a href="/pricing" class="hidden md:inline-flex btn btn-ghost text-sm">Pricing</a>
      <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="hidden sm:inline-flex btn btn-ghost text-sm font-bold text-emerald-700" rel="nofollow">Get Pro</a>
      <a href="/download" class="hidden sm:inline-flex btn btn-go text-sm" rel="nofollow">Download Free Scan</a>
    </div>
  </nav>

  <main class="max-w-5xl mx-auto px-6 py-12">
    <div class="text-center mb-10">
      <h1 class="text-3xl md:text-5xl font-black text-gray-900 mb-4">Windows Storage &amp; Cache Directory</h1>
      <p class="text-gray-600 text-lg max-w-2xl mx-auto mb-6">
        Wondering what is filling up your hard drive? Browse ${items.length} verified Windows 10 &amp; 11 cleanup guides organized by technical domain (${appItems.length} application caches &amp; ${folderItems.length} system folders).
      </p>
      <div class="flex flex-wrap justify-center gap-2">
        ${siloGroups
          .map(
            (g) =>
              `<a href="#silo-${g.profile.id}" class="text-xs font-bold px-3 py-1.5 rounded-full bg-white border border-gray-200 hover:border-emerald-500 text-gray-700 hover:text-emerald-700 no-underline transition-all">${g.profile.badge} (${g.items.length})</a>`
          )
          .join("")}
      </div>
    </div>

    ${renderGamingAndAiCacheBloatCalculatorWidget()}

    ${
      featuredItems.length > 0
        ? `
    <div id="gsc-trending-storage-fixes" class="mb-12 bg-emerald-50/70 border border-emerald-200 rounded-2xl p-6">
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

    ${siloGroups
      .map(
        (g) => `
    <section id="silo-${g.profile.id}" class="mb-12 scroll-mt-24">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-5">
        <h2 class="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <span>${g.profile.label}</span>
        </h2>
        <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">${g.items.length} Verified Guides</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        ${g.items.map(renderCard).join("")}
      </div>
    </section>
    `
      )
      .join("")}

    <!-- Competitor Comparison & Switcher Hub -->
    <section class="mb-12 bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm">
      <h2 class="text-xl font-bold text-gray-900 mb-2">Compare SWEEPR Cleaner vs. Legacy Windows &amp; Mac Cleaners (2026 Benchmarks)</h2>
      <p class="text-xs text-gray-600 mb-5">
        See how SWEEPR's 5.8 MB native Rust engine compares against Windows and macOS utilities across deep app/shader/developer cache detection, zero-telemetry privacy, and 7-day automatic rollback:
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <a href="/vs/ccleaner" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. CCleaner &rarr;</a>
        <a href="/vs/cleanmymac" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. CleanMyMac X &rarr;</a>
        <a href="/vs/pearcleaner" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. Pearcleaner &rarr;</a>
        <a href="/vs/onyx" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. OnyX &rarr;</a>
        <a href="/vs/daisydisk" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. DaisyDisk &rarr;</a>
        <a href="/vs/bleachbit" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. BleachBit &rarr;</a>
        <a href="/vs/cleanmypc" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. CleanMyPC &rarr;</a>
        <a href="/vs/avast-cleanup" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. Avast Cleanup &rarr;</a>
        <a href="/vs/wise-disk-cleaner" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. Wise Disk Cleaner &rarr;</a>
        <a href="/vs/glary-utilities" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. Glary Utilities &rarr;</a>
        <a href="/alternatives/ccleaner" class="p-3 rounded-xl bg-gray-50 border border-gray-200 hover:border-emerald-500 font-semibold text-gray-700 hover:text-emerald-700 no-underline">Best CCleaner Alternative (2026) &rarr;</a>
        <a href="/alternatives/cleanmymac" class="p-3 rounded-xl bg-gray-50 border border-gray-200 hover:border-emerald-500 font-semibold text-gray-700 hover:text-emerald-700 no-underline">Best CleanMyMac X Alternative &rarr;</a>
        <a href="/alternatives/pearcleaner" class="p-3 rounded-xl bg-gray-50 border border-gray-200 hover:border-emerald-500 font-semibold text-gray-700 hover:text-emerald-700 no-underline">Best Pearcleaner Alternative &rarr;</a>
        <a href="/alternatives/onyx" class="p-3 rounded-xl bg-gray-50 border border-gray-200 hover:border-emerald-500 font-semibold text-gray-700 hover:text-emerald-700 no-underline">Best OnyX Alternative &rarr;</a>
        <a href="/alternatives/daisydisk" class="p-3 rounded-xl bg-gray-50 border border-gray-200 hover:border-emerald-500 font-semibold text-gray-700 hover:text-emerald-700 no-underline">Best DaisyDisk Alternative &rarr;</a>
        <a href="/alternatives/bleachbit" class="p-3 rounded-xl bg-gray-50 border border-gray-200 hover:border-emerald-500 font-semibold text-gray-700 hover:text-emerald-700 no-underline">Best BleachBit Alternative (2026) &rarr;</a>
        <a href="/alternatives/cleanmypc" class="p-3 rounded-xl bg-gray-50 border border-gray-200 hover:border-emerald-500 font-semibold text-gray-700 hover:text-emerald-700 no-underline">Best CleanMyPC Alternative (2026) &rarr;</a>
        <a href="/alternatives/avast-cleanup" class="p-3 rounded-xl bg-gray-50 border border-gray-200 hover:border-emerald-500 font-semibold text-gray-700 hover:text-emerald-700 no-underline">Best Avast Cleanup Alternative &rarr;</a>
        <a href="/alternatives/wise-disk-cleaner" class="p-3 rounded-xl bg-gray-50 border border-gray-200 hover:border-emerald-500 font-semibold text-gray-700 hover:text-emerald-700 no-underline">Best Wise Disk Cleaner Alternative &rarr;</a>
        <a href="/alternatives/glary-utilities" class="p-3 rounded-xl bg-gray-50 border border-gray-200 hover:border-emerald-500 font-semibold text-gray-700 hover:text-emerald-700 no-underline">Best Glary Utilities Alternative &rarr;</a>
      </div>
    </section>

    <div class="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-2xl p-8 text-center mt-12">
      <h3 class="text-2xl font-bold mb-2">Want to clean all of these in 60 seconds?</h3>
      <p class="text-gray-300 text-sm max-w-lg mx-auto mb-6">
        SWEEPR Cleaner checks all 40+ hidden folders at once and safely frees up your storage in one click—covering up to 5 devices (Windows, Mac, Android &amp; iOS) with a 7-day undo safety net.
      </p>
      <div class="flex flex-col sm:flex-row justify-center gap-4 mb-5">
        <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="btn btn-go btn-big" rel="nofollow">
          Activate Pro Now (5 Devices) &rarr;
        </a>
        <a href="/download" class="btn bg-white/10 hover:bg-white/20 text-white text-sm px-6 py-3" rel="nofollow">
          Download Free Windows / Mac Scan
        </a>
      </div>
      <div class="max-w-lg mx-auto bg-white/5 border border-white/10 rounded-xl p-3 text-left text-xs text-gray-300">
        <strong class="text-emerald-400">🛡️ Windows 10/11 First-Launch Tip:</strong> Because v0.1.0 is a freshly compiled native Rust binary, if Windows SmartScreen appears on first launch:
        <strong>1. Click "More info"</strong> &rarr; <strong>2. Click "Run anyway"</strong>.
      </div>
    </div>
  </main>
  <footer class="mt-auto py-8 text-center text-gray-500 text-xs border-t border-gray-200 bg-white">
    <div class="flex flex-wrap justify-center gap-6 mb-3 font-medium">
      <a href="/refund" class="hover:text-emerald-600 transition-colors">Refund Policy</a>
      <a href="/terms" class="hover:text-emerald-600 transition-colors">Terms of Service</a>
      <a href="/privacy" class="hover:text-emerald-600 transition-colors">Privacy Policy</a>
      <a href="/support" class="hover:text-emerald-600 transition-colors">Support &amp; Help</a>
      <a href="#cookie-preferences" data-cookie-preferences="true" onclick="if(window.sweeprOpenCookiePreferences){window.sweeprOpenCookiePreferences();return false;}" class="hover:text-emerald-600 transition-colors">Cookie Preferences</a>
    </div>
    <p>&copy; 2026 SWEEPR Cleaner Inc. All rights reserved.</p>
  </footer>
  <div id="google_translate_element" style="display:none !important;"></div>
  <script src="/i18n.js" defer></script>
  <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" async defer></script>
</body>
</html>`;
  cachedDirectoryHtml = htmlResult;
  return htmlResult;
}

export function renderPseoPage(item: CleanItem): string {
  const clusterId = classifyPseoCluster(item);
  const cluster = CLUSTER_PROFILES[clusterId];
  const psSnippet = buildPowerShellInspectionSnippet(item);
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
  const seoOverride = getApprovedIntentGapSeoOverride(item.slug);
  const mergedTargetSlug = seoOverride?.mergedIntoSlug || item.mergedIntoSlug;
  const mergedTargetItem = mergedTargetSlug
    ? getCleanItems().find((i) => i.slug === mergedTargetSlug.toLowerCase())
    : undefined;
  const isNoindexed = Boolean(item.noindex || seoOverride?.noindex || mergedTargetItem);
  const robotsMetaContent = isNoindexed
    ? "noindex, follow"
    : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
  const canonicalUrl = mergedTargetItem
    ? `https://sweeprcleaner.com/clean/${mergedTargetItem.category}/${mergedTargetItem.slug}`
    : `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
  const { siblings, related } = getSiblingAndRelatedItems(item);
  const absorbedVariants = getAbsorbedRedirectVariants(item);
  const telemetryTruth = getActiveTelemetryTruthForSlug(item.slug);
  const bloatBenchmark = getPublishedBloatWatchForCleanSlug(item.slug);
  const matchedTool = matchTransactionalToolForItem(item, cluster.id);
  const isStreamDeck = item.slug === "elgato-streamdeck-cache";

  const faqItems = [
    {
      q: `Is it safe to delete ${item.name}?`,
      a: item.warning
        ? `Exercise caution: ${item.warning}`
        : `Yes, 100% safe. ${item.whatHappens}`,
    },
    {
      q: `How much storage space will cleaning ${item.name} free up?`,
      a: telemetryTruth?.badge_text
        ? `${telemetryTruth.badge_text}. Across Windows 10 and Windows 11 PCs, users typically reclaim ${item.avgSpace} in ${item.path}.`
        : `Users typically reclaim ${item.avgSpace} on Windows 10 and Windows 11 systems depending on update frequency and active cache retention in ${item.path}.`,
    },
    cluster.extraFaq(item),
    {
      q: `Where is ${item.name} located on Windows 10 and Windows 11?`,
      a: `It is stored at ${item.path}. You can paste that path directly into the Windows Run dialog (Win + R) or File Explorer address bar to inspect it.`,
    },
    ...(absorbedVariants.length > 0
      ? [
          {
            q: `Can I also delete Media Blob Storage, Service Worker CacheStorage, Code Cache, GPU Shader Cache, and Crashpad Dump Logs for ${item.name}?`,
            a: `Yes. All sub-cache modules associated with ${item.name}—including Media Blob Storage (blob_storage / IndexedDB), Service Worker CacheStorage, V8 Code & Bytecode Cache, GPU Shader Cache (GPUCache / DawnCache), and Crashpad Dump Logs (.dmp)—are 100% safe to delete when the app is closed and rebuild automatically on demand without resetting your profiles or logins.`,
          },
        ]
      : []),
    ...(isStreamDeck
      ? [
          {
            q: "How do I clean physical Elgato Stream Deck LCD keys vs. the Windows Stream Deck app cache?",
            a: "To clean the Windows software cache (500 MB–3.5 GB), quit the Stream Deck tray app and clear %AppData%\\Elgato\\StreamDeck\\logs, Cache, Service Worker\\CacheStorage, and Media Blob Storage (your button profiles in ProfilesV2 stay 100% safe). To clean physical Stream Deck LCD keys and housing, unplug the USB cable first and gently wipe the keys with a lint-free microfiber cloth lightly dampened with water or 70% isopropyl alcohol—never spray liquid directly onto the LCD keys or seams.",
          },
        ]
      : []),
    ...(Array.isArray(item.customFaqs) ? item.customFaqs.filter((f) => f && f.q && f.a) : []),
  ];

  const subLocations = buildSubLocationsForItem(item, clusterId);
  const consolidatedSubCacheHtml =
    absorbedVariants.length > 0
      ? `
      <div id="consolidated-subcache-modules" class="mt-6 pt-6 border-t border-gray-100">
        <h3 class="text-sm font-bold text-gray-900 mb-2">Consolidated Sub-Cache Modules: Media Blob Storage, Service Worker CacheStorage &amp; Shader Caches</h3>
        <p class="text-xs text-gray-600 mb-3">
          This canonical guide also covers all sub-cache directories for <strong>${item.name}</strong>. Every sub-module below is scanned and safely cleaned by SWEEPR Cleaner without affecting your saved settings or accounts:
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          ${absorbedVariants
            .map(
              (v) => `
          <div class="p-3 rounded-xl bg-gray-50 border border-gray-200/80">
            <div class="flex items-center justify-between gap-2 mb-1">
              <span class="font-bold text-gray-900">${v.label}</span>
              <span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">🟢 Safe</span>
            </div>
            <div class="font-mono text-[11px] text-gray-500 truncate mb-1">${v.subPath}</div>
            <div class="text-[11px] text-gray-600 leading-snug">${v.role}</div>
          </div>`
            )
            .join("")}
        </div>
      </div>`
      : "";

  const siblingTableSection = `
    <!-- Sub-Folders & Cache Locations Breakdown Table -->
    <div id="subfolders-breakdown-table" class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm mb-8">
      <h2 class="text-lg font-bold text-gray-900 mb-2">Sub-Folders &amp; Cache Locations Breakdown for ${item.name}</h2>
      <p class="text-xs text-gray-600 mb-4">
        Modern Windows applications and system services split their disk footprint across multiple sub-directories (` + "`Cache_Data`" + `, ` + "`Service Worker\\CacheStorage`" + `, ` + "`Media Blob Storage`" + `, ` + "`Code Cache`" + `, ` + "`GPUCache`" + `, and ` + "`Crashpad\\reports`" + `). Review which sub-folders inside <strong>${item.name}</strong> are safe to purge and which files remain protected:
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-gray-200">
              <th class="py-2.5 pr-3 font-bold text-gray-700">Sub-Folder / Cache Location</th>
              <th class="py-2.5 pr-3 font-bold text-gray-700">Storage Role</th>
              <th class="py-2.5 pr-3 font-bold text-gray-700">Typical Footprint</th>
              <th class="py-2.5 font-bold text-gray-700">Deletion Safety</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 text-gray-600">
            ${subLocations
              .map(
                (loc, idx) => `
            <tr class="${idx === 0 ? "bg-emerald-50/50" : loc.safe.includes("Protected") ? "bg-gray-50/80" : ""}">
              <td class="py-2.5 pr-3 font-mono text-[11px] font-semibold text-gray-900 break-all max-w-xs">${loc.subPath}</td>
              <td class="py-2.5 pr-3">${loc.role}</td>
              <td class="py-2.5 pr-3 font-semibold text-gray-800 whitespace-nowrap">${loc.avgSpace}</td>
              <td class="py-2.5 whitespace-nowrap font-semibold">${loc.safe}</td>
            </tr>`
              )
              .join("")}
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
            </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      ${consolidatedSubCacheHtml}
    </div>`;

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
  <meta name="robots" content="${robotsMetaContent}">
  <link rel="canonical" href="${canonicalUrl}">
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
  <script src="/vendor/tailwindcss-3.4.5.js"></script>
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
      <a href="/tools" class="hidden md:inline-flex btn btn-ghost text-sm">Cleaner Tools</a>
      <a href="/safe-to-delete" class="hidden md:inline-flex btn btn-ghost text-sm">Path Checker</a>
      <a href="/bloat-watch" class="hidden md:inline-flex btn btn-ghost text-sm">Bloat Watch</a>
      <a href="/state-of-windows-storage" class="hidden lg:inline-flex btn btn-ghost text-sm">2026 Storage Study</a>
      <a href="/pricing" class="hidden md:inline-flex btn btn-ghost text-sm">Pricing</a>
      <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="hidden sm:inline-flex btn btn-ghost text-sm font-bold text-emerald-700" rel="nofollow">Get Pro</a>
      <a href="/download" class="hidden sm:inline-flex btn btn-go text-sm" rel="nofollow">Get SWEEPR Cleaner</a>
    </div>
  </nav>

  <main class="max-w-3xl mx-auto px-6 py-12">
    <div class="mb-8">
      <div class="flex flex-wrap items-center gap-2 text-xs font-bold text-emerald-600 uppercase tracking-wider">
        <a href="/clean" class="hover:underline">&larr; Clean Directory</a>
        <span class="text-gray-300">/</span>
        <a href="/clean#silo-${cluster.id}" class="hover:underline">${cluster.badge}</a>
      </div>
      <h1 class="text-3xl md:text-4xl font-black text-gray-900 mt-2 mb-3">${
        isStreamDeck
          ? "Elgato Stream Deck App Cache Folder (%APPDATA%\\Elgato\\StreamDeck) — Safe to Delete? (Reclaim 1–4 GB on Windows 11)"
          : `How to Clean ${item.name}`
      }</h1>
      <div class="flex flex-wrap gap-3 items-center text-sm">
        <span class="px-3 py-1 rounded-full font-bold text-xs ${
          item.safeToDelete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
        }">
          ${item.safeToDelete ? "🟢 100% Safe to Delete" : "⚠️ Exercise Caution"}
        </span>
        <span class="text-gray-500">Typical Space Reclaimed: <strong>${item.avgSpace}</strong></span>
      </div>
      ${
        isStreamDeck
          ? `<div id="streamdeck-top-intent-callout" class="mt-4 bg-amber-50/90 border border-amber-300 rounded-xl p-3.5 text-xs text-slate-800 leading-relaxed shadow-sm">
              <p class="mb-1"><strong>1. Looking to clean physical Elgato Stream Deck LCD keys?</strong> Unplug the USB cable first and gently wipe the LCD buttons with a lint-free microfiber cloth lightly dampened with water or 70% isopropyl alcohol (never spray liquid directly onto the keys).</p>
              <p class="m-0"><strong>2. Looking to reclaim 1–4 GB of Windows 11 PC disk bloat?</strong> This guide covers deleting the software disk cache in <code>%APPDATA%\\Elgato\\StreamDeck</code> (<code>logs</code>, <code>Cache</code>, <code>Blob_Storage</code>, and <code>Service Worker\\CacheStorage</code>) while keeping your <code>ProfilesV2</code> button layouts 100% intact.</p>
            </div>`
          : ""
      }
    </div>

    <!-- Quick Verdict Box (GEO / AI Snippet Optimized) -->
    <div class="bg-white border-2 border-emerald-500/30 rounded-2xl p-6 shadow-sm mb-6">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 class="text-lg font-bold text-gray-900">Location &amp; Quick Verdict</h2>
        ${
          telemetryTruth?.badge_text
            ? `<span id="telemetry-truth-badge" class="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">${telemetryTruth.badge_text}</span>`
            : ""
        }
      </div>
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
      ${
        isStreamDeck
          ? `<div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-700 mb-4 leading-relaxed">
              <strong class="text-slate-900 block mb-1">💡 Cleaning Physical Stream Deck LCD Keys vs. Windows App Cache:</strong>
              <span><strong>1. Windows App Cache (500 MB–3.5 GB):</strong> Quit Stream Deck from the system tray and clean <code>%AppData%\\Elgato\\StreamDeck\\logs</code>, <code>Cache</code>, <code>Service Worker\\CacheStorage</code>, and <code>Media Blob Storage</code> (your <code>ProfilesV2</code> button layouts stay 100% untouched).<br><strong>2. Physical LCD Keys:</strong> Unplug the USB cable first, then wipe the LCD keycaps with a lint-free microfiber cloth lightly dampened with water or 70% isopropyl alcohol (never spray liquid directly onto the keys).</span>
            </div>`
          : ""
      }
      ${
        mergedTargetItem
          ? `<div id="soft-merge-consolidation-banner" class="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-xs text-blue-900 mb-4 leading-relaxed">
              <strong>📌 Consolidated Storage Guide:</strong> This folder is part of our primary guide for <a href="/clean/${mergedTargetItem.category}/${mergedTargetItem.slug}" class="font-bold underline hover:text-blue-700">${mergedTargetItem.name} (${mergedTargetItem.path})</a>.
            </div>`
          : ""
      }
      ${
        bloatBenchmark
          ? `<div id="bloat-watch-benchmark-callout" class="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 text-xs text-emerald-950 mb-4 flex flex-wrap items-center justify-between gap-2">
              <span>🧪 <strong>Lab VM Benchmark Available:</strong> ${bloatBenchmark.title}${bloatBenchmark.reclaimed_gb ? ` (${bloatBenchmark.reclaimed_gb} GB reclaimed)` : ""}</span>
              <a href="/bloat-watch/${bloatBenchmark.slug}" class="font-bold text-emerald-800 underline hover:text-emerald-600 whitespace-nowrap">Read Lab Benchmark &rarr;</a>
            </div>`
          : ""
      }
      <div class="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
        <a href="/download?platform=windows&amp;utm_source=pseo_quick_verdict&amp;slug=${item.slug}" class="btn btn-go text-xs py-2 px-4" rel="nofollow">
          Download Free 60-Second Windows Scan (.exe) &rarr;
        </a>
        <a href="/order?plan=annual&amp;utm_source=pseo_quick_verdict&amp;slug=${item.slug}" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="text-xs font-bold text-emerald-700 hover:underline" rel="nofollow">
          Or Activate 1-Click Pro Cleaner (5 Devices) &rarr;
        </a>
        <a href="/safe-to-delete" class="text-xs font-bold text-gray-700 hover:underline">
          🔍 Open Multi-Folder Batch Checker
        </a>
      </div>
    </div>

    <!-- Above-the-Fold Interactive "Safe-to-Delete + 1-Click Clean" Conversion Widget -->
    <div id="sweepr-inline-checker-widget" class="bg-gradient-to-br from-emerald-950 via-gray-900 to-gray-900 text-white rounded-2xl p-6 shadow-md mb-8 border border-emerald-500/30">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span class="text-[11px] font-extrabold uppercase tracking-wider text-emerald-400">⚡ Instant Folder Safety Verifier &amp; 1-Click Cleaner</span>
        <span class="text-[11px] text-gray-300">5 MB Native Rust Engine · 7-Day Undo Quarantine</span>
      </div>
      <h2 class="text-base md:text-lg font-extrabold text-white mb-1.5">Verify Any Windows Folder Path or Clean ${item.name} in 1 Click</h2>
      <p class="text-xs text-gray-300 mb-3">
        Paste any <code>C:\\</code>, <code>%LocalAppData%</code>, or <code>%AppData%</code> path below to check if it is safe to delete—or download SWEEPR Cleaner to scan all 40+ hidden cache locations automatically:
      </p>
      <div class="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          id="inlineSafeCheckInput"
          type="text"
          value="${item.path.split(/\s+(?:or|and)\s+/i)[0].trim().replace(/"/g, "&quot;")}"
          aria-label="Windows folder path to verify"
          class="flex-1 px-3.5 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white font-mono text-xs focus:outline-none focus:border-emerald-400"
        />
        <button
          id="inlineSafeCheckBtn"
          type="button"
          class="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-extrabold text-xs cursor-pointer transition whitespace-nowrap"
        >
          Verify Path Safety
        </button>
      </div>
      <div id="inlineSafeCheckResult" class="hidden rounded-xl bg-white/10 border border-white/15 p-3.5 text-xs mb-3"></div>
      <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/10 text-xs">
        <div class="flex flex-wrap items-center gap-3">
          <a href="/download?platform=windows&amp;utm_source=pseo_inline_widget&amp;slug=${item.slug}" class="inline-flex items-center gap-1.5 font-extrabold text-emerald-300 hover:text-emerald-200 underline" rel="nofollow">
            💻 Download Free Windows Scan (Reclaim ${item.avgSpace}) &rarr;
          </a>
          <a href="/order?plan=annual&amp;utm_source=pseo_inline_widget&amp;slug=${item.slug}" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="inline-flex items-center gap-1 font-bold text-white/90 hover:text-white" rel="nofollow">
            🔑 Unlock 5-Device Pro
          </a>
        </div>
        <span class="text-[11px] text-gray-400">Protected: saves, logins &amp; personal files untouched</span>
      </div>
      <script>
        (function() {
          var btn = document.getElementById('inlineSafeCheckBtn');
          var inp = document.getElementById('inlineSafeCheckInput');
          var out = document.getElementById('inlineSafeCheckResult');
          if (!btn || !inp || !out) return;
          btn.addEventListener('click', function() {
            var val = (inp.value || '').trim();
            if (!val) return;
            btn.disabled = true;
            btn.textContent = 'Checking…';
            fetch('/api/safe-to-delete/check', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ input: val })
            })
              .then(function(r) { return r.json(); })
              .then(function(d) {
                btn.disabled = false;
                btn.textContent = 'Verify Path Safety';
                var first = d && d.results && d.results[0];
                if (!first) return;
                out.classList.remove('hidden');
                var badgeColor = first.verdict === 'SAFE_TO_DELETE' ? '#34d399' : first.verdict === 'DO_NOT_DELETE' ? '#f87171' : '#fbbf24';
                out.innerHTML =
                  '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px;">' +
                  '<strong style="color:' + badgeColor + ';">' + (first.verdict_label || first.verdict) + ' — ' + (first.matched_name || '') + '</strong>' +
                  '<span style="font-weight:700;color:#d1fae5;">Typical Space: ' + (first.avg_space || '${item.avgSpace}') + '</span>' +
                  '</div>' +
                  '<div style="color:#e2e8f0;line-height:1.45;margin-bottom:6px;">' + (first.explanation || '') + '</div>' +
                  '<a href="/download?platform=windows&utm_source=pseo_inline_verified&slug=${item.slug}" style="color:#34d399;font-weight:800;text-decoration:underline;" rel="nofollow">Clean this path safely in 1 click with SWEEPR Cleaner (.exe) &rarr;</a>';
              })
              .catch(function() {
                btn.disabled = false;
                btn.textContent = 'Verify Path Safety';
              });
          });
        })();
      </script>
    </div>

    <!-- Technical Architecture & Cache Mechanics -->
    <div class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm mb-8">
      <h2 class="text-xl font-bold text-gray-900 mb-3">${cluster.sectionTitle(item)}</h2>
      <p class="text-gray-600 text-sm leading-relaxed mb-4">
        ${cluster.leadParagraph(item)}
      </p>
      <p class="text-gray-600 text-sm leading-relaxed mb-4">
        ${cluster.mechanicsParagraph(item)}
      </p>
      <div class="mt-4 mb-5">
        <div class="text-xs font-bold text-gray-700 mb-1.5">PowerShell Size Verification (Read-Only Check):</div>
        <pre class="bg-gray-900 text-emerald-300 font-mono text-[11px] p-3.5 rounded-xl overflow-x-auto leading-relaxed">${psSnippet}</pre>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 pt-6 border-t border-gray-100 text-xs">
        <div class="p-4 rounded-xl bg-gray-50 border border-gray-100">
          <span class="font-bold text-gray-900 block mb-1">🛡️ What Stays 100% Protected</span>
          <span class="text-gray-600">${cluster.protectedSummary}</span>
        </div>
        <div class="p-4 rounded-xl bg-gray-50 border border-gray-100">
          <span class="font-bold text-gray-900 block mb-1">⚡ What Gets Safely Removed</span>
          <span class="text-gray-600">${cluster.removedSummary}</span>
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
              <td class="py-2 text-emerald-700 font-semibold">&lt; 60 seconds across ${cleanItems.length}+ areas</td>
            </tr>
          </tbody>
        </table>
      </div>
      ${
        item.competitorBlueprint && item.competitorBlueprint.superiorityFixes?.length
          ? `<div class="mt-4 pt-3 border-t border-gray-100 text-xs text-gray-600">
               <p class="font-semibold text-gray-800 mb-1">Why this guide goes further than legacy PC cleaners (${esc(item.competitorBlueprint.sourceDomain)}):</p>
               <ul class="list-disc pl-4 space-y-0.5">
                 ${item.competitorBlueprint.superiorityFixes.map((f) => `<li>${esc(f)}</li>`).join("")}
               </ul>
             </div>`
          : ""
      }
    </div>

    ${relatedSection}

    <!-- A15: Matched Transactional Cleaner Tool & Competitor Switcher Hub -->
    <div id="pseo-commercial-crosslinks" class="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-6 mb-8">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-emerald-200/70">
        <div>
          <span class="inline-block text-[11px] font-extrabold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full mb-1.5">⚡ Interactive 1-Click Tool</span>
          <h2 class="text-base font-extrabold text-gray-900">${esc(matchedTool.label)} (Free ${esc(matchedTool.savings)})</h2>
          <p class="text-xs text-gray-600 mt-0.5">Paste your PowerShell folder scan output or download the 5.8 MB signed Rust cleaner for ${esc(item.name)}.</p>
        </div>
        <a href="/tools/${matchedTool.slug}" class="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs no-underline whitespace-nowrap shadow-sm">
          Open ${esc(matchedTool.label)} &rarr;
        </a>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
        <span class="font-semibold text-gray-800">Why Windows &amp; Mac users switch to SWEEPR (5.8 MB Rust, Zero Telemetry Bloat):</span>
        <div class="flex flex-wrap gap-3 font-bold">
          <a href="/vs/ccleaner" class="text-emerald-700 hover:underline">SWEEPR vs CCleaner</a>
          <a href="/alternatives/ccleaner" class="text-emerald-700 hover:underline">Best CCleaner Alternative</a>
          <a href="/vs/cleanmymac" class="text-emerald-700 hover:underline">SWEEPR vs CleanMyMac X</a>
          <a href="/vs/pearcleaner" class="text-emerald-700 hover:underline">SWEEPR vs Pearcleaner</a>
          <a href="/vs/onyx" class="text-emerald-700 hover:underline">SWEEPR vs OnyX</a>
          <a href="/vs/daisydisk" class="text-emerald-700 hover:underline">SWEEPR vs DaisyDisk</a>
          <a href="/vs/bleachbit" class="text-emerald-700 hover:underline">SWEEPR vs BleachBit</a>
          <a href="/safe-to-delete" class="text-emerald-700 hover:underline">Safe-to-Delete Checker</a>
          <a href="/state-of-windows-storage" class="text-emerald-700 hover:underline">2026 Storage Study</a>
        </div>
      </div>
    </div>

    <!-- Automated 1-Click Callout -->
    <div class="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-2xl p-8 text-center shadow-lg">
      <h3 class="text-2xl font-bold mb-2">Clean ${item.name} Automatically</h3>
      <p class="text-gray-300 text-sm max-w-lg mx-auto mb-6">
        SWEEPR Cleaner safely clears ${item.name} along with ${cleanItems.length}+ other hidden app folders and leftover files in one click—covering up to 5 devices (Windows, Mac, Android &amp; iOS) with a 7-day undo safety net.
      </p>
      <div class="flex flex-col sm:flex-row justify-center gap-4 mb-5">
        <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="btn btn-go gap-2" rel="nofollow">
          <span>Activate Pro Now (5 Devices)</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
        </a>
        <a href="/download" class="btn bg-white/10 hover:bg-white/20 text-white text-sm" rel="nofollow">
          Download Free Scan (.exe / .dmg)
        </a>
      </div>
      <div class="max-w-lg mx-auto bg-white/5 border border-white/10 rounded-xl p-3 text-left text-xs text-gray-300">
        <strong class="text-emerald-400">🛡️ Windows 10/11 First-Launch Walkthrough:</strong> Because v0.1.0 is a freshly compiled 5.8 MB native Rust app, if Windows SmartScreen appears:
        <strong>Step 1: Click "More info"</strong> &rarr; <strong>Step 2: Click "Run anyway"</strong>.
      </div>
    </div>
  </main>
  <footer class="mt-auto py-8 text-center text-gray-500 text-xs border-t border-gray-200 bg-white">
    <div class="flex flex-wrap justify-center gap-6 mb-3 font-medium">
      <a href="/refund" class="hover:text-emerald-600 transition-colors">Refund Policy</a>
      <a href="/terms" class="hover:text-emerald-600 transition-colors">Terms of Service</a>
      <a href="/privacy" class="hover:text-emerald-600 transition-colors">Privacy Policy</a>
      <a href="/support" class="hover:text-emerald-600 transition-colors">Support &amp; Help</a>
      <a href="#cookie-preferences" data-cookie-preferences="true" onclick="if(window.sweeprOpenCookiePreferences){window.sweeprOpenCookiePreferences();return false;}" class="hover:text-emerald-600 transition-colors">Cookie Preferences</a>
    </div>
    <p>&copy; 2026 SWEEPR Cleaner Inc. All rights reserved.</p>
  </footer>
  <div id="google_translate_element" style="display:none !important;"></div>
  <script src="/i18n.js" defer></script>
  <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" async defer></script>
</body>
</html>`;
}
