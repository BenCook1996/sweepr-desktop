import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getActiveTelemetryTruthForSlug } from "./seo/telemetry-truth.js";
import { escapeHtml as esc, isSafeObjectKey } from "./security.js";
import {
  ORGANIZATION_SAME_AS,
  renderEditorialHead,
  renderSiteFooter,
  renderSiteHeader,
} from "./ui-shell.js";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLEAN_ITEMS_FILE = join(__dirname, "data", "clean-items.json");
const cleanItemsData = require("./data/clean-items.json");
const pseoRedirectsData: Record<string, string> = require("./data/pseo-redirects.json");

export interface CleanItem {
  slug: string;
  category: "app" | "folder" | "mac" | "ios" | "android";
  platform?: "windows" | "mac" | "ios" | "android";
  name: string;
  path: string;
  safeToDelete: boolean;
  warning?: string;
  avgSpace: string;
  whatIsIt: string;
  whatHappens: string;
  manualSteps: string[];
  questionTitle?: string;
  directAnswer?: string;
  whenNotToDelete?: string;
  whyItGrows?: string;
  isChromiumBased?: boolean;
  shellCommand?: {
    label: string;
    language: "powershell" | "bash" | "cmd";
    code: string;
  };
  labMeasurement?: {
    beforeGb: number;
    afterGb: number;
    reclaimedGb: number;
    osBuild: string;
    notes: string;
  };
  metaTitle?: string;
  metaDescription?: string;
  customFaqs?: Array<{ q: string; a: string }>;
  subLocations?: Array<{
    subPath: string;
    role: string;
    avgSpace: string;
    safe: string;
    extensions?: string[];
    regenerates?: string;
    troubleshooting?: string;
  }>;
  proofImage?: string;
  visualProof?: string | { path: string; alt?: string; caption?: string };
  troubleshooting?: {
    processLock?: string;
    adminRequired?: boolean;
    edgeCaseNote?: string;
  };
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
  if (!isSafeObjectKey(category) || !isSafeObjectKey(slug)) return undefined;
  getCleanItems();
  return cleanItemsMap.get(`${category}:${slug}`);
}

const RETIRED_VARIANT_SUFFIX_RE =
  /-(service-worker-cachestorage|media-blob-storage|code-bytecode-cache|gpu-shader-cache|crashpad-dump-logs)$/;

function resolveIndexableRedirect(target: string): string {
  const m = target.match(/^\/clean\/(?:app|folder|mac|ios|android)\/([a-z0-9-]+)$/i);
  if (m && isPseoSlugNoindexed(m[1])) {
    return "/clean";
  }
  return target;
}

export type PseoRouteDisposition =
  | { action: "redirect"; target: string }
  | { action: "gone"; parentTarget?: string };

export function getPseoRouteDisposition(category: string, slug: string): PseoRouteDisposition | undefined {
  if (!isSafeObjectKey(category) || !isSafeObjectKey(slug)) return undefined;
  getCleanItems();
  const key = `${category}:${slug}`;
  if (cleanItemsMap.has(key)) {
    return undefined;
  }
  const direct = Object.prototype.hasOwnProperty.call(pseoRedirectsData, key)
    ? pseoRedirectsData[key]
    : undefined;
  if (direct) {
    const m = direct.match(/^\/clean\/(?:app|folder|mac|ios|android)\/([a-z0-9-]+)$/i);
    if (m && isPseoSlugNoindexed(m[1]) && RETIRED_VARIANT_SUFFIX_RE.test(slug)) {
      return { action: "gone", parentTarget: direct };
    }
    return { action: "redirect", target: resolveIndexableRedirect(direct) };
  }
  if (slug === "nvidia-shader-cache" || slug === "nvidia-dx-cache") {
    return { action: "redirect", target: "/clean/app/nvidia-dxcache" };
  }
  if (slug === "livekernelreports") {
    return { action: "redirect", target: "/clean/folder/windows-livekernelreports" };
  }
  if (slug === "vivaldi-cache") {
    return { action: "redirect", target: "/clean/app/vivaldi-browser-cache" };
  }
  if (slug === "intellij-idea-caches" || slug === "intellij-cache") {
    return { action: "redirect", target: "/clean/app/jetbrains-intellij-cache" };
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
    return { action: "redirect", target: "/clean/app/elgato-streamdeck-cache" };
  }
  if (category === "app" || category === "folder") {
    const otherCategory = category === "app" ? "folder" : "app";
    const crossMatch = cleanItemsMap.get(`${otherCategory}:${slug}`);
    if (crossMatch && !crossMatch.noindex) {
      return { action: "redirect", target: `/clean/${crossMatch.category}/${crossMatch.slug}` };
    }
  }
  if (RETIRED_VARIANT_SUFFIX_RE.test(slug)) {
    const base = slug.replace(RETIRED_VARIANT_SUFFIX_RE, "");
    const candidates = [`${base}-cache`, base, `${base}-logs`, `${base}-installer-cache`];
    for (const cand of candidates) {
      const match = cleanItemsMap.get(`app:${cand}`) || cleanItemsMap.get(`folder:${cand}`);
      if (match) {
        const parentTarget = `/clean/${match.category}/${match.slug}`;
        if (isPseoSlugNoindexed(match.slug)) {
          return { action: "gone", parentTarget };
        }
        return { action: "redirect", target: parentTarget };
      }
    }
  }
  return undefined;
}

export function getPseoRedirectTarget(category: string, slug: string): string | undefined {
  const disp = getPseoRouteDisposition(category, slug);
  return disp?.action === "redirect" ? disp.target : undefined;
}

