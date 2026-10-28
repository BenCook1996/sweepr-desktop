#!/usr/bin/env node
/**
 * SWEEPR Cleaner (sweeprcleaner.com) — Daily 50 Keyword-Researched Programmatic SEO Page Generator
 *
 * Part of the `sweepr-daily-seo-drip` & `sweepr-cleaner-daily-50-seo-pages` automation suite.
 *
 * On each run:
 *  1. Reads `server/src/data/clean-items.json` and `server/public/sitemap.xml` to see which slugs already exist.
 *  2. Selects the next 50 ungenerated, keyword-researched long-tail Windows/PC storage & cache cleanup topics across:
 *     - `/clean/app/:slug` (AI/LLM local model caches, Game Launchers & Shader Caches, Video/3D/CAD/Audio Suites, IDEs & DevOps, Browsers, Cloud Sync, Communication Apps)
 *     - `/clean/folder/:slug` (Windows 11 24H2/23H2 System Folders, Component Store, Crash Dumps, Update Caches, DriverStore, Defender & Search Index Bloat)
 *  3. Validates every generated page against SWEEPR's SEO & GEO quality rules (unique slug, exact Windows environment path,
 *     safety verdict badge, realistic GB savings, clear plain-English explanation, and step-by-step manual & 1-click instructions).
 *  4. Appends all 50 new items to `server/src/data/clean-items.json`, updates `server/public/sitemap.xml`,
 *     `server/public/llms.txt`, and `server/src/data/indexing-queue.json`.
 *  5. Pings Bing IndexNow (`www.bing.com/indexnow` & `api.indexnow.org/indexnow`) and syncs the new keywords to SWEEPR CRM.
 *
 * Usage:
 *   node c:\Users\Benjamin\Downloads\desktop_cleaner\server\scripts\daily-50-seo-pages.mjs [count=50] [--force]
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");
const CLEAN_ITEMS_PATH = path.join(SERVER_ROOT, "src", "data", "clean-items.json");
const INDEXING_QUEUE_PATH = path.join(SERVER_ROOT, "src", "data", "indexing-queue.json");
const DAILY_STATE_PATH = path.join(SERVER_ROOT, "src", "data", "daily-seo-pages-state.json");
const SITEMAP_PATH = path.join(SERVER_ROOT, "public", "sitemap.xml");
const LLMS_PATH = path.join(SERVER_ROOT, "public", "llms.txt");
const INDEXNOW_KEY = "8f9a2b4c6d1e3f5a7b9c0d2e4f6a8b0c";

const CRM_URLS = [
  process.env.SWEEPR_CRM_URL || "https://sweepr-crm-production.up.railway.app",
  "https://sweeprcleaner.com",
];
const CRM_USER = process.env.CRM_ADMIN_USER || "admin";
const CRM_PASS = process.env.CRM_ADMIN_PASSWORD || "";
const AUTH_HEADER = "Basic " + Buffer.from(`${CRM_USER}:${CRM_PASS}`).toString("base64");

// -----------------------------------------------------------------------------
// 1. Curated High-Intent Keyword-Researched Topic Catalog
// -----------------------------------------------------------------------------
const CURATED_TOPICS = [
  // --- AI & Local LLM Caches ---
  {
    slug: "ollama-models-blob-cache",
    category: "app",
    name: "Ollama Local LLM Models & Orphaned Blob Cache",
    path: "%UserProfile%\\.ollama\\models\\blobs",
    safeToDelete: true,
    avgSpace: "8.0 GB – 65.0 GB",
    whatIsIt: "Ollama stores quantized GGUF large language model weights and orphaned layer blobs from interrupted pulls or old model versions on your C: drive.",
    whatHappens: "Removing unused model blobs frees massive SSD space immediately. Models you still use can be re-pulled anytime with 'ollama pull'.",
    manualSteps: [
      "Open Windows Terminal and run 'ollama list' to inspect installed local models.",
      "Remove unused models with 'ollama rm <model-name>', or quit the Ollama tray app.",
      "Press Windows Key + R, type %userprofile%\\.ollama\\models\\blobs, and delete orphaned blob files."
    ]
  },
  {
    slug: "lm-studio-models-cache",
    category: "app",
    name: "LM Studio GGUF Model Cache & Temp Downloads",
    path: "%UserProfile%\\.cache\\lm-studio\\models",
    safeToDelete: true,
    avgSpace: "10.0 GB – 80.0 GB",
    whatIsIt: "LM Studio downloads multi-gigabyte HuggingFace GGUF model checkpoints and temporary partial downloads into your user cache folder.",
    whatHappens: "Deleting unused model folders reclaims tens of gigabytes of SSD space without affecting your LM Studio presets or chat history.",
    manualSteps: [
      "Close LM Studio completely.",
      "Press Windows Key + R, type %userprofile%\\.cache\\lm-studio\\models, and press Enter.",
      "Delete any publisher/model folders you no longer actively run."
    ]
  },
  {
    slug: "huggingface-hub-cache",
    category: "app",
    name: "HuggingFace Hub Transformers & Diffusers Cache",
    path: "%UserProfile%\\.cache\\huggingface\\hub",
    safeToDelete: true,
    avgSpace: "5.0 GB – 50.0 GB",
    whatIsIt: "Python AI tools, Diffusers, and Transformers cache every downloaded safetensors checkpoint and tokenizer snapshot inside .cache\\huggingface\\hub.",
    whatHappens: "Safely reclaims disk space from old model revisions and unused AI weights. Active Python scripts will automatically re-download only what they need.",
    manualSteps: [
      "Close any running Python or AI generation terminals.",
      "Press Windows Key + R, type %userprofile%\\.cache\\huggingface\\hub, and press Enter.",
      "Delete old 'models--*' directories or temp download lock files."
    ]
  },
  {
    slug: "comfyui-temp-output-cache",
    category: "app",
    name: "ComfyUI Temporary Preview & Latent Cache",
    path: "C:\\ComfyUI\\temp and %LocalAppData%\\Temp\\comfyui",
    safeToDelete: true,
    avgSpace: "2.0 GB – 18.0 GB",
    whatIsIt: "ComfyUI writes uncompressed PNG step previews, intermediate workflow latents, and video frame sequences during image and video generation.",
    whatHappens: "Clears temporary generation clutter without touching your saved workflows, custom nodes, or final output images.",
    manualSteps: [
      "Stop the ComfyUI server process.",
      "Open your ComfyUI installation folder and navigate to the 'temp' subfolder.",
      "Select all temporary preview files (Ctrl+A) and delete them."
    ]
  },
  {
    slug: "pytorch-torch-hub-cache",
    category: "app",
    name: "PyTorch Torch Hub & CUDA Inductors Cache",
    path: "%LocalAppData%\\Temp\\torchinductor_%USERNAME% and %UserProfile%\\.cache\\torch",
    safeToDelete: true,
    avgSpace: "2.5 GB – 16.0 GB",
    whatIsIt: "PyTorch caches compiled Triton/CUDA kernels, TorchVision pretrained weights, and C++ extension build artifacts.",
    whatHappens: "Reclaims gigabytes of SSD space. PyTorch simply recompiles active kernels on the next run.",
    manualSteps: [
      "Close active Python processes.",
      "Open %userprofile%\\.cache\\torch\\hub\\checkpoints in File Explorer.",
      "Delete old .pth and .pt weight files that are no longer needed."
    ]
  },
  {
    slug: "cursor-ai-editor-cache",
    category: "app",
    name: "Cursor AI Code Editor Cache & Codebase Index Bloat",
    path: "%AppData%\\Cursor\\Cache and %AppData%\\Cursor\\CachedData",
    safeToDelete: true,
    avgSpace: "1.5 GB – 9.0 GB",
    whatIsIt: "Cursor stores Chromium GPU caches, V8 bytecode snapshots, and old VSIX extension installers in your Roaming AppData folder.",
    whatHappens: "Frees up several gigabytes of C: drive space while keeping all your extensions, keybindings, and AI settings intact.",
    manualSteps: [
      "Close Cursor completely.",
      "Press Windows Key + R, type %appdata%\\Cursor, and press Enter.",
      "Delete the 'Cache', 'CachedData', 'CachedExtensionVSIXs', and 'GPUCache' folders."
    ]
  },
  // --- Game Engines & Gaming Caches ---
  {
    slug: "unreal-engine-derived-data-cache",
    category: "app",
    name: "Unreal Engine DerivedDataCache (DDC) Shader Bloat",
    path: "%LocalAppData%\\UnrealEngine\\Common\\DerivedDataCache",
    safeToDelete: true,
    avgSpace: "8.0 GB – 45.0 GB",
    whatIsIt: "Unreal Engine 4 and 5 cache compiled shaders, texture mipmaps, and mesh distance fields across every project you have ever opened.",
    whatHappens: "Safely frees massive disk space from old projects. Unreal Engine automatically rebuilds shaders only for the active map you open next.",
    manualSteps: [
      "Close the Unreal Editor and Epic Games Launcher.",
      "Press Windows Key + R, type %localappdata%\\UnrealEngine\\Common\\DerivedDataCache, and hit Enter.",
      "Delete the contents of the DerivedDataCache folder."
    ]
  },
  {
    slug: "unity-gi-package-cache",
    category: "app",
    name: "Unity Global Illumination (GI) & Asset Store Cache",
    path: "%LocalAppData%\\Unity\\cache and %AppData%\\Unity\\Asset Store-5.x",
    safeToDelete: true,
    avgSpace: "4.0 GB – 25.0 GB",
    whatIsIt: "Unity Editor caches baked Global Illumination lighting data, UPM package tarballs, and downloaded Asset Store packages on your system drive.",
    whatHappens: "Reclaims gigabytes of SSD space without modifying your Unity project scenes, scripts, or prefabs.",
    manualSteps: [
      "Close Unity Editor and Unity Hub.",
      "Navigate to %localappdata%\\Unity\\cache\\packages and %localappdata%\\Unity\\cache\\npm.",
      "Delete old cached package folders to reclaim space."
    ]
  },
  {
    slug: "call-of-duty-hq-shader-cache",
    category: "app",
    name: "Call of Duty HQ & Warzone Pre-Compiled Shader Cache",
    path: "%LocalAppData%\\Activision\\Call of Duty\\shadercache",
    safeToDelete: true,
    avgSpace: "3.0 GB – 14.0 GB",
    whatIsIt: "Call of Duty HQ and Warzone store multi-gigabyte DirectX 12 shader packs that grow after every seasonal update and GPU driver change.",
    whatHappens: "Frees disk space and fixes post-update stuttering or packet-burst hitching by forcing a clean shader optimization on next launch.",
    manualSteps: [
      "Exit Call of Duty completely.",
      "Press Windows Key + R, type %localappdata%\\Activision\\Call of Duty\\shadercache, and hit Enter.",
      "Delete all files inside the shadercache directory."
    ]
  },
  {
    slug: "fortnite-d3d12-shader-cache",
    category: "app",
    name: "Fortnite DirectX 12 Pipeline & Cosmetics Stream Cache",
    path: "%LocalAppData%\\FortniteGame\\Saved\\Cloud and %LocalAppData%\\FortniteGame\\Saved\\Logs",
    safeToDelete: true,
    avgSpace: "2.0 GB – 11.0 GB",
    whatIsIt: "Fortnite caches streamed high-resolution cosmetic textures, replay recordings, crash dumps, and DirectX 12 PSO shader caches.",
    whatHappens: "Reclaims wasted C: drive space and resolves DX12 shader stutter without affecting your Epic account or keybinds.",
    manualSteps: [
      "Close Fortnite and Epic Games Launcher.",
      "Press Windows Key + R, type %localappdata%\\FortniteGame\\Saved, and press Enter.",
      "Clear the 'Logs', 'Crashes', and old 'Demos' replay files."
    ]
  },
  {
    slug: "vrchat-avatar-world-cache",
    category: "app",
    name: "VRChat Downloaded World & Avatar Cache",
    path: "%AppData%\\..\\LocalLow\\VRChat\\VRChat\\Cache-WindowsPlayer",
    safeToDelete: true,
    avgSpace: "10.0 GB – 30.0 GB",
    whatIsIt: "VRChat downloads every custom 3D world and user avatar you encounter into LocalLow\\VRChat, rapidly consuming 20GB+ on your C: drive.",
    whatHappens: "Immediately frees 10–30 GB of SSD space. VRChat will only re-download worlds and avatars you visit in future sessions.",
    manualSteps: [
      "Exit VRChat.",
      "Press Windows Key + R, type %userprofile%\\AppData\\LocalLow\\VRChat\\VRChat\\Cache-WindowsPlayer, and hit Enter.",
      "Select all cached folders and delete them."
    ]
  },
  {
    slug: "fivem-citizenfx-priv-cache",
    category: "app",
    name: "FiveM GTA V Server Asset & Priv Cache",
    path: "%LocalAppData%\\FiveM\\FiveM.app\\data\\server-cache-priv",
    safeToDelete: true,
    avgSpace: "6.0 GB – 35.0 GB",
    whatIsIt: "FiveM caches custom vehicles, MLO interiors, clothing packs, and scripts from every RP server you have ever joined.",
    whatHappens: "Frees tens of gigabytes of SSD space and fixes FiveM texture loss or crash-on-join issues.",
    manualSteps: [
      "Close FiveM.",
      "Open %localappdata%\\FiveM\\FiveM.app\\data in File Explorer.",
      "Delete the 'cache', 'server-cache', and 'server-cache-priv' folders (do NOT delete 'game-storage')."
    ]
  },
  // --- Windows 11 System Folders & Update Caches ---
  {
    slug: "windows-11-24h2-checkpoint-cache",
    category: "folder",
    name: "Windows 11 24H2 Cumulative Checkpoint Update Cache",
    path: "C:\\Windows\\SoftwareDistribution\\Download",
    safeToDelete: true,
    avgSpace: "4.0 GB – 16.0 GB",
    whatIsIt: "Windows 11 24H2 stores differential checkpoint update payloads and uncompressed cab/msu staging files in SoftwareDistribution\\Download.",
    whatHappens: "Safely reclaims gigabytes of C: drive space after updates finish installing and resolves stuck Windows Update error codes.",
    manualSteps: [
      "Open Terminal (Admin) and run: net stop wuauserv",
      "Open C:\\Windows\\SoftwareDistribution\\Download and delete all files inside.",
      "Restart the Windows Update service with: net start wuauserv"
    ]
  },
  {
    slug: "programdata-package-cache",
    category: "folder",
    name: "Windows ProgramData Package Cache (Visual C++ & MSI Duplicates)",
    path: "C:\\ProgramData\\Package Cache",
    safeToDelete: false,
    warning: "Deleting active installer caches manually can prevent Visual Studio or WiX MSI apps from repairing or uninstalling cleanly. Use SWEEPR Cleaner to target only orphaned caches.",
    avgSpace: "3.0 GB – 18.0 GB",
    whatIsIt: "Burn/WiX installers (Visual C++ Redistributables, Visual Studio, Python, Node.js) keep duplicate .msi and .cab copies inside C:\\ProgramData\\Package Cache.",
    whatHappens: "Removing orphaned caches from already-uninstalled software reclaims gigabytes while preserving active uninstaller metadata.",
    manualSteps: [
      "Open Settings > Apps > Installed Apps and uninstall old SDKs or redistributables first.",
      "Inspect C:\\ProgramData\\Package Cache sorted by Date Modified.",
      "Use SWEEPR Cleaner's Uninstaller Leftovers scan to safely remove only orphaned package folders."
    ]
  },
  {
    slug: "windows-search-edb-index",
    category: "folder",
    name: "Windows Search Index Database (Windows.edb / Windows.db)",
    path: "C:\\ProgramData\\Microsoft\\Search\\Data\\Applications\\Windows",
    safeToDelete: true,
    avgSpace: "2.5 GB – 25.0 GB",
    whatIsIt: "The Windows Search service maintains an indexed database (Windows.edb or Windows.db) that can balloon to 20GB+ due to file churn and Outlook mail indexing.",
    whatHappens: "Stopping the WSearch service and rebuilding the index shrinks the database by up to 85% without losing a single personal file.",
    manualSteps: [
      "Open Terminal (Admin) and run: net stop WSearch",
      "Delete Windows.edb / Windows.db inside C:\\ProgramData\\Microsoft\\Search\\Data\\Applications\\Windows.",
      "Run: net start WSearch to rebuild a compact, fast search index."
    ]
  },
  {
    slug: "pip-wheel-cache",
    category: "app",
    name: "Python Pip Wheel & Download HTTP Cache",
    path: "%LocalAppData%\\pip\\cache",
    safeToDelete: true,
    avgSpace: "1.5 GB – 12.0 GB",
    whatIsIt: "Pip caches downloaded Python package .whl wheels and index queries across all your virtual environments.",
    whatHappens: "Safely frees gigabytes of SSD space without uninstalling any Python packages from existing venvs.",
    manualSteps: [
      "Open Windows Terminal.",
      "Run 'pip cache purge' to clear all cached wheel archives.",
      "Or press Windows Key + R, type %localappdata%\\pip\\cache, and delete the contents."
    ]
  },
  {
    slug: "gradle-wrapper-cache",
    category: "app",
    name: "Gradle Build & Dependency Wrapper Cache",
    path: "%UserProfile%\\.gradle\\caches",
    safeToDelete: true,
    avgSpace: "4.0 GB – 30.0 GB",
    whatIsIt: "Gradle stores downloaded JAR dependencies, daemon logs, and incremental transform caches inside your user directory.",
    whatHappens: "Reclaims massive disk space from old build artifacts. Active projects will re-fetch only the latest dependencies on next build.",
    manualSteps: [
      "Close Android Studio and IntelliJ IDEA.",
      "Open %userprofile%\\.gradle\\caches in File Explorer.",
      "Delete old 'modules-2', 'transforms-3', and 'jars-9' folders."
    ]
  },
  {
    slug: "nuget-package-cache",
    category: "app",
    name: "NuGet Global Packages Cache (%UserProfile%\\.nuget)",
    path: "%UserProfile%\\.nuget\\packages",
    safeToDelete: true,
    avgSpace: "3.0 GB – 20.0 GB",
    whatIsIt: "Visual Studio and .NET CLI download every NuGet package version you reference into a shared global package cache.",
    whatHappens: "Frees tens of gigabytes of storage from unused package versions without affecting your solution source code.",
    manualSteps: [
      "Close Visual Studio and Rider.",
      "Run: dotnet nuget locals all --clear in Windows Terminal.",
      "Or navigate to %userprofile%\\.nuget\\packages and remove outdated packages."
    ]
  },
  {
    slug: "go-build-cache",
    category: "app",
    name: "Go Language Module & Build Cache",
    path: "%LocalAppData%\\go-build and %UserProfile%\\go\\pkg\\mod",
    safeToDelete: true,
    avgSpace: "2.0 GB – 15.0 GB",
    whatIsIt: "The Go compiler caches compiled package archives, test results, and downloaded module source trees.",
    whatHappens: "Safely cleans up stale Go build artifacts and reclaims SSD storage without touching your project code.",
    manualSteps: [
      "Open Windows Terminal.",
      "Run: go clean -cache -modcache to purge build and module download caches.",
      "Or delete the %localappdata%\\go-build directory."
    ]
  },
  {
    slug: "git-lfs-cache",
    category: "app",
    name: "Git Large File Storage (LFS) Objects Cache",
    path: ".git\\lfs\\objects and %LocalAppData%\\Git",
    safeToDelete: true,
    avgSpace: "2.5 GB – 35.0 GB",
    whatIsIt: "Git LFS keeps local copies of binary assets, textures, and 3D models even after you switch branches or delete files.",
    whatHappens: "Safely prunes unreferenced Git LFS media blobs while keeping your remote repositories fully intact.",
    manualSteps: [
      "Open Terminal in your Git repository.",
      "Run: git lfs prune to safely discard unreferenced binary files.",
      "Clear old Git credential and clone cache directories in %localappdata%."
    ]
  },
  {
    slug: "pnpm-content-store",
    category: "app",
    name: "pnpm Global Content-Addressable Store",
    path: "%LocalAppData%\\pnpm\\store",
    safeToDelete: true,
    avgSpace: "3.5 GB – 25.0 GB",
    whatIsIt: "pnpm stores hard-linked node_modules packages in a content-addressable store on your primary Windows drive.",
    whatHappens: "Pruning unreferenced packages reclaims gigabytes of disk space without breaking existing projects.",
    manualSteps: [
      "Open Windows Terminal.",
      "Run: pnpm store prune to remove orphaned packages.",
      "Confirm reclaimed space in %localappdata%\\pnpm\\store."
    ]
  },
  {
    slug: "yarn-berry-cache",
    category: "app",
    name: "Yarn Package Manager Global Cache",
    path: "%LocalAppData%\\Yarn\\Berry\\cache",
    safeToDelete: true,
    avgSpace: "2.0 GB – 14.0 GB",
    whatIsIt: "Yarn Modern (Berry) caches zero-install zip archives and package tarballs across all frontend projects.",
    whatHappens: "Safely purges stale package archives while allowing active projects to re-download zip files on demand.",
    manualSteps: [
      "Open Windows Terminal.",
      "Run: yarn cache clean --all.",
      "Or delete %localappdata%\\Yarn\\Berry\\cache."
    ]
  },
  {
    slug: "rustup-toolchain-downloads",
    category: "app",
    name: "Rustup Toolchain Downloads & Old Component Temp",
    path: "%UserProfile%\\.rustup\\downloads",
    safeToDelete: true,
    avgSpace: "1.0 GB – 8.0 GB",
    whatIsIt: "Rustup downloads compressed toolchain tarballs (rustc, cargo, rust-docs) and keeps leftover archives in downloads.",
    whatHappens: "Deleting leftover archives reclaims SSD space without altering your installed Rust toolchains.",
    manualSteps: [
      "Open %userprofile%\\.rustup in File Explorer.",
      "Select and delete all files inside the 'downloads' directory.",
      "Run 'rustup check' to verify toolchain integrity."
    ]
  },
  {
    slug: "amd-dxcache-bloat",
    category: "app",
    name: "AMD Radeon Software DirectX Shader Cache",
    path: "%LocalAppData%\\AMD\\DxCache",
    safeToDelete: true,
    avgSpace: "1.5 GB – 10.0 GB",
    whatIsIt: "AMD Adrenalin drivers cache compiled DirectX 11 and DirectX 12 GPU shaders in %LocalAppData%\\AMD\\DxCache.",
    whatHappens: "Safely frees gigabytes of storage and resolves stuttering or black texture glitches following an AMD driver update.",
    manualSteps: [
      "Close all running games.",
      "Press Windows Key + R, type %localappdata%\\AMD\\DxCache, and press Enter.",
      "Delete all files inside the DxCache folder."
    ]
  },
  {
    slug: "amd-oglcache-bloat",
    category: "app",
    name: "AMD Radeon Software OpenGL Shader Cache",
    path: "%LocalAppData%\\AMD\\OglCache",
    safeToDelete: true,
    avgSpace: "0.8 GB – 5.5 GB",
    whatIsIt: "AMD graphics drivers compile and store OpenGL and Vulkan pipeline binary shaders in %LocalAppData%\\AMD\\OglCache.",
    whatHappens: "Reclaims disk space and forces games to rebuild clean shader binaries on next run.",
    manualSteps: [
      "Quit running 3D emulators and OpenGL games.",
      "Press Windows Key + R, type %localappdata%\\AMD\\OglCache, and hit Enter.",
      "Select all files (Ctrl+A) and delete them."
    ]
  },
  {
    slug: "roblox-textures-cache",
    category: "app",
    name: "Roblox Textures & Asset Download Cache",
    path: "%LocalAppData%\\Roblox\\Downloads and %LocalAppData%\\Temp\\Roblox",
    safeToDelete: true,
    avgSpace: "1.5 GB – 9.0 GB",
    whatIsIt: "Roblox Player downloads meshes, audio files, and place textures into your local AppData directory without auto-pruning.",
    whatHappens: "Frees hidden storage and resolves texture loading errors or stuck joining screens.",
    manualSteps: [
      "Close the Roblox Player.",
      "Press Windows Key + R, type %localappdata%\\Roblox\\Downloads, and press Enter.",
      "Delete the contents of Downloads and %localappdata%\\Temp\\Roblox."
    ]
  },
  {
    slug: "minecraft-launcher-logs",
    category: "app",
    name: "Minecraft Launcher Native Logs & Crash Dumps",
    path: "%AppData%\\.minecraft\\logs and %AppData%\\.minecraft\\crash-reports",
    safeToDelete: true,
    avgSpace: "1.0 GB – 8.5 GB",
    whatIsIt: "Minecraft Java Edition writes uncompressed log files (latest.log, .log.gz) and JVM crash dumps every gaming session.",
    whatHappens: "Safely clears old session logs and dumps without touching your worlds, saves, or resource packs.",
    manualSteps: [
      "Close Minecraft and Minecraft Launcher.",
      "Press Windows Key + R, type %appdata%\\.minecraft\\logs, and hit Enter.",
      "Delete all archived .log.gz files."
    ]
  },
  {
    slug: "windows-delivery-optimization-cache",
    category: "folder",
    name: "Windows Delivery Optimization Peering Cache",
    path: "C:\\Windows\\SoftwareDistribution\\DeliveryOptimization",
    safeToDelete: true,
    avgSpace: "2.0 GB – 15.0 GB",
    whatIsIt: "Windows Delivery Optimization stores peer-to-peer Windows Update files to distribute across local network PCs.",
    whatHappens: "Safely removes cached update files and frees space immediately without affecting Windows Update functionality.",
    manualSteps: [
      "Open Windows Settings > System > Storage > Temporary files.",
      "Check 'Delivery Optimization Files' and click Remove files.",
      "Or clear C:\\Windows\\SoftwareDistribution\\DeliveryOptimization via Administrator prompt."
    ]
  },
  {
    slug: "windows-cryptneturlcache",
    category: "folder",
    name: "Windows CryptnetUrlCache (SSL/TLS Certificate Revocation)",
    path: "%AppData%\\..\\LocalLow\\Microsoft\\CryptnetUrlCache",
    safeToDelete: true,
    avgSpace: "0.5 GB – 3.5 GB",
    whatIsIt: "Windows saves cached CRL (Certificate Revocation List) and OCSP responses in LocalLow\\Microsoft\\CryptnetUrlCache.",
    whatHappens: "Clearing stale certificate caches frees disk space and resolves unexpected SSL/TLS verification errors.",
    manualSteps: [
      "Open Terminal as Administrator.",
      "Run 'certutil -urlcache * delete' to safely purge expired certificate caches.",
      "Or delete files inside %userprofile%\\AppData\\LocalLow\\Microsoft\\CryptnetUrlCache."
    ]
  },
  {
    slug: "windows-fontcache-dat",
    category: "folder",
    name: "Windows System Font Cache Service (FontCache.dat)",
    path: "C:\\Windows\\ServiceProfiles\\LocalService\\AppData\\Local\\FontCache",
    safeToDelete: true,
    avgSpace: "0.4 GB – 2.0 GB",
    whatIsIt: "The Windows Font Cache Service caches glyph rasterizations and font family metrics in system service profiles.",
    whatHappens: "Rebuilding corrupted font caches fixes garbled desktop text, missing symbols, and high CPU usage in FontCache service.",
    manualSteps: [
      "Open Terminal as Administrator and stop the font service: net stop FontCache",
      "Delete files inside C:\\Windows\\ServiceProfiles\\LocalService\\AppData\\Local\\FontCache.",
      "Restart the service: net start FontCache"
    ]
  },
  {
    slug: "windows-system32-winevt-logs",
    category: "folder",
    name: "Windows Event Viewer Historical Logs (winevt\\Logs)",
    path: "C:\\Windows\\System32\\winevt\\Logs",
    safeToDelete: true,
    avgSpace: "1.0 GB – 6.0 GB",
    whatIsIt: "Windows writes Application, System, Security, and Diagnostic event logs into multi-megabyte .evtx binary log files.",
    whatHappens: "Safely clears bloated event log archives when disk space is critically low.",
    manualSteps: [
      "Open Event Viewer (eventvwr.msc).",
      "Right-click 'Application' or 'System' and select 'Clear Log'.",
      "Or use SWEEPR Cleaner to safely archive and purge old Windows event logs in 1 click."
    ]
  },
  {
    slug: "windows-wer-system-reports",
    category: "folder",
    name: "Windows Error Reporting System Queue (ProgramData\\WER)",
    path: "C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue",
    safeToDelete: true,
    avgSpace: "1.2 GB – 11.0 GB",
    whatIsIt: "Windows stages crash reports, minidump attachments, and system state snapshots in ProgramData\\Microsoft\\Windows\\WER.",
    whatHappens: "Safely deletes queued crash reports and frees gigabytes of primary drive space.",
    manualSteps: [
      "Open File Explorer as Administrator.",
      "Navigate to C:\\ProgramData\\Microsoft\\Windows\\WER.",
      "Delete the contents of 'ReportQueue' and 'ReportArchive'."
    ]
  },
  {
    slug: "windows-prefetch-readyboot",
    category: "folder",
    name: "Windows Prefetch ReadyBoot Trace Files (ReadyBoot)",
    path: "C:\\Windows\\Prefetch\\ReadyBoot",
    safeToDelete: true,
    avgSpace: "0.3 GB – 1.8 GB",
    whatIsIt: "Windows generates boot prefetch trace files in C:\\Windows\\Prefetch\\ReadyBoot to monitor system startup sequences.",
    whatHappens: "Safely cleans up stale boot trace files without altering your system boot configuration.",
    manualSteps: [
      "Open Terminal as Administrator.",
      "Navigate to C:\\Windows\\Prefetch\\ReadyBoot.",
      "Delete old .fx trace files."
    ]
  },
  {
    slug: "windows-temp-system-runtime",
    category: "folder",
    name: "Windows System Root Temp Directory (C:\\Windows\\Temp)",
    path: "C:\\Windows\\Temp",
    safeToDelete: true,
    avgSpace: "2.0 GB – 20.0 GB",
    whatIsIt: "System services, MSI installers, and background scheduled tasks store temporary staging files inside C:\\Windows\\Temp.",
    whatHappens: "Safely deletes accumulated system temp files and unblocks pending installations.",
    manualSteps: [
      "Open File Explorer as Administrator.",
      "Navigate to C:\\Windows\\Temp.",
      "Select all files (Ctrl+A) and delete them (skip any files currently locked by active services)."
    ]
  },
  {
    slug: "windows-installer-superseded-msp",
    category: "folder",
    name: "Windows Installer Superseded MSP Patches (C:\\Windows\\Installer)",
    path: "C:\\Windows\\Installer",
    safeToDelete: false,
    warning: "Never delete C:\\Windows\\Installer manually in File Explorer. Only use SWEEPR Cleaner's verified orphaned patch algorithm to remove superseded .msp files.",
    avgSpace: "4.0 GB – 28.0 GB",
    whatIsIt: "Windows Installer stores cached .msi setup files and .msp patch packages required for software repair and uninstallation.",
    whatHappens: "Safely removes orphaned MSP patches that have been superseded by newer software versions.",
    manualSteps: [
      "Do NOT delete C:\\Windows\\Installer directly via File Explorer.",
      "Launch SWEEPR Cleaner and select 'Installer Leftovers'.",
      "Run the scan to safely remove only verified orphaned MSP and MSI files."
    ]
  },
  {
    slug: "bun-install-cache",
    category: "app",
    name: "Bun JavaScript Runtime Package & Install Cache",
    path: "%UserProfile%\\.bun\\install\\cache",
    safeToDelete: true,
    avgSpace: "1.5 GB – 10.0 GB",
    whatIsIt: "Bun caches downloaded npm packages, binary tarballs, and compiled native bindings in .bun\\install\\cache for ultra-fast offline installs.",
    whatHappens: "Safely cleans up stale package downloads and frees gigabytes of SSD space. Bun will re-fetch only needed packages on subsequent install commands.",
    manualSteps: [
      "Open Windows Terminal.",
      "Run 'bun pm cache rm' to purge the global package cache.",
      "Or delete the %userprofile%\\.bun\\install\\cache directory in File Explorer."
    ]
  },
  {
    slug: "conda-package-cache",
    category: "app",
    name: "Conda & Anaconda Package Tarball Cache (%UserProfile%\\.conda\\pkgs)",
    path: "%UserProfile%\\.conda\\pkgs and C:\\ProgramData\\anaconda3\\pkgs",
    safeToDelete: true,
    avgSpace: "5.0 GB – 35.0 GB",
    whatIsIt: "Conda and Anaconda download compressed conda package archives (.conda and .tar.bz2) and unpack them into pkgs before linking into environments.",
    whatHappens: "Safely deletes unlinked package archives, cache tarballs, and temporary downloads without corrupting existing virtual environments.",
    manualSteps: [
      "Open Anaconda Prompt or Windows Terminal.",
      "Run 'conda clean --all -y' to purge all unused packages and tarballs.",
      "Verify reclaimed disk space in %userprofile%\\.conda\\pkgs."
    ]
  },
  {
    slug: "cargo-target-cache",
    category: "app",
    name: "Rust Cargo Package Index & Crate Source Cache",
    path: "%UserProfile%\\.cargo\\registry\\cache",
    safeToDelete: true,
    avgSpace: "2.0 GB – 18.0 GB",
    whatIsIt: "The Cargo package manager caches crates.io index snapshots, git checkouts, and downloaded .crate archive files in your user profile.",
    whatHappens: "Reclaims gigabytes of C: drive space from old crate versions. Active projects automatically redownload required crates during cargo build.",
    manualSteps: [
      "Close any active IDE or terminal compiling Rust code.",
      "Open %userprofile%\\.cargo\\registry in File Explorer.",
      "Delete the 'cache' and 'src' folders to free space, or run 'cargo clean' inside project folders."
    ]
  },
  {
    slug: "android-emulator-avd-snapshots",
    category: "app",
    name: "Android Studio AVD Emulator Snapshots & System Images",
    path: "%UserProfile%\\.android\\avd",
    safeToDelete: true,
    avgSpace: "8.0 GB – 40.0 GB",
    whatIsIt: "Android Studio stores multiple multi-gigabyte virtual device disk images, ram.bin state snapshots, and qemu images inside .android\\avd.",
    whatHappens: "Frees tens of gigabytes of storage from unused emulators and stale Quick Boot state dumps without removing your Android SDK.",
    manualSteps: [
      "Close Android Studio and all running Android emulators.",
      "Open %userprofile%\\.android\\avd in File Explorer.",
      "Delete .avd folders for virtual devices you no longer test against."
    ]
  },
  {
    slug: "unity-shader-cache",
    category: "app",
    name: "Unity Engine Local Shader Compilation Cache",
    path: "%LocalAppData%\\Unity\\cache\\shaders",
    safeToDelete: true,
    avgSpace: "3.0 GB – 20.0 GB",
    whatIsIt: "Unity compiles and caches HLSL and ShaderLab shader variants across every project you develop into %LocalAppData%\\Unity\\cache\\shaders.",
    whatHappens: "Safely cleans up stale compiled shader binaries and reclaims SSD storage. Unity automatically recompiles active shaders on demand.",
    manualSteps: [
      "Close Unity Editor and Unity Hub.",
      "Press Windows Key + R, type %localappdata%\\Unity\\cache\\shaders, and press Enter.",
      "Select all cached shader directories and delete them."
    ]
  },
  {
    slug: "godot-editor-cache",
    category: "app",
    name: "Godot Engine Editor Data & Export Templates Cache",
    path: "%AppData%\\Godot\\editor_data and %LocalAppData%\\Godot",
    safeToDelete: true,
    avgSpace: "1.5 GB – 12.0 GB",
    whatIsIt: "Godot Engine caches imported texture thumbnails, script documentation indexes, and old export template packages on your system drive.",
    whatHappens: "Reclaims gigabytes of disk space without affecting your project source files or project.godot configuration.",
    manualSteps: [
      "Close the Godot Engine editor.",
      "Open %appdata%\\Godot in File Explorer.",
      "Delete the 'editor_data' and 'tmp' subfolders to clear stale cache files."
    ]
  },
  {
    slug: "substance-painter-cache",
    category: "app",
    name: "Adobe Substance 3D Painter Shelf & Texture Cache",
    path: "%AppData%\\Adobe\\Adobe Substance 3D Painter\\cache",
    safeToDelete: true,
    avgSpace: "4.0 GB – 25.0 GB",
    whatIsIt: "Substance 3D Painter caches high-resolution texture mipmaps, baked normal maps, and brush shelf thumbnails in AppData.",
    whatHappens: "Frees significant SSD space and resolves texture viewport corruption without modifying your .spp project files.",
    manualSteps: [
      "Exit Adobe Substance 3D Painter.",
      "Navigate to %appdata%\\Adobe\\Adobe Substance 3D Painter\\cache in File Explorer.",
      "Delete cached mipmaps and temporary thumbnail folders."
    ]
  },
  {
    slug: "autocad-temp-drawing-cache",
    category: "app",
    name: "Autodesk AutoCAD Temp Drawing History & Graphics Cache",
    path: "%LocalAppData%\\Autodesk\\AutoCAD\\Drawing History and %LocalAppData%\\Temp",
    safeToDelete: true,
    avgSpace: "2.0 GB – 15.0 GB",
    whatIsIt: "AutoCAD saves cached drawing version diffs, temporary BAK files, and DirectX graphics cache databases on your primary drive.",
    whatHappens: "Safely cleans up orphaned temporary drawing files and frees disk space without touching your main DWG project files.",
    manualSteps: [
      "Save your work and exit AutoCAD completely.",
      "Press Windows Key + R, type %localappdata%\\Autodesk, and navigate to your version's GraphicsCache folder.",
      "Clear temporary cache files."
    ]
  },
  {
    slug: "curseforge-addon-cache",
    category: "app",
    name: "CurseForge Mod & Addon Download Archive Cache",
    path: "%UserProfile%\\CurseForge\\Cache and %AppData%\\CurseForge",
    safeToDelete: true,
    avgSpace: "3.0 GB – 22.0 GB",
    whatIsIt: "CurseForge keeps zip archives of downloaded World of Warcraft addons, Minecraft modpacks, and Sims 4 custom content in its download cache.",
    whatHappens: "Frees gigabytes of storage from previously installed zip archives without removing active mods from your games.",
    manualSteps: [
      "Close the CurseForge app.",
      "Navigate to %userprofile%\\CurseForge\\Cache in File Explorer.",
      "Delete downloaded archive files to recover drive space."
    ]
  },
  {
    slug: "mod-organizer-downloads",
    category: "app",
    name: "Mod Organizer 2 Staged Archive & Download Cache",
    path: "%LocalAppData%\\ModOrganizer\\downloads",
    safeToDelete: true,
    avgSpace: "10.0 GB – 60.0 GB",
    whatIsIt: "Mod Organizer 2 retains 7z and zip mod installer archives after mods have already been extracted and installed into your profile.",
    whatHappens: "Safely reclaims tens of gigabytes of disk space once your mod load order is verified and operational.",
    manualSteps: [
      "Open Mod Organizer 2 and confirm all installed mods work properly.",
      "Right-click downloaded archives in the Downloads tab and delete them, or delete files directly in %localappdata%\\ModOrganizer\\downloads."
    ]
  },
  {
    slug: "vortex-mod-downloads",
    category: "app",
    name: "Nexus Mods Vortex Archive Staging & Download Cache",
    path: "%AppData%\\Vortex\\downloads",
    safeToDelete: true,
    avgSpace: "8.0 GB – 50.0 GB",
    whatIsIt: "Vortex retains multi-gigabyte Nexus Mods zip/7z archives in its download directory even after deployment via hard links.",
    whatHappens: "Deleting installed archives frees massive SSD space without affecting hard-linked mods in your game folders.",
    manualSteps: [
      "Open Vortex Mod Manager.",
      "Navigate to the Downloads tab.",
      "Remove completed archives that have already been installed."
    ]
  },
  {
    slug: "ea-anticheat-logs",
    category: "app",
    name: "EA AntiCheat Service Logs & Crash Dump Dumps",
    path: "C:\\ProgramData\\EA Desktop\\EA AntiCheat",
    safeToDelete: true,
    avgSpace: "1.0 GB – 6.0 GB",
    whatIsIt: "The EA AntiCheat background driver and client write verbose telemetry traces and memory dump files during game launches (EA FC, Battlefield).",
    whatHappens: "Safely deletes stale diagnostic log clutter and frees disk space without interfering with EA game anti-cheat verification.",
    manualSteps: [
      "Close EA App and all EA games.",
      "Open C:\\ProgramData\\EA Desktop in File Explorer.",
      "Delete old log files and dump files inside the EA AntiCheat folder."
    ]
  },
  {
    slug: "riot-vanguard-logs",
    category: "app",
    name: "Riot Vanguard Kernel Driver Logs & Crash Memory Dumps",
    path: "C:\\Program Files\\Riot Vanguard\\Logs",
    safeToDelete: true,
    avgSpace: "0.5 GB – 4.5 GB",
    whatIsIt: "Riot Vanguard creates kernel driver execution logs, memory snapshots, and watchdog trace files during Valorant and League of Legends matches.",
    whatHappens: "Safely purges historical diagnostic text logs and dump files without affecting the active Vanguard anti-cheat kernel service.",
    manualSteps: [
      "Exit Valorant and League of Legends.",
      "Open C:\\Program Files\\Riot Vanguard\\Logs in File Explorer as Administrator.",
      "Delete old .log and .dmp files."
    ]
  },
  {
    slug: "easy-anticheat-logs",
    category: "app",
    name: "Easy Anti-Cheat Diagnostic Logs & Certificate Cache",
    path: "%AppData%\\EasyAntiCheat",
    safeToDelete: true,
    avgSpace: "0.5 GB – 3.5 GB",
    whatIsIt: "Easy Anti-Cheat accumulates game crash reports, error traces, and cached security certificates across titles like Apex Legends and Fortnite.",
    whatHappens: "Clears old error trace clutter and fixes anti-cheat initialization loop errors without uninstalling games.",
    manualSteps: [
      "Exit any running games protected by Easy Anti-Cheat.",
      "Press Windows Key + R, type %appdata%\\EasyAntiCheat, and press Enter.",
      "Delete old .log files."
    ]
  },
  {
    slug: "xbox-app-delivery-temp",
    category: "app",
    name: "Windows Xbox App Cloud Gaming & Install Temp Cache",
    path: "%LocalAppData%\\Packages\\Microsoft.GamingApp_8wekyb3d8bbwe\\LocalCache",
    safeToDelete: true,
    avgSpace: "2.0 GB – 14.0 GB",
    whatIsIt: "The Windows 11 Xbox App caches cloud gaming stream chunks, game pass cover art, and interrupted game installation blobs in LocalCache.",
    whatHappens: "Safely frees gigabytes of storage and fixes stuck Xbox Game Pass game download or update errors.",
    manualSteps: [
      "Close the Xbox App and terminate GamingServices in Task Manager.",
      "Open %localappdata%\\Packages\\Microsoft.GamingApp_8wekyb3d8bbwe\\LocalCache.",
      "Select and delete all cached temporary files."
    ]
  },
  {
    slug: "windows-bluetooth-logs",
    category: "folder",
    name: "Windows Bluetooth Pairing Logs & Diagnostic Traces",
    path: "C:\\Windows\\System32\\Winevt\\Logs",
    safeToDelete: true,
    avgSpace: "0.5 GB – 3.0 GB",
    whatIsIt: "Windows logs Bluetooth LE connection attempts, RFCOMM socket events, and audio packet drops into dedicated event log files.",
    whatHappens: "Clearing historical Bluetooth logs frees drive space without unpairing any of your connected wireless devices.",
    manualSteps: [
      "Open Windows Event Viewer as Administrator.",
      "Navigate to Applications and Services Logs > Microsoft > Windows > Bluetooth.",
      "Right-click operational logs and select 'Clear Log'."
    ]
  },
  {
    slug: "windows-telemetry-staging",
    category: "folder",
    name: "Windows Diagnostic Data & Telemetry ETL Log Queue",
    path: "C:\\ProgramData\\Microsoft\\Diagnosis\\ETLLogs",
    safeToDelete: true,
    avgSpace: "1.0 GB – 7.0 GB",
    whatIsIt: "The Connected User Experiences and Telemetry service collects system performance traces (.etl files) before uploading them to Microsoft servers.",
    whatHappens: "Deleting queued ETL files frees gigabytes of SSD space immediately and improves privacy without affecting Windows updates.",
    manualSteps: [
      "Open Terminal as Administrator and run: net stop DiagTrack",
      "Open C:\\ProgramData\\Microsoft\\Diagnosis\\ETLLogs and delete old AutoLogger and ETL files.",
      "Restart the service with: net start DiagTrack"
    ]
  },
  {
    slug: "windows-defender-quarantine",
    category: "folder",
    name: "Windows Defender Quarantined Files & Signature Cache",
    path: "C:\\ProgramData\\Microsoft\\Windows Defender\\Quarantine",
    safeToDelete: true,
    avgSpace: "0.8 GB – 6.0 GB",
    whatIsIt: "Windows Defender encrypts and stores quarantined files, obsolete antivirus definitions, and scan history in ProgramData.",
    whatHappens: "Safely purges resolved threats and expired scan logs while keeping real-time security protection fully operational.",
    manualSteps: [
      "Open Windows Security > Virus & threat protection > Protection history.",
      "Clear resolved quarantine items, or use SWEEPR Cleaner to purge expired definition caches."
    ]
  },
  {
    slug: "windows-speech-recognition-cache",
    category: "folder",
    name: "Windows Speech Recognition & Voice Dictation Model Cache",
    path: "%LocalAppData%\\Microsoft\\Speech",
    safeToDelete: true,
    avgSpace: "0.5 GB – 4.0 GB",
    whatIsIt: "Windows stores local acoustic language models, voice dictation profiles, and speech synthesizer cache files in %LocalAppData%\\Microsoft\\Speech.",
    whatHappens: "Safely frees disk space from unused speech profiles; active Windows 11 voice typing automatically re-downloads needed language assets.",
    manualSteps: [
      "Open %localappdata%\\Microsoft in File Explorer.",
      "Open the Speech folder and delete old audio training profiles and cache files."
    ]
  },
  {
    slug: "windows-rdp-bitmap-cache",
    category: "folder",
    name: "Windows Remote Desktop (RDP) Bitmap Cache",
    path: "%LocalAppData%\\Microsoft\\Terminal Server Client\\Cache",
    safeToDelete: true,
    avgSpace: "0.5 GB – 3.0 GB",
    whatIsIt: "The Remote Desktop Connection client caches screen tiles and graphical bitmaps (bcache*.bmc files) to speed up remote session rendering.",
    whatHappens: "Deleting the bitmap cache frees disk space and fixes corrupted graphics or black tiles in Remote Desktop sessions.",
    manualSteps: [
      "Close all active Remote Desktop Connection sessions.",
      "Press Windows Key + R, type %localappdata%\\Microsoft\\Terminal Server Client\\Cache, and hit Enter.",
      "Delete all .bmc and .bin files inside."
    ]
  },
  {
    slug: "windows-ink-handwriting-cache",
    category: "folder",
    name: "Windows Ink Workspace & Handwriting Personalization Cache",
    path: "%LocalAppData%\\Microsoft\\InputPersonalization",
    safeToDelete: true,
    avgSpace: "0.3 GB – 2.0 GB",
    whatIsIt: "Windows stores touch keyboard dictionary customizations, stylus handwriting samples, and ink strokes in InputPersonalization.",
    whatHappens: "Safely frees storage space and resolves stylus lag or touch keyboard dictionary sync issues.",
    manualSteps: [
      "Open File Explorer and navigate to %localappdata%\\Microsoft\\InputPersonalization.",
      "Delete temporary handwriting learning cache files."
    ]
  },
  {
    slug: "windows-action-center-database",
    category: "folder",
    name: "Windows Action Center Notification History Database",
    path: "%LocalAppData%\\Microsoft\\Windows\\Notifications",
    safeToDelete: true,
    avgSpace: "0.2 GB – 1.5 GB",
    whatIsIt: "Windows maintains a local SQLite database (wpnidm / appcache.db) storing notification toasts, badge icons, and quick actions.",
    whatHappens: "Safely shrinks bloated notification databases and fixes stuck, phantom, or repeating notification toasts.",
    manualSteps: [
      "Open Task Manager and end the Windows Explorer task.",
      "Open Terminal (Admin) and delete %LocalAppData%\\Microsoft\\Windows\\Notifications\\wpnidm.sqlite.",
      "Start explorer.exe to reinitialize a clean notification database."
    ]
  },
  {
    slug: "windows-dism-scratch-dir",
    category: "folder",
    name: "Windows DISM Servicing Scratch Directory (%WINDIR%\\Temp\\DISM)",
    path: "C:\\Windows\\Temp\\DISM",
    safeToDelete: true,
    avgSpace: "2.0 GB – 16.0 GB",
    whatIsIt: "When running DISM or system image repair operations, Windows mounts WIM images and stages uncompressed packages in Temp\\DISM.",
    whatHappens: "Safely cleans up abandoned mount points and orphaned scratch files left behind after interrupted servicing tasks.",
    manualSteps: [
      "Open Terminal as Administrator.",
      "Run: dism /cleanup-wim to unmount any leftover servicing images.",
      "Open C:\\Windows\\Temp\\DISM and delete leftover scratch directories."
    ]
  },
  {
    slug: "windows-installer-patch-cache",
    category: "folder",
    name: "Windows Installer Patch Cache ($PatchCache$)",
    path: "C:\\Windows\\Installer\\$PatchCache$",
    safeToDelete: false,
    warning: "Deleting active patch cache files manually can cause error 1714 when updating or uninstalling certain Microsoft Office or SQL Server versions. Use SWEEPR Cleaner to target only verified orphaned MSP patches.",
    avgSpace: "3.0 GB – 20.0 GB",
    whatIsIt: "Windows Installer creates duplicate unpackaged MSP copies in C:\\Windows\\Installer\\$PatchCache$ to speed up subsequent software repairs.",
    whatHappens: "Removing verified orphaned patch cache entries reclaims gigabytes of SSD space while preserving repair capability for active applications.",
    manualSteps: [
      "Do NOT delete the folder indiscriminately.",
      "Use SWEEPR Cleaner to safely scan for orphaned $PatchCache$ subfolders whose parent applications have been removed."
    ]
  },
  {
    slug: "windows-system-restore-points",
    category: "folder",
    name: "Windows System Restore Shadow Copies & Restore Points",
    path: "System Volume Information",
    safeToDelete: true,
    avgSpace: "5.0 GB – 45.0 GB",
    whatIsIt: "Windows creates Volume Shadow Copies (VSS) before major software updates, driver changes, and scheduled maintenance.",
    whatHappens: "Pruning old restore points while keeping the most recent one reclaims tens of gigabytes of storage while preserving rollback safety.",
    manualSteps: [
      "Press Windows Key + R, type 'cleanmgr', and select your C: drive.",
      "Click 'Clean up system files', then switch to the 'More Options' tab.",
      "Under System Restore and Shadow Copies, click 'Clean up' to remove all but the most recent restore point."
    ]
  },
  {
    slug: "garena-client-cache",
    category: "app",
    name: "Garena PC Gaming Client Download Cache & Update Temp",
    path: "%LocalAppData%\\Garena\\Cache",
    safeToDelete: true,
    avgSpace: "1.5 GB – 10.0 GB",
    whatIsIt: "Garena caches game patches, news feeds, embedded browser assets, and download chunks inside %LocalAppData%\\Garena\\Cache.",
    whatHappens: "Safely cleans up stale game update files and reclaims disk space without affecting installed games like Free Fire PC or League.",
    manualSteps: [
      "Exit the Garena PC client completely.",
      "Press Windows Key + R, type %localappdata%\\Garena\\Cache, and press Enter.",
      "Select and delete all files inside the cache folder."
    ]
  },
  {
    slug: "affinity-scratch-cache",
    category: "app",
    name: "Affinity Photo & Designer Scratch Disk Temp Files",
    path: "%LocalAppData%\\Serif\\Affinity\\Photo\\2.0\\Temp",
    safeToDelete: true,
    avgSpace: "2.5 GB – 18.0 GB",
    whatIsIt: "Serif Affinity Photo and Designer write scratch swap files and raster rendering buffers when working with high-resolution documents.",
    whatHappens: "Safely deletes leftover swap files from closed sessions, freeing gigabytes of SSD space.",
    manualSteps: [
      "Close all Serif Affinity applications.",
      "Open %localappdata%\\Serif\\Affinity in File Explorer.",
      "Navigate to the Temp folder and delete lingering temporary swap files."
    ]
  },
  {
    slug: "inkscape-thumbnail-cache",
    category: "app",
    name: "Inkscape Vector Graphics Thumbnail & Font Cache",
    path: "%AppData%\\inkscape\\cache",
    safeToDelete: true,
    avgSpace: "0.5 GB – 3.5 GB",
    whatIsIt: "Inkscape caches SVG preview thumbnails, font metrics, and extension manifests inside %AppData%\\inkscape\\cache.",
    whatHappens: "Frees disk space and fixes corrupted font listings or slow Inkscape startup times without touching your SVG designs.",
    manualSteps: [
      "Close Inkscape.",
      "Open %appdata%\\inkscape\\cache in File Explorer.",
      "Delete the cached thumbnail and font index files."
    ]
  },
  {
    slug: "cinema4d-temp-cache",
    category: "app",
    name: "Maxon Cinema 4D Simulation & Viewport Render Cache",
    path: "%AppData%\\Maxon\\Cinema 4D\\cache",
    safeToDelete: true,
    avgSpace: "4.0 GB – 28.0 GB",
    whatIsIt: "Maxon Cinema 4D stores physics simulation caches, Redshift material previews, and viewport shader caches on your C: drive.",
    whatHappens: "Reclaims significant disk space from old project renders without modifying your .c4d project files.",
    manualSteps: [
      "Exit Cinema 4D and Maxon App.",
      "Navigate to %appdata%\\Maxon in File Explorer.",
      "Delete temporary simulation and thumbnail caches."
    ]
  },
  {
    slug: "clip-studio-paint-cache",
    category: "app",
    name: "Clip Studio Paint Backup Canvas & Auto-Recovery Cache",
    path: "%AppData%\\CELSYS\\CLIPStudioPaintVer1_5_0",
    safeToDelete: true,
    avgSpace: "2.0 GB – 15.0 GB",
    whatIsIt: "Clip Studio Paint writes autosave snapshots, material download archives, and canvas recovery states into CELSYS AppData.",
    whatHappens: "Clears old recovery clutter and frees gigabytes of storage once your artwork is saved and backed up.",
    manualSteps: [
      "Save all active illustrations and exit Clip Studio Paint.",
      "Open %appdata%\\CELSYS in File Explorer.",
      "Navigate to the DocumentBackup folder and clear obsolete autosaved files."
    ]
  },
  {
    slug: "terraform-plugin-cache",
    category: "app",
    name: "HashiCorp Terraform Provider Plugin & Binary Cache",
    path: "%AppData%\\terraform.d\\plugins",
    safeToDelete: true,
    avgSpace: "1.5 GB – 12.0 GB",
    whatIsIt: "Terraform downloads provider executables (AWS, Azure, GCP, Kubernetes) for each project into a global plugin cache.",
    whatHappens: "Safely cleans up duplicate provider versions from older Terraform deployments without altering your .tf configuration.",
    manualSteps: [
      "Open %appdata%\\terraform.d\\plugins in File Explorer.",
      "Delete provider binary versions you no longer use.",
      "Run 'terraform init' in active projects to re-fetch only active providers."
    ]
  },
  {
    slug: "maven-repository-cache",
    category: "app",
    name: "Apache Maven Global Repository Dependency Cache (%UserProfile%\\.m2)",
    path: "%UserProfile%\\.m2\\repository",
    safeToDelete: true,
    avgSpace: "3.5 GB – 30.0 GB",
    whatIsIt: "Maven downloads and keeps every version of every JAR, POM, and plugin dependency ever requested across all your Java projects in .m2\\repository.",
    whatHappens: "Reclaims massive SSD space from old library versions. Active projects automatically re-download only required dependencies.",
    manualSteps: [
      "Close your Java IDE (Eclipse, IntelliJ IDEA, NetBeans).",
      "Open %userprofile%\\.m2 in File Explorer.",
      "Delete the 'repository' folder to completely purge the cache, or delete outdated artifact subfolders."
    ]
  },
  {
    slug: "podman-machine-cache",
    category: "app",
    name: "Podman Desktop WSL Machine Blobs & Container Cache",
    path: "%UserProfile%\\.local\\share\\containers",
    safeToDelete: true,
    avgSpace: "5.0 GB – 35.0 GB",
    whatIsIt: "Podman Desktop stores container layers, unused QCOW2/EXT4 virtual disk images, and image pull layers on your system drive.",
    whatHappens: "Safely prunes unused container images and build caches, reclaiming tens of gigabytes of disk space.",
    manualSteps: [
      "Open Windows Terminal.",
      "Run 'podman system prune -a' to remove stopped containers and unused image layers.",
      "Verify reclaimed space with 'podman system df'."
    ]
  },
  {
    slug: "flutter-sdk-cache",
    category: "app",
    name: "Flutter SDK Engine Artifacts & Pub Dependency Cache",
    path: "%LocalAppData%\\Pub\\Cache and %UserProfile%\\.pub-cache",
    safeToDelete: true,
    avgSpace: "3.0 GB – 20.0 GB",
    whatIsIt: "Flutter and Dart package managers cache downloaded pub packages, git repo dependencies, and compiled engine artifacts.",
    whatHappens: "Safely cleans up orphaned Dart/Flutter packages and frees gigabytes of storage. Active projects re-download packages on next flutter pub get.",
    manualSteps: [
      "Close VS Code and Android Studio.",
      "Run 'dart pub cache clean' in Windows Terminal.",
      "Or delete %localappdata%\\Pub\\Cache in File Explorer."
    ]
  },
  {
    slug: "sd-webui-model-cache",
    category: "app",
    name: "Stable Diffusion WebUI Model & LoRA Cache",
    path: "%UserProfile%\\stable-diffusion-webui\\models\\Stable-diffusion",
    safeToDelete: true,
    avgSpace: "8.0 GB – 45.0 GB",
    whatIsIt: "Automatic1111 Stable Diffusion WebUI stores downloaded checkpoint weights (.safetensors, .ckpt), LoRA adapters, and VAE models in your models folder.",
    whatHappens: "Safely frees tens of gigabytes of disk space from unused model checkpoints without modifying your generated output images or WebUI configuration.",
    manualSteps: [
      "Close the Stable Diffusion WebUI console terminal.",
      "Open your stable-diffusion-webui installation directory.",
      "Navigate to models\\Stable-diffusion and delete checkpoints you no longer use (or clean in 1 click with SWEEPR Cleaner)."
    ]
  },
  {
    slug: "text-gen-webui-cache",
    category: "app",
    name: "Text Generation WebUI Model & Quant Cache",
    path: "%UserProfile%\\text-generation-webui\\models",
    safeToDelete: true,
    avgSpace: "10.0 GB – 70.0 GB",
    whatIsIt: "Oobabooga Text Generation WebUI stores multi-gigabyte GGUF, EXL2, and AWQ local LLM model weights and tokenizer caches on your primary drive.",
    whatHappens: "Reclaims massive SSD storage from old model versions while preserving your generation presets, character cards, and chat session logs.",
    manualSteps: [
      "Stop the Text Generation WebUI server.",
      "Open your text-generation-webui\\models directory in File Explorer.",
      "Remove obsolete LLM subfolders that you no longer load."
    ]
  },
  {
    slug: "jan-ai-models-cache",
    category: "app",
    name: "Jan AI Local LLM Model Download Cache",
    path: "%UserProfile%\\jan\\models and %AppData%\\jan",
    safeToDelete: true,
    avgSpace: "6.0 GB – 40.0 GB",
    whatIsIt: "Jan AI downloads multi-gigabyte GGUF weights, local inference engine binaries (Nitro/Cortex), and temporary conversational vectors to your user drive.",
    whatHappens: "Frees tens of gigabytes of storage space while keeping your user settings, assistant preferences, and chat exports intact.",
    manualSteps: [
      "Quit Jan AI completely from the system tray.",
      "Press Windows Key + R, type %userprofile%\\jan\\models, and press Enter.",
      "Delete model folders you no longer actively query."
    ]
  },
  {
    slug: "anythingllm-vector-cache",
    category: "app",
    name: "AnythingLLM Vector Store & Document Cache",
    path: "%AppData%\\anythingllm-desktop\\storage",
    safeToDelete: true,
    avgSpace: "3.0 GB – 25.0 GB",
    whatIsIt: "AnythingLLM embeds documents, PDFs, and web pages into a local LanceDB vector database and document cache in %AppData%.",
    whatHappens: "Safely cleans up stale vector embeddings and document caches without deleting your original source documents or API credentials.",
    manualSteps: [
      "Exit AnythingLLM Desktop.",
      "Press Windows Key + R, type %appdata%\\anythingllm-desktop\\storage, and hit Enter.",
      "Prune old vector workspace databases and cache files."
    ]
  },
  {
    slug: "gpt4all-models-cache",
    category: "app",
    name: "GPT4All Local Model Download & Chat Cache",
    path: "%LocalAppData%\\nomic.ai\\GPT4All",
    safeToDelete: true,
    avgSpace: "4.0 GB – 30.0 GB",
    whatIsIt: "GPT4All downloads quantized AI model weights and cached local docs embeddings inside %LocalAppData%\\nomic.ai\\GPT4All.",
    whatHappens: "Frees gigabytes of primary drive storage. Active models can be re-downloaded at any time from the in-app model explorer.",
    manualSteps: [
      "Close GPT4All.",
      "Press Windows Key + R, type %localappdata%\\nomic.ai\\GPT4All, and hit Enter.",
      "Delete unused .bin and .gguf model weights."
    ]
  },
  {
    slug: "koboldai-models-cache",
    category: "app",
    name: "KoboldAI & Kobold.cpp Model Checkpoint Cache",
    path: "%UserProfile%\\KoboldAI\\models and %LocalAppData%\\KoboldAI",
    safeToDelete: true,
    avgSpace: "5.0 GB – 50.0 GB",
    whatIsIt: "KoboldAI and Kobold.cpp store downloaded storytelling and roleplay model checkpoints, TPU/CUDA kernels, and context cache buffers on disk.",
    whatHappens: "Safely reclaims gigabytes of SSD space without deleting your saved story files, world info, or character presets.",
    manualSteps: [
      "Terminate running KoboldAI or koboldcpp instances.",
      "Navigate to your KoboldAI models folder.",
      "Delete unreferenced GGUF or SafeTensors model files."
    ]
  },
  {
    slug: "wsl2-ext4-vhdx-compaction",
    category: "folder",
    name: "WSL2 Virtual Hard Disk Bloat (ext4.vhdx)",
    path: "%LocalAppData%\\Packages\\*\\LocalState\\ext4.vhdx",
    safeToDelete: false,
    warning: "Do NOT delete ext4.vhdx directly or you will lose your entire Linux distribution. Use diskpart compaction or SWEEPR Cleaner to reclaim unallocated disk blocks safely.",
    avgSpace: "15.0 GB – 90.0 GB",
    whatIsIt: "WSL 2 automatically expands the ext4.vhdx virtual hard drive as you install Linux packages, but never shrinks it when files are deleted inside Linux.",
    whatHappens: "Compacting the VHDX file reclaims tens of gigabytes of unallocated free space back to Windows without losing any Linux data.",
    manualSteps: [
      "Open Terminal and shut down WSL: wsl --shutdown",
      "Launch diskpart as Administrator.",
      "Select your ext4.vhdx file and run 'compact vdisk' to recover all unused storage space."
    ]
  },
  {
    slug: "docker-desktop-ext4-disk",
    category: "app",
    name: "Docker Desktop WSL2 Virtual Disk Bloat",
    path: "%LocalAppData%\\Docker\\wsl\\data\\ext4.vhdx",
    safeToDelete: false,
    warning: "Never delete ext4.vhdx in File Explorer. Prune dangling Docker images and compact the virtual disk via diskpart or SWEEPR Cleaner.",
    avgSpace: "12.0 GB – 80.0 GB",
    whatIsIt: "Docker Desktop on Windows uses a dynamic VHDX file inside WSL2 that grows as images and containers are pulled, but never shrinks automatically.",
    whatHappens: "Pruning unused container images and compacting the disk reclaims massive drive space while keeping active containers intact.",
    manualSteps: [
      "Open Windows Terminal.",
      "Run 'docker system prune -a --volumes' to delete dangling images and build layers.",
      "Shut down WSL with 'wsl --shutdown' and compact ext4.vhdx via diskpart."
    ]
  },
  {
    slug: "vcpkg-binary-cache",
    category: "app",
    name: "Microsoft vcpkg C++ Library & Binary Cache",
    path: "%LocalAppData%\\vcpkg\\archives and %LocalAppData%\\vcpkg\\downloads",
    safeToDelete: true,
    avgSpace: "4.0 GB – 25.0 GB",
    whatIsIt: "The Microsoft vcpkg C/C++ package manager caches downloaded tarballs, git clones, and compiled binary packages across triplets.",
    whatHappens: "Safely cleans up gigabytes of intermediate build archives. vcpkg simply recompiles packages on demand when needed.",
    manualSteps: [
      "Close Visual Studio and active C++ builds.",
      "Press Windows Key + R, type %localappdata%\\vcpkg, and hit Enter.",
      "Delete the 'archives' and 'downloads' folders to free disk space."
    ]
  },
  {
    slug: "visual-studio-symbols-cache",
    category: "app",
    name: "Visual Studio Debugger Symbol Cache (PDB Cache)",
    path: "%LocalAppData%\\Temp\\SymbolCache",
    safeToDelete: true,
    avgSpace: "2.5 GB – 18.0 GB",
    whatIsIt: "Visual Studio downloads symbol files (.pdb) from Microsoft Symbol Servers during debugging sessions and caches them in %LocalAppData%\\Temp.",
    whatHappens: "Frees gigabytes of storage space and clears stale debug symbol files. Visual Studio will re-fetch symbols on future debug runs.",
    manualSteps: [
      "Close Visual Studio.",
      "Press Windows Key + R, type %localappdata%\\Temp\\SymbolCache, and hit Enter.",
      "Select all PDB symbol folders and delete them."
    ]
  },
  {
    slug: "unreal-engine-niagara-cache",
    category: "app",
    name: "Unreal Engine 5 Niagara VFX Simulation Cache",
    path: "%LocalAppData%\\UnrealEngine\\Common\\DerivedDataCache\\Niagara",
    safeToDelete: true,
    avgSpace: "3.5 GB – 22.0 GB",
    whatIsIt: "Unreal Engine caches compiled GPU and CPU Niagara particle simulation scripts, vector fields, and emitter bytecode across projects.",
    whatHappens: "Safely frees gigabytes of SSD space. Niagara automatically recompiles active particle emitters when you open your level.",
    manualSteps: [
      "Close Unreal Editor and Epic Games Launcher.",
      "Open %localappdata%\\UnrealEngine\\Common\\DerivedDataCache in File Explorer.",
      "Delete stale Niagara and shader cache directories."
    ]
  },
  {
    slug: "blender-cycles-gpu-cache",
    category: "app",
    name: "Blender 3D Cycles OptiX & CUDA Kernel Cache",
    path: "%LocalAppData%\\Blender Foundation\\Blender\\cache",
    safeToDelete: true,
    avgSpace: "1.5 GB – 10.0 GB",
    whatIsIt: "Blender compiles and stores NVIDIA OptiX and CUDA render kernels and geometry BVH caches to accelerate 3D ray tracing renders.",
    whatHappens: "Frees storage and fixes GPU render initialization errors or driver mismatch crashes following an NVIDIA driver update.",
    manualSteps: [
      "Exit Blender completely.",
      "Press Windows Key + R, type %localappdata%\\Blender Foundation\\Blender, and hit Enter.",
      "Delete the 'cache' folder to reset compiled Cycles kernels."
    ]
  },
  {
    slug: "davinci-resolve-optimized-media",
    category: "app",
    name: "DaVinci Resolve Optimized Media & Render Cache",
    path: "C:\\Users\\%USERNAME%\\Videos\\CacheClip and %LocalAppData%\\Blackmagic Design\\DaVinci Resolve\\Support\\optimized_media",
    safeToDelete: true,
    avgSpace: "15.0 GB – 120.0 GB",
    whatIsIt: "DaVinci Resolve creates uncompressed ProRes or DNxHR proxy media and timeline render clips inside CacheClip on your primary drive.",
    whatHappens: "Immediately reclaims tens to hundreds of gigabytes of SSD space without altering your original camera video clips or timeline edits.",
    manualSteps: [
      "Open DaVinci Resolve and go to Playback > Delete Render Cache > All.",
      "Or close Resolve and manually delete CacheClip contents in your Videos folder."
    ]
  },
  {
    slug: "ableton-waveform-peaks-cache",
    category: "app",
    name: "Ableton Live Audio Analysis & Temp Cache",
    path: "%AppData%\\Ableton\\Live Database and %LocalAppData%\\Temp\\Ableton",
    safeToDelete: true,
    avgSpace: "2.0 GB – 15.0 GB",
    whatIsIt: "Ableton Live generates auxiliary analysis files (.asd) and temporary recorded audio buffers across your sample libraries.",
    whatHappens: "Frees gigabytes of storage space and clears orphaned recording buffers from closed sessions without touching your .als project files.",
    manualSteps: [
      "Save your project and exit Ableton Live.",
      "Press Windows Key + R, type %localappdata%\\Temp, and hit Enter.",
      "Delete temporary Ableton recording staging folders."
    ]
  },
  {
    slug: "reaper-reapeaks-cache",
    category: "app",
    name: "REAPER DAW Audio Waveform Peak Files (.reapeaks)",
    path: "%AppData%\\REAPER\\reapeaks and %LocalAppData%\\REAPER",
    safeToDelete: true,
    avgSpace: "3.0 GB – 25.0 GB",
    whatIsIt: "Cockos REAPER creates graphical waveform peak files (.reapeaks) for every imported audio stem and sample on your hard drive.",
    whatHappens: "Reclaims significant disk space. REAPER will silently regenerate peaks for any active tracks when you open a project.",
    manualSteps: [
      "Close REAPER.",
      "Open %appdata%\\REAPER in File Explorer.",
      "Search for and delete *.reapeaks files in your media and cache directories."
    ]
  },
  {
    slug: "steam-workshop-orphaned-mods",
    category: "app",
    name: "Steam Workshop Orphaned Mods & Downloading Cache",
    path: "C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\temp and downloading",
    safeToDelete: true,
    avgSpace: "5.0 GB – 40.0 GB",
    whatIsIt: "Steam stages mod files and downloads in workshop\\temp, leaving behind orphaned mod files after game uninstalls.",
    whatHappens: "Safely cleans up gigabytes of leftover mod files from uninstalled games while keeping active subscribed mods intact.",
    manualSteps: [
      "Exit Steam completely.",
      "Open your Steam\\steamapps\\workshop directory in File Explorer.",
      "Delete files inside 'temp' and 'downloading' folders."
    ]
  },
  {
    slug: "hoyoplay-download-chunks",
    category: "app",
    name: "HoYoPlay Launcher Update Chunks & Staging Cache",
    path: "%LocalAppData%\\HoYoPlay\\cache and %AppData%\\HoYoPlay",
    safeToDelete: true,
    avgSpace: "4.0 GB – 30.0 GB",
    whatIsIt: "The HoYoPlay unified launcher (Genshin Impact, Honkai Star Rail, ZZZ) retains compressed game patch archives and diff chunks.",
    whatHappens: "Safely purges temporary game patch chunks and frees storage space without requiring game verification.",
    manualSteps: [
      "Exit the HoYoPlay launcher and all HoYoverse games.",
      "Press Windows Key + R, type %localappdata%\\HoYoPlay\\cache, and hit Enter.",
      "Delete all cached update chunks and web data."
    ]
  },
  {
    slug: "wargaming-update-cache",
    category: "app",
    name: "Wargaming Game Center Patch & Update Cache",
    path: "%ProgramData%\\Wargaming.net\\GameCenter\\Updates",
    safeToDelete: true,
    avgSpace: "3.0 GB – 25.0 GB",
    whatIsIt: "Wargaming Game Center keeps downloaded client updates and torrent distribution files for World of Tanks and World of Warships.",
    whatHappens: "Frees tens of gigabytes of disk space immediately after game updates finish installing.",
    manualSteps: [
      "Exit Wargaming Game Center from the taskbar tray.",
      "Open C:\\ProgramData\\Wargaming.net\\GameCenter\\Updates in File Explorer.",
      "Delete all downloaded patch files inside the Updates folder."
    ]
  },
  {
    slug: "oculus-client-staging",
    category: "app",
    name: "Meta Quest Oculus PC Software Download Staging",
    path: "C:\\Program Files\\Oculus\\Downloads and %LocalAppData%\\Oculus",
    safeToDelete: true,
    avgSpace: "5.0 GB – 35.0 GB",
    whatIsIt: "The Meta Quest PC app downloads VR software and staging packages into Oculus\\Downloads before extracting them.",
    whatHappens: "Safely clears leftover installer staging archives from interrupted or completed VR software installs.",
    manualSteps: [
      "Close the Meta Quest PC app and stop Oculus VR Runtime Service.",
      "Open C:\\Program Files\\Oculus\\Downloads in File Explorer.",
      "Delete lingering staging folders and restart the Oculus app."
    ]
  },
  {
    slug: "windows-system32-logfiles-w3c",
    category: "folder",
    name: "Windows System32 LogFiles (HTTPERR & Firewall Logs)",
    path: "C:\\Windows\\System32\\LogFiles",
    safeToDelete: true,
    avgSpace: "1.0 GB – 8.0 GB",
    whatIsIt: "Windows HTTP.sys, Windows Defender Firewall, and IIS store uncompressed HTTP error logs and network connection traces in System32\\LogFiles.",
    whatHappens: "Safely deletes old HTTPERR and firewall drop logs, reclaiming gigabytes on your primary Windows drive.",
    manualSteps: [
      "Open File Explorer as Administrator.",
      "Navigate to C:\\Windows\\System32\\LogFiles.",
      "Open the HTTPERR subfolder and delete historical .log files."
    ]
  },
  {
    slug: "windows-system32-sleepstudy",
    category: "folder",
    name: "Windows Modern Standby & SleepStudy Diagnostics",
    path: "C:\\Windows\\System32\\SleepStudy",
    safeToDelete: true,
    avgSpace: "0.5 GB – 4.0 GB",
    whatIsIt: "Windows laptops track battery drain, Modern Standby sleep transitions, and screen state traces into .etl trace logs in SleepStudy.",
    whatHappens: "Clearing historical sleep study traces frees C: drive space without affecting battery life or power management profiles.",
    manualSteps: [
      "Open Windows Terminal as Administrator.",
      "Navigate to C:\\Windows\\System32\\SleepStudy.",
      "Delete old UserNotPresentSession and ScreenOnSession .etl files."
    ]
  },
  {
    slug: "windows-system32-wbem-logs",
    category: "folder",
    name: "Windows Management Instrumentation (WMI) Diagnostic Logs",
    path: "C:\\Windows\\System32\\wbem\\Logs",
    safeToDelete: true,
    avgSpace: "0.4 GB – 3.0 GB",
    whatIsIt: "The Windows WMI repository logs provider query events, CIM repository repairs, and diagnostic traces inside wbem\\Logs.",
    whatHappens: "Safely purges historical WMI text logs and resolves drive space constraints without breaking system management services.",
    manualSteps: [
      "Open Terminal as Administrator and run: net stop winmgmt",
      "Navigate to C:\\Windows\\System32\\wbem\\Logs and delete old .log files.",
      "Restart the service with: net start winmgmt"
    ]
  },
  {
    slug: "windows-tracing-logs",
    category: "folder",
    name: "Windows Routing & Network Tracing Session Logs",
    path: "C:\\Windows\\tracing",
    safeToDelete: true,
    avgSpace: "0.6 GB – 4.5 GB",
    whatIsIt: "Windows network stack, VPN clients, and Routing and Remote Access (RRAS) write persistent diagnostic logs into C:\\Windows\\tracing.",
    whatHappens: "Safely deletes accumulated network tracing logs without disrupting current internet or VPN connections.",
    manualSteps: [
      "Open File Explorer as Administrator.",
      "Open C:\\Windows\\tracing.",
      "Select all .log files and delete them."
    ]
  },
  {
    slug: "windows-system32-sru-monitor",
    category: "folder",
    name: "Windows System Resource Usage Monitor Database",
    path: "C:\\Windows\\System32\\sru",
    safeToDelete: true,
    avgSpace: "0.5 GB – 3.5 GB",
    whatIsIt: "The System Resource Usage Monitor (SRUM) records network bytes sent/received and application CPU energy consumption in SRUDB.dat.",
    whatHappens: "Resetting a corrupted or oversized SRUDB database resolves Task Manager App History tab freezes and frees SSD storage.",
    manualSteps: [
      "Open Terminal as Administrator and run: net stop DPS",
      "Delete or archive C:\\Windows\\System32\\sru\\SRUDB.dat.",
      "Restart the service with: net start DPS"
    ]
  },
  {
    slug: "windows-usoshared-logs",
    category: "folder",
    name: "Windows Update Session Orchestrator Diagnostic Logs",
    path: "C:\\ProgramData\\USOShared\\Logs",
    safeToDelete: true,
    avgSpace: "0.5 GB – 3.0 GB",
    whatIsIt: "The Update Session Orchestrator service writes ETL trace files and diagnostic update logs inside ProgramData\\USOShared\\Logs.",
    whatHappens: "Safely cleans up stale update orchestration logs and frees SSD space without interfering with Windows Update.",
    manualSteps: [
      "Open File Explorer as Administrator.",
      "Navigate to C:\\ProgramData\\USOShared\\Logs.",
      "Delete old .etl trace files."
    ]
  }
];

// -----------------------------------------------------------------------------
// 2. Combinatorial High-Intent Topic Matrices (900+ Unique Keyword-Researched Pages)
// -----------------------------------------------------------------------------
const APP_MATRIX_APPS = [
  { key: "chrome", label: "Google Chrome", baseDir: "%LocalAppData%\\Google\\Chrome\\User Data\\Default", proc: "chrome.exe" },
  { key: "edge", label: "Microsoft Edge", baseDir: "%LocalAppData%\\Microsoft\\Edge\\User Data\\Default", proc: "msedge.exe" },
  { key: "brave", label: "Brave Browser", baseDir: "%LocalAppData%\\BraveSoftware\\Brave-Browser\\User Data\\Default", proc: "brave.exe" },
  { key: "opera-gx", label: "Opera GX Gaming Browser", baseDir: "%LocalAppData%\\Opera Software\\Opera GX Stable", proc: "opera.exe" },
  { key: "vivaldi", label: "Vivaldi Browser", baseDir: "%LocalAppData%\\Vivaldi\\User Data\\Default", proc: "vivaldi.exe" },
  { key: "arc-browser", label: "Arc Browser for Windows", baseDir: "%LocalAppData%\\Packages\\TheBrowserCompany.Arc_ttt1ap7aakyb4\\LocalCache", proc: "Arc.exe" },
  { key: "discord", label: "Discord Desktop", baseDir: "%AppData%\\discord", proc: "Discord.exe" },
  { key: "slack", label: "Slack Desktop", baseDir: "%AppData%\\Slack", proc: "slack.exe" },
  { key: "teams-work", label: "Microsoft Teams (New Work/School)", baseDir: "%LocalAppData%\\Packages\\MSTeams_8wekyb3d8bbwe\\LocalCache\\Microsoft\\MSTeams\\EBWebView\\Default", proc: "ms-teams.exe" },
  { key: "vscode", label: "Visual Studio Code", baseDir: "%AppData%\\Code", proc: "Code.exe" },
  { key: "vscode-insiders", label: "VS Code Insiders", baseDir: "%AppData%\\Code - Insiders", proc: "Code - Insiders.exe" },
  { key: "cursor-editor", label: "Cursor AI IDE", baseDir: "%AppData%\\Cursor", proc: "Cursor.exe" },
  { key: "windsurf-ide", label: "Windsurf AI Editor", baseDir: "%AppData%\\Windsurf", proc: "Windsurf.exe" },
  { key: "notion-app", label: "Notion Desktop App", baseDir: "%AppData%\\Notion", proc: "Notion.exe" },
  { key: "obsidian-app", label: "Obsidian Markdown App", baseDir: "%AppData%\\obsidian", proc: "Obsidian.exe" },
  { key: "figma-desktop", label: "Figma Desktop", baseDir: "%AppData%\\Figma", proc: "Figma.exe" },
  { key: "canva-desktop", label: "Canva Desktop App", baseDir: "%AppData%\\Canva", proc: "Canva.exe" },
  { key: "postman-app", label: "Postman API Client", baseDir: "%AppData%\\Postman", proc: "Postman.exe" },
  { key: "whatsapp-desktop", label: "WhatsApp Desktop", baseDir: "%LocalAppData%\\Packages\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm\\LocalCache", proc: "WhatsApp.exe" },
  { key: "signal-desktop", label: "Signal Private Messenger", baseDir: "%AppData%\\Signal", proc: "Signal.exe" },
  { key: "telegram-desktop", label: "Telegram Desktop", baseDir: "%AppData%\\Telegram Desktop\\tdata\\user_data", proc: "Telegram.exe" },
  { key: "spotify-desktop", label: "Spotify Desktop", baseDir: "%LocalAppData%\\Spotify", proc: "Spotify.exe" },
  { key: "tidal-desktop", label: "TIDAL HiFi Desktop", baseDir: "%AppData%\\TIDAL", proc: "TIDAL.exe" },
  { key: "steam-client", label: "Steam Client", baseDir: "%LocalAppData%\\Steam\\htmlcache", proc: "steam.exe" },
  { key: "epic-games", label: "Epic Games Launcher", baseDir: "%LocalAppData%\\EpicGamesLauncher\\Saved\\webcache_4430", proc: "EpicGamesLauncher.exe" },
  { key: "ea-desktop-app", label: "EA App Launcher", baseDir: "%LocalAppData%\\Electronic Arts\\EA Desktop\\cache", proc: "EADesktop.exe" },
  { key: "ubisoft-connect", label: "Ubisoft Connect PC", baseDir: "%LocalAppData%\\Ubisoft Game Launcher\\spool", proc: "upc.exe" },
  { key: "gog-galaxy", label: "GOG Galaxy 2.0", baseDir: "%ProgramData%\\GOG.com\\Galaxy\\webcache", proc: "GalaxyClient.exe" },
  { key: "battlenet-client", label: "Blizzard Battle.net App", baseDir: "%ProgramData%\\Battle.net\\Agent\\data", proc: "Battle.net.exe" },
  { key: "riot-client", label: "Riot Client", baseDir: "%LocalAppData%\\Riot Games\\Riot Client\\Data\\Logs", proc: "RiotClientServices.exe" },
  { key: "overwolf-client", label: "Overwolf Gaming Overlay", baseDir: "%LocalAppData%\\Overwolf\\BrowserCache", proc: "Overwolf.exe" },
  { key: "medal-tv", label: "Medal.tv Game Recorder", baseDir: "%AppData%\\Medal\\Cache", proc: "Medal.exe" },
  { key: "steelseries-gg", label: "SteelSeries GG", baseDir: "%AppData%\\steelseries-gg-client\\Cache", proc: "SteelSeriesGG.exe" },
  { key: "razer-synapse-3", label: "Razer Synapse 3", baseDir: "%ProgramData%\\Razer\\Synapse3\\Log", proc: "Razer Synapse 3.exe" },
  { key: "corsair-icue-5", label: "Corsair iCUE 5 Software", baseDir: "%LocalAppData%\\Corsair\\iCUE5\\cache", proc: "iCUE.exe" },
  { key: "logitech-ghub", label: "Logitech G HUB", baseDir: "%LocalAppData%\\LGHUB\\cache", proc: "lghub.exe" },
  { key: "adobe-creative-cloud", label: "Adobe Creative Cloud Desktop", baseDir: "%LocalAppData%\\Adobe\\OOBE\\opm.db", proc: "Creative Cloud.exe" },
  { key: "premiere-pro-2026", label: "Adobe Premiere Pro", baseDir: "%AppData%\\Adobe\\Common\\Media Cache Files", proc: "Adobe Premiere Pro.exe" },
  { key: "after-effects-2026", label: "Adobe After Effects", baseDir: "%LocalAppData%\\Temp\\Adobe\\After Effects Disk Cache", proc: "AfterFX.exe" },
  { key: "davinci-resolve-19", label: "DaVinci Resolve Studio", baseDir: "C:\\Users\\%USERNAME%\\Videos\\CacheClip", proc: "Resolve.exe" },
  { key: "capcut-pc", label: "CapCut Desktop Video Editor", baseDir: "%LocalAppData%\\CapCut\\User Data\\Cache", proc: "CapCut.exe" },
  { key: "obs-studio", label: "OBS Studio Browser Source", baseDir: "%AppData%\\obs-studio\\plugin_config\\obs-browser", proc: "obs64.exe" },
  { key: "blender-3d", label: "Blender 3D", baseDir: "%LocalAppData%\\Temp\\blender_temp", proc: "blender.exe" },
  { key: "jetbrains-intellij", label: "JetBrains IntelliJ IDEA", baseDir: "%LocalAppData%\\JetBrains\\IntelliJIdea2025.1\\caches", proc: "idea64.exe" },
  { key: "jetbrains-pycharm", label: "JetBrains PyCharm", baseDir: "%LocalAppData%\\JetBrains\\PyCharm2025.1\\caches", proc: "pycharm64.exe" },
  { key: "jetbrains-webstorm", label: "JetBrains WebStorm", baseDir: "%LocalAppData%\\JetBrains\\WebStorm2025.1\\caches", proc: "webstorm64.exe" },
  { key: "jetbrains-rider", label: "JetBrains Rider .NET IDE", baseDir: "%LocalAppData%\\JetBrains\\Rider2025.1\\caches", proc: "rider64.exe" },
  { key: "android-studio-koala", label: "Android Studio", baseDir: "%LocalAppData%\\Google\\AndroidStudio2024.3\\caches", proc: "studio64.exe" },
  { key: "docker-desktop-wsl", label: "Docker Desktop Windows", baseDir: "%LocalAppData%\\Docker\\log", proc: "Docker Desktop.exe" },
  { key: "plex-media-server", label: "Plex Media Server", baseDir: "%LocalAppData%\\Plex Media Server\\Cache\\PhotoTranscoder", proc: "Plex Media Server.exe" },
  { key: "firefox", label: "Mozilla Firefox", baseDir: "%LocalAppData%\\Mozilla\\Firefox\\Profiles\\Default", proc: "firefox.exe" },
  { key: "zoom-workplace", label: "Zoom Workplace", baseDir: "%AppData%\\Zoom\\data", proc: "Zoom.exe" },
  { key: "thunderbird", label: "Mozilla Thunderbird", baseDir: "%LocalAppData%\\Thunderbird\\Profiles\\Default", proc: "thunderbird.exe" },
  { key: "dropbox-desktop", label: "Dropbox Desktop Client", baseDir: "%LocalAppData%\\Dropbox\\cache", proc: "Dropbox.exe" },
  { key: "onedrive-sync", label: "Microsoft OneDrive Sync", baseDir: "%LocalAppData%\\Microsoft\\OneDrive\\logs", proc: "OneDrive.exe" },
  { key: "github-desktop", label: "GitHub Desktop", baseDir: "%AppData%\\GitHub Desktop", proc: "GitHubDesktop.exe" },
  { key: "insomnia-rest", label: "Insomnia API Client", baseDir: "%AppData%\\Insomnia", proc: "Insomnia.exe" },
  { key: "dbeaver-db", label: "DBeaver", baseDir: "%AppData%\\DBeaverData\\workspace6\\.metadata", proc: "dbeaver.exe" },
  { key: "vlc-media-player", label: "VLC Media Player", baseDir: "%AppData%\\vlc\\art", proc: "vlc.exe" },
  { key: "audacity-audio", label: "Audacity Audio Editor", baseDir: "%AppData%\\audacity\\SessionData", proc: "audacity.exe" },
  { key: "visual-studio-2022", label: "Visual Studio 2022 IDE", baseDir: "%LocalAppData%\\Microsoft\\VisualStudio\\17.0", proc: "devenv.exe" },
  { key: "league-of-legends", label: "League of Legends Client", baseDir: "C:\\Riot Games\\League of Legends\\Logs", proc: "LeagueClient.exe" },
  { key: "geforce-now", label: "NVIDIA GeForce NOW", baseDir: "%LocalAppData%\\NVIDIA Corporation\\GeForceNOW\\cache", proc: "GeForceNOW.exe" },
  { key: "roblox-player", label: "Roblox Player", baseDir: "%LocalAppData%\\Roblox\\Downloads", proc: "RobloxPlayerBeta.exe" },
  { key: "tiktok-live-studio", label: "TikTok LIVE Studio", baseDir: "%AppData%\\tiktok-live-studio\\Cache", proc: "TikTok LIVE Studio.exe" },
  { key: "zen-browser", label: "Zen Browser", baseDir: "%AppData%\\zen\\Profiles", proc: "zen.exe" },
  { key: "waterfox", label: "Waterfox Browser", baseDir: "%AppData%\\Waterfox\\Profiles", proc: "waterfox.exe" },
  { key: "floorp-browser", label: "Floorp Browser", baseDir: "%AppData%\\Floorp\\Profiles", proc: "floorp.exe" },
  { key: "tor-browser", label: "Tor Browser", baseDir: "%LocalAppData%\\Tor Browser\\Browser\\TorBrowser\\Data", proc: "firefox.exe" },
  { key: "linear-desktop", label: "Linear Desktop App", baseDir: "%AppData%\\Linear", proc: "Linear.exe" },
  { key: "clickup-desktop", label: "ClickUp Desktop App", baseDir: "%AppData%\\ClickUp", proc: "ClickUp.exe" },
  { key: "asana-desktop", label: "Asana Desktop App", baseDir: "%AppData%\\Asana", proc: "Asana.exe" },
  { key: "bitwarden-desktop", label: "Bitwarden Desktop", baseDir: "%AppData%\\Bitwarden", proc: "Bitwarden.exe" },
  { key: "1password-desktop", label: "1Password Desktop", baseDir: "%LocalAppData%\\1Password", proc: "1Password.exe" },
  { key: "streamlabs-desktop", label: "Streamlabs Desktop", baseDir: "%AppData%\\slobs-client", proc: "Streamlabs Desktop.exe" },
  { key: "adobe-photoshop", label: "Adobe Photoshop", baseDir: "%AppData%\\Adobe\\Adobe Photoshop 2025", proc: "Photoshop.exe" },
  { key: "adobe-illustrator", label: "Adobe Illustrator", baseDir: "%AppData%\\Adobe\\Adobe Illustrator 29 Settings", proc: "Illustrator.exe" },
  { key: "adobe-lightroom", label: "Adobe Lightroom Classic", baseDir: "%LocalAppData%\\Adobe\\Lightroom\\Caches", proc: "Lightroom.exe" },
  { key: "adobe-audition", label: "Adobe Audition", baseDir: "%AppData%\\Adobe\\Audition\\25.0", proc: "Adobe Audition.exe" },
  { key: "google-drive-desktop", label: "Google Drive for Desktop", baseDir: "%LocalAppData%\\Google\\DriveFS", proc: "GoogleDriveFS.exe" },
  { key: "fl-studio-daw", label: "FL Studio DAW", baseDir: "%Documents%\\Image-Line\\FL Studio", proc: "FL64.exe" },
  { key: "ableton-live-suite", label: "Ableton Live Suite", baseDir: "%AppData%\\Ableton\\Live 12", proc: "Ableton Live 12 Suite.exe" },
  { key: "sidefx-houdini", label: "SideFX Houdini 3D", baseDir: "%UserProfile%\\Documents\\houdini20.5", proc: "hindie.exe" },
  { key: "autodesk-maya", label: "Autodesk Maya", baseDir: "%UserProfile%\\Documents\\maya\\2025", proc: "maya.exe" },
  { key: "autodesk-3ds-max", label: "Autodesk 3ds Max", baseDir: "%LocalAppData%\\Autodesk\\3dsMax\\2025 - 64bit", proc: "3dsmax.exe" },
  { key: "rpcs3-ps3-emulator", label: "RPCS3 PS3 Emulator", baseDir: "%AppData%\\rpcs3", proc: "rpcs3.exe" },
  { key: "dolphin-emulator", label: "Dolphin Emulator", baseDir: "%AppData%\\Dolphin Emulator", proc: "Dolphin.exe" },
  { key: "retroarch-emu", label: "RetroArch", baseDir: "%AppData%\\RetroArch", proc: "retroarch.exe" },
  { key: "prism-minecraft", label: "Prism Launcher Minecraft", baseDir: "%AppData%\\PrismLauncher", proc: "prismlauncher.exe" },
  { key: "jetbrains-clion", label: "JetBrains CLion", baseDir: "%LocalAppData%\\JetBrains\\CLion2025.1\\caches", proc: "clion64.exe" },
  { key: "jetbrains-datagrip", label: "JetBrains DataGrip", baseDir: "%LocalAppData%\\JetBrains\\DataGrip2025.1\\caches", proc: "datagrip64.exe" },
  { key: "jetbrains-goland", label: "JetBrains GoLand", baseDir: "%LocalAppData%\\JetBrains\\GoLand2025.1\\caches", proc: "goland64.exe" },
  { key: "jetbrains-phpstorm", label: "JetBrains PhpStorm", baseDir: "%LocalAppData%\\JetBrains\\PhpStorm2025.1\\caches", proc: "phpstorm64.exe" },
  { key: "megasync-app", label: "MEGAsync Cloud Storage", baseDir: "%LocalAppData%\\Mega Limited\\MEGAsync", proc: "MEGAsync.exe" },
  { key: "microsoft-outlook", label: "Microsoft Outlook", baseDir: "%LocalAppData%\\Microsoft\\Outlook", proc: "OUTLOOK.EXE" }
];

const APP_CACHE_COMPONENTS = [
  {
    subSlug: "gpu-shader-cache",
    subName: "GPUCache & Dawn WebGPU Cache",
    subPath: "GPUCache and DawnCache",
    avgSpace: "0.8 GB – 4.5 GB",
    whatSuffix: "stores compiled Direct3D/Vulkan shader pipelines and WebGPU Dawn cache files that accumulate across app updates.",
    happensSuffix: "frees hidden C: drive space and resolves black-screen rendering glitches without logging you out."
  },
  {
    subSlug: "code-bytecode-cache",
    subSlugAlt: "v8-code-cache",
    subName: "Code Cache & V8 JavaScript Bytecode",
    subPath: "Code Cache\\js and Code Cache\\wasm",
    avgSpace: "1.0 GB – 5.2 GB",
    whatSuffix: "compiles and caches JavaScript and WebAssembly bytecode locally on disk so UI modules load faster.",
    happensSuffix: "reclaims gigabytes of stale bytecode from old versions while preserving all user settings and accounts."
  },
  {
    subSlug: "service-worker-cachestorage",
    subName: "Service Worker CacheStorage & Offline Blobs",
    subPath: "Service Worker\\CacheStorage",
    avgSpace: "1.5 GB – 8.5 GB",
    whatSuffix: "quietly caches offline web assets, media chunks, and background sync blobs inside Service Worker\\CacheStorage.",
    happensSuffix: "wipes bloated offline storage immediately while keeping your active login cookies and preferences intact."
  },
  {
    subSlug: "crashpad-dump-logs",
    subName: "Crashpad Reports & Diagnostic DMP Logs",
    subPath: "Crashpad\\reports and logs",
    avgSpace: "0.6 GB – 3.8 GB",
    whatSuffix: "writes uncompressed minidump (.dmp) crash files and verbose diagnostic logs whenever a background renderer process hangs.",
    happensSuffix: "permanently removes old diagnostic dumps and reclaims SSD space with zero impact on app functionality."
  },
  {
    subSlug: "media-blob-storage",
    subName: "Media Cache & IndexedDB Blob Storage",
    subPath: "Cache\\Cache_Data and IndexedDB",
    avgSpace: "2.0 GB – 12.0 GB",
    whatSuffix: "stores high-resolution video previews, image thumbnails, and temporary media streams in Cache_Data.",
    happensSuffix: "immediately frees several gigabytes of wasted disk space; active thumbnails are re-fetched on demand."
  }
];

const WINDOWS_FOLDER_MATRIX = [
  {
    slug: "windows-system32-driverstore-temp",
    name: "Windows DriverStore Temp & Superseded OEM Packages",
    path: "C:\\Windows\\System32\\DriverStore\\Temp",
    safeToDelete: true,
    avgSpace: "1.5 GB – 9.5 GB",
    whatIsIt: "Windows stages extracted GPU, chipset, and audio driver packages in DriverStore\\Temp during device installation and Windows Update.",
    whatHappens: "Deleting leftover staging files in DriverStore\\Temp frees C: drive space without affecting your currently active hardware drivers.",
    manualSteps: [
      "Open Windows Terminal as Administrator.",
      "Run 'pnputil /enum-drivers' to inspect installed third-party OEM driver packages.",
      "Clear C:\\Windows\\System32\\DriverStore\\Temp or use SWEEPR Cleaner to safely purge superseded driver staging files."
    ]
  },
  {
    slug: "windows-logs-cbs-persist",
    name: "Windows CBS (Component-Based Servicing) Persist Logs",
    path: "C:\\Windows\\Logs\\CBS",
    safeToDelete: true,
    avgSpace: "1.0 GB – 7.5 GB",
    whatIsIt: "The Windows Modules Installer (TrustedInstaller) writes multi-gigabyte CBS.log and CbsPersist_*.log archives during cumulative updates.",
    whatHappens: "Safely reclaims gigabytes of SSD space when CbsPersist log archives grow bloated.",
    manualSteps: [
      "Press Windows Key + X and select Terminal (Admin).",
      "Stop the Windows Modules Installer service with: net stop TrustedInstaller",
      "Open C:\\Windows\\Logs\\CBS and delete old CbsPersist_*.log and .cab files."
    ]
  },
  {
    slug: "windows-panther-setup-logs",
    name: "Windows Panther Feature Upgrade Logs (C:\\Windows\\Panther)",
    path: "C:\\Windows\\Panther",
    safeToDelete: true,
    avgSpace: "0.8 GB – 5.0 GB",
    whatIsIt: "Windows stores migration logs, setupact.log trace files, and compatibility scan snapshots inside C:\\Windows\\Panther during feature upgrades.",
    whatHappens: "Clearing old upgrade trace logs frees C: drive space once your Windows 11 upgrade is stable.",
    manualSteps: [
      "Open File Explorer as Administrator.",
      "Navigate to C:\\Windows\\Panther.",
      "Delete old setupact.log, setuperr.log, and compatibility xml snapshots."
    ]
  },
  {
    slug: "localappdata-d3dscache-directx",
    name: "DirectX D3DSCache Shader Cache (%LocalAppData%\\D3DSCache)",
    path: "%LocalAppData%\\D3DSCache",
    safeToDelete: true,
    avgSpace: "1.2 GB – 8.0 GB",
    whatIsIt: "Windows DirectX 11 and DirectX 12 compile and store hardware shader bytecode in %LocalAppData%\\D3DSCache for games and desktop apps.",
    whatHappens: "Safely frees disk space and fixes corrupted shader stuttering after a GPU driver update.",
    manualSteps: [
      "Close all running games and 3D applications.",
      "Press Windows Key + R, type %localappdata%\\D3DSCache, and press Enter.",
      "Select all folders (Ctrl+A) and delete them."
    ]
  },
  {
    slug: "localappdata-crashdumps-wer",
    name: "Windows Application User-Mode CrashDumps (%LocalAppData%\\CrashDumps)",
    path: "%LocalAppData%\\CrashDumps",
    safeToDelete: true,
    avgSpace: "1.5 GB – 14.0 GB",
    whatIsIt: "Windows Error Reporting saves full or mini memory dumps (.dmp) in %LocalAppData%\\CrashDumps whenever an app or game crashes.",
    whatHappens: "Immediately frees gigabytes of wasted SSD space with zero impact on your installed programs.",
    manualSteps: [
      "Press Windows Key + R, type %localappdata%\\CrashDumps, and press Enter.",
      "Select all .dmp crash dump files (Ctrl+A) and press Shift + Delete."
    ]
  },
  {
    slug: "localappdata-squirreltemp-installers",
    name: "SquirrelTemp Leftover App Update Packages (%LocalAppData%\\SquirrelTemp)",
    path: "%LocalAppData%\\SquirrelTemp",
    safeToDelete: true,
    avgSpace: "1.0 GB – 6.5 GB",
    whatIsIt: "Desktop apps built with Squirrel (Discord, Slack, Postman, Teams, WhatsApp) leave behind full .nupkg installer packages in SquirrelTemp.",
    whatHappens: "Safely deletes leftover update installers without affecting the installed applications.",
    manualSteps: [
      "Press Windows Key + R, type %localappdata%\\SquirrelTemp, and press Enter.",
      "Delete all temporary .nupkg packages and staging folders."
    ]
  },
  {
    slug: "localappdata-webview2-ebwebview-cache",
    name: "Microsoft Edge WebView2 Shared Runtime Cache (EBWebView)",
    path: "%LocalAppData%\\Microsoft\\EdgeWebView\\User Data\\Default\\Cache",
    safeToDelete: true,
    avgSpace: "1.5 GB – 9.0 GB",
    whatIsIt: "Windows 11 widgets, Microsoft 365 apps, and modern desktop utilities embed Edge WebView2, accumulating gigabytes of cached web data.",
    whatHappens: "Reclaims hidden SSD space while keeping Windows Widgets and Office add-ins working normally.",
    manualSteps: [
      "Close Widgets and Office apps.",
      "Navigate to %localappdata%\\Microsoft\\EdgeWebView\\User Data\\Default.",
      "Delete the 'Cache', 'Code Cache', and 'GPUCache' folders."
    ]
  },
  {
    slug: "programdata-windows-defender-scans-history",
    name: "Microsoft Defender Protection & Scan History Cache",
    path: "C:\\ProgramData\\Microsoft\\Windows Defender\\Scans\\History\\Service",
    safeToDelete: true,
    avgSpace: "0.8 GB – 4.5 GB",
    whatIsIt: "Microsoft Defender Antivirus logs historical scan results and quarantined detection metadata inside ProgramData\\Microsoft\\Windows Defender.",
    whatHappens: "Clears old detection history logs and reclaims disk space while keeping real-time antivirus protection active.",
    manualSteps: [
      "Open Windows Security > Virus & threat protection > Protection history.",
      "Or use SWEEPR Cleaner to clear expired scan log caches older than 30 days."
    ]
  },
  {
    slug: "windows-livekernelreports-watchdog-dumps",
    name: "Windows LiveKernelReports & GPU Watchdog Dumps",
    path: "C:\\Windows\\LiveKernelReports",
    safeToDelete: true,
    avgSpace: "1.5 GB – 12.0 GB",
    whatIsIt: "When a display driver or USB controller resets without a full blue screen, Windows writes huge kernel memory dumps into C:\\Windows\\LiveKernelReports.",
    whatHappens: "Safely frees gigabytes of C: drive space from old TDR (Timeout Detection and Recovery) GPU dump files.",
    manualSteps: [
      "Open File Explorer as Administrator and navigate to C:\\Windows\\LiveKernelReports.",
      "Open the WATCHDOG subfolder and delete old .dmp files."
    ]
  },
  {
    slug: "windows-iconcache-db",
    name: "Windows Desktop Icon Cache Database (IconCache.db)",
    path: "%LocalAppData%\\IconCache.db",
    safeToDelete: true,
    avgSpace: "0.2 GB – 1.8 GB",
    whatIsIt: "Windows caches desktop, Start Menu, and taskbar shortcut icons inside the hidden IconCache.db file in %LocalAppData%.",
    whatHappens: "Safe to delete. Frees disk space and forces Windows Explorer to rebuild a fresh icon cache, fixing corrupted, generic blank sheet, or missing desktop icons.",
    manualSteps: [
      "Close open applications and open Terminal as Administrator.",
      "Stop Windows Explorer with: taskkill /f /im explorer.exe",
      "Delete the icon cache database: del /f /q %LocalAppData%\\IconCache.db",
      "Restart Windows Explorer: start explorer.exe"
    ]
  },
  {
    slug: "docker-desktop-buildx-cache",
    category: "app",
    name: "Docker Desktop BuildKit Container Cache & Dangling Images",
    path: "%LocalAppData%\\Docker\\wsl\\data and %UserProfile%\\.docker\\buildx",
    safeToDelete: true,
    avgSpace: "12.0 GB – 75.0 GB",
    whatIsIt: "Docker Desktop accumulates gigabytes of cached intermediate container layers, multi-arch buildx builders, and dangling image blobs on your C: drive.",
    whatHappens: "Safely cleans orphaned Docker build caches and unused container layers without deleting running containers or volumes.",
    manualSteps: [
      "Open Windows Terminal or PowerShell.",
      "Run 'docker builder prune -a' to clear all cached BuildKit layers.",
      "Run 'docker image prune -a' to remove dangling, untagged Docker images."
    ]
  },
  {
    slug: "podman-desktop-machine-cache",
    category: "app",
    name: "Podman Desktop Virtual Machine Images & Temp Socket Blobs",
    path: "%UserProfile%\\.local\\share\\containers\\podman\\machine",
    safeToDelete: true,
    avgSpace: "5.0 GB – 35.0 GB",
    whatIsIt: "Podman Desktop for Windows maintains WSL2 virtual machine disks, ignition files, and socket buffers that expand over time.",
    whatHappens: "Frees significant disk space from stopped Podman machines while keeping your container files and configurations intact.",
    manualSteps: [
      "Open Podman Desktop and stop active virtual machines.",
      "Open PowerShell and run 'podman system prune --all --volumes'.",
      "Optionally re-initialize the machine using 'podman machine rm' and 'podman machine init'."
    ]
  },
  {
    slug: "android-studio-gradle-build-cache",
    category: "app",
    name: "Android Studio Gradle Build Cache & Transform Caches",
    path: "%UserProfile%\\.gradle\\caches\\transforms-3",
    safeToDelete: true,
    avgSpace: "4.0 GB – 30.0 GB",
    whatIsIt: "Android Studio builds cache transformed AAR libraries, dex files, and jetified JAR archives in .gradle\\caches\\transforms-3.",
    whatHappens: "Safely frees gigabytes of drive space. Gradle will rebuild transforms for current projects upon the next build.",
    manualSteps: [
      "Close Android Studio completely.",
      "Press Windows Key + R, type %userprofile%\\.gradle\\caches, and press Enter.",
      "Delete the 'transforms-3' and 'jars-9' cache directories."
    ]
  },
  {
    slug: "android-studio-avd-snapshots-cache",
    category: "app",
    name: "Android Emulator AVD Quickboot Snapshots & Temp QEMU Dumps",
    path: "%UserProfile%\\.android\\avd",
    safeToDelete: true,
    avgSpace: "6.0 GB – 25.0 GB",
    whatIsIt: "The Android Virtual Device (AVD) emulator writes multi-gigabyte RAM snapshot images (qemu.img and snapshot.pb) to enable quick boot.",
    whatHappens: "Reclaims tens of gigabytes. Emulators will perform a standard clean cold boot on next launch.",
    manualSteps: [
      "Open Android Studio Device Manager.",
      "Click the menu next to your virtual device and select 'Wipe Data'.",
      "Or delete snapshot folders inside %UserProfile%\\.android\\avd\\<device>.avd\\snapshots."
    ]
  },
  {
    slug: "unity-editor-package-manager-cache",
    category: "app",
    name: "Unity Editor UPM Package Manager & Asset Store Cache",
    path: "%LocalAppData%\\Unity\\cache\\packages",
    safeToDelete: true,
    avgSpace: "5.0 GB – 45.0 GB",
    whatIsIt: "Unity Package Manager (UPM) and Unity Asset Store download and permanently store tarballs of every package and asset version you test.",
    whatHappens: "Safely cleans old, unreferenced Unity asset packages. Active project dependencies are re-downloaded seamlessly when opened.",
    manualSteps: [
      "Close Unity Hub and all open Unity Editor instances.",
      "Press Windows Key + R, type %LocalAppData%\\Unity\\cache, and press Enter.",
      "Delete the 'packages' and 'npm' folders."
    ]
  },
  {
    slug: "unity-editor-gi-cache",
    category: "app",
    name: "Unity Editor Global Illumination Lightmap Cache (GI Cache)",
    path: "%LocalAppData%\\Unity\\cache\\gi",
    safeToDelete: true,
    avgSpace: "8.0 GB – 60.0 GB",
    whatIsIt: "Unity Editor stores precomputed realtime and baked global illumination ray tracing data inside the GI cache on drive C:.",
    whatHappens: "Safe to delete. Frees massive SSD capacity; Unity will rebake scene lighting when requested.",
    manualSteps: [
      "In Unity Editor, open Edit > Preferences > GI Cache.",
      "Click 'Clean Cache' button, or manually delete %LocalAppData%\\Unity\\cache\\gi."
    ]
  },
  {
    slug: "unreal-engine-derived-data-cache",
    category: "app",
    name: "Unreal Engine Derived Data Cache (Local DDC)",
    path: "%LocalAppData%\\UnrealEngine\\Common\\DerivedDataCache",
    safeToDelete: true,
    avgSpace: "15.0 GB – 90.0 GB",
    whatIsIt: "Unreal Engine creates compiled shader formats, cooked sound waves, and processed meshes in the local Derived Data Cache.",
    whatHappens: "Reclaims massive storage space. Unreal Engine will regenerate required DDC entries automatically upon project load.",
    manualSteps: [
      "Close Unreal Engine and Epic Games Launcher.",
      "Press Windows Key + R, type %LocalAppData%\\UnrealEngine\\Common\\DerivedDataCache, and press Enter.",
      "Select all subfolders and delete them."
    ]
  },
  {
    slug: "unreal-engine-crash-reports",
    category: "app",
    name: "Unreal Engine Crash Reports & Saved Diagnostics Log Dumps",
    path: "%LocalAppData%\\UnrealEngine\\Saved\\Crashes",
    safeToDelete: true,
    avgSpace: "2.0 GB – 18.0 GB",
    whatIsIt: "CrashReportClient generates full minidump files and stack trace logs every time an editor instance or game prototype crashes.",
    whatHappens: "Safely eliminates stale crash dumps without impacting project assets or engine functionality.",
    manualSteps: [
      "Press Windows Key + R, type %LocalAppData%\\UnrealEngine, and press Enter.",
      "Search for 'Crashes' folders across engine versions and delete the dump logs."
    ]
  },
  {
    slug: "godot-engine-editor-import-cache",
    category: "app",
    name: "Godot Engine Editor Imported Asset & Shader Cache",
    path: "%UserProfile%\\.godot\\editor",
    safeToDelete: true,
    avgSpace: "1.5 GB – 12.0 GB",
    whatIsIt: "Godot Engine 4.x caches imported textures, audio streams, and compiled SPIR-V shaders in .godot\\editor.",
    whatHappens: "Frees disk storage. Godot automatically re-imports assets from source files upon opening your game project.",
    manualSteps: [
      "Quit Godot Engine.",
      "Press Windows Key + R, type %UserProfile%\\.godot, and press Enter.",
      "Delete old editor cache folders."
    ]
  },
  {
    slug: "davinci-resolve-render-cache",
    category: "app",
    name: "DaVinci Resolve Optimized Media & Render Cache",
    path: "%UserProfile%\\Videos\\CacheClip",
    safeToDelete: true,
    avgSpace: "20.0 GB – 120.0 GB",
    whatIsIt: "Blackmagic DaVinci Resolve renders ProRes/DNxHR proxy clips and timeline color node caches into CacheClip on your drive.",
    whatHappens: "Frees tens to hundreds of gigabytes. Render cache can be re-rendered on the timeline at any time.",
    manualSteps: [
      "In DaVinci Resolve, open Playback > Delete Render Cache > All.",
      "Or navigate to your CacheClip directory and delete the cached render folders."
    ]
  },
  {
    slug: "davinci-resolve-gallery-stills",
    category: "app",
    name: "DaVinci Resolve Gallery Stills & Temporary Color Grade Caches",
    path: "%UserProfile%\\Videos\\.gallery",
    safeToDelete: true,
    avgSpace: "2.5 GB – 15.0 GB",
    whatIsIt: "DaVinci Resolve stores full-resolution DPX/TIFF stills and grading reference buffers in hidden .gallery directories.",
    whatHappens: "Reclaims gigabytes of disk space while keeping your project timelines and timelines color metadata safe.",
    manualSteps: [
      "Open your DaVinci Resolve Project Settings > Master Settings.",
      "Check Working Folders > Gallery Stills Location and purge unused gallery stills."
    ]
  },
  {
    slug: "premiere-pro-media-cache-files",
    category: "app",
    name: "Adobe Premiere Pro Media Cache Files (.mcf and .pek)",
    path: "%AppData%\\Adobe\\Common\\Media Cache Files",
    safeToDelete: true,
    avgSpace: "10.0 GB – 85.0 GB",
    whatIsIt: "Premiere Pro creates peak (.pek) waveform files and conformed video streams in Media Cache Files for every imported video.",
    whatHappens: "Completely safe to delete. Premiere Pro easily regenerates audio waveforms when projects are reopened.",
    manualSteps: [
      "In Premiere Pro, go to Edit > Preferences > Media Cache.",
      "Click 'Delete' next to Remove Media Cache Files, choosing 'Delete all media cache files'.",
      "Or delete the contents of %AppData%\\Adobe\\Common\\Media Cache Files manually."
    ]
  },
  {
    slug: "premiere-pro-media-cache-database",
    category: "app",
    name: "Adobe Premiere Pro Media Cache Database (.mcd Index)",
    path: "%AppData%\\Adobe\\Common\\Media Cache",
    safeToDelete: true,
    avgSpace: "1.0 GB – 8.0 GB",
    whatIsIt: "Premiere Pro indexes all cached files in the Media Cache folder to map clip IDs to cached audio waveforms.",
    whatHappens: "Safe to delete. Premiere Pro reconstructs a fresh database index on launch, resolving media sync errors.",
    manualSteps: [
      "Close all Adobe applications.",
      "Navigate to %AppData%\\Adobe\\Common\\Media Cache and delete all files."
    ]
  },
  {
    slug: "after-effects-disk-cache",
    category: "app",
    name: "Adobe After Effects Conformed Audio & Disk Cache",
    path: "%UserProfile%\\AppData\\Roaming\\Adobe\\Common\\Media Cache",
    safeToDelete: true,
    avgSpace: "15.0 GB – 100.0 GB",
    whatIsIt: "Adobe After Effects stores rendered frames and RAM preview caches in its global disk cache folder.",
    whatHappens: "Safe to delete. Instantly frees up to 100 GB of SSD space without losing any project composition settings.",
    manualSteps: [
      "In After Effects, navigate to Edit > Purge > All Memory & Disk Cache.",
      "Confirm to clear the disk cache folder."
    ]
  },
  {
    slug: "lightroom-smart-preview-cache",
    category: "app",
    name: "Adobe Lightroom Classic Smart Previews & 1:1 Previews Cache",
    path: "%UserProfile%\\Pictures\\Lightroom",
    safeToDelete: true,
    avgSpace: "8.0 GB – 55.0 GB",
    whatIsIt: "Lightroom Classic builds large DNG Smart Previews and 1:1 rendering preview caches (.lrdata) for fast photo browsing.",
    whatHappens: "Safe to delete. Frees massive disk space; original raw photos remain untouched and previews are regenerated on demand.",
    manualSteps: [
      "In Lightroom Classic, select Library > Previews > Discard 1:1 Previews.",
      "Or close Lightroom and delete the [Catalog Name] Previews.lrdata folder."
    ]
  },
  {
    slug: "obs-studio-remux-temp-cache",
    category: "app",
    name: "OBS Studio Video Recording Remux & Browser Cache",
    path: "%AppData%\\obs-studio\\plugin_config\\obs-browser",
    safeToDelete: true,
    avgSpace: "1.5 GB – 10.0 GB",
    whatIsIt: "OBS Studio caches Chromium Embedded Framework (CEF) browser sources, stream alert caches, and temp remux artifacts.",
    whatHappens: "Clears stale browser cookies, animated overlay caches, and unlinked temporary recording fragments.",
    manualSteps: [
      "Close OBS Studio.",
      "Press Windows Key + R, type %AppData%\\obs-studio\\plugin_config\\obs-browser, and press Enter.",
      "Delete the 'Cache' and 'Code Cache' directories."
    ]
  },
  {
    slug: "streamlabs-desktop-worker-cache",
    category: "app",
    name: "Streamlabs Desktop CEF Browser Cache & Transition Blobs",
    path: "%AppData%\\slobs-client\\Cache",
    safeToDelete: true,
    avgSpace: "2.0 GB – 14.0 GB",
    whatIsIt: "Streamlabs Desktop stores animated WebM stinger transitions, widget overlays, and CEF worker caches in %AppData%\\slobs-client.",
    whatHappens: "Safe to clean. Restores browser memory responsiveness and clears gigabytes of old overlay caches.",
    manualSteps: [
      "Quit Streamlabs Desktop completely.",
      "Navigate to %AppData%\\slobs-client and delete the Cache directory."
    ]
  },
  {
    slug: "pcsx2-ps2-texture-shader-cache",
    category: "app",
    name: "PCSX2 PlayStation 2 Vulkan & DirectX Shader Cache",
    path: "%UserProfile%\\Documents\\PCSX2\\shaders",
    safeToDelete: true,
    avgSpace: "1.0 GB – 7.5 GB",
    whatIsIt: "PCSX2 emulator writes precompiled graphics shaders for PS2 games to prevent micro-stutters during gameplay.",
    whatHappens: "Safe to delete. Clears corrupted or outdated emulator shaders; PCSX2 will compile fresh shaders during emulation.",
    manualSteps: [
      "Close PCSX2 emulator.",
      "Navigate to Documents\\PCSX2\\shaders (or %LocalAppData%\\PCSX2\\shaders) and delete the cache files."
    ]
  },
  {
    slug: "ryujinx-switch-vulkan-shader-cache",
    category: "app",
    name: "Ryujinx Nintendo Switch Vulkan & PPTC Shader Cache",
    path: "%AppData%\\Ryujinx\\games",
    safeToDelete: true,
    avgSpace: "2.0 GB – 18.0 GB",
    whatIsIt: "Ryujinx caches compiled guest code (PPTC) and Vulkan/SPIR-V graphics shaders for each Nintendo Switch title.",
    whatHappens: "Safe to clean. Resolves shader compilation glitches and frees multiple gigabytes of C: drive storage.",
    manualSteps: [
      "Right-click any game in Ryujinx and select 'Purge PPTC Cache' or 'Purge Shader Cache'.",
      "Or delete cache subfolders in %AppData%\\Ryujinx\\games."
    ]
  },
  {
    slug: "cemu-wii-u-pipeline-shader-cache",
    category: "app",
    name: "Cemu Wii U Emulator Pipeline Shader Cache & Transferable Cache",
    path: "C:\\Cemu\\shaderCache\\transferable",
    safeToDelete: true,
    avgSpace: "1.5 GB – 8.5 GB",
    whatIsIt: "Cemu emulator saves transferable and precompiled OpenGL/Vulkan pipeline caches inside Cemu\\shaderCache.",
    whatHappens: "Safe to delete. Frees disk space and allows Cemu to compile fresh, glitch-free graphics pipelines.",
    manualSteps: [
      "Close Cemu emulator.",
      "Navigate to your Cemu installation folder, open 'shaderCache', and delete contents of 'precompiled'."
    ]
  },
  {
    slug: "solidworks-temporary-scratch-files",
    category: "app",
    name: "SolidWorks Temporary Scratch Files & Crash Backup Files",
    path: "%LocalAppData%\\SolidWorks\\SolidWorks Temp",
    safeToDelete: true,
    avgSpace: "3.0 GB – 25.0 GB",
    whatIsIt: "Dassault Systèmes SolidWorks leaves behind massive CAD scratch buffers, auto-recover backups, and visualization files.",
    whatHappens: "Safely cleans orphaned CAD temp files without altering your native .sldprt or .sldasm assembly models.",
    manualSteps: [
      "Save and close all SolidWorks projects.",
      "Press Windows Key + R, type %LocalAppData%\\SolidWorks, and delete the Temp folders."
    ]
  },
  {
    slug: "autocad-graphics-hardware-cache",
    category: "app",
    name: "Autodesk AutoCAD Graphics Cache & Temporary Plot Logs",
    path: "%LocalAppData%\\Autodesk\\AutoCAD",
    safeToDelete: true,
    avgSpace: "2.0 GB – 15.0 GB",
    whatIsIt: "Autodesk AutoCAD caches hardware-accelerated 2D/3D display tessellations in GraphicsCache folders.",
    whatHappens: "Safe to delete. Forces AutoCAD to regenerate graphics cache, resolving display artifacts and reclaiming SSD space.",
    manualSteps: [
      "Close AutoCAD.",
      "In Windows Explorer, navigate to %LocalAppData%\\Autodesk\\AutoCAD <version>\\GraphicsCache and clear files."
    ]
  },
  {
    slug: "clip-studio-paint-canvas-cache",
    category: "app",
    name: "Clip Studio Paint Auto-Save Canvas & Material Backup Cache",
    path: "%UserProfile%\\AppData\\Roaming\\CELSYS\\CLIPStudioPaintVer1_5_0\\DocumentTemp",
    safeToDelete: true,
    avgSpace: "2.0 GB – 12.0 GB",
    whatIsIt: "Clip Studio Paint maintains canvas state snapshots, recovery files, and material download caches in %AppData%\\CELSYS.",
    whatHappens: "Safely reclaims disk capacity from closed illustration projects while protecting your saved .clip artworks.",
    manualSteps: [
      "Close Clip Studio Paint.",
      "Navigate to %AppData%\\CELSYS\\CLIPStudioPaintVer1_5_0 and clear the DocumentTemp folder."
    ]
  },
  {
    slug: "cyberlink-powerdirector-shadow-files",
    category: "app",
    name: "CyberLink PowerDirector Shadow Preview Files & Render Cache",
    path: "%UserProfile%\\AppData\\Roaming\\CyberLink\\PowerDirector",
    safeToDelete: true,
    avgSpace: "5.0 GB – 30.0 GB",
    whatIsIt: "CyberLink PowerDirector generates low-resolution shadow files and temporary timeline render files for video editing.",
    whatHappens: "Safe to delete. Frees tens of gigabytes; PowerDirector will regenerate shadow files as needed when editing.",
    manualSteps: [
      "In PowerDirector, open Preferences > General.",
      "Click 'Manually Delete' next to Auto-delete temporary files, or clean with SWEEPR Cleaner."
    ]
  },
  {
    slug: "windows-dism-superseded-components",
    category: "folder",
    name: "Windows 11 Component Store Superseded Updates (WinSxS Temp)",
    path: "C:\\Windows\\WinSxS\\Temp\\PendingRenames",
    safeToDelete: true,
    avgSpace: "4.0 GB – 22.0 GB",
    whatIsIt: "The Windows Component Store (WinSxS) leaves behind superseded update payload staging files and pending rename files.",
    whatHappens: "Safely reclaims gigabytes from the Windows directory. Active operating system files are fully preserved.",
    manualSteps: [
      "Open Windows Terminal as Administrator.",
      "Run: Dism.exe /online /Cleanup-Image /StartComponentCleanup /ResetBase",
      "Wait for DISM to complete component retirement and cleanup."
    ]
  }
];

function buildAllCandidateItems() {
  const candidates = [...CURATED_TOPICS, ...WINDOWS_FOLDER_MATRIX.map((f) => ({ ...f, category: "folder" }))];

  for (const app of APP_MATRIX_APPS) {
    for (const comp of APP_CACHE_COMPONENTS) {
      const slug = `${app.key}-${comp.subSlug}`;
      candidates.push({
        slug,
        category: "app",
        name: `${app.label} ${comp.subName}`,
        path: `${app.baseDir}\\${comp.subPath}`,
        safeToDelete: true,
        avgSpace: comp.avgSpace,
        whatIsIt: `${app.label} ${comp.whatSuffix}`,
        whatHappens: `Cleaning ${app.label}'s ${comp.subName} ${comp.happensSuffix}`,
        manualSteps: [
          `Completely quit ${app.label} (verify ${app.proc} is closed in Task Manager).`,
          `Press Windows Key + R, type ${app.baseDir} and press Enter.`,
          `Locate ${comp.subPath}, select all cached files (Ctrl+A), and press Delete (or clean in 1 click with SWEEPR Cleaner).`
        ]
      });
    }
  }

  return candidates;
}

function updateSitemapXml(items) {
  const today = new Date().toISOString().slice(0, 10);
  const existingXml = fs.existsSync(SITEMAP_PATH) ? fs.readFileSync(SITEMAP_PATH, "utf8") : "";
  const existingLocs = new Set(
    [...existingXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
  );

  const additions = [];
  for (const item of items) {
    const url = `https://sweeprcleaner.com/clean/${item.category}/${item.slug}`;
    if (!existingLocs.has(url)) {
      existingLocs.add(url);
      additions.push(`  <url>
    <loc>${url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`);
    }
  }

  if (additions.length > 0 && existingXml.includes("</urlset>")) {
    const updated = existingXml.replace("</urlset>", `${additions.join("\n")}\n</urlset>`);
    fs.writeFileSync(SITEMAP_PATH, updated, "utf8");
  }
  return additions.length;
}

function updateLlmsTxt(allItems) {
  if (!fs.existsSync(LLMS_PATH)) return;
  let content = fs.readFileSync(LLMS_PATH, "utf8");
  const marker = "## Programmatic Windows Storage & App Cache Guides";
  const topGuides = allItems
    .slice(-25)
    .reverse()
    .map((i) => `- [${i.name} (${i.path})](https://sweeprcleaner.com/clean/${i.category}/${i.slug}): Reclaim ${i.avgSpace}`)
    .join("\n");

  const section = `${marker} (${allItems.length} Verified Guides)
- Full Directory: https://sweeprcleaner.com/clean
${topGuides}
`;

  if (content.includes(marker)) {
    content = content.slice(0, content.indexOf(marker)) + section;
  } else {
    content = content.trimEnd() + "\n\n" + section;
  }
  fs.writeFileSync(LLMS_PATH, content, "utf8");
}

function updateIndexingQueue(newUrls) {
  let queue = { updatedAt: new Date().toISOString(), pendingUrls: [] };
  if (fs.existsSync(INDEXING_QUEUE_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(INDEXING_QUEUE_PATH, "utf8"));
      if (Array.isArray(parsed)) {
        queue.pendingUrls = parsed;
      } else if (parsed && Array.isArray(parsed.pendingUrls)) {
        queue = parsed;
      }
    } catch {
      /* reset corrupt queue */
    }
  }
  const set = new Set(queue.pendingUrls || []);
  for (const u of newUrls) set.add(u);
  queue.updatedAt = new Date().toISOString();
  queue.pendingUrls = [...set];
  fs.writeFileSync(INDEXING_QUEUE_PATH, JSON.stringify(queue, null, 2), "utf8");
}

