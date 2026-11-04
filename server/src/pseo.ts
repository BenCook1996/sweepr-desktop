import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
  "steam-depotcache": "Steam depotcache Folder: Safe to Delete? | SWEEPR Cleaner",
  "programdata-package-cache": "ProgramData Package Cache: Safe to Delete? (2026) | SWEEPR",
  "riot-client-logs": "Clear VALORANT & Riot Client Cache Safely (2026) | SWEEPR",
  "logitech-ghub-installer-cache": "LGHUB Cache & Depots: Safe to Delete? (2026) | SWEEPR",
  "logitech-options-plus-cache": "Logi Options+ Cache & Depots: Safe to Delete? | SWEEPR",
  "elgato-streamdeck-cache": "Elgato Stream Deck Cache & Logs: Safe to Delete? | SWEEPR",
  "windows-livekernelreports": "C:\\Windows\\LiveKernelReports: Safe to Delete? | SWEEPR",
  "opera-gx-cache": "How to Clear Opera GX Cache & Bloat Safely (2026) | SWEEPR",
  "medal-tv-cache": "How to Clear Medal TV Cache (Keep Clips Safe) | SWEEPR",
  "capcut-desktop-cache": "How to Clear CapCut PC Cache Safely (2026) | SWEEPR",
  "capcut-pc-cache": "How to Clear CapCut PC Cache Safely (2026) | SWEEPR",
  "winsxs": "Windows WinSxS Folder Cleanup: Safe to Delete? | SWEEPR",
  "obs-studio-logs-crashes": "OBS Studio Logs & Crash Dumps: Safe to Delete? | SWEEPR",
  "adobe-media-cache": "Adobe Premiere & Media Cache: Safe to Delete? | SWEEPR",
  "creative-cloud-installer-cache": "Adobe Creative Cloud Cache: Safe to Delete? (2026) | SWEEPR",
  "nvidia-dxcache": "NVIDIA DXCache & GLCache Folder: Safe to Delete? | SWEEPR",
  "npm-cache": "Clear npm-cache Folder on Windows 11 Safely (2026) | SWEEPR",
  "gradle-wrapper-caches": "Clear .gradle Caches & Wrapper Dists on Windows | SWEEPR",
  "localappdata-crashdumps": "AppData\\Local\\CrashDumps: Safe to Delete? (2026) | SWEEPR",
  "hiberfil-sys": "C:\\hiberfil.sys on Windows 11: Safe to Delete? | SWEEPR",
  "windows-old": "Delete C:\\Windows.old Safely on Windows 11 (2026) | SWEEPR",
  "pip-cache": "How to Clear Python pip Cache on Windows 11 | SWEEPR",
  "delivery-optimization": "Clear Delivery Optimization Cache on Windows 11 | SWEEPR",
  "c-drive-filling-up-by-itself-windows-11": "C Drive Filling Up By Itself on Windows 11? Fix It | SWEEPR",
  "system-and-reserved-storage-100gb-windows-11": "System & Reserved Storage Taking 100GB Windows 11 | SWEEPR",
  "appdata-local-folder-huge-windows-11": "AppData\\Local Folder Huge on Windows 11? Safe Clean | SWEEPR",
  "windows-11-24h2-update-cache-8gb-bug": "Fix Windows 11 24H2 8.63 GB Undeletable Update Cache | SWEEPR",
  "other-storage-full-windows-11-cleanup": "Clean 'Other' & Temporary Files on Windows 11 | SWEEPR",
  "localappdata-webview2-ebwebview-cache": "WebView2 EBWebView Cache: Safe to Delete? (2026) | SWEEPR",
  "genshin-impact-update-cache": "Genshin Impact Update Cache: Safe to Delete? | SWEEPR",
  "ea-app-cache": "How to Clear EA App Cache & Logs Safely (2026) | SWEEPR",
  "epic-games-webcache": "Epic Games Launcher Webcache: Safe to Delete? | SWEEPR",
  "chrome-gpu-shader-cache": "Chrome GPUCache & GrShaderCache: Safe to Delete? | SWEEPR",
  "amd-shader-cache": "AMD DxCache & VkCache Folder: Safe to Delete? | SWEEPR",
  "vrchat-cache": "How to Clear VRChat Cache Folder Safely (2026) | SWEEPR",
  "intellij-idea-caches": "JetBrains & IntelliJ IDEA Caches: Safe to Delete? | SWEEPR",
  "comfyui-temp-output-cache": "ComfyUI Temp & Output Cache Cleanup Guide (2026) | SWEEPR",
  "lm-studio-models-cache": "LM Studio Models & GGUF Cache: Safe to Delete? | SWEEPR",
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
  "logitech-options-plus-cache":
    "Is C:\\ProgramData\\Logishrd\\LogiOptionsPlus\\depots safe to delete? Reclaim 1–4.5 GB of Logitech Options+ installer depots while keeping MX Master mappings safe.",
  "elgato-streamdeck-cache":
    "How to clear Elgato Stream Deck cache and rotating logs on Windows 10/11. Safely delete 500 MB–3.5 GB in %AppData%\\Elgato\\StreamDeck without losing profiles.",
  "windows-livekernelreports":
    "Is C:\\Windows\\LiveKernelReports safe to delete? Yes—reclaim 1–8 GB by removing old WATCHDOG GPU crash dump (.dmp) files on Windows 10/11 safely in 1 click.",
  "opera-gx-cache":
    "How to clear Opera GX cache, Service Worker CacheStorage, and shader bloat on Windows 10/11. Reclaim 1.5–8.5 GB while keeping tabs, mods, and logins intact.",
  "medal-tv-cache":
    "How to clear Medal.tv cache without losing clips. Safely delete 2–12 GB from %AppData%\\Medal\\Cache & IndexedDB blob storage on Windows 10 and Windows 11.",
  "capcut-desktop-cache":
    "How to clear CapCut PC cache on Windows 10/11 without losing video drafts. Safely remove 2–20 GB of proxy cache, Service Worker blobs, and render scratch.",
  "capcut-pc-cache":
    "How to clear CapCut PC cache on Windows 10/11 without losing video drafts. Safely remove 2–20 GB of proxy cache, Service Worker blobs, and render scratch.",
  "winsxs":
    "Can you delete C:\\Windows\\WinSxS? Learn how to safely clean the Windows Side-by-Side Component Store using DISM or SWEEPR Cleaner to reclaim 6–18 GB.",
  "obs-studio-logs-crashes":
    "How to clear OBS Studio logs, Crashpad dumps, and browser-source CEF cache on Windows 10/11. Reclaim 500 MB–4 GB in %AppData%\\obs-studio safely in 1 click.",
  "adobe-media-cache":
    "How to clear Adobe Media Cache Files (.cfa, .pek) on Windows 10/11. Reclaim 10–80 GB for Premiere Pro & After Effects without affecting project timelines.",
  "creative-cloud-installer-cache":
    "Is Adobe Creative Cloud cache safe to delete? Reclaim 2–12 GB of CoreSync, RIBS installer staging, and Service Worker cache without signing out of Adobe apps.",
  "nvidia-dxcache":
    "Is NVIDIA DXCache and GLCache safe to delete? Clear 2–15 GB of stale DirectX 12 & Vulkan compiled shader binaries on Windows 10/11 to fix disk bloat & stutter.",
  "npm-cache":
    "How to clear %LocalAppData%\\npm-cache on Windows 10/11 safely. Reclaim 2–18 GB of cached Node.js tarballs using npm cache clean --force or SWEEPR Cleaner.",
  "gradle-wrapper-caches":
    "Is %UserProfile%\\.gradle\\caches safe to delete? Reclaim 5–35 GB of orphaned Android Studio & Java Gradle wrapper distributions and build caches in 1 click.",
  "localappdata-crashdumps":
    "Is %LocalAppData%\\CrashDumps safe to delete on Windows 11? Yes—safely remove 1–15 GB of old application .dmp crash files without affecting installed apps.",
  "hiberfil-sys":
    "What is C:\\hiberfil.sys on Windows 11 and can you delete it? Reclaim 8–32 GB of SSD space using powercfg -h off or SWEEPR Cleaner's safe system audit.",
  "windows-old":
    "How to delete C:\\Windows.old on Windows 11 safely and reclaim 15–40 GB after an OS update without running into TrustedInstaller permission errors.",
  "pip-cache":
    "How to clear %LocalAppData%\\pip\\Cache on Windows 11. Safely delete 2–20 GB of cached Python wheel (.whl) and PyTorch packages in 1 click.",
  "delivery-optimization":
    "Is Windows Update Delivery Optimization cache safe to delete? Reclaim 3–20 GB in ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization.",
  "c-drive-filling-up-by-itself-windows-11":
    "Why is your C: drive filling up by itself on Windows 11? Find and purge hidden WinSxS, Temp, Package Cache, DXCache, and crash dumps to reclaim 12–65 GB.",
  "system-and-reserved-storage-100gb-windows-11":
    "Fix System & Reserved storage taking 80GB–100GB+ on Windows 11. Safely clean WinSxS component bloat, Windows Update staging, and hiberfil.sys in minutes.",
  "appdata-local-folder-huge-windows-11":
    "AppData\\Local folder taking 50GB+ on Windows 11? Learn which Cache, GPUCache, Temp, and D3DSCache subfolders are 100% safe to delete without losing logins.",
  "windows-11-24h2-update-cache-8gb-bug":
    "How to fix the Windows 11 24H2 8.63 GB undeletable Windows Update cache bug in WinSxS\\Temp\\PendingDeletes and C:\\$Windows.~BT using DISM and SWEEPR.",
  "other-storage-full-windows-11-cleanup":
    "Temporary files & 'Other' storage full on Windows 11? Safely clean hidden ProgramData\\Package Cache, .cache, and GPU shader folders to free 6–45 GB.",
  "localappdata-webview2-ebwebview-cache":
    "Is Microsoft Edge WebView2 EBWebView cache safe to delete? Reclaim 1–8 GB of embedded Chromium cache on Windows 10/11 without breaking desktop apps.",
  "genshin-impact-update-cache":
    "How to clear Genshin Impact & HoYoPlay update staging cache on Windows 10/11. Safely delete 4–25 GB of leftover .zip_tmp patch archives after updates.",
  "ea-app-cache":
    "Is %LocalAppData%\\Electronic Arts\\EA Desktop cache safe to delete? Clear 1–6 GB of EA App installer staging and CEF cache to fix stuck game updates.",
  "epic-games-webcache":
    "How to clear %LocalAppData%\\EpicGamesLauncher\\Saved\\webcache on Windows 10/11. Safely remove 1–5 GB of CEF storefront bloat and fix blank launcher UI.",
  "chrome-gpu-shader-cache":
    "Is Google Chrome GPUCache, GrShaderCache, and DawnCache safe to delete? Reclaim 1–6 GB in %LocalAppData%\\Google\\Chrome\\User Data without losing logins.",
  "amd-shader-cache":
    "Is %LocalAppData%\\AMD\\DxCache and VkCache safe to delete? Clear 2–12 GB of compiled Radeon DirectX & Vulkan shader binaries to fix disk bloat & stutter.",
  "vrchat-cache":
    "Is %LocalAppData%Low\\VRChat\\VRChat\\Cache-WindowsPlayer safe to delete? Reclaim 10–30 GB of cached avatar and world bundles without losing your account.",
  "intellij-idea-caches":
    "How to clear %LocalAppData%\\JetBrains caches and old IDE version indexes on Windows 10/11. Reclaim 5–25 GB of stale JVM & Gradle index storage safely.",
  "comfyui-temp-output-cache":
    "How to clear ComfyUI temp preview tensors, custom_nodes pip cache, and intermediate diffusion latents on Windows 11 to reclaim 5–40 GB of NVMe space.",
  "lm-studio-models-cache":
    "Where does LM Studio store GGUF models on Windows 11? Safely audit and clean %UserProfile%\\.cache\\lm-studio to reclaim 10–80 GB of unused LLM weights.",
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
  if (slug.endsWith("-shader-cache")) return "DirectX 12 / Vulkan / Dawn GPU Shaders";
  if (slug.endsWith("-webcache")) return "Embedded Chromium (CEF) Browser Cache";
  if (slug.endsWith("-logs-crashes") || slug.endsWith("-logs")) return "Diagnostic Logs & Crashpad Minidumps (.dmp)";
  return "Primary Application & System Storage Cache";
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

  for (let offset = 1; offset < pool.length && related.length < 6; offset++) {
    const candidate = pool[(myIdx + offset * 3) % pool.length];
    if (candidate && !siblingSlugs.has(candidate.slug)) {
      siblingSlugs.add(candidate.slug);
      related.push(candidate);
    }
  }

  return { siblings, related };
}

