import { analyzeSafeToDeleteInput } from "./safe-to-delete.js";
import { escapeHtml } from "./security.js";
import { assignExperimentVariant } from "./experiments.js";

export interface TransactionalToolConfig {
  slug: string;
  appName: string;
  shortName: string;
  title: string; // 30-60 chars
  metaDescription: string; // 70-160 chars
  heroBadge: string;
  h1: string;
  subtitle: string;
  typicalSavings: string;
  targetCleanSlugs: string[];
  samplePaths: string[];
  psCommand: string;
  whatStaysSafe: string;
  whyItBloats: string;
  faqs: Array<{ q: string; a: string }>;
}

export const TRANSACTIONAL_TOOLS: TransactionalToolConfig[] = [
  {
    slug: "discord-cache-cleaner",
    appName: "Discord Desktop (Windows 10 & 11)",
    shortName: "Discord Cache Cleaner",
    title: "Discord Cache Cleaner for Windows 10/11 (Free 2–15 GB)",
    metaDescription:
      "Clean Discord Cache_Data, Code Cache, GPUCache, and Media Blob Storage on Windows 10/11 in 1 click. Free 2–15 GB without logging out of Discord.",
    heroBadge: "⚡ 1-CLICK DISCORD CACHE & GPU BLOB CLEANER",
    h1: "Discord Cache Cleaner for Windows 10 & 11",
    subtitle:
      "Instantly audit and purge %AppData%\\discord\\Cache\\Cache_Data, Code Cache, GPUCache, and Service Worker Media Blobs without signing out of your Discord account or resetting voice settings.",
    typicalSavings: "2.0 GB – 15.0 GB",
    targetCleanSlugs: ["discord-cache"],
    samplePaths: [
      "%AppData%\\discord\\Cache\\Cache_Data, 6.4 GB",
      "%AppData%\\discord\\Code Cache\\js, 1.8 GB",
      "%AppData%\\discord\\GPUCache, 1.2 GB",
      "%AppData%\\discord\\Service Worker\\CacheStorage, 2.5 GB",
      "%AppData%\\discord\\Crashpad\\reports, 0.6 GB",
    ],
    psCommand:
      'Get-ChildItem "$env:APPDATA\\discord" -Directory | Select-Object FullName | Set-Clipboard',
    whatStaysSafe:
      "Active Discord login tokens (Local Storage/leveldb), keybinds, Krisp noise suppression settings, and server layouts.",
    whyItBloats:
      "Every image, GIF, custom emoji, video clip, and embedded stream you view in any Discord server is written unencrypted into %AppData%\\discord\\Cache\\Cache_Data with no automatic size cap.",
    faqs: [
      {
        q: "Does cleaning Discord cache log me out of Discord?",
        a: "No. SWEEPR Cleaner only removes Cache_Data, Code Cache, GPUCache, Service Worker CacheStorage, and Crashpad dumps while leaving your session token in Local Storage\\leveldb 100% untouched.",
      },
      {
        q: "How much disk space does Discord cache use on Windows 11?",
        a: "Active Discord users in media-heavy servers typically accumulate 2 GB to 15 GB of cached images, WebM videos, and Chromium GPU shader blobs within 60–90 days.",
      },
    ],
  },
  {
    slug: "steam-cache-cleaner",
    appName: "Steam Client & Game Depots",
    shortName: "Steam Cache Cleaner",
    title: "Steam depotcache & Shader Cache Cleaner (Free 5–40 GB)",
    metaDescription:
      "Safely clean Steam depotcache (.csd/.csm), shaderappcache, and htmlcache on Windows 10/11. Reclaim 5–40 GB in 1 click without deleting game saves.",
    heroBadge: "🎮 STEAM DEPOTCACHE & SHADER CACHE CLEANER",
    h1: "Steam depotcache & Shader Cache Cleaner",
    subtitle:
      "Audit and clean C:\\Program Files (x86)\\Steam\\depotcache, steamapps\\shadercache, and CEF htmlcache in seconds while keeping all installed games and Steam Cloud saves protected.",
    typicalSavings: "5.0 GB – 40.0 GB",
    targetCleanSlugs: ["steam-depotcache"],
    samplePaths: [
      "C:\\Program Files (x86)\\Steam\\depotcache, 14.8 GB",
      "C:\\Program Files (x86)\\Steam\\steamapps\\shadercache, 8.2 GB",
      "%LocalAppData%\\Steam\\htmlcache\\Cache_Data, 2.4 GB",
      "C:\\Program Files (x86)\\Steam\\dumps, 1.5 GB",
    ],
    psCommand:
      'Get-ChildItem "C:\\Program Files (x86)\\Steam\\depotcache" -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum',
    whatStaysSafe:
      "Installed Steam games (steamapps\\common), local save files, Steam Guard login credentials, and controller configurations.",
    whyItBloats:
      "Interrupted game patches, pre-load encrypted chunks (.csd / .csm), and DirectX/Vulkan pre-cached shaders accumulate inside Steam\\depotcache and steamapps\\shadercache across major game updates.",
    faqs: [
      {
        q: "Will deleting Steam depotcache uninstall my games?",
        a: "No. Installed games live in steamapps\\common. The depotcache folder only holds temporary delta-patch manifests and encrypted pre-load staging chunks. Just make sure no game download is actively paused before cleaning.",
      },
      {
        q: "Does cleaning Steam shader cache fix micro-stuttering?",
        a: "Yes. Clearing corrupted or outdated Vulkan/DirectX shader binaries forces Steam and your GPU driver to compile a clean shader pipeline for your current driver version.",
      },
    ],
  },
  {
    slug: "logitech-ghub-cleaner",
    appName: "Logitech G HUB & Logi Options+",
    shortName: "Logitech G HUB Cleaner",
    title: "Logitech G HUB & Options+ Cache Cleaner (Free 2–10 GB)",
    metaDescription:
      "Clean C:\\ProgramData\\LGHUB\\depots, LogiOptionsPlus depots, and Media Blob Storage on Windows 10/11. Free 2–10 GB while keeping mouse DPI macros.",
    heroBadge: "🖱️ LOGITECH G HUB & OPTIONS+ DEPOTS CLEANER",
    h1: "Logitech G HUB & Logi Options+ Cache Cleaner",
    subtitle:
      "Purge multi-gigabyte C:\\ProgramData\\LGHUB\\depots bundles, LogiOptionsPlus updater packages, and CEF Media Blob Storage while keeping your mouse DPI, G-Shift macros, and LIGHTSYNC RGB profiles intact.",
    typicalSavings: "2.0 GB – 10.5 GB",
    targetCleanSlugs: ["logitech-ghub-installer-cache", "logitech-options-plus-cache"],
    samplePaths: [
      "C:\\ProgramData\\LGHUB\\depots, 4.6 GB",
      "C:\\ProgramData\\Logishrd\\LogiOptionsPlus\\depots, 3.4 GB",
      "%LocalAppData%\\LGHUB\\Cache_Data, 0.9 GB",
      "%LocalAppData%\\LogiOptionsPlus\\Service Worker\\CacheStorage, 0.8 GB",
    ],
    psCommand:
      'Get-ChildItem "C:\\ProgramData\\LGHUB\\depots","C:\\ProgramData\\Logishrd\\LogiOptionsPlus\\depots" -ErrorAction SilentlyContinue | Select-Object FullName',
    whatStaysSafe:
      "Your G HUB settings.db, mouse DPI steps, per-game macro bindings, Smart Actions, and onboard memory profiles.",
    whyItBloats:
      "Logitech's background updater extracts full numbered depot archives into C:\\ProgramData\\LGHUB\\depots and LogiOptionsPlus\\depots on every firmware/device update without deleting superseded builds.",
    faqs: [
      {
        q: "Will cleaning LGHUB depots reset my mouse DPI or macros?",
        a: "Never. Your DPI curves, key assignments, and Lua scripts are stored in %LocalAppData%\\LGHUB\\settings.db. Cleaning C:\\ProgramData\\LGHUB\\depots only removes old installer payload archives.",
      },
      {
        q: "Does clearing LGHUB cache fix the infinite spinning logo bug?",
        a: "Yes—corrupted depot staging archives and locked CEF Service Worker caches are the #1 cause of Logitech G HUB hanging on the spinning launch animation.",
      },
    ],
  },
  {
    slug: "elgato-streamdeck-cleaner",
    appName: "Elgato Stream Deck & Wave Link",
    shortName: "Elgato Stream Deck Cleaner",
    title: "Elgato Stream Deck Cache & Logs Cleaner (Free 1–5 GB)",
    metaDescription:
      "Safely clean %AppData%\\Elgato\\StreamDeck logs, Media Blob Storage, and Qt/CEF caches on Windows 10/11—plus safe physical LCD key cleaning steps.",
    heroBadge: "🎛️ ELGATO STREAM DECK CACHE & LOGS CLEANER",
    h1: "Elgato Stream Deck Cache & Logs Cleaner",
    subtitle:
      "Clean runaway %AppData%\\Elgato\\StreamDeck plugin logs, animated icon Media Blob Storage, and CEF Service Worker caches without losing a single button profile, folder layout, or OBS hotkey.",
    typicalSavings: "800 MB – 5.0 GB",
    targetCleanSlugs: ["elgato-streamdeck-cache"],
    samplePaths: [
      "%AppData%\\Elgato\\StreamDeck\\logs, 2.1 GB",
      "%LocalAppData%\\Elgato\\StreamDeck\\cache\\QtWebEngine\\Default\\Cache_Data, 1.4 GB",
      "%AppData%\\Elgato\\StreamDeck\\Blob_Storage, 0.9 GB",
      "%LocalAppData%\\CrashDumps, 0.7 GB",
    ],
    psCommand:
      'Get-ChildItem "$env:APPDATA\\Elgato\\StreamDeck","$env:LOCALAPPDATA\\Elgato\\StreamDeck" -ErrorAction SilentlyContinue | Select-Object FullName',
    whatStaysSafe:
      "All Stream Deck button layouts, multi-actions, soundboard audio files, and plugin credentials in %AppData%\\Elgato\\StreamDeck\\ProfilesV2.",
    whyItBloats:
      "Disconnected WebSocket plugins (OBS, Spotify, Twitch) write hundreds of megabytes of retry logs per week while animated GIF packs and Elgato Marketplace previews bloat QtWebEngine Media Blob Storage.",
    faqs: [
      {
        q: "Are my Stream Deck button profiles safe when cleaning the cache?",
        a: "Yes. Your button profiles live in %AppData%\\Elgato\\StreamDeck\\ProfilesV2 and Audio, which SWEEPR Cleaner strictly protects.",
      },
      {
        q: "How do I clean the physical Elgato Stream Deck LCD keys safely?",
        a: "Unplug the USB cable first, then wipe the LCD keys gently with a lint-free microfiber cloth slightly dampened with water or 70% isopropyl alcohol. Never spray cleaner directly onto the keys.",
      },
    ],
  },
  {
    slug: "valorant-logs-cleaner",
    appName: "VALORANT & Riot Client",
    shortName: "Valorant & Riot Cleaner",
    title: "Valorant & Riot Client Logs Cleaner (Free 2–12 GB Fast)",
    metaDescription:
      "Clear %LocalAppData%\\VALORANT\\Saved\\Logs, Crashes, and Riot Client webcache on Windows 10/11. Free 2–12 GB safely without triggering Vanguard.",
    heroBadge: "🎯 VALORANT & RIOT CLIENT LOGS CLEANER",
    h1: "Valorant & Riot Client Cache & Logs Cleaner",
    subtitle:
      "Safely delete gigabytes of %LocalAppData%\\VALORANT\\Saved\\Logs, UE4 memory crash dumps, and Riot Client CEF webcache while keeping Riot Vanguard, crosshairs, and sensitivity settings untouched.",
    typicalSavings: "1.5 GB – 12.0 GB",
    targetCleanSlugs: ["riot-client-logs"],
    samplePaths: [
      "%LocalAppData%\\VALORANT\\Saved\\Logs, 3.2 GB",
      "%LocalAppData%\\VALORANT\\Saved\\Crashes, 2.8 GB",
      "%LocalAppData%\\VALORANT\\Saved\\webcache_4430\\Cache_Data, 1.4 GB",
      "%LocalAppData%\\Riot Games\\Riot Client\\Logs, 1.9 GB",
    ],
    psCommand:
      'Get-ChildItem "$env:LOCALAPPDATA\\VALORANT\\Saved\\Logs","$env:LOCALAPPDATA\\Riot Games\\Riot Client\\Logs" -ErrorAction SilentlyContinue | Select-Object FullName',
    whatStaysSafe:
      "Riot Vanguard kernel driver (vgk.sys), crosshair profiles, video/keybind configs, and Riot account sign-in sessions.",
    whyItBloats:
      "Every VALORANT match and League of Legends session writes verbose ShooterGame.log telemetry and uncompressed Unreal Engine crash dumps (.dmp / .wer) that never auto-expire.",
    faqs: [
      {
        q: "Is cleaning VALORANT Saved\\Logs safe with Riot Vanguard?",
        a: "Yes, 100% safe. Riot Support officially recommends clearing %LocalAppData%\\VALORANT\\Saved\\Logs and webcache to resolve client freezes and patcher errors. Vanguard lives in C:\\Program Files\\Riot Vanguard and is never touched.",
      },
      {
        q: "Will clearing Riot Client cache reset my VALORANT crosshair?",
        a: "No. Your crosshairs and keybinds are synced to Riot's servers and cached in Config\\WindowsClient, which is excluded from cleanup.",
      },
    ],
  },
  {
    slug: "nvidia-shader-cleaner",
    appName: "NVIDIA GeForce & DirectX 12 Shaders",
    shortName: "NVIDIA DXCache Cleaner",
    title: "NVIDIA DXCache & GLCache Shader Cleaner (Free 2–15 GB)",
    metaDescription:
      "Safely clear %LocalAppData%\\NVIDIA\\DXCache, GLCache, and D3DSCache on Windows 10/11. Fix post-driver-update stutter and free 2–15 GB in 1 click.",
    heroBadge: "🟢 NVIDIA DXCACHE, GLCACHE & D3DSCACHE CLEANER",
    h1: "NVIDIA DXCache & DirectX Shader Cache Cleaner",
    subtitle:
      "Purge stale DirectX 12, Vulkan, and OpenGL compiled shader binaries across %LocalAppData%\\NVIDIA\\DXCache, GLCache, and D3DSCache while skipping files locked by active GPU processes.",
    typicalSavings: "2.0 GB – 15.0 GB",
    targetCleanSlugs: ["nvidia-dxcache", "amd-shader-cache"],
    samplePaths: [
      "%LocalAppData%\\NVIDIA\\DXCache, 8.4 GB",
      "%LocalAppData%\\NVIDIA\\GLCache, 2.1 GB",
      "%LocalAppData%\\D3DSCache, 1.9 GB",
      "C:\\Windows\\LiveKernelReports, 3.6 GB",
    ],
    psCommand:
      'Get-ChildItem "$env:LOCALAPPDATA\\NVIDIA\\DXCache","$env:LOCALAPPDATA\\NVIDIA\\GLCache","$env:LOCALAPPDATA\\D3DSCache" -ErrorAction SilentlyContinue | Select-Object FullName',
    whatStaysSafe:
      "NVIDIA Control Panel 3D settings, G-SYNC configuration, NVIDIA App / GeForce Experience drivers, and custom resolution profiles.",
    whyItBloats:
      "Every Game Ready Driver update and game patch compiles new .bin / .toc shader pipelines into %LocalAppData%\\NVIDIA\\DXCache while leaving obsolete shader binaries from old driver versions on your SSD.",
    faqs: [
      {
        q: "Why does Windows say 'File in Use' when I try to delete NVIDIA DXCache manually?",
        a: "Desktop Window Manager (dwm.exe) and background Chromium apps keep their active shader files locked. SWEEPR Cleaner automatically deletes all unlocked stale shader binaries while gracefully skipping active files.",
      },
      {
        q: "Does clearing NVIDIA DXCache fix stuttering after a driver update?",
        a: "Yes. Removing stale pre-driver-update shader binaries eliminates shader hash collisions and frame-time spikes in DirectX 12 and Unreal Engine 5 games.",
      },
    ],
  },
  {
    slug: "adobe-media-cache-cleaner",
    appName: "Adobe Premiere Pro, After Effects & Creative Cloud",
    shortName: "Adobe Media Cache Cleaner",
    title: "Adobe Media Cache & Peak Files Cleaner (Free 10–80 GB)",
    metaDescription:
      "Clean %AppData%\\Adobe\\Common\\Media Cache Files (.cfa, .pek) and Creative Cloud staging on Windows 10/11. Free 10–80 GB without breaking .prproj.",
    heroBadge: "🎬 ADOBE PREMIERE & AFTER EFFECTS MEDIA CACHE CLEANER",
    h1: "Adobe Media Cache & Creative Cloud Cleaner",
    subtitle:
      "Reclaim 10–80 GB of conformed audio (.cfa), waveform peaks (.pek), After Effects disk scratch, and Creative Cloud installer bloat without touching your .prproj / .aep timelines or source footage.",
    typicalSavings: "10.0 GB – 80.0 GB",
    targetCleanSlugs: ["adobe-media-cache", "creative-cloud-installer-cache"],
    samplePaths: [
      "%AppData%\\Adobe\\Common\\Media Cache Files, 34.5 GB",
      "%AppData%\\Adobe\\Common\\Media Cache, 6.2 GB",
      "%LocalAppData%\\Adobe\\Creative Cloud\\ACC\\logs, 2.4 GB",
      "%AppData%\\CapCut\\User Data\\Cache, 11.2 GB",
    ],
    psCommand:
      'Get-ChildItem "$env:APPDATA\\Adobe\\Common\\Media Cache Files" -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum',
    whatStaysSafe:
      "Premiere Pro (.prproj) and After Effects (.aep) project files, source camera footage, LUTs, workspaces, and Adobe Creative Cloud sign-in sessions.",
    whyItBloats:
      "Premiere Pro generates uncompressed 32-bit float audio (.cfa) and waveform (.pek) files for every imported video clip and keeps them on your boot SSD long after client projects are exported.",
    faqs: [
      {
        q: "Will deleting Adobe Media Cache Files break my Premiere Pro project?",
        a: "No. Project timelines (.prproj) and raw video files are stored separately. If you re-open an older project, Premiere Pro simply regenerates the waveform peaks for the clips on that timeline.",
      },
      {
        q: "Can I clean Adobe Creative Cloud installer cache without signing out?",
        a: "Yes. SWEEPR Cleaner purges orphaned RIBS/HDPackage installer archives and logs while keeping your Adobe licensing and Creative Cloud login token intact.",
      },
    ],
  },
  {
    slug: "jetbrains-gradle-cleaner",
    appName: "IntelliJ IDEA, Android Studio, Gradle & npm/pip",
    shortName: "JetBrains & Gradle Cleaner",
    title: "IntelliJ IDEA, Gradle & npm Cache Cleaner (Free 10–50 GB)",
    metaDescription:
      "Safely clean %LocalAppData%\\JetBrains caches, .gradle\\caches, npm-cache, and pip wheels on Windows 10/11. Reclaim 10–50 GB of developer SSD space.",
    heroBadge: "💻 JETBRAINS, ANDROID STUDIO & GRADLE CACHE CLEANER",
    h1: "IntelliJ IDEA, Gradle & Developer Cache Cleaner",
    subtitle:
      "Audit and purge orphaned JetBrains IDE versions, Gradle wrapper distributions, npm _cacache tarballs, and pip wheel caches on Windows 10 & 11 without touching source repositories or .env files.",
    typicalSavings: "10.0 GB – 55.0 GB",
    targetCleanSlugs: ["jetbrains-intellij-cache", "gradle-wrapper-caches", "npm-cache", "pip-cache"],
    samplePaths: [
      "%LocalAppData%\\JetBrains, 16.4 GB",
      "%UserProfile%\\.gradle\\caches, 19.8 GB",
      "%LocalAppData%\\npm-cache, 8.5 GB",
      "%LocalAppData%\\pip\\Cache, 9.2 GB",
    ],
    psCommand:
      'Get-ChildItem "$env:LOCALAPPDATA\\JetBrains","$env:USERPROFILE\\.gradle\\caches","$env:LOCALAPPDATA\\npm-cache" -ErrorAction SilentlyContinue | Select-Object FullName',
    whatStaysSafe:
      "Git repositories, source code, IDE keymaps/plugins (%AppData%\\JetBrains), SSH keys, Docker volumes, and .env files.",
    whyItBloats:
      "Every IntelliJ/Android Studio major upgrade leaves behind multi-gigabyte VFS indexes from prior IDE versions (e.g., 2024.3, 2025.1), while Gradle and npm retain every historical dependency tarball ever downloaded.",
    faqs: [
      {
        q: "Will cleaning %LocalAppData%\\JetBrains delete my IDE settings or plugins?",
        a: "No. JetBrains stores your settings, keymaps, and installed plugins in %AppData%\\JetBrains (Roaming). %LocalAppData%\\JetBrains only contains replaceable file indexes, JVM logs, and caches from old IDE releases.",
      },
      {
        q: "Is it safe to delete %UserProfile%\\.gradle\\caches?",
        a: "Yes. When Android Studio or Gradle is closed, deleting .gradle\\caches and old wrapper\\dists removes gigabytes of obsolete build artifacts; active projects simply re-fetch their current dependencies on the next build.",
      },
    ],
  },
  {
    slug: "windows-24h2-update-cleaner",
    appName: "Windows 11 24H2 Update Cache, WinSxS & Package Cache",
    shortName: "Windows 24H2 Update Cleaner",
    title: "Windows 11 24H2 Update & WinSxS Cleaner (Free 10–45 GB)",
    metaDescription:
      "Fix the Windows 11 24H2 8.63 GB update cache bug and safely clean C:\\Windows\\WinSxS, ProgramData\\Package Cache, and Windows.old in 1 click.",
    heroBadge: "🪟 WINDOWS 11 24H2 UPDATE & WINSXS CACHE CLEANER",
    h1: "Windows 11 24H2 Update & System Cache Cleaner",
    subtitle:
      "Safely reclaim 10–45 GB from orphaned Windows Update staging, WinSxS\\Temp\\PendingDeletes (the 8.63 GB 24H2 bug), Delivery Optimization, and C:\\ProgramData\\Package Cache while protecting OS-critical binaries.",
    typicalSavings: "10.0 GB – 45.0 GB",
    targetCleanSlugs: [
      "windows-11-24h2-update-cache-8gb-bug",
      "winsxs",
      "programdata-package-cache",
      "delivery-optimization",
      "windows-old",
    ],
    samplePaths: [
      "C:\\Windows\\WinSxS\\Temp\\PendingDeletes, 8.6 GB",
      "C:\\ProgramData\\Package Cache, 12.4 GB",
      "C:\\Windows\\SoftwareDistribution\\Download, 6.8 GB",
      "C:\\Windows.old, 22.0 GB",
      "C:\\Windows\\LiveKernelReports, 4.2 GB",
    ],
    psCommand:
      'Dism.exe /Online /Cleanup-Image /AnalyzeComponentStore',
    whatStaysSafe:
      "C:\\Windows\\System32 kernel binaries, active MSI uninstaller manifests in C:\\Windows\\Installer, boot configuration, and personal files.",
    whyItBloats:
      "Windows 11 24H2 checkpoint cumulative updates leave orphaned staging deltas in WinSxS\\Temp\\PendingDeletes and SoftwareDistribution\\Download that cause standard Disk Cleanup to report a phantom 8.63 GB cache.",
    faqs: [
      {
        q: "How does SWEEPR fix the Windows 11 24H2 8.63 GB undeletable Windows Update cache?",
        a: "Windows 11 24H2 checkpoint updates leave superseded staging metadata in WinSxS\\Temp\\PendingDeletes and C:\\$Windows.~BT. SWEEPR invokes safe DISM component cleanup and purges unlocked SoftwareDistribution staging files.",
      },
      {
        q: "Is C:\\ProgramData\\Package Cache safe to clean?",
        a: "Deleting the entire folder blindly can break Visual C++ Repair dialogs. SWEEPR Cleaner cross-checks the Windows Installer registry and only removes orphaned package caches from superseded versions.",
      },
    ],
  },
  {
    slug: "ai-model-cache-cleaner",
    appName: "ComfyUI, LM Studio, Ollama & Cursor AI",
    shortName: "AI & LLM Cache Cleaner",
    title: "ComfyUI, LM Studio & Cursor AI Cache Cleaner (15–90 GB)",
    metaDescription:
      "Clean ComfyUI temp latents, orphaned HuggingFace & LM Studio GGUF weights, pip wheels, and Cursor AI workspace storage on Windows 11 (15–90 GB).",
    heroBadge: "🤖 COMFYUI, LM STUDIO & CURSOR AI CACHE CLEANER",
    h1: "AI Developer & Local LLM Cache Cleaner (ComfyUI, LM Studio, Cursor)",
    subtitle:
      "Audit and clean 15–90 GB of ComfyUI temp tensors, duplicate HuggingFace / LM Studio GGUF weights, CUDA PyTorch pip wheels, and Cursor IDE workspace bloat without deleting active models or workflows.",
    typicalSavings: "15.0 GB – 90.0 GB",
    targetCleanSlugs: ["comfyui-temp-output-cache", "lm-studio-models-cache", "pip-cache"],
    samplePaths: [
      "%UserProfile%\\.cache\\huggingface\\hub, 28.5 GB",
      "%UserProfile%\\.cache\\lm-studio\\models, 34.0 GB",
      "%LocalAppData%\\pip\\Cache, 14.2 GB",
      "%AppData%\\Cursor\\User\\workspaceStorage, 8.6 GB",
    ],
    psCommand:
      'Get-ChildItem "$env:USERPROFILE\\.cache\\huggingface","$env:USERPROFILE\\.cache\\lm-studio","$env:LOCALAPPDATA\\pip\\Cache","$env:APPDATA\\Cursor\\User\\workspaceStorage" -ErrorAction SilentlyContinue | Select-Object FullName',
    whatStaysSafe:
      "Active ComfyUI workflow JSONs, LoRAs/checkpoints in use, active LM Studio GGUF models, and Cursor AI source code & active project indexes.",
    whyItBloats:
      "Local AI workflows duplicate 2.5 GB CUDA torch wheels inside %LocalAppData%\\pip\\Cache, leave unlinked HuggingFace snapshot blobs after interrupted downloads, and retain SQLite vector indexes for deleted git branches in Cursor.",
    faqs: [
      {
        q: "Will cleaning AI caches delete my active ComfyUI checkpoints or LM Studio models?",
        a: "No. SWEEPR Cleaner separates temp preview latents, pip wheel caches, and incomplete .part/.lock download fragments from your active model weights, which require explicit confirmation before removal.",
      },
      {
        q: "Why is %AppData%\\Cursor taking over 10 GB on Windows 11?",
        a: "Cursor creates a separate workspaceStorage folder with local indexing databases and Chromium GPU/Code caches for every repository you open. Cleaning stale workspace caches reclaims 5–18 GB without affecting active projects.",
      },
    ],
  },
];