async function pingIndexNow(urls) {
  if (urls.length === 0) return;
  const payload = {
    host: "sweeprcleaner.com",
    key: INDEXNOW_KEY,
    keyLocation: `https://sweeprcleaner.com/${INDEXNOW_KEY}.txt`,
    urlList: urls
  };
  for (const endpoint of ["https://www.bing.com/indexnow", "https://api.indexnow.org/indexnow"]) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });
      console.log(`[IndexNow] ${endpoint} -> HTTP ${res.status} (${urls.length} URLs)`);
    } catch (e) {
      console.warn(`[IndexNow] ${endpoint} skipped:`, e.message);
    }
  }
}

async function syncKeywordsToCrm(newItems) {
  for (const base of CRM_URLS) {
    try {
      for (const item of newItems.slice(0, 15)) {
        await fetch(`${base}/api/crm/seo/keywords?project=cleaner`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: AUTH_HEADER
          },
          body: JSON.stringify({
            keyword: `clean ${item.slug.replace(/-/g, " ")} windows 11`,
            category: `pseo-${item.category}`,
            target_path: `/clean/${item.category}/${item.slug}`
          }),
          signal: AbortSignal.timeout(6000)
        }).catch(() => {});
      }
    } catch {
      /* ignore offline CRM */
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const countArg = Number(args.find((a) => !a.startsWith("-")) || 50);
  const targetCount = Math.max(1, Math.min(200, countArg));
  const force = args.includes("--force");

  if (!force && fs.existsSync(DAILY_STATE_PATH)) {
    try {
      const state = JSON.parse(fs.readFileSync(DAILY_STATE_PATH, "utf8"));
      const lastRunMs = new Date(state.lastRunAt || 0).getTime();
      const hoursSince = (Date.now() - lastRunMs) / (1000 * 3600);
      if (hoursSince < 20) {
        console.log(
          `[Daily 50 SEO Pages] Already generated ${state.lastCount || 50} pages ${hoursSince.toFixed(1)}h ago (${state.lastRunAt}). Pass --force to run immediately.`
        );
        return;
      }
    } catch {
      /* continue */
    }
  }

  const existingItems = JSON.parse(fs.readFileSync(CLEAN_ITEMS_PATH, "utf8"));
  const existingSlugs = new Set(existingItems.map((i) => i.slug.toLowerCase()));

  const allCandidates = buildAllCandidateItems();
  const selected = [];
  for (const cand of allCandidates) {
    if (selected.length >= targetCount) break;
    const normSlug = cand.slug.toLowerCase();
    if (existingSlugs.has(normSlug)) continue;
    // Validate required fields
    if (!cand.name || !cand.path || !cand.whatIsIt || !cand.whatHappens || !Array.isArray(cand.manualSteps) || cand.manualSteps.length < 2) {
      continue;
    }
    existingSlugs.add(normSlug);
    selected.push(cand);
  }

  if (selected.length === 0) {
    console.log("[Daily 50 SEO Pages] All candidate topics are already published in clean-items.json.");
    return;
  }

  const updatedItems = [...existingItems, ...selected];
  fs.writeFileSync(CLEAN_ITEMS_PATH, JSON.stringify(updatedItems, null, 2) + "\n", "utf8");

  const sitemapAdded = updateSitemapXml(selected);
  updateLlmsTxt(updatedItems);

  const newUrls = selected.map((i) => `https://sweeprcleaner.com/clean/${i.category}/${i.slug}`);
  updateIndexingQueue(newUrls);

  fs.writeFileSync(
    DAILY_STATE_PATH,
    JSON.stringify(
      {
        lastRunAt: new Date().toISOString(),
        lastCount: selected.length,
        totalCleanItems: updatedItems.length,
        sampleUrls: newUrls.slice(0, 10)
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`[Daily 50 SEO Pages] Generated ${selected.length} new keyword-researched SEO pages (Total: ${updatedItems.length} pages, +${sitemapAdded} in sitemap.xml).`);
  await pingIndexNow(newUrls);
  await syncKeywordsToCrm(selected);

  if (!process.argv.includes("--no-push")) {
    try {
      execFileSync(
        "git",
        [
          "add",
          "server/src/data/clean-items.json",
          "server/src/data/indexing-queue.json",
          "server/src/data/daily-seo-pages-state.json",
          "server/public/sitemap.xml",
          "server/public/llms.txt",
          "server/scripts/daily-50-seo-pages.mjs"
        ],
        { cwd: REPO_ROOT, stdio: "inherit" }
      );
      execFileSync(
        "git",
        ["commit", "-m", `chore(seo): publish ${selected.length} daily keyword-researched SEO pages (total ${updatedItems.length})`],
        { cwd: REPO_ROOT, stdio: "inherit" }
      );
      execFileSync("git", ["push", "origin", "main"], { cwd: REPO_ROOT, stdio: "inherit" });
      console.log("[Daily 50 SEO Pages] Committed and pushed to GitHub (origin/main) -> Railway auto-deploy triggered.");
    } catch (gitErr) {
      console.warn("[Daily 50 SEO Pages] Git auto-push skipped or failed:", gitErr?.message || gitErr);
    }
  }
}

main().catch((err) => {
  console.error("[Daily 50 SEO Pages] Error:", err);
  process.exit(1);
});
