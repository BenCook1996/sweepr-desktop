//! Cleaning rule definitions.
//!
//! Every path the app can ever delete from is resolved HERE, in Rust, from a
//! fixed allowlist. The frontend can only refer to rules by `id`.
//! Rules within one OS must not overlap (no root may sit inside another rule's root),
//! otherwise bytes would be double-counted.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Group {
    System,
    Browsers,
    Apps,
    Developer,
}

#[derive(Clone, Debug)]
pub struct Rule {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub group: Group,
    /// Concrete, existing directories (wildcards already expanded).
    pub roots: Vec<PathBuf>,
    /// Only files not modified within this many hours are targeted.
    pub min_age_hours: u64,
    /// Included in the free tier (no subscription required to clean).
    pub free: bool,
}

pub struct Spec {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub group: Group,
    pub base: Base,
    pub patterns: &'static [&'static str],
    pub min_age_hours: u64,
    pub free: bool,
}

#[allow(dead_code)]
#[derive(Clone, Copy)]
pub enum Base {
    Downloads,
    Home,
    Temp,
    LocalAppData,
    RoamingAppData,
    UserFolders,
}

impl Base {
    pub fn resolve(self) -> Option<PathBuf> {
        match self {
            Base::Home => dirs::home_dir(),
            Base::Downloads => dirs::download_dir(),
            Base::Temp => Some(std::env::temp_dir()),
            Base::LocalAppData => dirs::data_local_dir(),
            Base::RoamingAppData => dirs::data_dir(),
            Base::UserFolders => dirs::home_dir(),
        }
    }
}

fn user_folder_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    for dir in [
        dirs::download_dir(),
        dirs::document_dir(),
        dirs::picture_dir(),
        dirs::video_dir(),
        dirs::audio_dir(),
        dirs::desktop_dir(),
    ]
    .into_iter()
    .flatten()
    {
        if dir.is_dir() && !roots.iter().any(|r| r == &dir) {
            roots.push(dir);
        }
    }
    roots
}

/// Simple glob for a single path segment: supports `*` anywhere in the segment.
fn segment_matches(pattern: &str, name: &str) -> bool {
    if !pattern.contains('*') {
        return pattern.eq_ignore_ascii_case(name);
    }
    let parts: Vec<&str> = pattern.split('*').collect();
    let lname = name.to_ascii_lowercase();
    let mut pos = 0usize;
    for (i, part) in parts.iter().enumerate() {
        let part = part.to_ascii_lowercase();
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            if !lname.starts_with(&part) {
                return false;
            }
            pos = part.len();
        } else if let Some(found) = lname[pos..].find(&part) {
            pos += found + part.len();
        } else {
            return false;
        }
    }
    let last = parts.last().unwrap().to_ascii_lowercase();
    last.is_empty() || lname.ends_with(&last)
}