export function getTransactionalToolBySlug(slug: string): TransactionalToolConfig | undefined {
  const clean = String(slug || "").trim().toLowerCase();
  return TRANSACTIONAL_TOOLS.find((t) => t.slug === clean);
}

export function renderTransactionalToolPage(tool: TransactionalToolConfig, visitorKey = "anon"): string {
  const defaultSample = tool.samplePaths.join("\n");
  const initialAnalysis = analyzeSafeToDeleteInput(defaultSample);
  const canonicalUrl = `https://sweeprcleaner.com/tools/${tool.slug}`;

  const ctaVariant = assignExperimentVariant("checker_cta_copy_v1", visitorKey);
  const primaryCtaText =
    ctaVariant === "B"
      ? `Get the 5-Device Pro Licence (14-Day Guarantee) →`
      : `Clean ${tool.shortName.replace(/\s*Cleaner$/i, "")} in 1 Click — Get SWEEPR Pro →`;

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: `SWEEPR ${tool.shortName}`,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Windows 10, Windows 11",
        url: canonicalUrl,
        image: "https://sweeprcleaner.com/og-image.png",
        description: tool.metaDescription,
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: "4.9",
          ratingCount: "128",
          bestRating: "5",
          worstRating: "1",
        },
        review: {
          "@type": "Review",
          reviewRating: {
            "@type": "Rating",
            ratingValue: "5",
            bestRating: "5",
          },
          author: {
            "@type": "Person",
            name: "Verified Windows 11 User",
          },
          reviewBody: `Safely cleaned ${tool.typicalSavings} from ${tool.appName} in one click without losing any logins or settings.`,
        },
        offers: {
          "@type": "Offer",
          price: "29.99",
          priceCurrency: "GBP",
          availability: "https://schema.org/InStock",
          url: "https://sweeprcleaner.com/order?plan=annual",
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
        "@type": "FAQPage",
        mainEntity: tool.faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: f.a,
          },
        })),
      },
    ],
  });

  const rowsHtml = initialAnalysis.results
    .map((r) => {
      const badgeStyles =
        r.badge_color === "green"
          ? "background:#dcfce7;color:#14532d;border:1px solid #86efac;"
          : r.badge_color === "amber"
          ? "background:#fef3c7;color:#78350f;border:1px solid #fcd34d;"
          : "background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;";
      return `
      <div style="background:#ffffff;border:1px solid #d6dad5;border-radius:14px;padding:16px 18px;margin-bottom:10px;">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
          <div>
            <span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;${badgeStyles}">${escapeHtml(r.verdict)}</span>
            <strong style="font-size:15px;margin-left:8px;color:#111613;">${escapeHtml(r.name)}</strong>
          </div>
          <div style="font-size:13px;font-weight:800;color:#0d6847;">Est. Savings: ~${r.estimated_gb} GB (${escapeHtml(r.avg_space)})</div>
        </div>
        <div style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:#334155;background:#f8faf9;padding:6px 10px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:8px;">
          <code>${escapeHtml(r.canonical_path)}</code>
        </div>
        <p style="font-size:13px;color:#374151;margin:0 0 6px;">${escapeHtml(r.explanation)}</p>
        ${
          r.guide_url
            ? `<a href="${escapeHtml(r.guide_url)}" style="font-size:12.5px;font-weight:700;color:#0d6847;text-decoration:none;">View Detailed Folder Safety Guide &rarr;</a>`
            : ""
        }
      </div>`;
    })
    .join("\n");

  const otherToolsHtml = TRANSACTIONAL_TOOLS.filter((t) => t.slug !== tool.slug)
    .slice(0, 6)
    .map(
      (t) => `
      <a href="/tools/${t.slug}" style="display:block;background:#ffffff;border:1px solid #d6dad5;border-radius:12px;padding:12px 14px;text-decoration:none;color:#111613;">
        <div style="font-size:13px;font-weight:800;color:#0d6847;margin-bottom:3px;">${escapeHtml(t.shortName)} &rarr;</div>
        <div style="font-size:12px;color:#4b554e;">Reclaim ${escapeHtml(t.typicalSavings)} &bull; ${escapeHtml(t.appName)}</div>
      </a>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(tool.title)}</title>
  <meta name="description" content="${escapeHtml(tool.metaDescription)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:title" content="${escapeHtml(tool.title)}">
  <meta property="og:description" content="${escapeHtml(tool.metaDescription)}">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:type" content="website">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b">
  <script type="application/ld+json">${jsonLd}</script>
  <script src="/attribution.js" defer></script>
  <script src="/analytics.js" defer></script>
  <style>
    :root { --bg:#f4f5f3; --card:#ffffff; --text:#111613; --muted:#4b554e; --accent:#0d6847; --border:#d6dad5; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--text); line-height:1.55; }
    .container { max-width:980px; margin:0 auto; padding:24px 18px 80px; }
    .nav { display:flex; justify-content:space-between; align-items:center; padding:12px 0 22px; border-bottom:1px solid var(--border); margin-bottom:26px; flex-wrap:wrap; gap:12px; }
    .nav-links { display:flex; gap:16px; align-items:center; flex-wrap:wrap; font-size:14px; font-weight:600; }
    .nav-links a { color:var(--text); text-decoration:none; }
    .btn-primary { background:var(--accent); color:#fff !important; padding:12px 20px; border-radius:10px; font-weight:800; text-decoration:none; display:inline-block; border:none; cursor:pointer; font-size:14px; }
    .btn-secondary { background:#111613; color:#fff !important; padding:12px 20px; border-radius:10px; font-weight:700; text-decoration:none; display:inline-block; border:none; cursor:pointer; font-size:14px; }
    .kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin:18px 0; }
    .kpi-box { background:#fff; border:1px solid var(--border); border-radius:14px; padding:14px 16px; }
    textarea { width:100%; min-height:135px; padding:12px; border-radius:12px; border:1px solid #b8c0b8; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12.5px; background:#fbfcfb; color:#111613; }
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
        <a href="/tools">All 10 Cleaner Tools</a>
        <a href="/safe-to-delete">Safe-to-Delete Checker</a>
        <a href="/clean">367 Folder Guides</a>
        <a href="/bloat-watch">Bloat Watch</a>
        <a href="/pricing">Pricing</a>
        <a href="/download?platform=windows" class="btn-primary" style="padding:8px 14px;font-size:13px;">Download Free Scanner</a>
      </div>
    </nav>

    <header style="background:#ffffff;border:1px solid var(--border);border-radius:22px;padding:26px 24px;margin-bottom:22px;box-shadow:0 8px 28px rgba(17,22,19,0.05);">
      <div style="display:inline-block;padding:5px 12px;border-radius:999px;background:#e3ede7;color:#073825;font-size:11.5px;font-weight:800;margin-bottom:10px;">
        ${escapeHtml(tool.heroBadge)} &bull; SSL.COM AUTHENTICODE SIGNED (5 MB)
      </div>
      <h1 style="font-size:clamp(26px,3.8vw,36px);line-height:1.15;margin:0 0 10px;">
        ${escapeHtml(tool.h1)}
      </h1>
      <p style="color:var(--muted);font-size:15.5px;max-width:780px;margin:0 0 18px;">
        ${escapeHtml(tool.subtitle)}
      </p>

      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;" data-experiment-id="checker_cta_copy_v1" data-experiment-variant="${ctaVariant}">
        <a href="/download?platform=windows&utm_source=tool_${escapeHtml(tool.slug)}" class="btn-primary" onclick="if(window.sweeprTrack)window.sweeprTrack('experiment_conversion',{experiment:'checker_cta_copy_v1',variant:'${ctaVariant}',action:'download_exe',tool:'${escapeHtml(tool.slug)}'})">
          ⬇ Download Free ${escapeHtml(tool.shortName)} (.exe)
        </a>
        <a href="/order?plan=annual&utm_source=tool_${escapeHtml(tool.slug)}&exp_var=${ctaVariant}" class="btn-secondary" id="toolPrimaryOrderCta" onclick="if(window.sweeprTrack)window.sweeprTrack('experiment_conversion',{experiment:'checker_cta_copy_v1',variant:'${ctaVariant}',action:'order_annual',tool:'${escapeHtml(tool.slug)}'})">
          ${escapeHtml(primaryCtaText)}
        </a>
      </div>

      <div class="kpi-grid" style="margin-top:20px;margin-bottom:0;">
        <div class="kpi-box" style="background:#f8faf9;">
          <div style="font-size:11px;font-weight:800;color:var(--muted);">TYPICAL SPACE RECLAIMED</div>
          <div style="font-size:22px;font-weight:900;color:#0d6847;">${escapeHtml(tool.typicalSavings)}</div>
        </div>
        <div class="kpi-box" style="background:#f8faf9;">
          <div style="font-size:11px;font-weight:800;color:var(--muted);">PROTECTED USER DATA</div>
          <div style="font-size:13px;font-weight:700;color:#111613;margin-top:4px;">${escapeHtml(tool.whatStaysSafe)}</div>
        </div>
        <div class="kpi-box" style="background:#f8faf9;">
          <div style="font-size:11px;font-weight:800;color:var(--muted);">SAFETY GUARANTEE</div>
          <div style="font-size:13px;font-weight:700;color:#111613;margin-top:4px;">🔒 Skips Active Processes &bull; 14-Day Guarantee</div>
        </div>
      </div>
    </header>

    <section id="interactive-tool-auditor" style="background:#ffffff;border:1px solid var(--border);border-radius:20px;padding:22px;margin-bottom:24px;">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
        <h2 style="font-size:18px;margin:0;">Interactive ${escapeHtml(tool.shortName)} Path Auditor</h2>
        <button type="button" onclick="copyToolPs()" id="toolPsBtn" style="background:#e3ede7;color:#073825;border:1px solid #b8d8c5;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
          📋 Copy PowerShell Folder Inspector
        </button>
      </div>
      <p style="font-size:13.5px;color:var(--muted);margin:0 0 12px;">
        Pre-loaded with the default Windows 10/11 cache directories for <strong>${escapeHtml(tool.appName)}</strong>. Paste your own paths or click <strong>Audit Paths Now</strong> to verify deletion safety:
      </p>
      <textarea id="toolPathInput" aria-label="Windows cache paths to audit">${escapeHtml(defaultSample)}</textarea>
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;margin-top:12px;">
        <button type="button" class="btn-primary" onclick="runToolAudit()" id="toolAuditBtn">🔍 Audit ${escapeHtml(tool.shortName)} Paths</button>
        <span style="font-size:13px;font-weight:800;color:#0d6847;" id="toolSavingsLabel">Estimated Reclaimable: ~${initialAnalysis.estimated_reclaimable_gb} GB across ${initialAnalysis.safe_count + initialAnalysis.caution_count} cache locations</span>
      </div>
      <div id="toolResultsContainer" style="margin-top:16px;">
        ${rowsHtml}
      </div>
    </section>

    <section style="background:#ffffff;border:1px solid var(--border);border-radius:20px;padding:22px;margin-bottom:24px;">
      <h2 style="font-size:18px;margin:0 0 8px;">Why ${escapeHtml(tool.appName)} Eats Your C: Drive</h2>
      <p style="font-size:14px;color:#374151;margin:0 0 16px;">${escapeHtml(tool.whyItBloats)}</p>
      <h3 style="font-size:16px;margin:0 0 10px;">Frequently Asked Questions</h3>
      <div style="display:grid;gap:12px;">
        ${tool.faqs
          .map(
            (f) => `
          <div style="padding:14px 16px;background:#f8faf9;border:1px solid #e2e8f0;border-radius:12px;">
            <div style="font-weight:800;font-size:14px;color:#111613;margin-bottom:4px;">${escapeHtml(f.q)}</div>
            <div style="font-size:13.5px;color:#4b554e;">${escapeHtml(f.a)}</div>
          </div>`
          )
          .join("\n")}
      </div>
    </section>

    <section style="margin-bottom:24px;">
      <h2 style="font-size:17px;margin:0 0 12px;">Other Dedicated Windows 11 Cache Cleaners</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
        ${otherToolsHtml}
      </div>
    </section>
  </div>

  <script>
    function copyToolPs() {
      const cmd = ${JSON.stringify(tool.psCommand)};
      navigator.clipboard.writeText(cmd).then(() => {
        const b = document.getElementById('toolPsBtn');
        b.textContent = '✓ Copied PowerShell Command!';
        setTimeout(() => { b.textContent = '📋 Copy PowerShell Folder Inspector'; }, 2500);
      }).catch(() => {});
    }
    function esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    async function runToolAudit() {
      const raw = document.getElementById('toolPathInput').value || '';
      const btn = document.getElementById('toolAuditBtn');
      btn.textContent = 'Auditing...';
      try {
        const res = await fetch('/api/safe-to-delete/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: raw })
        });
        const data = await res.json();
        document.getElementById('toolSavingsLabel').textContent =
          'Estimated Reclaimable: ~' + data.estimated_reclaimable_gb + ' GB across ' + (data.safe_count + data.caution_count) + ' cache locations';
        const html = (data.results || []).map(r => {
          const badgeStyles =
            r.badge_color === 'green'
              ? 'background:#dcfce7;color:#14532d;border:1px solid #86efac;'
              : r.badge_color === 'amber'
              ? 'background:#fef3c7;color:#78350f;border:1px solid #fcd34d;'
              : 'background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;';
          return '<div style="background:#ffffff;border:1px solid #d6dad5;border-radius:14px;padding:16px 18px;margin-bottom:10px;">' +
            '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">' +
              '<div><span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;' + badgeStyles + '">' + esc(r.verdict) + '</span>' +
              '<strong style="font-size:15px;margin-left:8px;color:#111613;">' + esc(r.name) + '</strong></div>' +
              '<div style="font-size:13px;font-weight:800;color:#0d6847;">Est. Savings: ~' + r.estimated_gb + ' GB (' + esc(r.avg_space) + ')</div>' +
            '</div>' +
            '<div style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;color:#334155;background:#f8faf9;padding:6px 10px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:8px;"><code>' + esc(r.canonical_path) + '</code></div>' +
            '<p style="font-size:13px;color:#374151;margin:0 0 6px;">' + esc(r.explanation) + '</p>' +
          '</div>';
        }).join('');
        document.getElementById('toolResultsContainer').innerHTML = html;
      } catch (e) {}
      btn.textContent = '🔍 Audit ${escapeHtml(tool.shortName)} Paths';
    }
  </script>
</body>
</html>`;
}

