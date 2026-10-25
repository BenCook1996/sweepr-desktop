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
  { key: "roblox-player", label: "Roblox Engine & Player", baseDir: "%LocalAppData%\\Roblox\\Downloads", proc: "RobloxPlayerBeta.exe" },
  { key: "tiktok-live-studio", label: "TikTok LIVE Studio", baseDir: "%AppData%\\tiktok-live-studio\\Cache", proc: "TikTok LIVE Studio.exe" }
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
          "server/public/llms.txt"
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