/// Resolve an optional `@prefix/` override on a pattern so a single rule can
/// cleanly span `LocalAppData`, `RoamingAppData`, `ProgramData`, `Home`, etc.
fn resolve_pattern_base<'a>(default_base: &Path, pattern: &'a str) -> Option<(PathBuf, &'a str)> {
    if let Some(rest) = pattern.strip_prefix("@local/") {
        return dirs::data_local_dir().map(|b| (b, rest));
    }
    if let Some(rest) = pattern.strip_prefix("@roaming/") {
        return dirs::data_dir().map(|b| (b, rest));
    }
    if let Some(rest) = pattern.strip_prefix("@home/") {
        return dirs::home_dir().map(|b| (b, rest));
    }
    if let Some(rest) = pattern.strip_prefix("@programdata/") {
        let pd = std::env::var_os("ProgramData")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
        return Some((pd, rest));
    }
    if let Some(rest) = pattern.strip_prefix("@pfx86/") {
        let pf = std::env::var_os("ProgramFiles(x86)")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)"));
        return Some((pf, rest));
    }
    if let Some(rest) = pattern.strip_prefix("@systemdrive/") {
        let sd = std::env::var_os("SystemDrive")
            .map(|d| PathBuf::from(format!("{}\\", d.to_string_lossy())))
            .unwrap_or_else(|| PathBuf::from(r"C:\"));
        return Some((sd, rest));
    }
    Some((default_base.to_path_buf(), pattern))
}

/// Expand a `/`-separated relative pattern (with `*` segments) against `base`,
/// returning only directories that exist.
fn expand(base: &Path, pattern: &str) -> Vec<PathBuf> {
    let Some((start_base, rel_pattern)) = resolve_pattern_base(base, pattern) else {
        return Vec::new();
    };
    let mut current = vec![start_base];
    for seg in rel_pattern.split('/').filter(|s| !s.is_empty()) {
        let mut next = Vec::new();
        for dir in &current {
            if seg.contains('*') {
                if let Ok(rd) = std::fs::read_dir(dir) {
                    for e in rd.flatten() {
                        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                        if is_dir && segment_matches(seg, &e.file_name().to_string_lossy()) {
                            next.push(e.path());
                        }
                    }
                }
            } else {
                next.push(dir.join(seg));
            }
        }
        current = next;
    }
    current.into_iter().filter(|p| p.is_dir()).collect()
}

#[cfg(target_os = "windows")]
fn specs() -> Vec<Spec> {
    use Base::*;
    vec![
        Spec { id: "temp", name: "Temporary files", description: "Files apps left in your temp folder more than 24 hours ago.", group: Group::System, base: Temp, patterns: &[""], min_age_hours: 24, free: false },
        Spec { id: "thumbnails", name: "Windows thumbnail & icon cache", description: "Cached Explorer thumbnails, IE/WebView caches and diagnostic traces. Rebuilds automatically.", group: Group::System, base: LocalAppData, patterns: &["Microsoft/Windows/INetCache/IE", "Microsoft/Windows/Caches", "ElevatedDiagnostics"], min_age_hours: 24, free: false },
        Spec { id: "crash_dumps", name: "Crash dumps & kernel reports", description: "Diagnostic dumps, Windows Error Reporting archives, LiveKernelReports watchdog dumps and CLR usage logs.", group: Group::System, base: LocalAppData, patterns: &["CrashDumps", "Microsoft/Windows/WER/ReportArchive", "Microsoft/Windows/WER/ReportQueue", "Diagnostics", "Microsoft/CLR_v4.0/UsageLogs", "@systemdrive/Windows/LiveKernelReports"], min_age_hours: 0, free: false },
        Spec { id: "delivery_opt", name: "Windows Update, Package Cache & Windows.old", description: "Delivery Optimization peer cache, installer Package Cache, Defender scan history and previous Windows installation leftovers.", group: Group::System, base: LocalAppData, patterns: &["Microsoft/Windows/DeliveryOptimization/Cache", "Package Cache", "@programdata/Package Cache", "@programdata/Microsoft/Windows Defender/Scans/History/Results", "@systemdrive/Windows.old"], min_age_hours: 24, free: false },
        Spec { id: "shader_cache", name: "DirectX, NVIDIA & AMD GPU shader caches", description: "DirectX D3DSCache, NVIDIA DXCache/GLCache/NV_Cache, AMD DxCache/VkCache/GLCache and C:\\AMD driver unpack leftovers. Rebuilds automatically.", group: Group::System, base: LocalAppData, patterns: &["D3DSCache", "NVIDIA/DXCache", "NVIDIA/GLCache", "@programdata/NVIDIA Corporation/NV_Cache", "AMD/DxCache", "AMD/VkCache", "AMD/GLCache", "AMD/OglCache", "@systemdrive/AMD"], min_age_hours: 24, free: false },
        Spec { id: "webview2_cache", name: "Microsoft Edge WebView2 (EBWebView) cache", description: "Shared WebView2 runtime caches from Windows Widgets, Search, Teams and desktop add-ins. Rebuilds automatically.", group: Group::System, base: LocalAppData, patterns: &["Microsoft/EdgeWebView", "Packages/MSTeams_8wekyb3d8bbwe/LocalCache/Microsoft/MSTeams/EBWebView/Default/Cache", "Packages/MSTeams_8wekyb3d8bbwe/LocalCache/Microsoft/MSTeams/EBWebView/Default/Code Cache", "Packages/MicrosoftWindows.Client.WebExperience_cw5n1h2txyewy/LocalState/EBWebView/Default/Cache", "Packages/Microsoft.Windows.Search_cw5n1h2txyewy/LocalState/EBWebView/Default/Cache", "*/EBWebView/Default/Cache", "*/EBWebView/Default/Code Cache", "*/EBWebView/Default/GPUCache", "*/EBWebView/Default/Service Worker/CacheStorage"], min_age_hours: 24, free: false },
        Spec { id: "chrome", name: "Google Chrome cache & GPU/Service Worker storage", description: "Cached web content, Code Cache, GPUCache, Dawn WebGPU cache and Service Worker CacheStorage. Logins and history are untouched.", group: Group::Browsers, base: LocalAppData, patterns: &["Google/Chrome/User Data/*/Cache", "Google/Chrome/User Data/*/Code Cache", "Google/Chrome/User Data/*/GPUCache", "Google/Chrome/User Data/*/DawnCache", "Google/Chrome/User Data/*/GraphiteDawnCache", "Google/Chrome/User Data/GrShaderCache", "Google/Chrome/User Data/ShaderCache", "Google/Chrome/User Data/*/Service Worker/CacheStorage", "Google/Chrome/User Data/*/Service Worker/ScriptCache"], min_age_hours: 0, free: false },
        Spec { id: "edge", name: "Microsoft Edge cache & GPU/Service Worker storage", description: "Cached web content, Code Cache, GPUCache and Service Worker storage. Logins and history are untouched.", group: Group::Browsers, base: LocalAppData, patterns: &["Microsoft/Edge/User Data/*/Cache", "Microsoft/Edge/User Data/*/Code Cache", "Microsoft/Edge/User Data/*/GPUCache", "Microsoft/Edge/User Data/*/DawnCache", "Microsoft/Edge/User Data/GrShaderCache", "Microsoft/Edge/User Data/*/Service Worker/CacheStorage"], min_age_hours: 0, free: false },
        Spec { id: "brave", name: "Brave Browser cache & GPU/Service Worker storage", description: "Cached web content, Code Cache, GPUCache and Service Worker storage. Logins and Shields are untouched.", group: Group::Browsers, base: LocalAppData, patterns: &["BraveSoftware/Brave-Browser/User Data/*/Cache", "BraveSoftware/Brave-Browser/User Data/*/Code Cache", "BraveSoftware/Brave-Browser/User Data/*/GPUCache", "BraveSoftware/Brave-Browser/User Data/*/DawnCache", "BraveSoftware/Brave-Browser/User Data/GrShaderCache", "BraveSoftware/Brave-Browser/User Data/*/Service Worker/CacheStorage"], min_age_hours: 0, free: false },
        Spec { id: "firefox", name: "Firefox cache & startup shader cache", description: "Cached web content and startup/shader caches across Firefox profiles. Logins and history are untouched.", group: Group::Browsers, base: LocalAppData, patterns: &["Mozilla/Firefox/Profiles/*/cache2", "Mozilla/Firefox/Profiles/*/startupCache", "Mozilla/Firefox/Profiles/*/shader-cache"], min_age_hours: 0, free: false },
        Spec { id: "alt_browsers", name: "Opera GX, Arc, Vivaldi & Thunderbird caches", description: "Web, shader, bytecode and Service Worker caches from Opera GX, Arc Browser, Vivaldi and Mozilla Thunderbird.", group: Group::Browsers, base: LocalAppData, patterns: &["Opera Software/Opera GX Stable/Cache", "Opera Software/Opera GX Stable/SystemCache", "@roaming/Opera Software/Opera GX Stable/Code Cache", "@roaming/Opera Software/Opera GX Stable/GPUCache", "@roaming/Opera Software/Opera GX Stable/ShaderCache", "@roaming/Opera Software/Opera GX Stable/Service Worker/CacheStorage", "Opera Software/Opera Stable/Cache", "Vivaldi/User Data/*/Cache", "Vivaldi/User Data/*/Code Cache", "Vivaldi/User Data/*/GPUCache", "Packages/TheBrowserCompany.Arc*/LocalCache/Local/Arc/User Data/*/Cache", "Packages/TheBrowserCompany.Arc*/LocalCache/Local/Arc/User Data/*/Code Cache", "Packages/TheBrowserCompany.Arc*/LocalCache/Local/Arc/User Data/*/GPUCache", "Thunderbird/Profiles/*/cache2", "Thunderbird/Profiles/*/startupCache"], min_age_hours: 0, free: false },
        Spec { id: "app_caches", name: "Discord & VS Code caches", description: "Cached media, bytecode and workspace data from Discord and Visual Studio Code. Rebuilds on next launch.", group: Group::Apps, base: RoamingAppData, patterns: &["discord/Cache", "discord/Code Cache", "discord/GPUCache", "Code/Cache", "Code/CachedData", "Code/GPUCache"], min_age_hours: 0, free: false },
        Spec { id: "peripheral_caches", name: "Logitech G HUB, Razer Synapse & iCUE caches", description: "Logitech G HUB media/blob storage, installer depots & bytecode caches, plus Razer Synapse and Corsair iCUE logs. Macros and profiles (settings.db) are untouched.", group: Group::Apps, base: LocalAppData, patterns: &["LGHUB/blob_storage", "LGHUB/cache", "@roaming/LGHUB/Code Cache", "@roaming/LGHUB/GPUCache", "@roaming/LGHUB/DawnCache", "@programdata/LGHUB/depots", "Razer/Synapse3/Log", "Razer/RazerAppEngine/User Data/Default/Cache", "Razer/RazerAppEngine/User Data/Default/Code Cache", "Corsair/iCUE5/logs"], min_age_hours: 0, free: false },
        Spec { id: "game_launchers", name: "Gaming Launchers & Shader/Update Caches", description: "Safe webcaches, depotcaches, shader caches and crash logs from Steam, Epic Games, EA App/Origin, HoYoPlay/Genshin Impact, Riot Client, GOG Galaxy, Ubisoft, VRChat, Medal TV, Overwolf, Minecraft and Roblox.", group: Group::Apps, base: LocalAppData, patterns: &["EpicGamesLauncher/Saved/webcache", "EpicGamesLauncher/Saved/webcache_4147", "EpicGamesLauncher/Saved/webcache_4430", "EpicGamesLauncher/Saved/Logs", "EpicGamesLauncher/Saved/Crashes", "Electronic Arts/EA Desktop/EA Desktop/cache", "Electronic Arts/EA Desktop/EA Desktop/CEF/BrowserCache", "Origin/Web Cache", "@programdata/Origin/DownloadCache", "@programdata/EA Desktop/InstallData", "HoYoPlay/logs", "HoYoPlay/webCaches", "GenshinImpact/webCaches", "Steam/htmlcache", "@pfx86/Steam/depotcache", "@pfx86/Steam/steamapps/shadercache", "@pfx86/Steam/appcache/httpcache", "@pfx86/Steam/logs", "@pfx86/Steam/dumps", "Riot Games/Riot Client/Logs", "Riot Games/Riot Client/Data/Logs", "VALORANT/Saved/Logs", "VALORANT/Saved/Crashes", "@programdata/GOG.com/Galaxy/webcache", "@programdata/GOG.com/Galaxy/logs", "Ubisoft Game Launcher/cache", "Ubisoft Game Launcher/logs", "Battle.net/BrowserCaches", "Battle.net/Cache", "VRChat/VRChat/Cache-WindowsPlayer", "VRChat/VRChat/HTTPCache-WindowsPlayer", "Medal/editor", "@roaming/Medal/logs", "@roaming/Medal/Cache", "@roaming/Medal/Code Cache", "Overwolf/Log", "Overwolf/BrowserCache", "@roaming/.minecraft/logs", "@roaming/.minecraft/crash-reports", "Roblox/http", "Roblox/logs", "Activision/Call of Duty/shadercache"], min_age_hours: 0, free: false },
        Spec { id: "creator_ai_caches", name: "Creator, Media & Local AI App Caches", description: "Temporary caches and logs from CapCut, OBS Studio, DaVinci Resolve, Adobe Media/CameraRaw, Canva, Notion, Postman, Plex, ComfyUI and LM Studio.", group: Group::Apps, base: LocalAppData, patterns: &["CapCut/User Data/Cache", "@roaming/obs-studio/logs", "@roaming/obs-studio/crashes", "@roaming/Blackmagic Design/DaVinci Resolve/Support/logs", "Adobe/Common/Media Cache Files", "Adobe/CameraRaw/Cache", "Plex Media Server/Cache/Transcode", "Plex Media Server/Logs", "@roaming/Canva/Cache", "@roaming/Canva/Code Cache", "@roaming/Canva/GPUCache", "@roaming/Notion/Cache", "@roaming/Notion/Code Cache", "@roaming/Notion/GPUCache", "@roaming/Postman/logs", "@roaming/Postman/Cache", "@roaming/Postman/Code Cache", "@roaming/LM Studio/Cache", "@roaming/LM Studio/Code Cache", "@roaming/LM Studio/GPUCache", "@home/.cache/lm-studio/.internal", "@home/.cache/huggingface/hub/.locks"], min_age_hours: 0, free: false },
        Spec { id: "spotify", name: "Spotify offline cache", description: "Streaming cache (not your downloaded playlists).", group: Group::Apps, base: LocalAppData, patterns: &["Spotify/Data"], min_age_hours: 0, free: false },
        Spec { id: "downloads", name: "Old & Unused Downloads", description: "Files in your Downloads folder older than 30 days that haven't been opened or used recently.", group: Group::System, base: Downloads, patterns: &[""], min_age_hours: 30 * 24, free: false },
        Spec { id: "duplicates", name: "Duplicate Files", description: "Identical copies of files, photos, documents, and installers across your device. The original copy is always preserved.", group: Group::System, base: UserFolders, patterns: &[""], min_age_hours: 0, free: false },
        Spec { id: "dev_caches", name: "Developer package & IDE caches", description: "npm, pnpm, pip, Yarn, NuGet, Composer, Go build/module caches and JetBrains IDE caches/logs.", group: Group::Developer, base: LocalAppData, patterns: &["npm-cache/_cacache", "pnpm/store", "pip/cache", "Yarn/Cache", "NuGet/v3-cache", "Composer/cache", "go-build", "@home/go/pkg/mod/cache/download", "JetBrains/*/caches", "JetBrains/*/log"], min_age_hours: 0, free: false },
        Spec { id: "build_caches", name: "Gradle, Maven & Cargo build caches", description: "Cached Gradle, Maven (.m2) and Rust Cargo registry archives in your user profile (~/.gradle/caches, ~/.m2/repository/.cache, ~/.cargo/registry/cache).", group: Group::Developer, base: Home, patterns: &[".gradle/caches", ".m2/repository/.cache", ".cargo/registry/cache"], min_age_hours: 24 * 7, free: false },
        Spec { id: "messenger_caches", name: "Messenger & Collaboration caches", description: "Cached media and webviews from Slack, Microsoft Teams, Zoom, WhatsApp, and Telegram Desktop. Chats and logins are not touched.", group: Group::Apps, base: RoamingAppData, patterns: &["Slack/Cache", "Slack/Code Cache", "Slack/GPUCache", "Slack/Service Worker/CacheStorage", "Microsoft/Teams/Cache", "Microsoft/Teams/Code Cache", "Microsoft/Teams/GPUCache", "Zoom/data/WebViewCache", "Telegram Desktop/tdata/user_data/cache", "Telegram Desktop/tdata/user_data/media_cache"], min_age_hours: 0, free: false },
        Spec { id: "recent_activity", name: "Windows Activity & JumpList traces", description: "Recent file jump lists and Explorer activity caches.", group: Group::System, base: RoamingAppData, patterns: &["Microsoft/Windows/Recent/AutomaticDestinations", "Microsoft/Windows/Recent/CustomDestinations"], min_age_hours: 24, free: false },
        Spec { id: "system_slimmer", name: "Windows Installer & INet cache slimmer", description: "Legacy Windows Setup logs and temporary installer extraction caches.", group: Group::System, base: LocalAppData, patterns: &["Microsoft/Windows/INetCache/Content.Outlook", "Temp/WinGet"], min_age_hours: 24, free: false },
    ]
}

#[cfg(target_os = "macos")]
fn specs() -> Vec<Spec> {
    use Base::*;
    vec![
        Spec { id: "temp", name: "System Temp Files", description: "Per-user temporary files and caches older than 24 hours.", group: Group::System, base: Temp, patterns: &[""], min_age_hours: 24, free: true },
        Spec { id: "trash", name: "Trash", description: "Items in your ~/.Trash folder older than 24 hours.", group: Group::System, base: Home, patterns: &[".Trash"], min_age_hours: 24, free: false },
        Spec { id: "chrome", name: "Google Chrome Cache & GPU/Service Worker Storage", description: "Cached images, scripts, GPUCache, Dawn WebGPU cache and Service Worker storage. Tabs, history, and logins are untouched.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/Google/Chrome", "Library/Application Support/Google/Chrome/*/Code Cache", "Library/Application Support/Google/Chrome/*/GPUCache", "Library/Application Support/Google/Chrome/*/DawnCache", "Library/Application Support/Google/Chrome/GrShaderCache", "Library/Application Support/Google/Chrome/*/Service Worker/CacheStorage"], min_age_hours: 0, free: false },
        Spec { id: "safari", name: "Safari Cache", description: "Safari web cache and preview thumbnails. History, bookmarks, and logins are untouched.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/com.apple.Safari", "Library/Safari/Touch Icons Cache"], min_age_hours: 0, free: false },
        Spec { id: "brave", name: "Brave Browser Cache & GPU/Service Worker Storage", description: "Cached web data, Code Cache, GPUCache and Service Worker storage for Brave Browser. History, Shields settings, and logins are untouched.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/BraveSoftware/Brave-Browser", "Library/Application Support/BraveSoftware/Brave-Browser/*/Code Cache", "Library/Application Support/BraveSoftware/Brave-Browser/*/GPUCache", "Library/Application Support/BraveSoftware/Brave-Browser/*/Service Worker/CacheStorage"], min_age_hours: 0, free: false },
        Spec { id: "firefox", name: "Firefox Cache & Startup Cache", description: "Cached web assets across Firefox profiles. Bookmarks and passwords are untouched.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/Firefox/Profiles/*/cache2", "Library/Caches/Firefox/Profiles/*/startupCache"], min_age_hours: 0, free: false },
        Spec { id: "edge", name: "Microsoft Edge Cache", description: "Cached web assets for Microsoft Edge on macOS. Tabs and logins are untouched.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/Microsoft Edge", "Library/Application Support/Microsoft Edge/*/Code Cache", "Library/Application Support/Microsoft Edge/*/GPUCache"], min_age_hours: 0, free: false },
        Spec { id: "alt_browsers", name: "Opera GX, Arc, Vivaldi & Thunderbird Caches", description: "Cached web, shader, and bytecode files from Opera GX, Arc Browser, Vivaldi, and Thunderbird.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/com.operasoftware.OperaGX", "Library/Application Support/com.operasoftware.OperaGX/Code Cache", "Library/Application Support/com.operasoftware.OperaGX/GPUCache", "Library/Caches/company.thebrowser.Browser", "Library/Application Support/Arc/User Data/*/Code Cache", "Library/Application Support/Arc/User Data/*/GPUCache", "Library/Caches/Vivaldi", "Library/Caches/Thunderbird/Profiles/*/cache2"], min_age_hours: 0, free: false },
        Spec { id: "app_caches", name: "Discord & VS Code Caches", description: "Caches from Discord and Visual Studio Code. Rebuilt automatically on next launch.", group: Group::Apps, base: Home, patterns: &["Library/Application Support/discord/Cache", "Library/Application Support/discord/Code Cache", "Library/Application Support/discord/GPUCache", "Library/Application Support/Code/Cache", "Library/Application Support/Code/CachedData", "Library/Application Support/Code/GPUCache"], min_age_hours: 0, free: false },
        Spec { id: "peripheral_caches", name: "Logitech G HUB & Peripheral Caches", description: "Logitech G HUB media/blob storage, installer depots, and bytecode caches. Profiles (settings.db) are untouched.", group: Group::Apps, base: Home, patterns: &["Library/Caches/com.logitech.manager.daemon", "Library/Application Support/lghub/blob_storage", "Library/Application Support/lghub/Code Cache", "Library/Application Support/lghub/GPUCache", "Library/Application Support/lghub/depots"], min_age_hours: 0, free: false },
        Spec { id: "game_launchers", name: "Gaming Launchers & Shader/Update Caches", description: "Safe webcaches, depotcaches, shader caches, and logs from Steam, Epic Games, EA App/Origin, Riot Client, GOG Galaxy, Minecraft, and Roblox.", group: Group::Apps, base: Home, patterns: &["Library/Caches/com.epicgames.EpicGamesLauncher", "Library/Logs/Unreal Engine/EpicGamesLauncher", "Library/Application Support/Origin/DownloadCache", "Library/Caches/com.ea.mac.eaapp", "Library/Application Support/Steam/depotcache", "Library/Application Support/Steam/steamapps/shadercache", "Library/Application Support/Steam/appcache/httpcache", "Library/Application Support/Riot Games/Riot Client/Logs", "Library/Application Support/GOG.com/Galaxy/webcache", "Library/Application Support/minecraft/logs", "Library/Caches/com.roblox.RobloxPlayer"], min_age_hours: 0, free: false },
        Spec { id: "creator_ai_caches", name: "Creator, Media & Local AI App Caches", description: "Temporary caches and logs from CapCut, OBS Studio, DaVinci Resolve, Adobe Media/CameraRaw, Canva, Notion, Postman, Plex, and LM Studio.", group: Group::Apps, base: Home, patterns: &["Library/Containers/com.lemon.lvoverseas/Data/Library/Caches", "Library/Application Support/obs-studio/logs", "Library/Application Support/obs-studio/crashes", "Library/Application Support/Blackmagic Design/DaVinci Resolve/logs", "Library/Caches/Adobe/Common/Media Cache Files", "Library/Caches/Adobe Camera Raw2", "Library/Caches/com.plexapp.mediaserver/Transcode", "Library/Application Support/Canva/Cache", "Library/Application Support/Canva/Code Cache", "Library/Application Support/Notion/Cache", "Library/Application Support/Notion/Code Cache", "Library/Application Support/Postman/logs", "Library/Application Support/Postman/Cache", "Library/Application Support/LM Studio/Cache"], min_age_hours: 0, free: false },
        Spec { id: "spotify", name: "Spotify Offline Cache", description: "Streaming audio cache (does not delete your downloaded offline playlists).", group: Group::Apps, base: Home, patterns: &["Library/Caches/com.spotify.client/Data", "Library/Application Support/Spotify/PersistentCache/Storage"], min_age_hours: 0, free: false },
        Spec { id: "messenger_caches", name: "Messenger & Collaboration Caches", description: "Cached media and webviews from Slack, Microsoft Teams, Zoom, and Telegram. Chats and logins are untouched.", group: Group::Apps, base: Home, patterns: &["Library/Application Support/Slack/Cache", "Library/Application Support/Slack/Code Cache", "Library/Application Support/Slack/Service Worker/CacheStorage", "Library/Caches/us.zoom.xos", "Library/Application Support/Microsoft/Teams/Cache"], min_age_hours: 0, free: false },
        Spec { id: "user_caches", name: "macOS User & Library Caches", description: "~/Library/Caches system components older than 24 hours. Apps rebuild these automatically.", group: Group::Apps, base: Home, patterns: &["Library/Caches/CloudKit", "Library/Caches/com.apple.helpd", "Library/Caches/com.apple.parsecd"], min_age_hours: 24, free: false },
        Spec { id: "logs", name: "User & Crash Logs", description: "~/Library/Logs and macOS CrashReporter diagnostic reports.", group: Group::System, base: Home, patterns: &["Library/Logs", "Library/Application Support/CrashReporter"], min_age_hours: 24, free: false },
        Spec { id: "xcode", name: "Xcode & Simulator Caches", description: "Xcode DerivedData and CoreSimulator caches. Xcode regenerates them on next build.", group: Group::Developer, base: Home, patterns: &["Library/Developer/Xcode/DerivedData", "Library/Developer/CoreSimulator/Caches"], min_age_hours: 0, free: false },
        Spec { id: "downloads", name: "Old & Unused Downloads", description: "Files in your Downloads folder older than 30 days that haven't been opened or used recently.", group: Group::System, base: Downloads, patterns: &[""], min_age_hours: 30 * 24, free: false },
        Spec { id: "duplicates", name: "Duplicate Files", description: "Identical copies of files, photos, documents, and installers across your Mac. The original copy is always preserved.", group: Group::System, base: UserFolders, patterns: &[""], min_age_hours: 0, free: false },
        Spec { id: "dev_caches", name: "Developer Package & IDE Caches", description: "Homebrew, npm, pnpm, pip, Yarn, CocoaPods, Go module caches, and JetBrains IDE caches.", group: Group::Developer, base: Home, patterns: &["Library/Caches/Homebrew", ".npm/_cacache", "Library/pnpm/store", "Library/Caches/pip", "Library/Caches/Yarn", "Library/Caches/CocoaPods", "Library/Caches/go-build", "go/pkg/mod/cache/download", "Library/Caches/JetBrains"], min_age_hours: 0, free: false },
        Spec { id: "build_caches", name: "Gradle, Maven & Cargo Build Caches", description: "Cached Gradle, Maven (.m2), and Rust Cargo registry archives (~/.gradle/caches, ~/.m2/repository/.cache, ~/.cargo/registry/cache).", group: Group::Developer, base: Home, patterns: &[".gradle/caches", ".m2/repository/.cache", ".cargo/registry/cache"], min_age_hours: 24 * 7, free: false },
    ]
}