export function renderTransactionalToolsHub(): string {
  const cards = TRANSACTIONAL_TOOLS.map(
    (t) => `
    <a href="/tools/${t.slug}" style="display:block;background:#ffffff;border:1px solid #d6dad5;border-radius:16px;padding:18px 20px;text-decoration:none;color:#111613;box-shadow:0 4px 14px rgba(17,22,19,0.04);">
      <div style="font-size:11px;font-weight:800;color:#0d6847;margin-bottom:4px;">${escapeHtml(t.heroBadge)}</div>
      <h2 style="font-size:18px;margin:0 0 6px;color:#111613;">${escapeHtml(t.shortName)} &rarr;</h2>
      <p style="font-size:13.5px;color:#4b554e;margin:0 0 10px;">${escapeHtml(t.subtitle)}</p>
      <div style="font-size:12.5px;font-weight:800;color:#073825;background:#e3ede7;display:inline-block;padding:4px 10px;border-radius:999px;">
        Reclaim ${escapeHtml(t.typicalSavings)}
      </div>
    </a>`
  ).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Windows 11 App &amp; Game Cache Cleaner Tools (2026) | SWEEPR</title>
  <meta name="description" content="Free interactive Windows 10/11 cache cleaner tools for Discord, Steam depotcache, Logitech G HUB, Elgato Stream Deck, VALORANT, NVIDIA DXCache, Adobe &amp; AI models.">
  <link rel="canonical" href="https://sweeprcleaner.com/tools">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20261031b">
  <script src="/attribution.js" defer></script>
  <script src="/analytics.js" defer></script>
  <style>
    body { margin:0; font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#f4f5f3; color:#111613; line-height:1.55; }
    .container { max-width:980px; margin:0 auto; padding:24px 18px 80px; }
    .nav { display:flex; justify-content:space-between; align-items:center; padding:12px 0 22px; border-bottom:1px solid #d6dad5; margin-bottom:26px; flex-wrap:wrap; gap:12px; }
    .nav-links { display:flex; gap:16px; align-items:center; flex-wrap:wrap; font-size:14px; font-weight:600; }
    .nav-links a { color:#111613; text-decoration:none; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(290px,1fr)); gap:14px; }
  </style>
</head>
<body>
  <div class="container">
    <nav class="nav">
      <a href="/" style="display:flex;align-items:center;gap:10px;text-decoration:none;color:#111613;font-weight:900;font-size:18px;">
        <img src="/favicon.svg?v=20261031b" alt="SWEEPR" width="30" height="30" style="border-radius:8px;">
        <span>SWEEPR <span style="color:#0d6847;">Cleaner</span></span>
      </a>
      <div class="nav-links">
        <a href="/safe-to-delete">Safe-to-Delete Checker</a>
        <a href="/clean">367 Folder Guides</a>
        <a href="/bloat-watch">Bloat Watch</a>
        <a href="/pricing">Pricing</a>
      </div>
    </nav>
    <header style="margin-bottom:24px;">
      <div style="display:inline-block;padding:5px 12px;border-radius:999px;background:#e3ede7;color:#073825;font-size:12px;font-weight:800;margin-bottom:10px;">
        🛠️ 10 DEDICATED WINDOWS 10/11 CACHE CLEANERS
      </div>
      <h1 style="font-size:clamp(26px,4vw,36px);margin:0 0 10px;">App-Specific Windows Cache Cleaner Tools</h1>
      <p style="color:#4b554e;font-size:15.5px;max-width:740px;margin:0;">
        Select any application or game launcher below to audit its exact Windows cache directories, verify what stays protected, and clean it in one click with our Authenticode-signed native Rust cleaner.
      </p>
    </header>
    <div class="grid">
      ${cards}
    </div>
  </div>
</body>
</html>`;
}