export function buildPseoTitle(item: CleanItem): string {
  const custom = item.metaTitle || CUSTOM_GSC_TITLES[item.slug];
  if (custom && custom.length >= 30 && custom.length <= 60) {
    return custom;
  }

  const cleanName = item.name
    .replace(/TechSmith Snagit Screen Capture/g, "Snagit Capture")
    .replace(/MuseScore Studio Notation Software/g, "MuseScore Studio")
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

export function buildPseoDescription(item: CleanItem): string {
  const customDesc = item.metaDescription || CUSTOM_GSC_DESCRIPTIONS[item.slug];
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
  "logitech-options-plus-cache",
  "elgato-streamdeck-cache",
  "windows-livekernelreports",
  "opera-gx-cache",
  "medal-tv-cache",
  "capcut-desktop-cache",
  "winsxs",
  "obs-studio-logs-crashes",
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
      <h2 class="text-xl font-bold text-gray-900 mb-2">Compare SWEEPR Cleaner vs. Legacy PC Cleaners (2026 Benchmarks)</h2>
      <p class="text-xs text-gray-600 mb-5">
        See how SWEEPR's 5 MB native Rust engine compares against legacy Windows cleaners across deep app/shader/developer cache detection, zero-telemetry privacy, and 7-day automatic rollback:
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
        <a href="/vs/ccleaner" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. CCleaner &rarr;</a>
        <a href="/vs/bleachbit" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. BleachBit &rarr;</a>
        <a href="/vs/cleanmypc" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. CleanMyPC &rarr;</a>
        <a href="/vs/avast-cleanup" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. Avast Cleanup &rarr;</a>
        <a href="/vs/wise-disk-cleaner" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. Wise Disk Cleaner &rarr;</a>
        <a href="/vs/glary-utilities" class="p-3 rounded-xl border border-gray-200 hover:border-emerald-500 font-bold text-gray-800 hover:text-emerald-700 no-underline">SWEEPR vs. Glary Utilities &rarr;</a>
        <a href="/alternatives/ccleaner" class="p-3 rounded-xl bg-gray-50 border border-gray-200 hover:border-emerald-500 font-semibold text-gray-700 hover:text-emerald-700 no-underline">Best CCleaner Alternative (2026) &rarr;</a>
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
  const canonicalUrl = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
  const { siblings, related } = getSiblingAndRelatedItems(item);

  const faqItems = [
    {
      q: `Is it safe to delete ${item.name}?`,
      a: item.warning
        ? `Exercise caution: ${item.warning}`
        : `Yes, 100% safe. ${item.whatHappens}`,
    },
    {
      q: `How much storage space will cleaning ${item.name} free up?`,
      a: `Users typically reclaim ${item.avgSpace} on Windows 10 and Windows 11 systems depending on update frequency and active cache retention in ${item.path}.`,
    },
    cluster.extraFaq(item),
    {
      q: `Where is ${item.name} located on Windows 10 and Windows 11?`,
      a: `It is stored at ${item.path}. You can paste that path directly into the Windows Run dialog (Win + R) or File Explorer address bar to inspect it.`,
    },
    ...(Array.isArray(item.customFaqs) ? item.customFaqs.filter((f) => f && f.q && f.a) : []),
  ];

  const subLocations = buildSubLocationsForItem(item, clusterId);
  const siblingTableSection = `
    <!-- Sub-Folders & Cache Locations Breakdown Table -->
    <div id="subfolders-breakdown-table" class="bg-white border border-gray-200 rounded-2xl p-6 md:p-8 shadow-sm mb-8">
      <h2 class="text-lg font-bold text-gray-900 mb-2">Sub-Folders &amp; Cache Locations Breakdown for ${item.name}</h2>
      <p class="text-xs text-gray-600 mb-4">
        Modern Windows applications and system services split their disk footprint across multiple sub-directories (` + "`Cache_Data`" + `, ` + "`Service Worker\\CacheStorage`" + `, ` + "`Code Cache`" + `, ` + "`GPUCache`" + `, and ` + "`Crashpad\\reports`" + `). Review which sub-folders inside <strong>${item.name}</strong> are safe to purge and which files remain protected:
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
      <div class="flex flex-wrap items-center gap-2 text-xs font-bold text-emerald-600 uppercase tracking-wider">
        <a href="/clean" class="hover:underline">&larr; Clean Directory</a>
        <span class="text-gray-300">/</span>
        <a href="/clean#silo-${cluster.id}" class="hover:underline">${cluster.badge}</a>
      </div>
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
        <a href="/safe-to-delete" class="text-xs font-bold text-gray-700 hover:underline">
          🔍 Check Other Folders in Interactive Path Checker
        </a>
      </div>
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