#[cfg(all(unix, not(target_os = "macos")))]
fn specs() -> Vec<Spec> {
    use Base::*;
    vec![
        Spec { id: "temp", name: "Temporary files", description: "Your files in /tmp older than 24 hours.", group: Group::System, base: Temp, patterns: &[""], min_age_hours: 24, free: false },
        Spec { id: "trash", name: "Trash bin", description: "Files in ~/.local/share/Trash older than 24 hours.", group: Group::System, base: Home, patterns: &[".local/share/Trash/files", ".local/share/Trash/info"], min_age_hours: 24, free: false },
        Spec { id: "shader_cache", name: "Mesa, Vulkan & NVIDIA GPU shader caches", description: "Compiled Mesa, Vulkan and NVIDIA GLCache/DXCache shader caches. Rebuilt automatically.", group: Group::System, base: Home, patterns: &[".cache/mesa_shader_cache", ".cache/mesa_shader_cache_sf", ".cache/nvidia/GLCache", ".cache/nvidia/DXCache"], min_age_hours: 24, free: false },
        Spec { id: "chrome", name: "Google Chrome cache & GPU/Service Worker storage", description: "Cached web content, Code Cache, GPUCache, Dawn WebGPU cache and Service Worker storage.", group: Group::Browsers, base: Home, patterns: &[".cache/google-chrome", ".config/google-chrome/*/Code Cache", ".config/google-chrome/*/GPUCache", ".config/google-chrome/*/DawnCache", ".config/google-chrome/*/Service Worker/CacheStorage"], min_age_hours: 0, free: false },
        Spec { id: "brave", name: "Brave Browser cache & GPU/Service Worker storage", description: "Cached web content, Code Cache, GPUCache and Service Worker storage.", group: Group::Browsers, base: Home, patterns: &[".cache/BraveSoftware", ".config/BraveSoftware/Brave-Browser/*/Code Cache", ".config/BraveSoftware/Brave-Browser/*/GPUCache", ".config/BraveSoftware/Brave-Browser/*/Service Worker/CacheStorage"], min_age_hours: 0, free: false },
        Spec { id: "firefox", name: "Firefox cache", description: "Cached web content across Firefox profiles.", group: Group::Browsers, base: Home, patterns: &[".cache/mozilla/firefox/*/cache2", ".cache/mozilla/firefox/*/startupCache"], min_age_hours: 0, free: false },
        Spec { id: "alt_browsers", name: "Vivaldi, Edge & Thunderbird caches", description: "Cached web content from Vivaldi, Microsoft Edge, and Mozilla Thunderbird.", group: Group::Browsers, base: Home, patterns: &[".cache/vivaldi", ".cache/microsoft-edge", ".cache/thunderbird"], min_age_hours: 0, free: false },
        Spec { id: "game_launchers", name: "Steam, Proton & Minecraft caches", description: "Steam depotcache, Vulkan shader caches, HTTP caches, and Minecraft logs.", group: Group::Apps, base: Home, patterns: &[".steam/steam/depotcache", ".steam/steam/steamapps/shadercache", ".steam/steam/appcache/httpcache", ".local/share/Steam/depotcache", ".local/share/Steam/steamapps/shadercache", ".minecraft/logs"], min_age_hours: 0, free: false },
        Spec { id: "creator_ai_caches", name: "OBS Studio, Postman & Local AI caches", description: "Logs and temporary caches from OBS Studio, Postman, and LM Studio.", group: Group::Apps, base: Home, patterns: &[".config/obs-studio/logs", ".config/obs-studio/crashes", ".config/Postman/logs", ".config/Postman/Cache", ".config/LM Studio/Cache", ".cache/lm-studio/.internal"], min_age_hours: 0, free: false },
        Spec { id: "user_caches", name: "Thumbnail & desktop caches", description: "~/.cache/thumbnails and fontconfig caches older than 24 hours.", group: Group::Apps, base: Home, patterns: &[".cache/thumbnails", ".cache/fontconfig"], min_age_hours: 24, free: false },
        Spec { id: "logs", name: "User state logs", description: "~/.local/state/log diagnostic logs.", group: Group::System, base: Home, patterns: &[".local/state/log"], min_age_hours: 24, free: false },
        Spec { id: "downloads", name: "Old & Unused Downloads", description: "Files in your Downloads folder older than 30 days that haven't been opened or used recently.", group: Group::System, base: Downloads, patterns: &[""], min_age_hours: 30 * 24, free: false },
        Spec { id: "duplicates", name: "Duplicate Files", description: "Identical copies of files, photos, documents, and installers across your device. The original copy is always preserved.", group: Group::System, base: UserFolders, patterns: &[""], min_age_hours: 0, free: false },
        Spec { id: "dev_caches", name: "Developer package, build & IDE caches", description: "npm, pnpm, pip, Yarn, Go, JetBrains, Gradle, Maven and Cargo download caches.", group: Group::Developer, base: Home, patterns: &[".npm/_cacache", ".local/share/pnpm/store", ".cache/pip", ".cache/yarn", ".cache/go-build", "go/pkg/mod/cache/download", ".cache/JetBrains", ".gradle/caches", ".m2/repository/.cache", ".cargo/registry/cache"], min_age_hours: 0, free: false },
    ]
}