export function renderPseoGonePage(category: string, slug: string): string {
  const canonicalUrl = `https://sweeprcleaner.com/clean/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`;
  return `<!doctype html>
<html lang="en">
${renderEditorialHead({
  title: "410 Gone — Retired Sub-Cache Guide | SWEEPR Cleaner",
  description:
    "This retired sub-cache URL has been permanently removed (HTTP 410 Gone). Browse active Windows, Mac, iOS & Android storage guides.",
  canonical: canonicalUrl,
  robots: "noindex, nofollow",
  ogType: "website",
})}
<body>
  ${renderSiteHeader("guides")}
  <main id="main-content" class="ed-article">
    <section class="ed-section ed-card">
      <div class="ed-verdict-label">HTTP 410 GONE</div>
      <h1 class="ed-h1">This sub-cache guide has been permanently retired</h1>
      <p style="font-size:0.96rem;color:var(--muted);line-height:1.6;margin-bottom:16px;">
        The URL <code class="ed-code">/clean/${esc(category)}/${esc(slug)}</code> is a retired synthetic sub-cache page that has been permanently removed.
      </p>
      <div class="ed-actions">
        <a href="/clean" class="ed-btn-primary">Browse Active Storage Guides</a>
        <a href="/safe-to-delete" class="ed-btn-secondary">Open Path Safety Checker</a>
      </div>
    </section>
  </main>
  ${renderSiteFooter()}
</body>
</html>`;
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
  "steam-depotcache": "Can I Delete Steam depotcache? YES (2–25 GB) — Safe Guide",
  "riot-client-logs": "Can I Delete Riot Client Logs? YES (1.5–8 GB) — Safe Guide",
  "logitech-ghub-installer-cache": "Can I Delete LGHUB Depots? YES (1.5–8 GB) — Safe Guide",
  "stremio-desktop-cache": "Can I Delete Stremio Cache? YES (2–10 GB) — Safe Guide",
  "amd-shader-cache": "Can I Delete AMD DxCache? YES (2–12 GB) — Safe Guide",
  "comfyui-temp-output-cache": "Can I Delete ComfyUI Temp? YES (2–18 GB) — Safe Guide",
  "genshin-impact-update-cache": "Can I Delete Genshin Temp? YES (3–22 GB) — Safe Guide",
  "winsxs": "Can You Delete WinSxS? No — Safe DISM Cleanup Guide (Win 11)",
  "programdata-package-cache": "ProgramData\\Package Cache: Safe to Delete? (MSI Guide)",
  "windows-livekernelreports": "LiveKernelReports & WATCHDOG .dmp: Safe to Delete? (Win 11)",
  "logitech-options-plus-cache": "Delete LogiOptionsPlus Cache? YES (1.2–6.5 GB) — Guide",
  "elgato-streamdeck-cache": "Delete Elgato StreamDeck Cache? YES (1–4 GB) — Safe Guide",
  "vivaldi-browser-cache": "Can I Delete Vivaldi Cache? YES (1–5 GB) — Safe Guide",
  "jetbrains-intellij-cache": "Delete IntelliJ IDEA Cache? YES (1–8 GB) — Safe Guide",
  "opera-gx-cache": "Can I Delete Opera GX Cache? YES (1.8–12 GB) — Safe Guide",
  "medal-tv-cache": "Can I Delete Medal TV Cache? YES (2–14 GB) — Safe Guide",
  "capcut-desktop-cache": "Can I Delete CapCut Cache? YES (2.5–18 GB) — Safe Guide",
  "obs-studio-logs-crashes": "Delete OBS Studio Logs & Cache? YES (1–6.5 GB) — Guide",
  "adobe-media-cache": "Can I Delete Adobe Media Cache? YES (10–80 GB) — Guide",
  "creative-cloud-installer-cache": "Delete Creative Cloud Cache? YES (2–12 GB) — Safe Guide",
  "nvidia-dxcache": "Clear NVIDIA Shader Cache (DXCache) Safely — 2–14 GB",
  "npm-cache": "Can I Delete npm-cache? YES (2–18 GB) — Safe Cleanup Guide",
  "gradle-wrapper-caches": "Can I Delete .gradle\\caches? YES (4–35 GB) — Safe Guide",
  "localappdata-crashdumps": "Can I Delete CrashDumps? YES (1–15 GB) — Safe Guide",
  "hiberfil-sys": "Remove hiberfil.sys on Windows 11 Safely (powercfg Guide)",
  "windows-old": "Delete Windows.old Folder Safely on Windows 11 (15–35 GB)",
  "pip-cache": "Can I Delete pip Cache? YES (2–20 GB) — Safe Cleanup Guide",
  "delivery-optimization": "Delete DeliveryOptimization? YES (3–20 GB) — Safe Guide",
  "c-drive-filling-up-by-itself-windows-11": "Fix C: Drive Filling Up? YES (12–65 GB) — Safe Guide",
  "system-and-reserved-storage-100gb-windows-11": "Shrink System & Reserved? YES (10–60 GB) — Safe Guide",
  "appdata-local-folder-huge-windows-11": "Clean Huge %LOCALAPPDATA%? YES (10–50 GB) — Safe Guide",
  "windows-11-24h2-update-cache-8gb-bug": "Fix Windows 11 24H2 8.6 GB Bug? YES — Safe Cleanup Guide",
  "other-storage-full-windows-11-cleanup": "Clear Windows 11 Temp Files? YES (6–45 GB) — Safe Guide",
  "localappdata-webview2-ebwebview-cache": "Delete WebView2 EBWebView? YES (1.5–9 GB) — Safe Guide",
  "ea-app-cache": "Can I Delete EA App Cache? YES (1.5–6 GB) — Safe Guide",
  "epic-games-webcache": "Delete Epic Games webcache? YES (1–5 GB) — Safe Guide",
  "chrome-gpu-shader-cache": "Delete Chrome GPUCache? YES (1–6 GB) — Safe Cleanup Guide",
  "vrchat-cache": "Delete VRChat Cache Folder? YES (10–30 GB) — Safe Guide",
  "lm-studio-models-cache": "Delete LM Studio Models Cache? YES (10–80 GB) — Guide",
  "discord-cache": "Can I Delete Discord Cache? YES (1.5–6 GB) — Safe Guide",
  "spotify-cache": "Can I Delete Spotify Cache? YES (2–10 GB) — Safe Guide",
  "docker-desktop-ext4-disk": "Shrink Docker WSL2 ext4.vhdx? YES (12–80 GB) — Guide",
  "microsoft-teams-cache": "Clear Microsoft Teams Cache on Windows 11 (1.5–9 GB)",
  "software-distribution-download": "Clear Windows Update Cache on Windows 11 (2.5–16 GB)",
  "appdata-temp": "Delete Temp Files on Windows 11 Safely (Reclaim 2–12 GB)",
  "system-data-huge": "Mac System Data Huge (100 GB+)? Safe Cleanup Guide",
  "iphone-system-data-full": "iPhone System Data Full (40 GB+)? Clear Without Reset",
  "other-storage-full": "Android Other Storage Full? Clear Hidden Trash & Cache",
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
    "Can I delete %AppData%\\stremio\\stremio-server\\stremio-cache? YES (2–10 GB). Zero add-ons or watch history lost. Manual + 1-click 6.5 MB Sweepr scan.",
  "amd-shader-cache":
    "Can I delete %LOCALAPPDATA%\\AMD\\DxCache? YES (2–12 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "comfyui-temp-output-cache":
    "Can I delete C:\\ComfyUI\\temp & %LOCALAPPDATA%\\Temp\\comfyui? YES (2–18 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "genshin-impact-update-cache":
    "Delete C:\\Program Files\\HoYoPlay\\games\\Genshin Impact game\\Temp (3–22 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "winsxs":
    "Never delete C:\\Windows\\WinSxS manually. Run DISM /StartComponentCleanup to reclaim gigabytes of superseded update files while keeping system files intact.",
  "programdata-package-cache":
    "Never delete C:\\ProgramData\\Package Cache wholesale—it breaks Visual C++ and MSI repair. Learn how to remove only orphaned GUID installers safely.",
  "windows-livekernelreports":
    "C:\\Windows\\LiveKernelReports\\WATCHDOG holds GPU and kernel crash dumps (.dmp). Safe to delete after debugging—keep the folder and check TDR stability.",
  "logitech-options-plus-cache":
    "Can I delete %LOCALAPPDATA%\\LogiOptionsPlus\\cache? YES (1.2–6.5 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "elgato-streamdeck-cache":
    "Can I delete %APPDATA%\\Elgato\\StreamDeck cache? YES (1–4 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "vivaldi-browser-cache":
    "Can I delete %LOCALAPPDATA%\\Vivaldi\\User Data\\Default\\Cache? YES (1–5 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "jetbrains-intellij-cache":
    "Can I delete %LocalAppData%\\JetBrains\\IntelliJIdea* caches? YES (1–8 GB). Zero projects, keymaps, or plugins lost. Manual steps + 6.5 MB Sweepr scan.",
  "opera-gx-cache":
    "Can I delete %LOCALAPPDATA%\\Opera Software\\Opera GX Stable\\Cache? YES (1.8–12 GB). Zero save files or active logins lost. Manual + 1-click 6.5 MB Sweepr scan.",
  "medal-tv-cache":
    "Can I delete %APPDATA%\\Medal\\Cache? YES (2–14 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "capcut-desktop-cache":
    "Can I delete %LOCALAPPDATA%\\CapCut\\User Data\\Cache? YES (2.5–18 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "obs-studio-logs-crashes":
    "Can I delete %APPDATA%\\obs-studio\\logs & Cache? YES (1–6.5 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "creative-cloud-installer-cache":
    "Can I delete %LOCALAPPDATA%\\Adobe\\Creative Cloud? YES (2–12 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "nvidia-dxcache":
    "Clear NVIDIA DXCache (2–14 GB) to fix game stutter cleanly. Zero save files or active logins lost. Manual + 1-click 6.5 MB Sweepr scan.",
  "npm-cache":
    "Can I delete %LOCALAPPDATA%\\npm-cache? YES (2–18 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "gradle-wrapper-caches":
    "Can I delete %USERPROFILE%\\.gradle\\caches? YES (4–35 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "localappdata-crashdumps":
    "Delete %LOCALAPPDATA%\\CrashDumps (.dmp files) safely on Windows 11 to reclaim 1–15 GB without affecting apps or OS stability. Manual + 1-click Sweepr scan.",
  "hiberfil-sys":
    "Disable hibernation with powercfg /h off or shrink hiberfil.sys to reclaim 6–32 GB on Windows 11. Note: disables Hibernate and Fast Startup.",
  "windows-old":
    "Delete C:\\Windows.old safely on Windows 11 to reclaim 15–35 GB without losing personal files. Manual Storage Settings steps + 1-click Sweepr scan.",
  "c-drive-filling-up-by-itself-windows-11":
    "C: drive filling up in %LOCALAPPDATA% & C:\\Windows\\Temp? Reclaim 12–65 GB while keeping Windows and personal files intact. Manual + 1-click Sweepr scan.",
  "system-and-reserved-storage-100gb-windows-11":
    "System & Reserved taking 100 GB in WinSxS & hiberfil.sys? Reclaim 10–60 GB safely via DISM & Storage Sense without risking Windows. Manual + Sweepr scan.",
  "appdata-local-folder-huge-windows-11":
    "Can you clean bloated %LOCALAPPDATA%\\Temp & GPUCache? Reclaim 10–50 GB while keeping app settings and personal files intact. Manual + 1-click Sweepr scan.",
  "windows-11-24h2-update-cache-8gb-bug":
    "Fix the Windows 11 24H2 8.63 GB cache bug in C:\\Windows\\WinSxS\\Temp. Reclaim update space safely via DISM without risking OS stability. Manual + Sweepr scan.",
  "other-storage-full-windows-11-cleanup":
    "Clean 'Other' storage in C:\\ProgramData\\Package Cache & app caches (6–45 GB) while keeping installed apps and personal files intact. Manual + Sweepr scan.",
  "localappdata-webview2-ebwebview-cache":
    "Clear %LOCALAPPDATA%\\Microsoft\\EdgeWebView\\User Data cache safely (1.5–9 GB) while keeping Windows widgets and desktop apps working. Manual + Sweepr scan.",
  "ea-app-cache":
    "Can I delete %LOCALAPPDATA%\\Electronic Arts\\EA Desktop\\cache? YES (1.5–6 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "epic-games-webcache":
    "Can I delete %LOCALAPPDATA%\\EpicGamesLauncher\\Saved\\webcache? YES (1–5 GB). Zero save files or active logins lost. Manual steps + 1-click 6.5 MB Sweepr scan.",
  "vrchat-cache":
    "Can I delete %LOCALAPPDATA%Low\\VRChat\\VRChat\\Cache-WindowsPlayer? YES (10–30 GB). Zero save files or active logins lost. Manual + 1-click 6.5 MB Sweepr scan.",
  "lm-studio-models-cache":
    "Can I delete %USERPROFILE%\\.cache\\lm-studio\\models? YES (10–80 GB). Zero save files or active logins lost. Manual steps + 1-click free 6.5 MB Sweepr scan.",
  "microsoft-teams-cache":
    "Clear New & Classic Microsoft Teams EBWebView cache on Windows 11 to reclaim 1.5–9 GB and fix sync bugs. Chats stay safe. Manual + 1-click Sweepr scan.",
  "software-distribution-download":
    "Clear C:\\Windows\\SoftwareDistribution\\Download safely on Windows 11 to reclaim 2.5–16 GB and fix stuck updates. Manual steps + 1-click Sweepr scan.",
  "appdata-temp":
    "Delete %LOCALAPPDATA%\\Temp and C:\\Windows\\Temp safely on Windows 11 (2–12 GB). Keeps active system files and user data intact. Manual + 1-click Sweepr scan.",
  "system-data-huge":
    "Mac System Data taking 100 GB+? Clear APFS Time Machine snapshots with tmutil, ~/Library/Caches, Xcode DerivedData & orphaned backups without risking macOS.",
  "iphone-system-data-full":
    "iPhone System Data taking 40 GB+? Clear camouflaged social app caches, flush Finder/iTunes temp files, and remove near-duplicate bursts without a factory reset.",
  "other-storage-full":
    "Android Other or System storage full on Samsung or Pixel? Fix hidden Android/.Trash, One UI Usage Access, and WhatsApp/Telegram caches safely.",
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
      /winsxs|softwaredistribution|package-cache|installer-patch|delivery-optimization|windows-old|catroot2|servicing|wuau|rempl|sihclient|usoclient|waasmedic|24h2-update-cache/.test(
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
  if (/nvidia|amd-dx|amd-shader|intel-shader|directx-shader|vulkan|shader|geforce|adrenalin|msi-afterburner|rivatuner|3dmark|furmark/.test(s)) {
    return "gpu";
  }
  if (/steam|epic-games|riot|valorant|battlenet|ea-app|ubisoft|gog-galaxy|xbox|minecraft|roblox|genshin|honkai|fortnite|call-of-duty|apex|overwatch|fivem|curseforge|overwolf|modrinth|vortex|nexus-mods|playnite|retroarch|rpcs3|yuzu|ryujinx|dolphin|pcsx2|cemu|ppsspp|duckstation|medal|parsec|moonlight|sunshine|razer|corsair|steelseries|logitech-ghub|armoury-crate|nzxt|lian-li|signalrgb|openrgb|vrchat|oculus|steamvr|faceit|esea|we-mod|plitch/.test(s)) {
    return "gaming";
  }
  if (/adobe|creative-cloud|premiere|after-effects|photoshop|lightroom|illustrator|indesign|audition|davinci|capcut|obs-studio|streamlabs|elgato|figma|canva|affinity|blender|unreal-engine|unity|godot|maya|3ds-max|cinema-4d|zbrush|substance|houdini|autocad|revit|solidworks|sketchup|rhino|lumion|enscape|twinmotion|handbrake|topaz|vlc|plex|jellyfin|kodi|ableton|fl-studio|reaper|cubase|studio-one|pro-tools|native-instruments|splice|musescore|audacity|kdenlive|shotcut|clip-studio|krita|gimp|inkscape|pureref|eagle|gyroflow|snagit|camtasia/.test(s)) {
    return "creative";
  }
  if (/npm|pnpm|yarn|bun|pip|conda|poetry|uv-python|cargo|rustup|go-build|gradle|maven|nuget|composer|cocoapods|vcpkg|conan|huggingface|ollama|lm-studio|pytorch|vs-code|vscode|cursor|windsurf|zed|visual-studio|jetbrains|intellij|pycharm|webstorm|rider|clion|goland|android-studio|docker|podman|vagrant|virtualbox|vmware|wsl|gitkraken|sourcetree|github-desktop|fork|postman|insomnia|bruno|dbeaver|datagrip|pgadmin|mongodb|tableplus|comfyui/.test(s)) {
    return "devtools";
  }
  return "browsers_chat";
}

export type DirectoryGroupId =
  | "problems"
  | "mac_mobile"
  | "win_system"
  | "gaming_gpu"
  | "devtools_ai"
  | "creative_browsers";

export function classifyDirectoryGroup(item: CleanItem): DirectoryGroupId {
  if (item.category === "mac" || item.category === "ios" || item.category === "android") {
    return "mac_mobile";
  }
  const s = `${item.slug} ${item.name} ${item.path}`.toLowerCase();
  if (/c-drive-filling-up|system-and-reserved|appdata-local-folder-huge|24h2-update-cache|other-storage-full/.test(s)) {
    return "problems";
  }
  if (item.category === "folder") {
    return "win_system";
  }
  const c = classifyPseoCluster(item);
  if (c === "gaming" || c === "gpu") return "gaming_gpu";
  if (c === "devtools") return "devtools_ai";
  return "creative_browsers";
}

interface ClusterMeta {
  id: DirectoryGroupId;
  filterKey: string;
  label: string;
  shortLabel: string;
}

const CLUSTER_META: Record<DirectoryGroupId, ClusterMeta> = {
  problems: {
    id: "problems",
    filterKey: "problems",
    label: "Common Storage Symptoms",
    shortLabel: "Common Problems",
  },
  mac_mobile: {
    id: "mac_mobile",
    filterKey: "mac_mobile",
    label: "Mac, iPhone & Android Storage",
    shortLabel: "Mac & Mobile",
  },
  win_system: {
    id: "win_system",
    filterKey: "win_system",
    label: "Windows System & Update Folders",
    shortLabel: "Windows System",
  },
  gaming_gpu: {
    id: "gaming_gpu",
    filterKey: "gaming_gpu",
    label: "PC Gaming Launchers & GPU Shaders",
    shortLabel: "Gaming & GPU",
  },
  devtools_ai: {
    id: "devtools_ai",
    filterKey: "devtools_ai",
    label: "Developer Toolchains & Local AI",
    shortLabel: "Dev & AI",
  },
  creative_browsers: {
    id: "creative_browsers",
    filterKey: "creative_browsers",
    label: "Video Editors, Browsers & Chat Apps",
    shortLabel: "Creative & Browsers",
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

function extractChromiumBasePath(item: CleanItem): string {
  if (item.slug === "spotify-cache") {
    return "%LocalAppData%\\Spotify\\Browser";
  }
  const rawParts = item.path
    .split(/(?:,\s*|\s+)\b(?:or|and)\b\s+|\s+&\s+|,\s*/i)
    .map((p) => p.trim().replace(/^(?:and|or)\s+/i, "").replace(/,+$/, "").replace(/\\+$/, ""))
    .filter((p) => p.length > 0 && /^(?:%[a-z]+%|[a-z]:\\)/i.test(p));

  const candidates = rawParts.length > 0 ? rawParts : [item.path.trim().replace(/\\+$/, "")];

  const scoreSegment = (seg: string): number => {
    const lower = seg.toLowerCase();
    let score = 0;
    if (lower.includes("obs-browser")) score += 40;
    if (lower.includes("webview") || lower.includes("ebwebview")) score += 30;
    if (lower.includes("user data")) score += 25;
    if (/(?:^|\\)(?:cache|cache_data|cacheddata|webcache[^\\]*|localcache)$/i.test(lower)) score += 20;
    if (lower.startsWith("%localappdata%") || lower.startsWith("%appdata%")) score += 10;
    if (/\\(?:depots|logs|crashes|crashpad)(?:\\|$)/i.test(lower)) score -= 50;
    if (lower.includes("programdata\\") && candidates.some((c) => /^%(?:localappdata|appdata)%/i.test(c))) score -= 20;
    return score;
  };

  let best = candidates[0];
  let bestScore = scoreSegment(best);
  for (let i = 1; i < candidates.length; i++) {
    const s = scoreSegment(candidates[i]);
    if (s > bestScore) {
      best = candidates[i];
      bestScore = s;
    }
  }

  best = best
    .replace(/\\Service Worker\\CacheStorage$/i, "")
    .replace(/\\Cache\\Cache_Data$/i, "")
    .replace(/\\Cache_Data$/i, "")
    .replace(/\\(?:CachedData|CachedExtensionVSIXs)$/i, "")
    .replace(/\\Cache$/i, (match, offset, str) => {
      const prev = str.slice(0, offset);
      if (match === "\\cache" && /\\(?:LGHUB|LogiOptionsPlus|StreamDeck)$/i.test(prev)) {
        return match;
      }
      return "";
    });

  return best.replace(/\\+$/, "") || "%LOCALAPPDATA%";
}

export function getAbsorbedRedirectVariants(item: CleanItem): Array<{
  slug: string;
  label: string;
  subPath: string;
  role: string;
}> {
  if (!item.isChromiumBased) {
    return [];
  }
  const canonicalTarget = `/clean/${item.category}/${item.slug}`;
  const matchedSlugs: string[] = [];
  for (const [key, target] of Object.entries(pseoRedirectsData)) {
    if (target === canonicalTarget) {
      const idx = key.indexOf(":");
      const s = idx >= 0 ? key.slice(idx + 1) : key;
      matchedSlugs.push(s);
    }
  }
  if (matchedSlugs.length === 0 && item.slug !== "logitech-options-plus-cache") {
    return [];
  }
  const basePath = extractChromiumBasePath(item);
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

  if (variants.length === 0) {
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
  _clusterId: PseoClusterId
): Array<{
  subPath: string;
  role: string;
  avgSpace: string;
  safe: string;
  extensions?: string[];
  regenerates?: string;
  troubleshooting?: string;
}> {
  if (Array.isArray(item.subLocations) && item.subLocations.length > 0) {
    return item.subLocations;
  }
  const basePath = extractPrimaryDisplayPath(item.path);
  return [
    {
      subPath: basePath,
      role: item.whatIsIt,
      avgSpace: item.avgSpace,
      safe: item.safeToDelete ? "Safe to delete" : "Conditional — follow manual steps",
    },
    {
      subPath: "User Settings, Logins & Project Files",
      role: "Application configuration, saved sessions, and personal documents.",
      avgSpace: "Protected",
      safe: "Protected — keep",
    },
  ];
}

export function getSiblingAndRelatedItems(item: CleanItem): {
  siblings: CleanItem[];
  related: CleanItem[];
} {
  const all = getCleanItems().filter((i) => !isPseoSlugNoindexed(i.slug) && !i.noindex && !i.mergedIntoSlug);
  const seen = new Set<string>([item.slug]);
  const familyKey = getAppFamilyKey(item.slug);
  const siblings = all.filter((i) => i.slug !== item.slug && getAppFamilyKey(i.slug) === familyKey);
  for (const s of siblings) seen.add(s.slug);

  const related: CleanItem[] = [];
  const pushItem = (cand: CleanItem | undefined) => {
    if (!cand || seen.has(cand.slug)) return;
    seen.add(cand.slug);
    related.push(cand);
  };

  // Ring step across all surviving items (consecutive stride = 1 guarantees uniform in-degree >= 4)
  const myGlobalIdx = all.findIndex((i) => i.slug === item.slug && i.category === item.category);
  const startGlobal = myGlobalIdx >= 0 ? myGlobalIdx : 0;
  for (let offset = 1; offset <= all.length && related.length < 4; offset++) {
    const cand = all[(startGlobal + offset) % all.length];
    if (classifyPseoCluster(cand) === classifyPseoCluster(item)) {
      pushItem(cand);
    }
  }
  for (let offset = 1; offset <= all.length && related.length < 4; offset++) {
    pushItem(all[(startGlobal + offset) % all.length]);
  }

  // Add 2 cross-topic high-value guides deterministically
  for (let jump = 7; related.length < 6 && jump < all.length + 7; jump += 5) {
    pushItem(all[(startGlobal + jump) % all.length]);
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
  const custom =
    (Object.hasOwn(CUSTOM_GSC_TITLES, item.slug) ? CUSTOM_GSC_TITLES[item.slug] : undefined) || item.metaTitle;
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

  if (cleanName.length > 19) {
    const words = cleanName.split(" ");
    let acc = "";
    for (const w of words) {
      if ((acc + " " + w).trim().length <= 19) {
        acc = (acc + " " + w).trim();
      } else {
        break;
      }
    }
    cleanName = acc.replace(/[&:,\-–—]+$/, "").trim() || cleanName.slice(0, 19).trim();
  }

  const telemetry = getActiveTelemetryTruthForSlug(item.slug);
  const spaceLabel = telemetry ? `${telemetry.median_gb}–${telemetry.p90_gb} GB` : formatCompactSpaceRange(item.avgSpace);
  const candidateTitle = `Can I Delete ${cleanName}? YES (${spaceLabel}) — Safe Guide`;
  if (candidateTitle.length >= 30 && candidateTitle.length <= 60 && candidateTitle.slice(0, 48).includes(")")) {
    return candidateTitle;
  }
  const compactGuideTitle = `Can I Delete ${cleanName}? YES (${spaceLabel}) — Guide`;
  if (compactGuideTitle.length >= 30 && compactGuideTitle.length <= 60 && compactGuideTitle.slice(0, 48).includes(")")) {
    return compactGuideTitle;
  }
  const shortSafeTitle = `Delete ${cleanName}? YES (${spaceLabel}) — Safe Guide`;
  if (shortSafeTitle.length >= 30 && shortSafeTitle.length <= 60) {
    return shortSafeTitle;
  }
  const suffix = `? YES (${spaceLabel}) — Guide`;
  const maxNameLen = Math.max(8, 60 - "Delete ".length - suffix.length);
  const trimmedName = cleanName.length > maxNameLen ? cleanName.slice(0, maxNameLen).trim() : cleanName;
  return `Delete ${trimmedName}${suffix}`;
}

export function buildPseoDescription(item: CleanItem): string {
  const approvedDesc = approvedIntentGapOverrides.get(item.slug)?.metaDescription;
  if (approvedDesc && approvedDesc.length >= 70 && approvedDesc.length <= 160) {
    return approvedDesc;
  }
  const customDesc =
    (Object.hasOwn(CUSTOM_GSC_DESCRIPTIONS, item.slug) ? CUSTOM_GSC_DESCRIPTIONS[item.slug] : undefined) || item.metaDescription;
  if (customDesc && customDesc.length >= 70 && customDesc.length <= 160) {
    return customDesc;
  }
  const telemetry = getActiveTelemetryTruthForSlug(item.slug);
  const spaceLabel = telemetry ? `${telemetry.median_gb}–${telemetry.p90_gb} GB` : formatCompactSpaceRange(item.avgSpace);
  let primaryPath = extractPrimaryDisplayPath(item.path);

  const safetyPhrase =
    item.category === "folder"
      ? "Keeps OS files and user data intact."
      : "Zero save files or active logins lost.";
  let desc = `Can I delete ${primaryPath}? YES (${spaceLabel}). ${safetyPhrase} Manual steps + 1-click free 6.5 MB Sweepr scan.`;
  if (desc.length > 158) {
    desc = `Delete ${primaryPath} (${spaceLabel}). ${safetyPhrase} Manual steps + 1-click free 6.5 MB Sweepr scan.`;
  }
  if (desc.length > 158) {
    desc = `Delete ${primaryPath} (${spaceLabel}). ${safetyPhrase} Manual + 1-click 6.5 MB Sweepr scan.`;
  }
  if (desc.length > 158) {
    const maxP = 158 - `Delete  (${spaceLabel}). ${safetyPhrase} Manual + 1-click 6.5 MB Sweepr scan.`.length;
    primaryPath = primaryPath.slice(0, Math.max(18, maxP));
    desc = `Delete ${primaryPath} (${spaceLabel}). ${safetyPhrase} Manual + 1-click 6.5 MB Sweepr scan.`;
  }
  return desc;
}

export const FEATURED_GSC_SLUGS = [
  "c-drive-filling-up-by-itself-windows-11",
  "windows-11-24h2-update-cache-8gb-bug",
  "appdata-local-folder-huge-windows-11",
  "system-and-reserved-storage-100gb-windows-11",
  "system-data-huge",
  "iphone-system-data-full",
  "other-storage-full",
  "steam-depotcache",
  "nvidia-dxcache",
  "winsxs",
  "windows-old",
  "hiberfil-sys",
  "logitech-ghub-installer-cache",
  "riot-client-logs",
  "genshin-impact-update-cache",
  "comfyui-temp-output-cache",
  "programdata-package-cache",
  "amd-shader-cache",
  "discord-cache",
  "spotify-cache",
  "docker-desktop-ext4-disk",
  "adobe-premiere-media-cache",
  "software-distribution-download",
  "appdata-temp",
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
  return `<section id="pc-cache-bloat-calculator" class="ed-card">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px;">
      <div>
        <div class="ed-kpi-label" style="color:var(--accent);margin-bottom:4px;">Windows Gaming &amp; AI Cache Bloat Calculator</div>
        <h2 class="ed-h2" style="margin:0;">Select the apps you run on your PC</h2>
      </div>
      <span class="mono" style="font-size:0.75rem;color:var(--muted);">Windows 10 &amp; 11 typical ranges</span>
    </div>
    <p class="ed-lead" style="font-size:0.94rem;margin-bottom:18px;">
      Check any game launcher, GPU driver, local AI model, or creative suite installed on your drive to inspect the exact cache folders and estimate reclaimable gigabytes.
    </p>

    <div class="ed-grid-2" id="bloatCalcGrid" style="gap:10px;margin-bottom:20px;">
      <label class="ed-check-card">
        <input type="checkbox" class="bloat-calc-cb" data-id="steam" data-name="Steam depotcache &amp; NVIDIA DXCache" data-guide="/clean/app/steam-depotcache" data-gb="12.5" data-paths="%LocalAppData%\\NVIDIA\\DXCache|C:\\Program Files (x86)\\Steam\\depotcache|%LocalAppData%\\Steam\\htmlcache" checked />
        <span>
          <strong style="display:block;font-size:0.92rem;">Steam &amp; NVIDIA DXCache</strong>
          <span class="mono" style="font-size:0.78rem;color:var(--accent);">~12.5 GB typical</span>
        </span>
      </label>
      <label class="ed-check-card">
        <input type="checkbox" class="bloat-calc-cb" data-id="genshin" data-name="Genshin Impact / HoYoPlay" data-guide="/clean/app/genshin-impact-update-cache" data-gb="8.4" data-paths="%AppData%\\Cognosphere\\HYP\\1_1\\fedata\\Cache|C:\\Program Files\\HoYoPlay\\games\\Genshin Impact game\\Temp" />
        <span>
          <strong style="display:block;font-size:0.92rem;">Genshin / HoYoPlay</strong>
          <span class="mono" style="font-size:0.78rem;color:var(--accent);">~8.4 GB typical</span>
        </span>
      </label>
      <label class="ed-check-card">
        <input type="checkbox" class="bloat-calc-cb" data-id="valorant" data-name="VALORANT &amp; Riot Client" data-guide="/clean/app/riot-client-logs" data-gb="4.8" data-paths="%LocalAppData%\\VALORANT\\Saved\\Logs|%LocalAppData%\\VALORANT\\Saved\\Crashes|%LocalAppData%\\Riot Games\\Riot Client\\Logs" />
        <span>
          <strong style="display:block;font-size:0.92rem;">VALORANT &amp; Riot Client</strong>
          <span class="mono" style="font-size:0.78rem;color:var(--accent);">~4.8 GB typical</span>
        </span>
      </label>
      <label class="ed-check-card">
        <input type="checkbox" class="bloat-calc-cb" data-id="comfyui" data-name="ComfyUI Temp &amp; Output" data-guide="/clean/app/comfyui-temp-output-cache" data-gb="21.6" data-paths="C:\\ComfyUI\\temp|%LocalAppData%\\Temp\\comfyui|%LocalAppData%\\pip\\Cache" checked />
        <span>
          <strong style="display:block;font-size:0.92rem;">ComfyUI &amp; Python pip</strong>
          <span class="mono" style="font-size:0.78rem;color:var(--accent);">~21.6 GB typical</span>
        </span>
      </label>
      <label class="ed-check-card">
        <input type="checkbox" class="bloat-calc-cb" data-id="lmstudio" data-name="LM Studio Models Cache" data-guide="/clean/app/lm-studio-models-cache" data-gb="26.5" data-paths="%UserProfile%\\.cache\\lm-studio\\models" checked />
        <span>
          <strong style="display:block;font-size:0.92rem;">LM Studio Local Models</strong>
          <span class="mono" style="font-size:0.78rem;color:var(--accent);">~26.5 GB typical</span>
        </span>
      </label>
      <label class="ed-check-card">
        <input type="checkbox" class="bloat-calc-cb" data-id="docker" data-name="Docker Desktop WSL2 ext4.vhdx" data-guide="/clean/app/docker-desktop-ext4-disk" data-gb="28.0" data-paths="%LocalAppData%\\Docker\\wsl\\data\\ext4.vhdx" />
        <span>
          <strong style="display:block;font-size:0.92rem;">Docker &amp; WSL2 Virtual Disk</strong>
          <span class="mono" style="font-size:0.78rem;color:var(--accent);">~28.0 GB typical</span>
        </span>
      </label>
      <label class="ed-check-card">
        <input type="checkbox" class="bloat-calc-cb" data-id="jetbrains" data-name="JetBrains IntelliJ &amp; Cursor" data-guide="/clean/app/jetbrains-intellij-cache" data-gb="9.2" data-paths="%LocalAppData%\\JetBrains|%AppData%\\Cursor\\User\\workspaceStorage|%AppData%\\Code\\CachedData" checked />
        <span>
          <strong style="display:block;font-size:0.92rem;">IntelliJ IDEA, Cursor &amp; VS Code</strong>
          <span class="mono" style="font-size:0.78rem;color:var(--accent);">~9.2 GB typical</span>
        </span>
      </label>
      <label class="ed-check-card">
        <input type="checkbox" class="bloat-calc-cb" data-id="adobe" data-name="Adobe Premiere Media Cache" data-guide="/clean/app/adobe-premiere-media-cache" data-gb="22.0" data-paths="%AppData%\\Adobe\\Common\\Media Cache Files|%AppData%\\Adobe\\Common\\Peak Files" />
        <span>
          <strong style="display:block;font-size:0.92rem;">Adobe Media Cache</strong>
          <span class="mono" style="font-size:0.78rem;color:var(--accent);">~22.0 GB typical</span>
        </span>
      </label>
    </div>

    <div class="ed-card-muted">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:14px;padding-bottom:16px;border-bottom:1px solid var(--border);margin-bottom:16px;">
        <div>
          <div class="ed-kpi-label">ESTIMATED HIDDEN CACHE</div>
          <div id="bloatCalcTotalGb" class="ed-kpi-val" style="font-size:2.4rem;color:var(--accent);">69.8 GB</div>
          <div id="bloatCalcCountLabel" style="font-size:0.84rem;color:var(--muted);margin-top:4px;">Across 4 selected workloads</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          <a href="/safe-to-delete" class="ed-btn-secondary">Check Custom Paths</a>
          <a href="/download" rel="nofollow" class="ed-btn-primary">Download Free 60s Scan</a>
        </div>
      </div>

      <div class="ed-kpi-label" style="margin-bottom:8px;">WINDOWS PATHS TO INSPECT &amp; GUIDE LINKS</div>
      <div id="bloatCalcPathsList" class="ed-ledger"></div>
    </div>

    <script>
      (function(){
        var cbs = document.querySelectorAll('.bloat-calc-cb');
        var totalEl = document.getElementById('bloatCalcTotalGb');
        var countEl = document.getElementById('bloatCalcCountLabel');
        var listEl = document.getElementById('bloatCalcPathsList');
        function escHtml(s){
          return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }
        function updateBloatCalc() {
          var total = 0;
          var count = 0;
          var rows = [];
          for (var i = 0; i < cbs.length; i++) {
            var cb = cbs[i];
            if (cb.checked) {
              var gb = parseFloat(cb.getAttribute('data-gb') || '0') || 0;
              var nm = cb.getAttribute('data-name') || '';
              var guide = cb.getAttribute('data-guide') || '/clean';
              var rawPaths = (cb.getAttribute('data-paths') || '').split('|');
              total += gb;
              count++;
              for (var j = 0; j < rawPaths.length; j++) {
                if (rawPaths[j]) {
                  rows.push(
                    '<a href="' + escHtml(guide) + '" class="ed-ledger-row" style="grid-template-columns:1.5fr 1fr auto;">' +
                      '<span class="ed-path-mono" style="color:var(--text);">' + escHtml(rawPaths[j]) + '</span>' +
                      '<span style="font-size:0.82rem;font-weight:700;color:var(--muted);">' + escHtml(nm) + '</span>' +
                      '<span style="font-size:0.82rem;font-weight:700;color:var(--accent);">Read guide &rarr;</span>' +
                    '</a>'
                  );
                }
              }
            }
          }
          if (totalEl) totalEl.textContent = total.toFixed(1) + ' GB';
          if (countEl) countEl.textContent = 'Across ' + count + ' selected workload' + (count === 1 ? '' : 's') + ' — saved logins and game saves stay untouched';
          if (listEl) listEl.innerHTML = rows.length ? rows.join('') : '<div style="padding:14px;font-size:0.88rem;color:var(--muted);">Select at least one workload above to inspect its folder paths.</div>';
        }
        for (var k = 0; k < cbs.length; k++) {
          cbs[k].addEventListener('change', updateBloatCalc);
        }
        updateBloatCalc();
      })();
    </script>
  </section>`;
}

export function renderGamingAndAiCacheBloatCalculatorPage(): string {
  const widgetHtml = renderGamingAndAiCacheBloatCalculatorWidget();
  const pageTitle = "PC Cache Bloat Calculator (Windows 10 & 11) | SWEEPR Cleaner";
  const pageDesc =
    "Estimate how much hidden storage is tied up in Steam depotcache, NVIDIA DXCache, ComfyUI, LM Studio, Docker WSL2, JetBrains, and Adobe caches.";
  const canonicalUrl = "https://sweeprcleaner.com/tools/pc-cache-calculator";
  const calcJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        headline: "Windows Cache Bloat Calculator",
        description: pageDesc,
        url: canonicalUrl,
        author: { "@type": "Organization", name: "SWEEPR Storage Research Lab" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://sweeprcleaner.com/" },
          { "@type": "ListItem", position: 2, name: "Cleaner Tools", item: "https://sweeprcleaner.com/tools" },
          { "@type": "ListItem", position: 3, name: "PC Cache Calculator", item: canonicalUrl },
        ],
      },
    ],
  };

  return `<!doctype html>
<html lang="en">
${renderEditorialHead({
  title: pageTitle,
  description: pageDesc,
  canonical: canonicalUrl,
  ogType: "website",
  jsonLd: calcJsonLd,
})}
<body>
  ${renderSiteHeader("tools")}
  <main id="main-content" class="ed-container">
    <nav class="ed-crumb" aria-label="Breadcrumb">
      <a href="/">Home</a>
      <span>/</span>
      <a href="/tools">Tools</a>
      <span>/</span>
      <span>PC Cache Calculator</span>
    </nav>

    <header style="margin-bottom:24px;">
      <h1 class="ed-h1">How much space is hiding in <em>PC caches</em>?</h1>
      <p class="ed-lead">
        Modern PC games, GPU shader compilers, local AI tools, and IDEs write tens of gigabytes into <code class="ed-code">%LOCALAPPDATA%</code> and <code class="ed-code">%USERPROFILE%</code> folders that Windows Storage Settings often skips. Select your apps below to inspect every path and read its safety guide.
      </p>
    </header>

    ${widgetHtml}

    <section class="ed-section ed-card ed-prose">
      <h2 class="ed-h2">What stays untouched when you clear these caches</h2>
      <p>
        Disposable shader caches, interrupted game patch chunks, and temporary build artifacts can be removed safely while leaving saved games, source code repositories, browser logins, and active AI model weights alone. For exact manual steps and "when not to delete" notes, inspect individual guides:
        <a href="/clean/app/steam-depotcache">Steam depotcache</a>,
        <a href="/clean/app/nvidia-dxcache">NVIDIA DXCache</a>,
        <a href="/clean/app/comfyui-temp-output-cache">ComfyUI temp files</a>,
        <a href="/clean/app/docker-desktop-ext4-disk">Docker WSL2 virtual disk</a>, and
        <a href="/clean/folder/winsxs">Windows WinSxS Component Store</a>.
      </p>
      <div class="ed-actions">
        <a href="/safe-to-delete" class="ed-btn-secondary">Open Path Safety Checker</a>
        <a href="/state-of-windows-storage" class="ed-btn-secondary">Read 2026 Storage Study</a>
        <a href="/vs/ccleaner" class="ed-btn-secondary">SWEEPR vs CCleaner</a>
      </div>
    </section>
  </main>
  ${renderSiteFooter()}
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

  const items = cleanItems.filter((i) => !isPseoSlugNoindexed(i.slug) && !i.noindex && !i.mergedIntoSlug);

  const topQuestionSlugs = [
    "c-drive-filling-up-by-itself-windows-11",
    "windows-11-24h2-update-cache-8gb-bug",
    "appdata-local-folder-huge-windows-11",
    "system-and-reserved-storage-100gb-windows-11",
    "system-data-huge",
    "iphone-system-data-full",
    "other-storage-full",
    "windows-old",
    "hiberfil-sys",
    "steam-depotcache",
  ];
  const topQuestions = topQuestionSlugs
    .map((s) => items.find((i) => i.slug === s))
    .filter((i): i is CleanItem => Boolean(i));

  const clusterOrder: DirectoryGroupId[] = [
    "problems",
    "mac_mobile",
    "win_system",
    "gaming_gpu",
    "devtools_ai",
    "creative_browsers",
  ];
  const clusterGroups = clusterOrder
    .map((cid) => ({
      meta: CLUSTER_META[cid],
      items: items.filter((i) => classifyDirectoryGroup(i) === cid),
    }))
    .filter((g) => g.items.length > 0);

  const platformBadgeLabel = (i: CleanItem) => {
    if (i.category === "mac") return "macOS";
    if (i.category === "ios") return "iPhone / iOS";
    if (i.category === "android") return "Android";
    return i.category === "folder" ? "Windows System" : "Windows App";
  };

  const pageTitle = "Storage & Folder Safety Guides (PC, Mac & Mobile) | SWEEPR";
  const pageDesc =
    "Wondering if a Windows, Mac, iPhone, or Android folder is safe to delete? Browse verified Q&A cleanup guides, manual steps, and exact folder verdicts.";
  const canonicalUrl = "https://sweeprcleaner.com/clean";

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${canonicalUrl}#collection`,
        url: canonicalUrl,
        name: "Storage & Folder Safety Guides",
        description: pageDesc,
      },
      {
        "@type": "ItemList",
        name: "Verified Storage Cleanup Guides",
        numberOfItems: items.length,
        itemListElement: items.map((i, idx) => ({
          "@type": "ListItem",
          position: idx + 1,
          name: i.questionTitle || i.name,
          url: `https://sweeprcleaner.com/clean/${i.category}/${i.slug}`,
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://sweeprcleaner.com/" },
          { "@type": "ListItem", position: 2, name: "Storage Guides", item: canonicalUrl },
        ],
      },
    ],
  };

  const htmlResult = `<!doctype html>
<html lang="en">
${renderEditorialHead({
  title: pageTitle,
  description: pageDesc,
  canonical: canonicalUrl,
  ogType: "website",
  jsonLd,
})}
<body>
  ${renderSiteHeader("guides")}

  <main id="main-content" class="ed-container">
    <header style="margin-bottom:8px;">
      <h1 class="ed-h1">What's eating your drive—and is it <em>safe to delete?</em></h1>
      <p class="ed-lead">
        ${items.length} straightforward cleanup guides across Windows 11, macOS, iPhone, and Android. Every guide gives you the direct answer first, tells you what never to touch, and includes manual steps you can run yourself.
      </p>
    </header>

    <!-- Search & Domain Filter -->
    <div class="ed-filter-bar" role="search" aria-label="Filter storage guides">
      <label for="guideSearchInput" class="skip-link">Search guides by folder path, app name, or question</label>
      <input
        id="guideSearchInput"
        type="search"
        class="ed-search-input"
        placeholder="Search by folder path, app name, or question (e.g. WinSxS, System Data, NVIDIA, AppData)..."
        aria-label="Search guides by folder path, app name, or question"
      />
      <div class="ed-filter-pills" role="group" aria-label="Filter by category">
        <button type="button" class="ed-filter-pill" data-cluster="all" aria-pressed="true">All (${items.length})</button>
        ${clusterGroups
          .map(
            (g) =>
              `<button type="button" class="ed-filter-pill" data-cluster="${g.meta.filterKey}" aria-pressed="false">${esc(g.meta.shortLabel)} (${g.items.length})</button>`
          )
          .join("")}
      </div>
    </div>

    <!-- Top Forum-Backed Storage Questions -->
    <section id="most-asked-questions" style="margin-bottom:36px;">
      <h2 class="ed-h2">Most asked storage questions</h2>
      <p class="ed-lead" style="font-size:0.94rem;margin-bottom:16px;">
        Start here if your drive filled up unexpectedly on Windows, Mac, iPhone, or Android.
      </p>
      <div class="ed-grid-2">
        ${topQuestions
          .map((q) => {
            const verdictClass = q.safeToDelete ? "ed-status-safe" : "ed-status-caution";
            const verdictLabel = q.safeToDelete ? "Safe to clear" : "Conditional";
            const summaryLine = (q.directAnswer || q.whatHappens).split(/(?<=[.!?])\s+/)[0] || q.whatIsIt;
            return `<a href="/clean/${q.category}/${q.slug}" class="ed-card" style="display:flex;flex-direction:column;justify-content:space-between;gap:12px;">
              <div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                  <span class="mono" style="font-size:0.74rem;font-weight:700;color:var(--muted);">${esc(platformBadgeLabel(q))}</span>
                  <span class="ed-status ${verdictClass}"><span class="ed-dot" aria-hidden="true"></span>${verdictLabel}</span>
                </div>
                <h3 class="ed-h3" style="margin-bottom:6px;">${esc(q.questionTitle || q.name)}</h3>
                <p style="font-size:0.86rem;color:var(--muted);line-height:1.5;">${esc(summaryLine)}</p>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding-top:10px;border-top:1px solid var(--border);font-size:0.82rem;">
                <span class="mono" style="color:var(--text);font-weight:700;">Typical: ${esc(q.avgSpace)}</span>
                <span style="color:var(--accent);font-weight:700;">Read guide &rarr;</span>
              </div>
            </a>`;
          })
          .join("")}
      </div>
    </section>

    <!-- Full Folder & App Safety Index (Compact Ledger) -->
    <section id="directory-ledger-sections" style="space-y:28px;">
      ${clusterGroups
        .map(
          (g) => `
      <div class="directory-cluster-block" data-cluster-block="${g.meta.filterKey}" style="margin-bottom:32px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          <h2 class="ed-h2" style="margin:0;">${esc(g.meta.label)}</h2>
          <span class="mono" style="font-size:0.78rem;color:var(--muted);">${g.items.length} guides</span>
        </div>
        <div class="ed-ledger">
          ${g.items
            .map((item) => {
              const statusClass = item.safeToDelete ? "ed-status-safe" : "ed-status-caution";
              const statusText = item.safeToDelete ? "Safe" : "Conditional";
              const searchBlob = `${item.name} ${item.questionTitle || ""} ${item.path} ${item.slug} ${item.category}`.toLowerCase();
              return `<a href="/clean/${item.category}/${item.slug}" class="ed-ledger-row" data-search="${esc(searchBlob)}" data-cluster="${g.meta.filterKey}">
                <span style="font-weight:700;font-size:0.93rem;color:var(--text);">${esc(item.questionTitle || item.name)}</span>
                <span class="ed-path-mono">${esc(item.path)}</span>
                <span class="ed-status ${statusClass}"><span class="ed-dot" aria-hidden="true"></span>${statusText}</span>
                <span class="mono" style="font-size:0.82rem;font-weight:700;color:var(--text);white-space:nowrap;">${esc(item.avgSpace)}</span>
              </a>`;
            })
            .join("")}
        </div>
      </div>`
        )
        .join("")}
    </section>

    <div id="directoryNoMatches" class="ed-card" style="display:none;margin-bottom:28px;text-align:center;">
      <p style="font-weight:700;margin-bottom:6px;">No guide matches that filter.</p>
      <p style="font-size:0.88rem;color:var(--muted);">Try searching by app name or paste an exact Windows path into our <a href="/safe-to-delete" style="color:var(--accent);text-decoration:underline;font-weight:700;">Safe-to-Delete Path Checker</a>.</p>
    </div>

    <!-- Interactive Utilities -->
    <section class="ed-section ed-grid-2">
      <div class="ed-card">
        <h2 class="ed-h2" style="font-size:1.25rem;">Not sure about a specific path?</h2>
        <p style="font-size:0.9rem;color:var(--muted);line-height:1.55;margin-bottom:14px;">
          Paste any folder path or WizTree CSV list into our Path Safety Checker to verify whether it is disposable cache or critical OS data before deleting.
        </p>
        <a href="/safe-to-delete" class="ed-btn-secondary">Open Path Safety Checker &rarr;</a>
      </div>
      <div class="ed-card">
        <h2 class="ed-h2" style="font-size:1.25rem;">Estimate hidden PC cache bloat</h2>
        <p style="font-size:0.9rem;color:var(--muted);line-height:1.55;margin-bottom:14px;">
          Run our interactive Gaming, AI &amp; Dev Cache Calculator or explore the 2026 State of Windows Storage benchmark dataset.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          <a href="/tools/pc-cache-calculator" class="ed-btn-secondary">PC Cache Calculator &rarr;</a>
          <a href="/state-of-windows-storage" class="ed-btn-secondary">2026 Storage Study &rarr;</a>
        </div>
      </div>
    </section>

    <!-- Compare Cleaners Strip -->
    <section class="ed-section ed-card-muted">
      <h2 class="ed-h2" style="font-size:1.15rem;">Looking for a safer cleaner instead of CCleaner or CleanMyMac?</h2>
      <p style="font-size:0.88rem;color:var(--muted);margin-bottom:12px;">
        Read honest side-by-side comparisons against legacy cleaners and open-source utilities:
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:8px 16px;font-size:0.86rem;font-weight:700;">
        <a href="/vs/ccleaner" style="color:var(--accent);text-decoration:underline;">SWEEPR vs CCleaner</a>
        <a href="/alternatives/ccleaner" style="color:var(--accent);text-decoration:underline;">Best CCleaner Alternatives</a>
        <a href="/vs/bleachbit" style="color:var(--accent);text-decoration:underline;">SWEEPR vs BleachBit</a>
        <a href="/alternatives/bleachbit" style="color:var(--accent);text-decoration:underline;">Best BleachBit Alternatives</a>
        <a href="/vs/avast-cleanup" style="color:var(--accent);text-decoration:underline;">SWEEPR vs Avast Cleanup</a>
        <a href="/alternatives/avast-cleanup" style="color:var(--accent);text-decoration:underline;">Best Avast Cleanup Alternatives</a>
        <a href="/vs/cleanmypc" style="color:var(--accent);text-decoration:underline;">SWEEPR vs CleanMyPC</a>
        <a href="/alternatives/cleanmypc" style="color:var(--accent);text-decoration:underline;">Best CleanMyPC Alternatives</a>
        <a href="/vs/glary-utilities" style="color:var(--accent);text-decoration:underline;">SWEEPR vs Glary Utilities</a>
        <a href="/alternatives/glary-utilities" style="color:var(--accent);text-decoration:underline;">Best Glary Utilities Alternatives</a>
        <a href="/vs/wise-disk-cleaner" style="color:var(--accent);text-decoration:underline;">SWEEPR vs Wise Disk Cleaner</a>
        <a href="/alternatives/wise-disk-cleaner" style="color:var(--accent);text-decoration:underline;">Best Wise Disk Cleaner Alternatives</a>
        <a href="/vs/cleanmymac" style="color:var(--accent);text-decoration:underline;">SWEEPR vs CleanMyMac X</a>
        <a href="/alternatives/cleanmymac" style="color:var(--accent);text-decoration:underline;">Best CleanMyMac Alternatives</a>
        <a href="/vs/daisydisk" style="color:var(--accent);text-decoration:underline;">SWEEPR vs DaisyDisk</a>
        <a href="/vs/pearcleaner" style="color:var(--accent);text-decoration:underline;">SWEEPR vs Pearcleaner</a>
      </div>
    </section>

    <!-- Quiet Single CTA -->
    <section class="ed-section ed-card" style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:18px;">
      <div style="max-width:60ch;">
        <h2 class="ed-h2" style="margin-bottom:6px;">Want one lightweight app to scan all of these at once?</h2>
        <p style="font-size:0.92rem;color:var(--muted);line-height:1.55;">
          SWEEPR Cleaner scans hidden app caches, shader folders, and duplicate photos in under 60 seconds with zero background slowdowns and a 7-day undo safety net across up to 5 devices.
        </p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        <a href="/download" class="ed-btn-primary" rel="nofollow">Download Free Scan</a>
        <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="ed-btn-secondary" rel="nofollow">Get 5-Device Pro</a>
      </div>
    </section>
  </main>

  <script>
    (function(){
      var input = document.getElementById('guideSearchInput');
      var pills = document.querySelectorAll('.ed-filter-pill');
      var rows = document.querySelectorAll('.ed-ledger-row');
      var blocks = document.querySelectorAll('.directory-cluster-block');
      var emptyMsg = document.getElementById('directoryNoMatches');
      var topSection = document.getElementById('most-asked-questions');
      var activeCluster = 'all';

      function applyFilter() {
        var q = (input && input.value ? input.value : '').trim().toLowerCase();
        var visibleCount = 0;

        if (topSection) {
          topSection.style.display = q || activeCluster !== 'all' ? 'none' : '';
        }

        for (var b = 0; b < blocks.length; b++) {
          var block = blocks[b];
          var blockCluster = block.getAttribute('data-cluster-block');
          var blockMatchesCluster = activeCluster === 'all' || blockCluster === activeCluster;
          var blockRows = block.querySelectorAll('.ed-ledger-row');
          var blockVisible = 0;

          for (var r = 0; r < blockRows.length; r++) {
            var row = blockRows[r];
            var hay = row.getAttribute('data-search') || '';
            var match = blockMatchesCluster && (!q || hay.indexOf(q) !== -1);
            row.style.display = match ? '' : 'none';
            if (match) {
              blockVisible++;
              visibleCount++;
            }
          }
          block.style.display = blockVisible > 0 ? '' : 'none';
        }

        if (emptyMsg) {
          emptyMsg.style.display = visibleCount === 0 ? '' : 'none';
        }
      }

      if (input) {
        input.addEventListener('input', applyFilter);
      }
      for (var p = 0; p < pills.length; p++) {
        pills[p].addEventListener('click', function(){
          activeCluster = this.getAttribute('data-cluster') || 'all';
          for (var j = 0; j < pills.length; j++) {
            pills[j].setAttribute('aria-pressed', pills[j] === this ? 'true' : 'false');
          }
          applyFilter();
        });
      }
    })();
  </script>

  ${renderSiteFooter()}
  <script src="/i18n.js" defer></script>
</body>
</html>`;

  cachedDirectoryHtml = htmlResult;
  return htmlResult;
}

export function renderPseoPage(item: CleanItem): string {
  const clusterId = classifyPseoCluster(item);
  const cluster = CLUSTER_META[classifyDirectoryGroup(item)];
  const platform =
    item.platform ||
    (item.category === "mac"
      ? "mac"
      : item.category === "ios"
        ? "ios"
        : item.category === "android"
          ? "android"
          : "windows");

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
  const isStreamDeck = item.slug === "elgato-streamdeck-cache";
  const isWindows = platform === "windows";
  const isMac = platform === "mac";

  const headingText = isStreamDeck
    ? "Elgato Stream Deck App Cache Folder (%APPDATA%\\Elgato\\StreamDeck) — Safe to Delete?"
    : item.questionTitle || `How to clean ${item.name}`;

  const directAnswerHtml = (() => {
    if (item.directAnswer) {
      return esc(item.directAnswer);
    }
    const prefix = item.safeToDelete ? "Yes—it is safe to delete" : "Use caution before cleaning";
    const base = `${prefix} ${item.name} at ${item.path} to reclaim ${item.avgSpace}. ${item.whatHappens}`;
    return esc(base);
  })();

  const subLocations = buildSubLocationsForItem(item, clusterId);

  const shellCmd = item.shellCommand
    ? item.shellCommand
    : isWindows
      ? {
          label: "PowerShell: Measure current disk footprint (Read-Only)",
          language: "powershell" as const,
          code: buildPowerShellInspectionSnippet(item),
        }
      : null;

  const faqItems: Array<{ q: string; a: string }> = [
    ...(Array.isArray(item.customFaqs) ? item.customFaqs.filter((f) => f && f.q && f.a) : []),
    ...(isStreamDeck
      ? [
          {
            q: "How do I clean physical Elgato Stream Deck LCD keys vs. the Windows Stream Deck app cache?",
            a: "To clean the Windows software cache (1–4 GB), quit the Stream Deck tray app and clear %AppData%\\Elgato\\StreamDeck\\logs, Cache, Service Worker\\CacheStorage, and Media Blob Storage (your button profiles in ProfilesV2 stay untouched). To clean physical Stream Deck LCD keys, unplug the USB cable first and gently wipe the keys with a lint-free microfiber cloth lightly dampened with water or 70% isopropyl alcohol—never spray liquid directly onto the keys.",
          },
        ]
      : []),
    ...(absorbedVariants.length > 0
      ? [
          {
            q: `Can I also clear Service Worker CacheStorage, Media Blob Storage, Code Cache, and GPUCache for ${item.name}?`,
            a: `Yes. Those Chromium/Electron cache folders inside ${item.name} are temporary web assets and compiled script caches that rebuild automatically without signing you out or removing preferences.`,
          },
        ]
      : []),
    {
      q: `How much space does cleaning ${item.name} usually free?`,
      a: telemetryTruth?.badge_text
        ? `${telemetryTruth.badge_text}. Across Windows PCs, users typically reclaim ${item.avgSpace} in ${item.path}.`
        : `Typically ${item.avgSpace} depending on app activity and update history at ${item.path}.`,
    },
  ];

  const envLabel =
    platform === "mac"
      ? "Verified on macOS Sequoia / Tahoe"
      : platform === "ios"
        ? "Verified on iOS 18 / 19"
        : platform === "android"
          ? "Verified on Android 14 / 15"
          : "Tested on Windows 11 24H2";

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        "@id": `${canonicalUrl}#article`,
        headline: pageTitle,
        description: pageDesc,
        proficiencyLevel: "Beginner",
        datePublished: "2026-11-01",
        dateModified: "2026-11-22",
        author: {
          "@type": "Person",
          name: "Benjamin Cook",
          jobTitle: "Founder & Systems Engineer",
          url: "https://github.com/BenCook1996",
        },
        publisher: {
          "@id": "https://sweeprcleaner.com/#organization",
        },
        mainEntityOfPage: canonicalUrl,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://sweeprcleaner.com/" },
          { "@type": "ListItem", position: 2, name: "Storage Guides", item: "https://sweeprcleaner.com/clean" },
          { "@type": "ListItem", position: 3, name: item.name, item: canonicalUrl },
        ],
      },
      {
        "@type": "Organization",
        "@id": "https://sweeprcleaner.com/#organization",
        name: "SWEEPR Cleaner",
        url: "https://sweeprcleaner.com",
        logo: "https://sweeprcleaner.com/logo-mint-glass.svg",
        sameAs: ORGANIZATION_SAME_AS,
      },
    ],
  };

  const visualProofHtml = item.proofImage
    ? `<section id="verified-visual-proof" class="ed-section ed-card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          <h2 class="ed-h2" style="margin:0;">Windows 11 Disk Inspection Snapshot</h2>
          <span class="mono" style="font-size:0.75rem;color:var(--muted);">SWEEPR Storage Lab</span>
        </div>
        <figure style="margin:0;">
          <img
            src="${esc(item.proofImage)}"
            alt="${typeof item.visualProof === "object" && item.visualProof?.alt ? esc(item.visualProof.alt) : `Verified disk inspection of ${esc(item.name)} on Windows 11`}"
            class="ed-proof-img"
            loading="lazy"
            decoding="async"
            width="800"
            height="450"
            style="aspect-ratio: 800 / 450;"
          />
          <figcaption style="margin-top:8px;font-size:0.82rem;color:var(--muted);">
            ${typeof item.visualProof === "object" && item.visualProof?.caption ? esc(item.visualProof.caption) : `Disk inspection demonstrating folder footprint for ${esc(item.name)}.`}
          </figcaption>
        </figure>
      </section>`
    : "";

  const labBenchmarkHtml = item.labMeasurement
    ? `<section id="lab-benchmark-box" class="ed-section ed-card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
          <h2 class="ed-h2" style="margin:0;">Measured Lab Cleanup Result</h2>
          <span class="mono" style="font-size:0.75rem;color:var(--accent);">${esc(item.labMeasurement.osBuild)}</span>
        </div>
        <div class="ed-table-wrap">
          <table class="ed-table">
            <thead>
              <tr>
                <th>Before Cleanup</th>
                <th>After Cleanup</th>
                <th>Space Reclaimed</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="mono" style="font-weight:700;">${item.labMeasurement.beforeGb} GB</td>
                <td class="mono">${item.labMeasurement.afterGb} GB</td>
                <td class="mono" style="color:var(--accent);font-weight:700;">${item.labMeasurement.reclaimedGb} GB</td>
                <td>${esc(item.labMeasurement.notes)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>`
    : "";

  const consolidatedSubCacheHtml =
    absorbedVariants.length > 0
      ? `<div id="consolidated-subcache-modules" style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border);">
          <h3 class="ed-h3" style="margin-bottom:6px;">Included Chromium &amp; Electron Sub-Caches</h3>
          <p style="font-size:0.86rem;color:var(--muted);margin-bottom:12px;">
            The folders below are safe to clear alongside ${esc(item.name)} without logging you out:
          </p>
          <div class="ed-grid-2" style="gap:10px;">
            ${absorbedVariants
              .map(
                (v) => `<div style="padding:12px;border-radius:10px;background:var(--bg);border:1px solid var(--border);">
                  <div style="font-weight:700;font-size:0.88rem;margin-bottom:4px;">${esc(v.label)}</div>
                  <div class="ed-path-mono">${esc(v.subPath)}</div>
                  <div style="font-size:0.8rem;color:var(--muted);">${esc(v.role)}</div>
                </div>`
              )
              .join("")}
          </div>
        </div>`
      : "";

  const inlinePathWidgetHtml = isWindows
    ? `<section id="sweepr-inline-checker-widget" class="ed-section ed-card-muted">
        <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:6px;">
          <h2 class="ed-h2" style="font-size:1.15rem;margin:0;">Verify a path on your PC</h2>
          <a href="/safe-to-delete" style="font-size:0.84rem;font-weight:700;color:var(--accent);text-decoration:underline;">Open full batch checker &rarr;</a>
        </div>
        <p style="font-size:0.86rem;color:var(--muted);margin-bottom:12px;">
          Check this folder or paste any <code class="ed-code">%LocalAppData%</code> path from File Explorer before deleting it manually:
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          <input
            id="inlineSafeCheckInput"
            type="text"
            class="ed-input"
            style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:0.84rem;background:var(--surface-elevated);"
            value="${esc(extractPrimaryDisplayPath(item.path))}"
            aria-label="Windows folder path to verify"
          />
          <button id="inlineSafeCheckBtn" type="button" class="ed-btn-primary">Verify Path Safety</button>
        </div>
        <div id="inlineSafeCheckResult" style="display:none;margin-top:12px;padding:12px 14px;border-radius:10px;background:var(--surface-elevated);border:1px solid var(--border);font-size:0.86rem;"></div>
        <script>
          (function(){
            var btn = document.getElementById('inlineSafeCheckBtn');
            var inp = document.getElementById('inlineSafeCheckInput');
            var out = document.getElementById('inlineSafeCheckResult');
            if (!btn || !inp || !out) return;
            btn.addEventListener('click', function(){
              var val = (inp.value || '').trim();
              if (!val) return;
              btn.disabled = true;
              btn.textContent = 'Checking...';
              fetch('/api/safe-to-delete/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: val })
              })
                .then(function(r){ return r.json(); })
                .then(function(d){
                  btn.disabled = false;
                  btn.textContent = 'Verify Path Safety';
                  var first = d && d.results && d.results[0];
                  if (!first) return;
                  out.style.display = 'block';
                  var escT = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
                  out.innerHTML =
                    '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:4px;">' +
                      '<strong>' + escT(first.verdict || '') + ' &mdash; ' + escT(first.name || '') + '</strong>' +
                      '<span class="mono" style="font-weight:700;color:var(--accent);">' + escT(first.avg_space || '') + '</span>' +
                    '</div>' +
                    '<div style="color:var(--muted);">' + escT(first.explanation || '') + '</div>';
                })
                .catch(function(){
                  btn.disabled = false;
                  btn.textContent = 'Verify Path Safety';
                });
            });
          })();
        </script>
      </section>`
    : "";

  const html = `<!doctype html>
<html lang="en">
${renderEditorialHead({
  title: pageTitle,
  description: pageDesc,
  canonical: canonicalUrl,
  robots: robotsMetaContent,
  ogType: "article",
  jsonLd,
})}
<body>
  ${renderSiteHeader("guides")}

  <main id="main-content" class="ed-article">
    <nav class="ed-crumb" aria-label="Breadcrumb">
      <a href="/">Home</a>
      <span>/</span>
      <a href="/clean">Storage Guides</a>
      <span>/</span>
      <a href="/clean#silo-${cluster.id}">${esc(cluster.shortLabel)}</a>
      <span>/</span>
      <span>${esc(item.name)}</span>
    </nav>

    <header>
      <h1 class="ed-h1">${esc(headingText)}</h1>
      <div class="ed-meta-row">
        <span class="ed-status ${item.safeToDelete ? "ed-status-safe" : "ed-status-caution"}">
          <span class="ed-dot" aria-hidden="true"></span>
          ${item.safeToDelete ? "Safe to Delete" : "Use Caution"}
        </span>
        <span class="mono" style="font-weight:700;color:var(--text);">Typical space: ${esc(item.avgSpace)}</span>
        ${
          telemetryTruth?.badge_text
            ? `<span id="telemetry-truth-badge" class="ed-status ed-status-safe">${esc(telemetryTruth.badge_text)}</span>`
            : ""
        }
        <span>${isWindows ? "Tested on Windows 11 24H2 · Verified Microsoft Authenticode Publisher: Benjamin Cook" : `${esc(envLabel)} · Verified Publisher: Benjamin Cook`} · Updated <time datetime="2026-11-22">22 Nov 2026</time> (<a href="https://github.com/BenCook1996" rel="author">GitHub</a>)</span>
      </div>
    </header>

    <!-- Direct Answer / Quick Verdict -->
    <section class="ed-verdict ${item.safeToDelete ? "" : "ed-verdict-caution"}" aria-labelledby="quick-verdict-heading">
      <div id="quick-verdict-heading" class="ed-verdict-label">DIRECT ANSWER</div>
      <p id="ai-direct-verdict" style="font-size:1.02rem;line-height:1.6;color:var(--text);font-weight:500;">
        ${directAnswerHtml}
      </p>
      <div class="ed-path-box">${esc(item.path)}</div>
      ${
        item.whenNotToDelete || item.warning
          ? `<div class="ed-caution-box"><strong>When not to delete:</strong> ${esc(item.whenNotToDelete || item.warning || "")}</div>`
          : ""
      }
      ${
        isStreamDeck
          ? `<div class="ed-caution-box" style="background:var(--surface);border-color:var(--border);color:var(--text);margin-top:12px;">
              <strong>Cleaning physical Stream Deck LCD keys?</strong> Unplug the USB cable first and wipe gently with a lint-free microfiber cloth lightly dampened with water or 70% isopropyl alcohol. To reclaim 1–4 GB of PC disk bloat, follow the software cache steps below without touching <code class="ed-code">ProfilesV2</code>.
            </div>`
          : ""
      }
      ${
        mergedTargetItem
          ? `<div id="soft-merge-consolidation-banner" class="ed-caution-box" style="background:var(--accent-soft);border-color:var(--border);color:var(--accent-ink);">
              <strong>Merged guide:</strong> See the primary guide for <a href="/clean/${mergedTargetItem.category}/${mergedTargetItem.slug}" style="text-decoration:underline;font-weight:700;">${esc(mergedTargetItem.name)}</a>.
            </div>`
          : ""
      }
      <div class="ed-actions">
        <a href="/download?platform=${encodeURIComponent(platform)}&amp;utm_source=pseo_quick_verdict&amp;slug=${encodeURIComponent(item.slug)}" class="ed-btn-primary" rel="nofollow">
          Download Free Scan
        </a>
        <a href="/order?plan=annual&amp;utm_source=pseo_quick_verdict&amp;slug=${encodeURIComponent(item.slug)}" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="ed-btn-secondary" rel="nofollow">
          Unlock 5-Device Pro
        </a>
      </div>
    </section>

    ${inlinePathWidgetHtml}
    ${labBenchmarkHtml}

    <!-- What Causes It & Safe Command -->
    <section class="ed-section ed-card ed-prose">
      <h2 class="ed-h2">Why ${esc(item.name)} grows</h2>
      <p>${esc(item.whyItGrows || item.whatIsIt)}</p>
      ${item.whyItGrows && item.whatHappens ? `<p>${esc(item.whatHappens)}</p>` : ""}
      ${
        shellCmd
          ? `<div style="margin-top:16px;">
              <div style="font-size:0.84rem;font-weight:700;color:var(--text);margin-bottom:6px;">${esc(shellCmd.label)}</div>
              <pre class="ed-pre">${esc(shellCmd.code)}</pre>
            </div>`
          : ""
      }
    </section>

    <!-- Manual Cleaning Steps -->
    <section class="ed-section ed-card">
      <h2 class="ed-h2">How to clean it manually</h2>
      <ol class="ed-steps">
        ${item.manualSteps
          .map(
            (step, idx) =>
              `<li><span class="ed-step-num">${idx + 1}</span><span>${esc(step)}</span></li>`
          )
          .join("")}
      </ol>
      ${
        item.troubleshooting &&
        (item.troubleshooting.processLock ||
          typeof item.troubleshooting.adminRequired === "boolean" ||
          item.troubleshooting.edgeCaseNote)
          ? `<div id="manual-troubleshooting-notes" class="ed-caution-box" style="margin-top:16px;">
              <div style="font-weight:700;margin-bottom:6px;">Troubleshooting &amp; Process Locks</div>
              ${
                item.troubleshooting.processLock
                  ? `<div style="margin-bottom:4px;"><strong>Processes to close:</strong> <code class="ed-code">${esc(item.troubleshooting.processLock)}</code></div>`
                  : ""
              }
              ${
                typeof item.troubleshooting.adminRequired === "boolean"
                  ? `<div style="margin-bottom:4px;"><strong>Administrator privileges:</strong> ${item.troubleshooting.adminRequired ? "Required (run Command Prompt / PowerShell as Administrator)" : "Not required for standard user folders"}</div>`
                  : ""
              }
              ${
                item.troubleshooting.edgeCaseNote
                  ? `<div>${esc(item.troubleshooting.edgeCaseNote)}</div>`
                  : ""
              }
            </div>`
          : isWindows
            ? `<p style="font-size:0.84rem;color:var(--muted);margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
                If Windows reports a file is currently in use, close the parent app in Task Manager first—or leave active session files untouched.
              </p>`
            : ""
      }
    </section>

    ${visualProofHtml}

    <!-- Sub-Folders Breakdown Table -->
    <section class="ed-section ed-card">
      <div id="subfolders-breakdown-table">
        <h2 class="ed-h2">Sub-folder safety breakdown</h2>
        <p style="font-size:0.88rem;color:var(--muted);">
          Review which paths inside <strong>${esc(item.name)}</strong> are disposable versus protected:
        </p>
        <div class="ed-table-wrap">
          <table class="ed-table">
            <thead>
              <tr>
                <th>Sub-Folder / Cache Location</th>
                <th>Storage Role</th>
                <th>Typical Footprint</th>
                <th>Deletion Safety</th>
              </tr>
            </thead>
            <tbody>
              ${subLocations
                .map(
                  (loc) => `<tr>
                    <td>
                      <span class="ed-path-mono" style="color:var(--text);font-weight:600;">${esc(loc.subPath)}</span>
                      ${
                        Array.isArray(loc.extensions) && loc.extensions.length > 0
                          ? `<div class="mono" style="font-size:0.72rem;color:var(--muted);margin-top:4px;">${loc.extensions.map((e) => esc(e)).join(" &middot; ")}</div>`
                          : ""
                      }
                    </td>
                    <td>
                      <div>${esc(loc.role)}</div>
                      ${
                        loc.regenerates
                          ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:4px;"><strong>Regenerates:</strong> ${esc(loc.regenerates)}</div>`
                          : ""
                      }
                      ${
                        loc.troubleshooting
                          ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:2px;"><strong>Note:</strong> ${esc(loc.troubleshooting)}</div>`
                          : ""
                      }
                    </td>
                    <td class="mono" style="font-weight:700;">${esc(loc.avgSpace)}</td>
                    <td style="font-weight:700;">${esc(loc.safe)}</td>
                  </tr>`
                )
                .join("")}
              ${siblings
                .map(
                  (s) => `<tr>
                    <td>
                      <a href="/clean/${s.category}/${s.slug}">${esc(s.name)}</a>
                      <div class="ed-path-mono">${esc(s.path)}</div>
                    </td>
                    <td>${esc(describeCacheVariantRole(s.slug))}</td>
                    <td class="mono" style="font-weight:700;">${esc(s.avgSpace)}</td>
                    <td style="font-weight:700;">${s.safeToDelete ? "Safe to delete" : "Conditional"}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
      ${consolidatedSubCacheHtml}
    </section>

    <!-- FAQs -->
    <section class="ed-section ed-card">
      <h2 class="ed-h2">Common questions</h2>
      <div>
        ${faqItems
          .map(
            (f) => `<div class="ed-faq-item">
              <h3 class="ed-faq-q">${esc(f.q)}</h3>
              <p class="ed-faq-a">${esc(f.a)}</p>
            </div>`
          )
          .join("")}
      </div>
    </section>

    ${
      related.length > 0
        ? `<section class="ed-section ed-card">
            <h2 class="ed-h2" style="margin-bottom:12px;">Related storage guides</h2>
            <div class="ed-grid-2">
              ${related
                .map(
                  (r) => `<a href="/clean/${r.category}/${r.slug}" style="display:block;padding:14px;border-radius:12px;border:1px solid var(--border);background:var(--bg);">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
                      <span class="ed-status ${r.safeToDelete ? "ed-status-safe" : "ed-status-caution"}" style="font-size:0.72rem;padding:2px 8px;">
                        <span class="ed-dot" aria-hidden="true"></span>${r.safeToDelete ? "Safe" : "Conditional"}
                      </span>
                      <span class="mono" style="font-size:0.78rem;font-weight:700;color:var(--text);">${esc(r.avgSpace)}</span>
                    </div>
                    <div style="font-weight:700;font-size:0.92rem;color:var(--text);margin-bottom:4px;">${esc(r.questionTitle || r.name)}</div>
                    <div class="ed-path-mono">${esc(r.path)}</div>
                  </a>`
                )
                .join("")}
            </div>
          </section>`
        : ""
    }

    <!-- Single Restrained CTA -->
    <section class="ed-section ed-card-muted">
      <h2 class="ed-h2">Prefer a 1-click scan with a 7-day undo net?</h2>
      <p style="font-size:0.92rem;color:var(--muted);line-height:1.6;">
        SWEEPR Cleaner checks ${esc(item.name)} alongside your other hidden system and app folders, keeps active settings and personal files protected, and covers up to 5 Windows, Mac, iPhone, and Android devices.
      </p>
      <div class="ed-actions">
        <a href="/download?platform=${encodeURIComponent(platform)}" class="ed-btn-primary" rel="nofollow">Download Free Scan</a>
        <a href="/order?plan=annual" onclick="try{sessionStorage.setItem('sweepr_selected_plan','annual')}catch(e){}" class="ed-btn-secondary" rel="nofollow">Get 5-Device Pro</a>
        ${
          isWindows
            ? `<a href="/tools/pc-cache-calculator" class="ed-btn-secondary">PC Cache Calculator</a>`
            : `<a href="/clean" class="ed-btn-secondary">Browse All Guides</a>`
        }
      </div>
    </section>
  </main>

  ${renderSiteFooter()}
  <script src="/i18n.js" defer></script>
</body>
</html>`;

  return html;
}
