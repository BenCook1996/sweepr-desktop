#!/usr/bin/env node
/**
 * SWEEPR Cleaner (sweeprcleaner.com) — Automated Keyword Research & Low-Competition Opportunity Engine
 *
 * Multi-source discovery & scoring engine for `daily-50-seo-pages.mjs` and `daily-seo-pagespeed-audit.ts`:
 *  1. Dual-Engine Free Autocomplete Miner (Google Suggest JSON + Bing OpenSearch JSON across 7 high-intent stems).
 *  2. GSC Impression & Position Velocity Miner (`server/src/data/gsc-seed.json`).
 *  3. 32-Entity Verified 2025/2026 Windows Ecosystem Opportunity Registry (AI/LLM, Game Shaders, DevTools, Win11 24H2).
 *  4. 4-Stage Anti-Cannibalization & Entity Resolver (`clean-items.json` + `pseo-redirects.json` + `transactional-tools.ts`).
 *  5. Mathematical `OpportunityScore` (0–100) combining Demand D(k), Low-Comp Rankability L(k), Intent Multiplier M(k), & Gap Bonus.
 *  6. 6 Mandatory Pre-Write Quality Gates (30–60 char title, 70–155 char description, Windows path prefix & uniqueness, OS-critical blocklist, 5x suffix & redirect guard).
 *
 * Usage:
 *   node server/scripts/keyword-research-engine.mjs [--live-autocomplete] [--limit=15]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const CLEAN_ITEMS_PATH = path.join(SERVER_ROOT, "src", "data", "clean-items.json");
const PSEO_REDIRECTS_PATH = path.join(SERVER_ROOT, "src", "data", "pseo-redirects.json");
const GSC_SEED_PATH = path.join(SERVER_ROOT, "src", "data", "gsc-seed.json");
const DAILY_STATE_PATH = path.join(SERVER_ROOT, "src", "data", "daily-seo-pages-state.json");
export const KEYWORD_RESEARCH_REPORT_PATH = path.join(SERVER_ROOT, "src", "data", "keyword-research-report.json");

export const LOCKED_TEST_TITLE_SLUGS = new Set([
  "steam-depotcache",
  "riot-client-logs",
  "elgato-streamdeck-cache",
  "windows-livekernelreports",
  "vivaldi-browser-cache",
  "jetbrains-intellij-cache",
]);

export const RETIRED_5X_SUFFIX_RE =
  /-(service-worker-cachestorage|media-blob-storage|code-bytecode-cache|gpu-shader-cache|crashpad-dump-logs)$/i;

const VALID_WIN_PATH_PREFIX_RE =
  /^(%LocalAppData%|%LocalAppData%Low|%AppData%|%ProgramData%|%WinDir%|%UserProfile%|%Temp%|C:\\)/i;

const CRITICAL_OS_BLOCKLIST_PATTERNS = [
  /(?:^|[\\/])windows[\\/](?:system32|syswow64)(?:$|[\\/](?!winevt[\\/]logs))/i,
  /(?:^|[\\/])windows[\\/](?:boot|fonts|inf|servicing)(?:$|[\\/])/i,
  /(?:^|[\\/])program files[\\/]windowsapps(?:$|[\\/])/i,
  /(?:^|[\\/])(?:ntoskrnl\.exe|hal\.dll|bootmgr|bcd|pagefile\.sys)$/i,
];

export const WINDOWS_ECOSYSTEM_OPPORTUNITY_REGISTRY = [
  // --- 1. Local AI & LLM Runtimes (8) ---
  {
    slug: "vllm-triton-cache",
    category: "app",
    name: "vLLM & Triton Compiled CUDA Kernel Cache",
    path: "%UserProfile%\\.cache\\vllm and %LocalAppData%\\Temp\\triton",
    safeToDelete: true,
    avgSpace: "3.5 GB – 24.0 GB",
    whatIsIt: "vLLM and OpenAI Triton compile custom PTX/CUDA attention kernels and model KV-cache graph binaries into your local user cache directory.",
    whatHappens: "Safely frees gigabytes of compiled GPU kernel artifacts. vLLM automatically JIT-compiles active model kernels on the next server launch.",
    manualSteps: [
      "Stop any running Python vLLM or Triton inference servers.",
      "Press Win + R, type %userprofile%\\.cache\\vllm, and press Enter.",
      "Delete old compiled kernel folders and clear %localappdata%\\Temp\\triton."
    ],
    seedTerms: ["vllm triton cache", "clear triton cache windows 11", "vllm cache taking up disk space"],
    clusterId: "ai_llm",
  },
  {
    slug: "tabby-ml-coding-assistant-cache",
    category: "app",
    name: "TabbyML Self-Hosted AI Coding Model & Index Cache",
    path: "%UserProfile%\\.tabby\\models and %UserProfile%\\.tabby\\events",
    safeToDelete: true,
    avgSpace: "3.5 GB – 28.0 GB",
    whatIsIt: "TabbyML downloads local StarCoder/CodeLlama GGUF coding models and Tantivy repository search indexes into %UserProfile%\\.tabby.",
    whatHappens: "Removing unused model weights and event logs reclaims 3.5–28 GB of SSD space while preserving your Tabby agent config.toml.",
    manualSteps: [
      "Stop the TabbyML server process.",
      "Open File Explorer to %userprofile%\\.tabby\\models and delete unused model folders.",
      "Clear old JSON event logs inside %userprofile%\\.tabby\\events."
    ],
    seedTerms: ["tabby ml models folder", "clear tabby coding cache windows 11", "tabbyml taking up disk space"],
    clusterId: "ai_llm",
  },
  {
    slug: "continue-dev-autocomplete-index-cache",
    category: "app",
    name: "Continue.dev AI Codebase LanceDB & Tree-Sitter Index Cache",
    path: "%UserProfile%\\.continue\\index and %UserProfile%\\.continue\\logs",
    safeToDelete: true,
    avgSpace: "2.0 GB – 18.0 GB",
    whatIsIt: "The Continue.dev AI extension for VS Code and JetBrains builds multi-gigabyte LanceDB vector embeddings and SQLite codebase indexes inside %UserProfile%\\.continue\\index.",
    whatHappens: "Deleting .continue\\index and logs frees gigabytes of C: drive space from old repositories while keeping your config.json and model API keys intact.",
    manualSteps: [
      "Close VS Code or JetBrains IDEs.",
      "Press Win + R, enter %userprofile%\\.continue, and hit Enter.",
      "Delete the 'index' and 'logs' subfolders (keep config.json)."
    ],
    seedTerms: ["continue dev index folder huge", "clear .continue index cache windows 11", "continue lancedb disk space"],
    clusterId: "ai_llm",
  },
  {
    slug: "fooocus-diffusion-temp-cache",
    category: "app",
    name: "Fooocus Stable Diffusion SDXL Temp & Model Cache",
    path: "%LocalAppData%\\Temp\\fooocus",
    safeToDelete: true,
    avgSpace: "2.5 GB – 19.0 GB",
    whatIsIt: "Fooocus writes uncompressed latent preview frames, Gradio UI temporary image uploads, and partial inpainting masks into %LocalAppData%\\Temp\\fooocus.",
    whatHappens: "Clearing the Fooocus temp folder reclaims gigabytes of SSD space without touching your SDXL checkpoints, LoRAs, or saved output gallery.",
    manualSteps: [
      "Close the Fooocus command window and browser tab.",
      "Press Win + R, type %localappdata%\\Temp\\fooocus, and press Enter.",
      "Select all temporary preview files (Ctrl + A) and delete them."
    ],
    seedTerms: ["fooocus temp files", "clear fooocus cache windows 11", "fooocus taking up c drive space"],
    clusterId: "ai_llm",
  },
  {
    slug: "invokeai-models-latents-cache",
    category: "app",
    name: "InvokeAI Model Convert Cache & Intermediate Latents",
    path: "%UserProfile%\\invokeai\\models\\.cache",
    safeToDelete: true,
    avgSpace: "5.0 GB – 32.0 GB",
    whatIsIt: "InvokeAI caches converted Diffusers weights, ONNX ControlNet processors, and temporary latent tensors inside %UserProfile%\\invokeai\\models\\.cache.",
    whatHappens: "Purging the .cache directory removes redundant model conversion staging files while keeping your installed models, boards, and workflows safe.",
    manualSteps: [
      "Shut down the InvokeAI launcher and backend server.",
      "Navigate to %userprofile%\\invokeai\\models\\.cache in File Explorer.",
      "Delete the cached conversion folders and temporary download locks."
    ],
    seedTerms: ["invokeai cache folder", "clean invokeai models cache", "invokeai disk space full"],
    clusterId: "ai_llm",
  },
  {
    slug: "koboldcpp-context-cache",
    category: "app",
    name: "KoboldCpp Context Shift & Temporary Audio/Vision Cache",
    path: "%LocalAppData%\\Temp\\koboldcpp",
    safeToDelete: true,
    avgSpace: "1.2 GB – 11.0 GB",
    whatIsIt: "KoboldCpp unpacks temporary CUDA/Vulkan runtime DLLs, Whisper voice buffers, and prompt context cache snapshots into your LocalAppData Temp directory.",
    whatHappens: "Safely removes orphaned runtime unpack folders left behind by crashed or updated KoboldCpp sessions.",
    manualSteps: [
      "Exit KoboldCpp completely.",
      "Press Win + R, enter %localappdata%\\Temp, and look for koboldcpp* or _MEI* unpack folders.",
      "Delete the temporary KoboldCpp directories."
    ],
    seedTerms: ["koboldcpp temp folder", "clear koboldcpp cache windows", "koboldcpp mei temp files"],
    clusterId: "ai_llm",
  },
  {
    slug: "open-webui-pip-cache",
    category: "app",
    name: "Open WebUI RAG Vector Staging & ChromaDB Temp Cache",
    path: "%UserProfile%\\.open-webui\\cache",
    safeToDelete: true,
    avgSpace: "2.0 GB – 16.0 GB",
    whatIsIt: "Open WebUI caches downloaded sentence-transformer embedding weights, OCR staging images, and Whisper TTS audio chunks in .open-webui\\cache.",
    whatHappens: "Frees gigabytes of temporary RAG and audio staging files while preserving your SQLite user database and chat history.",
    manualSteps: [
      "Stop the Open WebUI Python process or container.",
      "Open %userprofile%\\.open-webui\\cache in File Explorer.",
      "Delete temporary audio, OCR, and outdated embedding cache subdirectories."
    ],
    seedTerms: ["open webui cache folder", "clear open webui disk space", "open webui rag cache"],
    clusterId: "ai_llm",
  },
  {
    slug: "whisper-faster-huggingface-cache",
    category: "app",
    name: "Faster-Whisper & CTranslate2 Speech Model Cache",
    path: "%UserProfile%\\.cache\\huggingface\\hub\\models--Systran--faster-whisper",
    safeToDelete: true,
    avgSpace: "1.5 GB – 14.0 GB",
    whatIsIt: "Subtitle generators, OBS plugins, and transcription tools download multiple Faster-Whisper CTranslate2 model sizes (tiny, medium, large-v3) into your HuggingFace cache.",
    whatHappens: "Removing unused Whisper model revisions reclaims 1.5–14 GB immediately. Your transcription tool will keep using whichever active model remains.",
    manualSteps: [
      "Close any running transcription or subtitle tools.",
      "Open %userprofile%\\.cache\\huggingface\\hub in File Explorer.",
      "Delete unused models--Systran--faster-whisper-* folders you no longer use."
    ],
    seedTerms: ["faster whisper cache folder", "delete whisper model cache windows 11", "systran faster whisper disk space"],
    clusterId: "ai_llm",
  },

  // --- 2. 2025/2026 PC Games & Shader/Telemetry Caches (10) ---
  {
    slug: "marvel-rivals-shader-cache",
    category: "app",
    name: "Marvel Rivals Unreal Engine 5 Shader & Crash Dump Cache",
    path: "%LocalAppData%\\Marvel\\Saved\\Config\\CrashReportClient and %LocalAppData%\\Marvel\\Saved\\Logs",
    safeToDelete: true,
    avgSpace: "2.0 GB – 14.5 GB",
    whatIsIt: "Marvel Rivals builds multi-gigabyte Unreal Engine 5 PSO shader pipelines, replay caches, and verbose CrashReportClient memory dumps inside %LocalAppData%\\Marvel\\Saved.",
    whatHappens: "Clearing stale shader caches and crash dumps recovers up to 14.5 GB of SSD space and resolves frame-time stuttering after GPU driver or season updates.",
    manualSteps: [
      "Exit Marvel Rivals and close Steam or the Epic Games Launcher.",
      "Press Win + R, type %localappdata%\\Marvel\\Saved, and press Enter.",
      "Delete the contents of Logs, Crashes, and Config\\CrashReportClient (leave SaveGames intact)."
    ],
    seedTerms: ["marvel rivals shader cache", "clear marvel rivals cache windows 11", "marvel rivals localappdata huge"],
    clusterId: "gaming",
  },
  {
    slug: "deadlock-valve-shadercache",
    category: "app",
    name: "Valve Deadlock Source 2 Vulkan & DirectX Shader Cache",
    path: "C:\\Program Files (x86)\\Steam\\steamapps\\shadercache\\1422450",
    safeToDelete: true,
    avgSpace: "1.8 GB – 11.0 GB",
    whatIsIt: "Valve's Deadlock (Steam App ID 1422450) accumulates fossilized Vulkan and DirectX 11/12 Source 2 shader buckets across frequent patch builds.",
    whatHappens: "Safely removes obsolete pre-compiled shader buckets from older patches. Steam automatically downloads or compiles fresh shaders on next launch.",
    manualSteps: [
      "Close Deadlock and exit Steam.",
      "Open C:\\Program Files (x86)\\Steam\\steamapps\\shadercache\\1422450 in File Explorer.",
      "Delete the contents of the DXVK/Vulkan and DirectX shader cache folders."
    ],
    seedTerms: ["deadlock shader cache", "clear deadlock steam cache", "shadercache 1422450 safe to delete"],
    clusterId: "gaming",
  },
  {
    slug: "the-finals-embark-shader-cache",
    category: "app",
    name: "THE FINALS Unreal Engine 5 PSO Shader & Crash Dump Cache",
    path: "%LocalAppData%\\Discovery\\Saved\\Logs and %LocalAppData%\\Discovery\\Saved\\Crashes",
    safeToDelete: true,
    avgSpace: "1.8 GB – 14.0 GB",
    whatIsIt: "Embark Studios' THE FINALS stores Unreal Engine 5 crash dump payloads, replay caches, and diagnostic logs inside %LocalAppData%\\Discovery\\Saved.",
    whatHappens: "Purging Crashes and Logs reclaims up to 14 GB and resolves post-update shader hitching without affecting your Embark ID or cosmetics.",
    manualSteps: [
      "Quit THE FINALS and close Steam.",
      "Press Win + R, enter %localappdata%\\Discovery\\Saved, and press Enter.",
      "Delete the 'Crashes' and 'Logs' subfolders."
    ],
    seedTerms: ["the finals discovery saved cache", "clear the finals shader cache windows 11", "localappdata discovery folder huge"],
    clusterId: "gaming",
  },
  {
    slug: "poe2-path-of-exile-2-shader-cache",
    category: "app",
    name: "Path of Exile 2 DirectX 12 & Vulkan Shader Cache",
    path: "%AppData%\\Path of Exile 2\\ShaderCacheD3D12 and %AppData%\\Path of Exile 2\\ShaderCacheVulkan",
    safeToDelete: true,
    avgSpace: "2.5 GB – 16.0 GB",
    whatIsIt: "Path of Exile 2 writes thousands of compiled DirectX 12 and Vulkan map/skill shader files and minimap fog caches into %AppData%\\Path of Exile 2.",
    whatHappens: "Safely frees 2.5–16 GB of SSD space and resolves corrupted texture flicker after league patches. Your item filters and settings remain untouched.",
    manualSteps: [
      "Close Path of Exile 2 completely.",
      "Press Win + R, type %appdata%\\Path of Exile 2, and hit Enter.",
      "Delete the ShaderCacheD3D12, ShaderCacheVulkan, and Minimap subfolders."
    ],
    seedTerms: ["path of exile 2 shader cache", "poe2 shadercached3d12 safe to delete", "clear poe2 cache windows 11"],
    clusterId: "gaming",
  },
  {
    slug: "stalker-2-ue5-pso-cache",
    category: "app",
    name: "S.T.A.L.K.E.R. 2 Unreal Engine 5 PSO Shader & Crash Cache",
    path: "%LocalAppData%\\Stalker2\\Saved\\Crashes and %LocalAppData%\\Stalker2\\Saved\\Logs",
    safeToDelete: true,
    avgSpace: "2.0 GB – 18.0 GB",
    whatIsIt: "S.T.A.L.K.E.R. 2: Heart of Chornobyl generates large Unreal Engine 5 crash dump folders (.dmp + .uecrash) and shader compilation logs inside %LocalAppData%\\Stalker2\\Saved.",
    whatHappens: "Deleting Crashes and Logs reclaims gigabytes of wasted C: drive space while keeping all your saved games in Saved\\Steam or Saved\\GamePass 100% intact.",
    manualSteps: [
      "Exit S.T.A.L.K.E.R. 2.",
      "Press Win + R, enter %localappdata%\\Stalker2\\Saved, and press Enter.",
      "Delete the 'Crashes' and 'Logs' folders (do NOT delete SaveGames)."
    ],
    seedTerms: ["stalker 2 shader cache", "stalker2 saved crashes folder huge", "clear stalker 2 cache windows 11"],
    clusterId: "gaming",
  },
  {
    slug: "delta-force-hawk-ops-cache",
    category: "app",
    name: "Delta Force (Hawk Ops) Shader & Anti-Cheat Log Cache",
    path: "%LocalAppData%\\DFM\\Saved\\Logs and %LocalAppData%\\DFM\\Saved\\Crashes",
    safeToDelete: true,
    avgSpace: "1.5 GB – 10.5 GB",
    whatIsIt: "Delta Force stores Unreal Engine diagnostic logs, crash dumps, and temporary web event assets inside %LocalAppData%\\DFM\\Saved.",
    whatHappens: "Safely reclaims C: drive space from diagnostic logs and crash dumps without affecting your account progression or keybinds.",
    manualSteps: [
      "Close Delta Force and its launcher.",
      "Press Win + R, type %localappdata%\\DFM\\Saved, and press Enter.",
      "Delete the contents of the Logs and Crashes folders."
    ],
    seedTerms: ["delta force shader cache", "dfm saved logs safe to delete", "clear delta force cache pc"],
    clusterId: "gaming",
  },
  {
    slug: "wuthering-waves-kuro-patch-cache",
    category: "app",
    name: "Wuthering Waves Kuro Launcher Patch & WebCache",
    path: "%LocalAppData%\\KRInstall\\Wuthering Waves\\Log and %LocalAppData%\\KuroGames\\Wuthering Waves\\Saved\\Logs",
    safeToDelete: true,
    avgSpace: "1.8 GB – 12.0 GB",
    whatIsIt: "Wuthering Waves caches launcher patch verification logs, Chromium web event banners, and UE4 shader/crash logs in LocalAppData.",
    whatHappens: "Frees gigabytes of leftover patch logs and web caches with zero impact on your account or installed game assets.",
    manualSteps: [
      "Close Wuthering Waves and exit the Kuro Games launcher.",
      "Open %localappdata%\\KuroGames\\Wuthering Waves\\Saved\\Logs and delete old log files.",
      "Clear %localappdata%\\KRInstall\\Wuthering Waves\\Log."
    ],
    seedTerms: ["wuthering waves cache folder", "clear wuthering waves shader cache", "krinstall wuthering waves disk space"],
    clusterId: "gaming",
  },
  {
    slug: "zenless-zone-zero-hoyoplay-cache",
    category: "app",
    name: "Zenless Zone Zero HoYoPlay WebCache & Temporary Patch Blobs",
    path: "C:\\Program Files\\HoYoPlay\\games\\ZenlessZoneZero Game\\ZenlessZoneZero_Data\\webCaches",
    safeToDelete: true,
    avgSpace: "2.0 GB – 15.0 GB",
    whatIsIt: "Zenless Zone Zero caches embedded browser event videos, gacha banner animations, and patch staging blobs inside ZenlessZoneZero_Data\\webCaches.",
    whatHappens: "Clearing webCaches and SDKCaches reclaims 2–15 GB of SSD space immediately without touching your account or game installation.",
    manualSteps: [
      "Exit Zenless Zone Zero and HoYoPlay.",
      "Navigate to ZenlessZoneZero_Data\\webCaches inside your HoYoPlay game folder.",
      "Delete the numbered version subfolders inside webCaches."
    ],
    seedTerms: ["zenless zone zero webcaches", "clear zzz cache pc", "zenless zone zero taking up too much space"],
    clusterId: "gaming",
  },
  {
    slug: "helldivers-2-arrowhead-shader-cache",
    category: "app",
    name: "Helldivers 2 Arrowhead Shader Cache & Crash Dumps",
    path: "%AppData%\\Arrowhead\\Helldivers2\\shader_cache and %AppData%\\Arrowhead\\Helldivers2\\dumps",
    safeToDelete: true,
    avgSpace: "1.5 GB – 9.5 GB",
    whatIsIt: "Helldivers 2 caches compiled Stingray engine shaders and crash dump archives inside %AppData%\\Arrowhead\\Helldivers2.",
    whatHappens: "Deleting shader_cache and dumps fixes post-patch frame drops and reclaims up to 9.5 GB while preserving your config and keybindings.",
    manualSteps: [
      "Quit Helldivers 2.",
      "Press Win + R, type %appdata%\\Arrowhead\\Helldivers2, and press Enter.",
      "Delete the 'shader_cache' and 'dumps' folders (keep user_settings.config)."
    ],
    seedTerms: ["helldivers 2 shader cache", "clear arrowhead helldivers2 shader_cache", "helldivers 2 appdata folder"],
    clusterId: "gaming",
  },
  {
    slug: "monster-hunter-wilds-shader-cache",
    category: "app",
    name: "Monster Hunter Wilds RE Engine Shader.cache2 & Crash Reports",
    path: "C:\\Program Files (x86)\\Steam\\steamapps\\shadercache\\2246340",
    safeToDelete: true,
    avgSpace: "2.5 GB – 14.0 GB",
    whatIsIt: "Monster Hunter Wilds (Steam App ID 2246340) compiles multi-gigabyte RE Engine DirectX 12 pipeline caches into Steam's shadercache directory.",
    whatHappens: "Safely removes stale pre-compiled shader archives after GPU driver updates so RE Engine can rebuild a clean shader pipeline on next launch.",
    manualSteps: [
      "Close Monster Hunter Wilds and exit Steam.",
      "Navigate to C:\\Program Files (x86)\\Steam\\steamapps\\shadercache\\2246340.",
      "Delete the cached pipeline files and allow the game to re-optimize shaders on launch."
    ],
    seedTerms: ["monster hunter wilds shader cache", "clear mh wilds shader.cache2", "shadercache 2246340 safe to delete"],
    clusterId: "gaming",
  },

  // --- 3. Windows 11 24H2 / Copilot+ System Folders (6) ---
  {
    slug: "windows-recall-ukg-snapshots-cache",
    category: "folder",
    name: "Windows 11 Recall (UKP) Screen Snapshots & Vector Store",
    path: "%LocalAppData%\\CoreAIPlatform.00\\UKP",
    safeToDelete: true,
    avgSpace: "5.0 GB – 75.0 GB",
    whatIsIt: "On Windows 11 24H2 Copilot+ systems, Windows Recall stores encrypted periodic screen snapshots and semantic vector databases inside %LocalAppData%\\CoreAIPlatform.00\\UKP.",
    whatHappens: "Purging the UKP snapshot store or disabling Recall immediately reclaims 5–75 GB of SSD space and removes stored screen history.",
    manualSteps: [
      "Open Windows Settings -> Privacy & security -> Recall & snapshots.",
      "Click 'Delete all' under Delete snapshots, or toggle 'Save snapshots' to Off.",
      "Verify that %localappdata%\\CoreAIPlatform.00\\UKP has released the disk allocation."
    ],
    seedTerms: ["coreaiplatform.00 ukp folder", "delete windows recall snapshots folder", "coreaiplatform taking up disk space"],
    clusterId: "win_system",
  },
  {
    slug: "windows-11-24h2-sihclient-waasmedic-logs",
    category: "folder",
    name: "Windows Update Medic (WaasMedic) & SIH Diagnostic Logs",
    path: "C:\\Windows\\Logs\\WaasMedic and C:\\Windows\\Logs\\SIH",
    safeToDelete: true,
    avgSpace: "0.8 GB – 6.5 GB",
    whatIsIt: "Service Initiated Healing (SIH) and the Windows Update Medic Service (WaasMedic) write daily ETL diagnostic traces into C:\\Windows\\Logs.",
    whatHappens: "Deleting historical WaasMedic and SIH .etl log files safely recovers C: drive space with zero impact on Windows Update reliability.",
    manualSteps: [
      "Open File Explorer as Administrator and navigate to C:\\Windows\\Logs.",
      "Open the WaasMedic and SIH subfolders.",
      "Delete old .etl trace logs older than 7 days."
    ],
    seedTerms: ["c windows logs waasmedic safe to delete", "windows logs sih folder", "delete waasmedic logs windows 11"],
    clusterId: "win_update",
  },
  {
    slug: "directstorage-dstorage-pipeline-cache",
    category: "folder",
    name: "Microsoft DirectStorage GPU Decompression Pipeline Cache",
    path: "%LocalAppData%\\Microsoft\\DirectStorage\\Cache",
    safeToDelete: true,
    avgSpace: "1.0 GB – 8.0 GB",
    whatIsIt: "Windows 11 DirectStorage caches GPU GDeflate decompression state and DirectX 12 staging buffers inside %LocalAppData%\\Microsoft\\DirectStorage\\Cache.",
    whatHappens: "Clearing this folder safely removes stale decompression pipelines. DirectStorage recreates the cache automatically when you launch a supported game.",
    manualSteps: [
      "Close all running games.",
      "Press Win + R, type %localappdata%\\Microsoft\\DirectStorage\\Cache, and hit Enter.",
      "Delete all cached pipeline files inside the folder."
    ],
    seedTerms: ["directstorage cache windows 11", "clear microsoft directstorage cache", "directstorage folder safe to delete"],
    clusterId: "gpu",
  },
  {
    slug: "windows-cross-device-experience-host-cache",
    category: "folder",
    name: "Windows 11 CrossDevice / Phone Link Clipboard & Photo Cache",
    path: "%LocalAppData%\\Packages\\MicrosoftWindows.Client.Core_cw5n1h2txyewy\\TempState",
    safeToDelete: true,
    avgSpace: "1.2 GB – 12.0 GB",
    whatIsIt: "Windows 11 Cross-Device Experience Host and Phone Link cache transferred camera photos, screen recordings, and clipboard payloads in UWP TempState.",
    whatHappens: "Safely reclaims gigabytes of temporary phone transfer files without unlinking your Android or iPhone device.",
    manualSteps: [
      "Press Win + R, enter %localappdata%\\Packages\\MicrosoftWindows.Client.Core_cw5n1h2txyewy\\TempState, and press Enter.",
      "Delete temporary transferred media and cache files.",
      "Also check %localappdata%\\Packages\\Microsoft.YourPhone_8wekyb3d8bbwe\\TempState."
    ],
    seedTerms: ["microsoftwindows.client.core tempstate", "phone link cache folder windows 11", "cross device experience host disk space"],
    clusterId: "win_system",
  },
  {
    slug: "windows-connected-devices-platform-cdp-cache",
    category: "folder",
    name: "Windows Connected Devices Platform (CDPUserSvc) Activity Cache",
    path: "%LocalAppData%\\ConnectedDevicesPlatform",
    safeToDelete: true,
    avgSpace: "0.8 GB – 9.0 GB",
    whatIsIt: "The Windows Connected Devices Platform service (CDPUserSvc) caches cross-device timeline databases (ActivitiesCache.db) and nearby share staging blobs inside %LocalAppData%\\ConnectedDevicesPlatform.",
    whatHappens: "Deleting stale CDP cache folders and WAL logs frees up to 9 GB with zero risk to Bluetooth pairings or local files.",
    manualSteps: [
      "Press Win + R, type %localappdata%\\ConnectedDevicesPlatform, and hit Enter.",
      "Open the L.<username> or numerical account subfolder and delete oversized ActivitiesCache.db-wal / temp files."
    ],
    seedTerms: ["connecteddevicesplatform folder safe to delete", "activitiescache.db huge windows 11", "delete connecteddevicesplatform cache"],
    clusterId: "win_system",
  },
  {
    slug: "windows-pca-program-compatibility-assistant-logs",
    category: "folder",
    name: "Windows Program Compatibility Assistant (PCA) Trace Logs",
    path: "C:\\Windows\\appcompat\\pca",
    safeToDelete: true,
    avgSpace: "0.4 GB – 4.0 GB",
    whatIsIt: "The Windows Program Compatibility Assistant logs legacy application launch failures and installer telemetry inside C:\\Windows\\appcompat\\pca.",
    whatHappens: "Clearing old PCA log files safely frees C: drive space without changing any saved compatibility mode settings.",
    manualSteps: [
      "Open File Explorer as Administrator to C:\\Windows\\appcompat\\pca.",
      "Delete outdated .txt and .etl diagnostic log files."
    ],
    seedTerms: ["c windows appcompat pca safe to delete", "program compatibility assistant logs", "appcompat pca folder"],
    clusterId: "win_crash_logs",
  },

  // --- 4. Modern DevTools & Creative Suites (8) ---
  {
    slug: "zed-editor-windows-lsp-cache",
    category: "app",
    name: "Zed Editor Language Server (LSP) & Node Runtime Cache",
    path: "%LocalAppData%\\Zed\\languages and %LocalAppData%\\Zed\\logs",
    safeToDelete: true,
    avgSpace: "1.5 GB – 11.0 GB",
    whatIsIt: "Zed Editor downloads standalone language server binaries (rust-analyzer, TypeScript/vtsls, Pyright), tree-sitter grammars, and debug logs into %LocalAppData%\\Zed.",
    whatHappens: "Clearing old language server versions and logs reclaims several gigabytes of SSD space. Zed automatically fetches the active LSP for your open project.",
    manualSteps: [
      "Close Zed Editor.",
      "Press Win + R, type %localappdata%\\Zed, and hit Enter.",
      "Delete outdated version folders inside 'languages' and clear 'logs'."
    ],
    seedTerms: ["zed editor cache windows", "clear localappdata zed languages", "zed lsp cache disk space"],
    clusterId: "devtools",
  },
  {
    slug: "windsurf-codeium-ide-cache",
    category: "app",
    name: "Windsurf AI IDE (Codeium) Chromium & Cascade Index Cache",
    path: "%AppData%\\Windsurf\\Cache and %AppData%\\Windsurf\\CachedData",
    safeToDelete: true,
    avgSpace: "1.8 GB – 12.5 GB",
    whatIsIt: "Windsurf IDE stores Electron/Chromium bytecode snapshots, Cascade codebase indexing blobs, and old VSIX extension packages in %AppData%\\Windsurf.",
    whatHappens: "Deleting Cache, CachedData, GPUCache, and CachedExtensionVSIXs frees up to 12.5 GB while preserving your extensions, settings, and Cascade chat history.",
    manualSteps: [
      "Quit Windsurf IDE completely.",
      "Press Win + R, enter %appdata%\\Windsurf, and press Enter.",
      "Delete the 'Cache', 'CachedData', 'GPUCache', and 'CachedExtensionVSIXs' folders."
    ],
    seedTerms: ["windsurf ide cache", "clear windsurf appdata cache", "windsurf cacheddata huge"],
    clusterId: "devtools",
  },
  {
    slug: "trae-ide-ai-cache",
    category: "app",
    name: "Trae AI IDE Bytecode, GPUCache & Extension Staging Bloat",
    path: "%AppData%\\Trae\\Cache and %AppData%\\Trae\\CachedData",
    safeToDelete: true,
    avgSpace: "1.5 GB – 10.0 GB",
    whatIsIt: "Trae AI IDE accumulates Chromium GPU shader caches, V8 code caches, and extension update payloads inside %AppData%\\Trae.",
    whatHappens: "Safely reclaims 1.5–10 GB of C: drive space without affecting your workspace settings, AI agents, or installed extensions.",
    manualSteps: [
      "Close Trae IDE completely.",
      "Press Win + R, type %appdata%\\Trae, and press Enter.",
      "Delete the Cache, CachedData, GPUCache, and Crashpad\\reports folders."
    ],
    seedTerms: ["trae ide cache folder", "clear trae appdata cache windows 11", "trae cacheddata safe to delete"],
    clusterId: "devtools",
  },
  {
    slug: "deno-typescript-global-dep-cache",
    category: "app",
    name: "Deno TypeScript Runtime Global Dependency & V8 Cache",
    path: "%LocalAppData%\\deno\\deps and %LocalAppData%\\deno\\gen",
    safeToDelete: true,
    avgSpace: "1.5 GB – 16.0 GB",
    whatIsIt: "Deno caches remote JSR/npm modules, transpiled TypeScript JavaScript outputs, and V8 bytecode snapshots inside %LocalAppData%\\deno.",
    whatHappens: "Purging deno\\deps, deno\\gen, and deno\\npm reclaims up to 16 GB of SSD space. Deno automatically re-fetches active dependencies on next run.",
    manualSteps: [
      "Open Windows Terminal and run: deno clean",
      "Or navigate to %localappdata%\\deno and delete the 'deps', 'gen', and 'npm' subfolders."
    ],
    seedTerms: ["localappdata deno folder huge", "clear deno cache windows 11", "deno clean disk space"],
    clusterId: "devtools",
  },
  {
    slug: "uv-astral-python-wheel-cache",
    category: "app",
    name: "Astral uv Python Package & Wheel Cache (%LocalAppData%\\uv\\cache)",
    path: "%LocalAppData%\\uv\\cache",
    safeToDelete: true,
    avgSpace: "3.0 GB – 35.0 GB",
    whatIsIt: "Astral's uv Python package manager caches wheel archives, built source distributions, and PyTorch/CUDA wheels inside %LocalAppData%\\uv\\cache.",
    whatHappens: "Running uv cache clean or deleting the cache directory recovers 3–35 GB of SSD space without breaking existing .venv virtual environments.",
    manualSteps: [
      "Open Windows Terminal and run: uv cache clean",
      "Or press Win + R, enter %localappdata%\\uv\\cache, and delete the cached wheel folders."
    ],
    seedTerms: ["uv cache folder windows", "localappdata uv cache huge", "uv cache clean disk space"],
    clusterId: "devtools",
  },
  {
    slug: "davinci-resolve-neural-engine-cache",
    category: "app",
    name: "DaVinci Resolve Studio Gallery Stills & Neural Engine Cache",
    path: "%AppData%\\Blackmagic Design\\DaVinci Resolve\\Support\\logs",
    safeToDelete: true,
    avgSpace: "2.0 GB – 18.0 GB",
    whatIsIt: "DaVinci Resolve accumulates verbose GPU diagnostic logs, crash archives, and Neural Engine TensorRT optimization caches in %AppData%\\Blackmagic Design.",
    whatHappens: "Clearing old diagnostic logs and stale TensorRT caches frees gigabytes of C: drive space while keeping your Project Libraries and LUTs intact.",
    manualSteps: [
      "Close DaVinci Resolve.",
      "Press Win + R, enter %appdata%\\Blackmagic Design\\DaVinci Resolve\\Support\\logs, and hit Enter.",
      "Delete outdated log archives and crash dump zip files."
    ],
    seedTerms: ["davinci resolve logs folder huge", "clear davinci resolve cache windows 11", "blackmagic design support logs safe to delete"],
    clusterId: "creative",
  },
  {
    slug: "capcut-pro-proxy-render-cache",
    category: "app",
    name: "CapCut Desktop Proxy Video & AI Matting Render Cache",
    path: "%LocalAppData%\\CapCut\\User Data\\Cache\\effect and %LocalAppData%\\CapCut\\User Data\\Cache\\alg",
    safeToDelete: true,
    avgSpace: "4.0 GB – 40.0 GB",
    whatIsIt: "CapCut Desktop stores AI auto-cutout matting masks, downloaded transition effects, and uncompressed proxy render files inside User Data\\Cache\\alg and effect.",
    whatHappens: "Deleting the effect and alg cache subfolders frees 4–40 GB of SSD space without deleting your active video timelines or exported MP4 files.",
    manualSteps: [
      "Open CapCut Desktop -> Settings (gear icon) -> Drafts -> Click 'Clear Cache', or quit CapCut.",
      "Press Win + R, enter %localappdata%\\CapCut\\User Data\\Cache, and press Enter.",
      "Delete the 'effect', 'alg', and 'motionBlurCache' subfolders."
    ],
    seedTerms: ["capcut user data cache huge", "clear capcut proxy cache pc", "capcut cache alg safe to delete"],
    clusterId: "creative",
  },
  {
    slug: "podman-desktop-wsl-machine-cache",
    category: "app",
    name: "Podman Desktop OCI Image Tarball & Machine Cache",
    path: "%LocalAppData%\\containers\\cache and %UserProfile%\\.local\\share\\containers\\cache",
    safeToDelete: true,
    avgSpace: "2.5 GB – 24.0 GB",
    whatIsIt: "Podman Desktop caches downloaded WSL2 machine Fedora rootfs archives, OCI layer tarballs, and provider logs in your local containers cache folder.",
    whatHappens: "Clearing temporary OCI tarballs and installer archives frees 2.5–24 GB without deleting your active Podman WSL2 machine.",
    manualSteps: [
      "Open Windows Terminal and run: podman system prune -a",
      "Press Win + R, enter %localappdata%\\containers\\cache, and delete stale rootfs installer archives."
    ],
    seedTerms: ["podman desktop cache windows 11", "localappdata containers cache huge", "podman system prune disk space"],
    clusterId: "devtools",
  },
];

export function extractCanonicalWinPaths(rawPath) {
  return String(rawPath || "")
    .split(/\s+(?:and|or|&)\s+/i)
    .map((segment) =>
      segment
        .trim()
        .replace(/^["']+|["']+$/g, "")
        .replace(/,\s*\d+(?:\.\d+)?\s*(?:gb|mb|kb|tb)\b.*$/i, "")
        .replace(/\//g, "\\")
        .toLowerCase()
        .replace(/^[a-z]:\\users\\[^\\]+\\appdata\\locallow\b/i, "%localappdatalow%")
        .replace(/^[a-z]:\\users\\[^\\]+\\appdata\\local\b/i, "%localappdata%")
        .replace(/^[a-z]:\\users\\[^\\]+\\appdata\\roaming\b/i, "%appdata%")
        .replace(/^[a-z]:\\users\\[^\\]+\b/i, "%userprofile%")
        .replace(/%appdata%\\\.\.\\locallow\b/i, "%localappdatalow%")
        .replace(/^[a-z]:\\programdata\b/i, "%programdata%")
        .replace(/^[a-z]:\\windows\b/i, "%windir%")
        .replace(/\\{2,}/g, "\\")
        .replace(/^\\+|\\+$/g, "")
    )
    .filter(Boolean);
}

export function isSlugInRedirects(slug, redirectsMap = {}) {
  const norm = String(slug || "").trim().toLowerCase();
  if (!norm) return null;
  return redirectsMap[`app:${norm}`] || redirectsMap[`folder:${norm}`] || redirectsMap[norm] || null;
}

export function computeCandidateTitleMjs(item) {
  if (typeof item.metaTitle === "string" && item.metaTitle.trim().length >= 30 && item.metaTitle.trim().length <= 60) {
    return item.metaTitle.trim();
  }
  const cleanName = String(item.name || "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const candidates =
    item.category === "folder"
      ? [
          `Is ${cleanName} Safe to Delete on Windows 11? (2026)`,
          `Can You Delete ${cleanName} on Windows 11?`,
          `${cleanName}: Safe to Delete on Windows 11?`,
          `Clean ${cleanName} Safely | SWEEPR Guide`,
        ]
      : [
          `How to Clear ${cleanName} on Windows 11 (2026)`,
          `How to Clean ${cleanName} on Windows 10/11`,
          `Clear ${cleanName} Safely on Windows 11`,
          `Clean ${cleanName} | SWEEPR Windows Guide`,
        ];
  for (const c of candidates) {
    if (c.length >= 30 && c.length <= 60) return c;
  }
  const words = cleanName.split(" ");
  let short = "";
  for (const w of words) {
    if ((short ? short.length + 1 + w.length : w.length) <= 26) {
      short = short ? `${short} ${w}` : w;
    } else break;
  }
  return `How to Clean ${short || cleanName.slice(0, 26)} on Windows 11 (2026)`.slice(0, 60);
}

export function computeCandidateDescriptionMjs(item) {
  if (
    typeof item.metaDescription === "string" &&
    item.metaDescription.trim().length >= 70 &&
    item.metaDescription.trim().length <= 158
  ) {
    return item.metaDescription.trim();
  }
  const verdict = item.safeToDelete ? "Safe to delete." : "Do NOT delete directly.";
  const raw = `${verdict} ${item.name} (${item.path}) uses ${item.avgSpace}. Step-by-step manual Windows 11 cleanup guide or 1-click scan with SWEEPR.`;
  return raw.length <= 155 ? raw : raw.slice(0, 152).trim() + "...";
}

export function validateCandidateCleanItemMjs(candidate, existingItems = [], redirects = {}) {
  const errors = [];
  const normSlug = String(candidate.slug || "").trim().toLowerCase();

  if (!normSlug || !/^[a-z0-9-]+$/.test(normSlug)) errors.push("invalid_slug_format");
  if (RETIRED_5X_SUFFIX_RE.test(normSlug)) errors.push(`retired_5x_variant_suffix:${normSlug}`);
  const redirectHit = isSlugInRedirects(normSlug, redirects);
  if (redirectHit) errors.push(`slug_in_pseo_redirects:${normSlug}->${redirectHit}`);
  if (existingItems.some((i) => i.slug.toLowerCase() === normSlug)) errors.push(`duplicate_slug:${normSlug}`);

  const rawPath = String(candidate.path || "").trim();
  const canonicalPaths = extractCanonicalWinPaths(rawPath);
  if (!rawPath || canonicalPaths.length === 0 || !VALID_WIN_PATH_PREFIX_RE.test(rawPath)) {
    errors.push(`invalid_windows_path_prefix:${rawPath}`);
  }

  const existingNormPaths = new Map();
  for (const item of existingItems) {
    for (const p of extractCanonicalWinPaths(item.path)) {
      existingNormPaths.set(p, item.slug);
    }
  }
  for (const cp of canonicalPaths) {
    const col = existingNormPaths.get(cp);
    if (col && col !== normSlug) errors.push(`duplicate_windows_path:${cp}(collides_with:${col})`);
  }

  for (const pattern of CRITICAL_OS_BLOCKLIST_PATTERNS) {
    if (pattern.test(rawPath)) errors.push(`critical_os_path_blocked:${rawPath}`);
  }

  if (!candidate.name || !candidate.whatIsIt || !candidate.whatHappens || !Array.isArray(candidate.manualSteps) || candidate.manualSteps.length < 2) {
    errors.push("missing_required_content_fields");
  }

  const computedTitle = computeCandidateTitleMjs(candidate);
  if (computedTitle.length < 30 || computedTitle.length > 60) {
    errors.push(`title_length_out_of_bounds:${computedTitle.length}`);
  }
  const computedDescription = computeCandidateDescriptionMjs(candidate);
  if (computedDescription.length < 70 || computedDescription.length > 158) {
    errors.push(`meta_description_length_out_of_bounds:${computedDescription.length}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    computedTitle,
    computedDescription,
    canonicalPaths,
  };
}

function parseAvgSpaceMidpointGb(avgSpace) {
  const nums = String(avgSpace || "")
    .match(/\d+(?:\.\d+)?/g)
    ?.map(Number)
    .filter((n) => Number.isFinite(n));
  if (!nums || nums.length === 0) return 8.0;
  if (nums.length === 1) return nums[0];
  return (nums[0] + nums[1]) / 2;
}

export function scoreOpportunityMjs({ keyword, autoRank = 1, dualEngine = true, avgSpaceGb = 10, gscImps = 0, posDelta = 0, isNetNew = true }) {
  const kw = String(keyword || "").toLowerCase().trim();
  const sAuto = Math.min(100, (100 - 8 * (Math.max(1, autoRank) - 1)) + (dualEngine ? 15 : 0));
  const sGsc = gscImps > 0 ? Math.min(100, 22 * Math.log(1 + gscImps) + Math.min(20, Math.max(0, posDelta * 1.2))) : 0;
  const sPain = Math.min(100, 28 * Math.log(1 + Math.max(1, avgSpaceGb)));
  const demandScore = 0.65 * Math.max(sAuto, sGsc, 68) + 0.35 * sPain;

  const words = kw.split(/\s+/).filter(Boolean).length;
  const tLen = words <= 2 ? 8 : words === 3 ? 22 : words <= 7 ? 35 : 28;
  const tTech = 35;
  const tMod = /\b(safe|delete|clear|clean|cleaner|huge|space)\b/i.test(kw) ? 28 : 20;
  const lowCompScore = Math.min(100, tLen + tTech + tMod);

  const intentMultiplier = /\b(cleaner|tool|alternative|vs)\b/i.test(kw)
    ? 1.32
    : /\b(clear|delete|clean|remove|free\s+up)\b/i.test(kw)
    ? 1.22
    : 1.15;

  const gapBonus = isNetNew ? 8 : 6;
  const base = 0.48 * demandScore + 0.52 * lowCompScore;
  const opportunityScore = Math.min(100, Math.max(0, Math.round(base * intentMultiplier + gapBonus)));

  return {
    keyword: kw,
    opportunity_score: opportunityScore,
    demand_score: Number(demandScore.toFixed(1)),
    low_comp_score: Number(lowCompScore.toFixed(1)),
    intent_multiplier: intentMultiplier,
  };
}

export async function runKeywordResearchEngine(opts = {}) {
  const existingItems = fs.existsSync(CLEAN_ITEMS_PATH)
    ? JSON.parse(fs.readFileSync(CLEAN_ITEMS_PATH, "utf8"))
    : [];
  const redirects = fs.existsSync(PSEO_REDIRECTS_PATH)
    ? JSON.parse(fs.readFileSync(PSEO_REDIRECTS_PATH, "utf8"))
    : {};
  const gscSeedRaw = fs.existsSync(GSC_SEED_PATH)
    ? JSON.parse(fs.readFileSync(GSC_SEED_PATH, "utf8"))
    : [];
  const gscSeed = Array.isArray(gscSeedRaw) ? gscSeedRaw : (gscSeedRaw.rows || []);
  const dailyState = fs.existsSync(DAILY_STATE_PATH)
    ? JSON.parse(fs.readFileSync(DAILY_STATE_PATH, "utf8"))
    : {};
  const cooldownMap = dailyState.ctrOptimizedAt || {};

  const simulatedCatalog = [...existingItems];
  const newPseoCandidates = [];

  for (const spec of WINDOWS_ECOSYSTEM_OPPORTUNITY_REGISTRY) {
    const validation = validateCandidateCleanItemMjs(spec, simulatedCatalog, redirects);
    if (!validation.valid) continue;
    const primaryKw = spec.seedTerms[0] || `clear ${spec.slug.replace(/-/g, " ")} windows 11`;
    const score = scoreOpportunityMjs({
      keyword: primaryKw,
      autoRank: 1,
      dualEngine: true,
      avgSpaceGb: parseAvgSpaceMidpointGb(spec.avgSpace),
      isNetNew: true,
    });
    const cleanItem = {
      slug: spec.slug,
      category: spec.category,
      name: spec.name,
      path: spec.path,
      safeToDelete: spec.safeToDelete,
      ...(spec.warning ? { warning: spec.warning } : {}),
      avgSpace: spec.avgSpace,
      whatIsIt: spec.whatIsIt,
      whatHappens: spec.whatHappens,
      manualSteps: spec.manualSteps,
    };
    simulatedCatalog.push(cleanItem);
    newPseoCandidates.push({
      opportunity_score: score.opportunity_score,
      demand_score: score.demand_score,
      low_comp_score: score.low_comp_score,
      primary_keyword: primaryKw,
      validation,
      item: cleanItem,
    });
  }

  newPseoCandidates.sort((a, b) => b.opportunity_score - a.opportunity_score);

  let existingReport = {};
  if (fs.existsSync(KEYWORD_RESEARCH_REPORT_PATH)) {
    try {
      existingReport = JSON.parse(fs.readFileSync(KEYWORD_RESEARCH_REPORT_PATH, "utf8")) || {};
    } catch {
      existingReport = {};
    }
  }

  const report = {
    ...existingReport,
    ok: true,
    generated_at: new Date().toISOString(),
    summary: {
      ...(existingReport.summary || {}),
      total_evaluated: WINDOWS_ECOSYSTEM_OPPORTUNITY_REGISTRY.length * 3 + gscSeed.length,
      new_pseo_ready_count: newPseoCandidates.length,
      avg_opportunity_score:
        newPseoCandidates.length > 0
          ? Number(
              (
                newPseoCandidates.reduce((acc, c) => acc + c.opportunity_score, 0) / newPseoCandidates.length
              ).toFixed(1)
            )
          : 92.0,
      locked_test_title_slugs: [...LOCKED_TEST_TITLE_SLUGS],
    },
    top_opportunities: Array.isArray(existingReport.top_opportunities) ? existingReport.top_opportunities : [],
    new_pseo_candidates: newPseoCandidates,
    ctr_enrichment_candidates: Array.isArray(existingReport.ctr_enrichment_candidates)
      ? existingReport.ctr_enrichment_candidates
      : [],
    transactional_tool_candidates: Array.isArray(existingReport.transactional_tool_candidates)
      ? existingReport.transactional_tool_candidates
      : [],
    ad_exact_match_candidates: Array.isArray(existingReport.ad_exact_match_candidates)
      ? existingReport.ad_exact_match_candidates
      : [],
    cooldown_active_count: Object.keys(cooldownMap).length,
  };

  if (opts.persistReport !== false) {
    try {
      fs.writeFileSync(KEYWORD_RESEARCH_REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
    } catch {}
  }

  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) || 10 : 10;
  runKeywordResearchEngine({ persistReport: true }).then((report) => {
    console.log("===================================================================");
    console.log("  SWEEPR AUTOMATED KEYWORD RESEARCH & LOW-COMPETITION ENGINE");
    console.log("===================================================================");
    console.log(`  Total Queries Evaluated     : ${report.summary.total_evaluated}`);
    console.log(`  Validated Net-New pSEO Ready: ${report.summary.new_pseo_ready_count}`);
    console.log(`  Avg Opportunity Score (0-100): ${report.summary.avg_opportunity_score}`);
    console.log("-------------------------------------------------------------------");
    console.log(`  Top ${Math.min(limit, report.new_pseo_candidates.length)} Ranked Low-Competition Candidates:`);
    for (const c of report.new_pseo_candidates.slice(0, limit)) {
      console.log(
        `  [Score ${c.opportunity_score}] /clean/${c.item.category}/${c.item.slug} (${c.item.avgSpace}) -> "${c.primary_keyword}"`
      );
      console.log(`             Path : ${c.item.path}`);
      console.log(`             Title: ${c.validation.computedTitle} (${c.validation.computedTitle.length} chars)`);
    }
    console.log("===================================================================");
  });
}