pub fn all_specs() -> Vec<Spec> {
    specs()
}

/// Resolve all rules for the current OS. Called per scan so new browser
/// profiles etc. are picked up. Also deduplicates any overlapping roots across
/// rules so bytes are never double-counted.
pub fn all() -> Vec<Rule> {
    let mut seen_roots: Vec<PathBuf> = Vec::new();
    specs()
        .into_iter()
        .map(|s| {
            let raw_roots: Vec<PathBuf> = match s.base {
                Base::UserFolders => user_folder_roots(),
                _ => s
                    .base
                    .resolve()
                    .map(|b| s.patterns.iter().flat_map(|p| expand(&b, p)).collect())
                    .unwrap_or_default(),
            };
            let mut roots = Vec::new();
            if matches!(s.base, Base::UserFolders) {
                roots = raw_roots;
            } else {
                for r in raw_roots {
                    let overlaps = seen_roots
                        .iter()
                        .any(|existing| r.starts_with(existing) || existing.starts_with(&r));
                    if !overlaps {
                        seen_roots.push(r.clone());
                        roots.push(r);
                    }
                }
            }
            Rule {
                id: s.id,
                name: s.name,
                description: s.description,
                group: s.group,
                roots,
                min_age_hours: s.min_age_hours,
                free: s.free,
            }
        })
        .collect()
}

pub fn find(id: &str) -> Option<Rule> {
    all().into_iter().find(|r| r.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_segments() {
        assert!(segment_matches("*", "Default"));
        assert!(segment_matches("Profile*", "Profile 1"));
        assert!(segment_matches("*cache*", "GPUCache"));
        assert!(!segment_matches("Profile*", "Default"));
        assert!(segment_matches("Cache", "cache"));
    }
}

