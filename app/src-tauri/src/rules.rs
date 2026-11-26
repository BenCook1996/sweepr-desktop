//! Cleaning rule definitions.
//!
//! Every path the app can ever delete from is resolved HERE, in Rust, from a
//! fixed allowlist. The frontend can only refer to rules by `id`.
//! Rules within one OS must not overlap (no root may sit inside another rule's root),
//! otherwise bytes would be double-counted.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Group {
    System,
    Browsers,
    Apps,
    Developer,
}

impl Group {
    pub fn as_str(self) -> &'static str {
        match self {
            Group::System => "system",
            Group::Browsers => "browsers",
            Group::Apps => "apps",
            Group::Developer => "developer",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileGlobTarget {
    pub dir: PathBuf,
    pub pattern: String,
}

#[derive(Clone, Debug)]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub group: Group,
    /// Concrete, existing directories (wildcards already expanded).
    pub roots: Vec<PathBuf>,
    /// Concrete, existing directories matched non-recursively by filename glob.
    pub file_targets: Vec<FileGlobTarget>,
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
    pub fn as_str(self) -> &'static str {
        match self {
            Base::Downloads => "downloads",
            Base::Home => "home",
            Base::Temp => "temp",
            Base::LocalAppData => "local_app_data",
            Base::RoamingAppData => "roaming_app_data",
            Base::UserFolders => "user_folders",
        }
    }

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
pub(crate) fn segment_matches(pattern: &str, name: &str) -> bool {
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
#[cfg(test)]
fn expand(base: &Path, pattern: &str) -> Vec<PathBuf> {
    let Some((start_base, rel_pattern)) = resolve_pattern_base(base, pattern) else {
        return Vec::new();
    };
    expand_segments(start_base, rel_pattern.split('/').filter(|s| !s.is_empty()))
}

fn expand_segments<'a>(
    start_base: PathBuf,
    segments: impl Iterator<Item = &'a str>,
) -> Vec<PathBuf> {
    let mut current = vec![start_base];
    for seg in segments {
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

/// Expand a pattern into directory roots or, when the final segment is a file
/// glob containing `*` (such as `thumbcache_*.db` or `*.lnk`), into
/// `FileGlobTarget`s scoped to existing parent directories.
pub(crate) fn expand_spec_targets(base: &Path, pattern: &str) -> (Vec<PathBuf>, Vec<FileGlobTarget>) {
    let Some((start_base, rel_pattern)) = resolve_pattern_base(base, pattern) else {
        return (Vec::new(), Vec::new());
    };
    let segments: Vec<&str> = rel_pattern.split('/').filter(|s| !s.is_empty()).collect();
    if let Some((&last_seg, parent_segs)) = segments.split_last() {
        if last_seg.contains('*') {
            let dirs = expand_segments(start_base, parent_segs.iter().copied());
            let file_targets = dirs
                .into_iter()
                .map(|dir| FileGlobTarget {
                    dir,
                    pattern: last_seg.to_string(),
                })
                .collect();
            return (Vec::new(), file_targets);
        }
    }
    (expand_segments(start_base, segments.into_iter()), Vec::new())
}

pub fn windows_specs() -> Vec<Spec> {
    use Base::*;
    vec![
        Spec { id: "temp", name: "Temporary files", description: "Files apps left in your temp folder more than 24 hours ago.", group: Group::System, base: Temp, patterns: &[""], min_age_hours: 24, free: true },
        Spec { id: "thumbnails", name: "Windows thumbnail & icon cache", description: "Cached Explorer thumbnails (thumbcache_*.db), IE/WebView caches and diagnostic traces. Rebuilds automatically.", group: Group::System, base: LocalAppData, patterns: &["Microsoft/Windows/INetCache/IE", "Microsoft/Windows/Caches", "ElevatedDiagnostics", "Microsoft/Windows/Explorer/thumbcache_*.db"], min_age_hours: 24, free: false },
        Spec { id: "crash_dumps", name: "Crash dumps & kernel reports", description: "Diagnostic dumps, Windows Error Reporting archives, LiveKernelReports watchdog dumps and CLR usage logs.", group: Group::System, base: LocalAppData, patterns: &["CrashDumps", "Microsoft/Windows/WER/ReportArchive", "Microsoft/Windows/WER/ReportQueue", "Diagnostics", "Microsoft/CLR_v4.0/UsageLogs", "@systemdrive/Windows/LiveKernelReports"], min_age_hours: 0, free: false },
        Spec { id: "delivery_opt", name: "Windows Update, Package Cache & Windows.old", description: "Delivery Optimization peer cache, installer Package Cache, Defender scan history and previous Windows installation leftovers.", group: Group::System, base: LocalAppData, patterns: &["Microsoft/Windows/DeliveryOptimization/Cache", "Package Cache", "@programdata/Package Cache", "@programdata/Microsoft/Windows Defender/Scans/History/Results", "@systemdrive/Windows.old"], min_age_hours: 24, free: false },
        Spec { id: "shader_cache", name: "NVIDIA DXCache / GLCache & AMD DxCache", description: "DirectX D3DSCache, NVIDIA DXCache/GLCache/NV_Cache, AMD DxCache/DxcCache/VkCache/GLCache and C:\\AMD driver unpack leftovers. Rebuilds automatically.", group: Group::System, base: LocalAppData, patterns: &["NVIDIA/DXCache", "NVIDIA/GLCache", "@programdata/NVIDIA Corporation/NV_Cache", "AMD/DxCache", "AMD/DxcCache", "AMD/VkCache", "AMD/GLCache", "AMD/OglCache", "D3DSCache", "@systemdrive/AMD"], min_age_hours: 24, free: false },
        Spec { id: "webview2_cache", name: "Microsoft Edge WebView2 (EBWebView) cache", description: "Shared WebView2 runtime caches from Windows Widgets, Search, Teams and desktop add-ins. Rebuilds automatically.", group: Group::System, base: LocalAppData, patterns: &["Microsoft/EdgeWebView", "Packages/MSTeams_8wekyb3d8bbwe/LocalCache/Microsoft/MSTeams/EBWebView/Default/Cache", "Packages/MSTeams_8wekyb3d8bbwe/LocalCache/Microsoft/MSTeams/EBWebView/Default/Code Cache", "Packages/MicrosoftWindows.Client.WebExperience_cw5n1h2txyewy/LocalState/EBWebView/Default/Cache", "Packages/Microsoft.Windows.Search_cw5n1h2txyewy/LocalState/EBWebView/Default/Cache", "*/EBWebView/Default/Cache", "*/EBWebView/Default/Code Cache", "*/EBWebView/Default/GPUCache", "*/EBWebView/Default/Service Worker/CacheStorage"], min_age_hours: 24, free: false },
        Spec { id: "chrome", name: "Google Chrome cache & GPU/Service Worker storage", description: "Cached web content, Code Cache, GPUCache, Dawn WebGPU cache and Service Worker CacheStorage. Logins and history are untouched.", group: Group::Browsers, base: LocalAppData, patterns: &["Google/Chrome/User Data/*/Cache", "Google/Chrome/User Data/*/Code Cache", "Google/Chrome/User Data/*/GPUCache", "Google/Chrome/User Data/*/DawnCache", "Google/Chrome/User Data/*/GraphiteDawnCache", "Google/Chrome/User Data/GrShaderCache", "Google/Chrome/User Data/ShaderCache", "Google/Chrome/User Data/*/Service Worker/CacheStorage", "Google/Chrome/User Data/*/Service Worker/ScriptCache"], min_age_hours: 0, free: true },
        Spec { id: "edge", name: "Microsoft Edge cache & GPU/Service Worker storage", description: "Cached web content, Code Cache, GPUCache and Service Worker storage. Logins and history are untouched.", group: Group::Browsers, base: LocalAppData, patterns: &["Microsoft/Edge/User Data/*/Cache", "Microsoft/Edge/User Data/*/Code Cache", "Microsoft/Edge/User Data/*/GPUCache", "Microsoft/Edge/User Data/*/DawnCache", "Microsoft/Edge/User Data/GrShaderCache", "Microsoft/Edge/User Data/*/Service Worker/CacheStorage"], min_age_hours: 0, free: true },
        Spec { id: "brave", name: "Brave Browser cache & GPU/Service Worker storage", description: "Cached web content, Code Cache, GPUCache and Service Worker storage. Logins and Shields are untouched.", group: Group::Browsers, base: LocalAppData, patterns: &["BraveSoftware/Brave-Browser/User Data/*/Cache", "BraveSoftware/Brave-Browser/User Data/*/Code Cache", "BraveSoftware/Brave-Browser/User Data/*/GPUCache", "BraveSoftware/Brave-Browser/User Data/*/DawnCache", "BraveSoftware/Brave-Browser/User Data/GrShaderCache", "BraveSoftware/Brave-Browser/User Data/*/Service Worker/CacheStorage"], min_age_hours: 0, free: true },
        Spec { id: "firefox", name: "Firefox cache & startup shader cache", description: "Cached web content and startup/shader caches across Firefox profiles. Logins and history are untouched.", group: Group::Browsers, base: LocalAppData, patterns: &["Mozilla/Firefox/Profiles/*/cache2", "Mozilla/Firefox/Profiles/*/startupCache", "Mozilla/Firefox/Profiles/*/shader-cache"], min_age_hours: 0, free: true },
        Spec { id: "alt_browsers", name: "Opera GX, Arc, Vivaldi & Thunderbird caches", description: "Web, shader, bytecode and Service Worker caches from Opera GX, Arc Browser, Vivaldi and Mozilla Thunderbird.", group: Group::Browsers, base: LocalAppData, patterns: &["Opera Software/Opera GX Stable/Cache", "Opera Software/Opera GX Stable/SystemCache", "@roaming/Opera Software/Opera GX Stable/Code Cache", "@roaming/Opera Software/Opera GX Stable/GPUCache", "@roaming/Opera Software/Opera GX Stable/ShaderCache", "@roaming/Opera Software/Opera GX Stable/Service Worker/CacheStorage", "Opera Software/Opera Stable/Cache", "Vivaldi/User Data/*/Cache", "Vivaldi/User Data/*/Code Cache", "Vivaldi/User Data/*/GPUCache", "Packages/TheBrowserCompany.Arc*/LocalCache/Local/Arc/User Data/*/Cache", "Packages/TheBrowserCompany.Arc*/LocalCache/Local/Arc/User Data/*/Code Cache", "Packages/TheBrowserCompany.Arc*/LocalCache/Local/Arc/User Data/*/GPUCache", "Thunderbird/Profiles/*/cache2", "Thunderbird/Profiles/*/startupCache"], min_age_hours: 0, free: false },
        Spec { id: "app_caches", name: "Discord & VS Code caches", description: "Cached media, bytecode and workspace data from Discord and Visual Studio Code. Rebuilds on next launch.", group: Group::Apps, base: RoamingAppData, patterns: &["discord/Cache", "discord/Code Cache", "discord/GPUCache", "Code/Cache", "Code/CachedData", "Code/GPUCache"], min_age_hours: 0, free: false },
        Spec { id: "elgato_streamdeck_cache", name: "Elgato Stream Deck App Cache", description: "Elgato Stream Deck software Cache, Code Cache, GPUCache and Service Worker storage (%APPDATA%\\Elgato\\StreamDeck). Profiles, custom icons and actions are untouched.", group: Group::Apps, base: RoamingAppData, patterns: &["Elgato/StreamDeck/Cache", "Elgato/StreamDeck/Code Cache", "Elgato/StreamDeck/GPUCache", "Elgato/StreamDeck/Service Worker/CacheStorage", "@local/Elgato/StreamDeck/Cache"], min_age_hours: 0, free: false },
        Spec { id: "peripheral_caches", name: "Logitech G HUB & Options+ Depots/Blob Cache", description: "Logitech G HUB & Logi Options+ installer depots, media/blob storage & bytecode caches, plus Razer Synapse and Corsair iCUE logs. Macros and profiles (settings.db) are untouched.", group: Group::Apps, base: LocalAppData, patterns: &["LGHUB/depots", "@programdata/LGHUB/depots", "LGHUB/blob_storage", "LGHUB/cache", "LogiOptionsPlus/cache", "@roaming/LogiOptionsPlus/Cache", "@roaming/LogiOptionsPlus/Code Cache", "@roaming/LGHUB/Code Cache", "@roaming/LGHUB/GPUCache", "@roaming/LGHUB/DawnCache", "Razer/Synapse3/Log", "Razer/RazerAppEngine/User Data/Default/Cache", "Razer/RazerAppEngine/User Data/Default/Code Cache", "Corsair/iCUE5/logs"], min_age_hours: 0, free: false },
        Spec { id: "steam_cache", name: "Steam DepotCache & HTTP/Shader Cache", description: "Steam depotcache staging chunks, HTTP/HTML caches, DirectX/Vulkan shadercache and crash dumps. Installed games and saves are untouched.", group: Group::Apps, base: LocalAppData, patterns: &["@pfx86/Steam/depotcache", "@pfx86/Steam/appcache/httpcache", "@pfx86/Steam/steamapps/shadercache", "@pfx86/Steam/logs", "@pfx86/Steam/dumps", "Steam/htmlcache"], min_age_hours: 0, free: false },
        Spec { id: "riot_valorant_logs", name: "Riot Client & Valorant Logs/Crashes", description: "Riot Client diagnostic logs and VALORANT Saved/Logs and crash dump archives. Game installations and Vanguard settings are untouched.", group: Group::Apps, base: LocalAppData, patterns: &["Riot Games/Riot Client/Logs", "Riot Games/Riot Client/Data/Logs", "VALORANT/Saved/Logs", "VALORANT/Saved/Crashes"], min_age_hours: 0, free: false },
        Spec { id: "genshin_hoyoplay_cache", name: "Genshin Impact / HoYoPlay Update & WebCaches", description: "Cognosphere HoYoPlay launcher fedata caches and Genshin Impact webCaches/update staging leftovers. Game data and account logins are untouched.", group: Group::Apps, base: LocalAppData, patterns: &["@roaming/Cognosphere/HYP/1_0/fedata/Cache", "@roaming/Cognosphere/HYP/*/fedata/Cache", "@roaming/Cognosphere/HYP/1_0/fedata/Code Cache", "@roaming/Cognosphere/HYP/1_0/fedata/GPUCache", "HoYoPlay/logs", "HoYoPlay/webCaches", "GenshinImpact/webCaches", "@pfx86/Genshin Impact/Genshin Impact Game/GenshinImpact_Data/webCaches", "@systemdrive/Program Files/Genshin Impact/Genshin Impact Game/GenshinImpact_Data/webCaches"], min_age_hours: 0, free: false },
        Spec { id: "game_launchers", name: "Gaming Launchers & Shader/Update Caches", description: "Safe webcaches, depotcaches, shader caches and crash logs from Epic Games, EA App/Origin, GOG Galaxy, Ubisoft, Battle.net, VRChat, Medal TV, Overwolf, Minecraft and Roblox.", group: Group::Apps, base: LocalAppData, patterns: &["EpicGamesLauncher/Saved/webcache", "EpicGamesLauncher/Saved/webcache_4147", "EpicGamesLauncher/Saved/webcache_4430", "EpicGamesLauncher/Saved/Logs", "EpicGamesLauncher/Saved/Crashes", "Electronic Arts/EA Desktop/EA Desktop/cache", "Electronic Arts/EA Desktop/EA Desktop/CEF/BrowserCache", "Origin/Web Cache", "@programdata/Origin/DownloadCache", "@programdata/EA Desktop/InstallData", "HoYoPlay/logs", "HoYoPlay/webCaches", "GenshinImpact/webCaches", "@roaming/Cognosphere/HYP/1_0/fedata/Cache", "Steam/htmlcache", "@pfx86/Steam/depotcache", "@pfx86/Steam/steamapps/shadercache", "@pfx86/Steam/appcache/httpcache", "@pfx86/Steam/logs", "@pfx86/Steam/dumps", "Riot Games/Riot Client/Logs", "Riot Games/Riot Client/Data/Logs", "VALORANT/Saved/Logs", "VALORANT/Saved/Crashes", "@programdata/GOG.com/Galaxy/webcache", "@programdata/GOG.com/Galaxy/logs", "Ubisoft Game Launcher/cache", "Ubisoft Game Launcher/logs", "Battle.net/BrowserCaches", "Battle.net/Cache", "VRChat/VRChat/Cache-WindowsPlayer", "VRChat/VRChat/HTTPCache-WindowsPlayer", "Medal/editor", "@roaming/Medal/logs", "@roaming/Medal/Cache", "@roaming/Medal/Code Cache", "Overwolf/Log", "Overwolf/BrowserCache", "@roaming/.minecraft/logs", "@roaming/.minecraft/crash-reports", "Roblox/http", "Roblox/logs", "Activision/Call of Duty/shadercache"], min_age_hours: 0, free: false },
        Spec { id: "creator_ai_caches", name: "Creator, Media & Local AI App Caches", description: "Temporary caches, incomplete model downloads, and logs from ComfyUI, HuggingFace, PyTorch, Whisper, uv, Conda, Ollama, LM Studio, CapCut, OBS Studio, DaVinci Resolve, Adobe Media/CameraRaw, Canva, Notion, Postman and Plex.", group: Group::Apps, base: LocalAppData, patterns: &["ComfyUI/temp", "@home/ComfyUI/temp", "@home/ComfyUI/input/temp", "@home/.cache/huggingface/hub", "@home/.cache/huggingface/xet", "@home/.cache/torch", "@home/.cache/whisper", "@home/.cache/uv", "uv/cache", "@home/.conda/pkgs", "Ollama/logs", "@home/.ollama/logs", "@home/.cache/lm-studio", "@roaming/LM Studio/Cache", "@roaming/LM Studio/Code Cache", "@roaming/LM Studio/GPUCache", "CapCut/User Data/Cache", "@roaming/obs-studio/logs", "@roaming/obs-studio/crashes", "@roaming/Blackmagic Design/DaVinci Resolve/Support/logs", "Adobe/Common/Media Cache Files", "Adobe/CameraRaw/Cache", "Plex Media Server/Cache/Transcode", "Plex Media Server/Logs", "@roaming/Canva/Cache", "@roaming/Canva/Code Cache", "@roaming/Canva/GPUCache", "@roaming/Notion/Cache", "@roaming/Notion/Code Cache", "@roaming/Notion/GPUCache", "@roaming/Postman/logs", "@roaming/Postman/Cache", "@roaming/Postman/Code Cache"], min_age_hours: 0, free: false },
        Spec { id: "spotify", name: "Spotify offline cache", description: "Streaming cache (not your downloaded playlists).", group: Group::Apps, base: LocalAppData, patterns: &["Spotify/Data"], min_age_hours: 0, free: false },
        Spec { id: "downloads", name: "Old & Unused Downloads", description: "Files in your Downloads folder older than 30 days that haven't been opened or used recently.", group: Group::System, base: Downloads, patterns: &[""], min_age_hours: 30 * 24, free: false },
        Spec { id: "duplicates", name: "Duplicate Files", description: "Identical copies of files, photos, documents, and installers across your device. The original copy is always preserved.", group: Group::System, base: UserFolders, patterns: &[""], min_age_hours: 0, free: false },
        Spec { id: "dev_caches", name: "Developer package & IDE caches", description: "npm, pnpm, pip, Yarn, NuGet, Composer, Go build/module caches and JetBrains IDE caches/logs.", group: Group::Developer, base: LocalAppData, patterns: &["npm-cache/_cacache", "pnpm/store", "pip/cache", "Yarn/Cache", "NuGet/v3-cache", "Composer/cache", "go-build", "@home/go/pkg/mod/cache/download", "JetBrains/*/caches", "JetBrains/*/log"], min_age_hours: 0, free: false },
        Spec { id: "build_caches", name: "Gradle, Maven & Cargo build caches", description: "Cached Gradle, Maven (.m2) and Rust Cargo registry archives in your user profile (~/.gradle/caches, ~/.m2/repository/.cache, ~/.cargo/registry/cache).", group: Group::Developer, base: Home, patterns: &[".gradle/caches", ".m2/repository/.cache", ".cargo/registry/cache"], min_age_hours: 24 * 7, free: false },
        Spec { id: "messenger_caches", name: "Messenger & Collaboration caches", description: "Cached media and webviews from Slack, Microsoft Teams, Zoom, WhatsApp, and Telegram Desktop. Chats and logins are not touched.", group: Group::Apps, base: RoamingAppData, patterns: &["Slack/Cache", "Slack/Code Cache", "Slack/GPUCache", "Slack/Service Worker/CacheStorage", "Microsoft/Teams/Cache", "Microsoft/Teams/Code Cache", "Microsoft/Teams/GPUCache", "Zoom/data/WebViewCache", "Telegram Desktop/tdata/user_data/cache", "Telegram Desktop/tdata/user_data/media_cache"], min_age_hours: 0, free: false },
        Spec { id: "recent_activity", name: "Windows Activity & JumpList traces", description: "Recent file shortcuts (*.lnk), jump lists, and Explorer activity caches.", group: Group::System, base: RoamingAppData, patterns: &["Microsoft/Windows/Recent/AutomaticDestinations", "Microsoft/Windows/Recent/CustomDestinations", "Microsoft/Windows/Recent/*.lnk"], min_age_hours: 24, free: false },
        Spec { id: "system_slimmer", name: "Windows Installer & INet cache slimmer", description: "Legacy Windows Setup logs and temporary installer extraction caches.", group: Group::System, base: LocalAppData, patterns: &["Microsoft/Windows/INetCache/Content.Outlook", "Temp/WinGet"], min_age_hours: 24, free: false },
    ]
}

pub fn macos_specs() -> Vec<Spec> {
    use Base::*;
    vec![
        Spec { id: "temp", name: "System Temp Files", description: "Per-user temporary files and caches older than 24 hours.", group: Group::System, base: Temp, patterns: &[""], min_age_hours: 24, free: true },
        Spec { id: "trash", name: "Trash", description: "Items in your ~/.Trash folder older than 24 hours.", group: Group::System, base: Home, patterns: &[".Trash"], min_age_hours: 24, free: false },
        Spec { id: "chrome", name: "Google Chrome Cache & GPU/Service Worker Storage", description: "Cached images, scripts, GPUCache, Dawn WebGPU cache and Service Worker storage. Tabs, history, and logins are untouched.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/Google/Chrome", "Library/Application Support/Google/Chrome/*/Code Cache", "Library/Application Support/Google/Chrome/*/GPUCache", "Library/Application Support/Google/Chrome/*/DawnCache", "Library/Application Support/Google/Chrome/GrShaderCache", "Library/Application Support/Google/Chrome/*/Service Worker/CacheStorage"], min_age_hours: 0, free: true },
        Spec { id: "safari", name: "Safari Cache", description: "Safari web cache and preview thumbnails. History, bookmarks, and logins are untouched.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/com.apple.Safari", "Library/Safari/Touch Icons Cache"], min_age_hours: 0, free: false },
        Spec { id: "brave", name: "Brave Browser Cache & GPU/Service Worker Storage", description: "Cached web data, Code Cache, GPUCache and Service Worker storage for Brave Browser. History, Shields settings, and logins are untouched.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/BraveSoftware/Brave-Browser", "Library/Application Support/BraveSoftware/Brave-Browser/*/Code Cache", "Library/Application Support/BraveSoftware/Brave-Browser/*/GPUCache", "Library/Application Support/BraveSoftware/Brave-Browser/*/Service Worker/CacheStorage"], min_age_hours: 0, free: true },
        Spec { id: "firefox", name: "Firefox Cache & Startup Cache", description: "Cached web assets across Firefox profiles. Bookmarks and passwords are untouched.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/Firefox/Profiles/*/cache2", "Library/Caches/Firefox/Profiles/*/startupCache"], min_age_hours: 0, free: true },
        Spec { id: "edge", name: "Microsoft Edge Cache", description: "Cached web assets for Microsoft Edge on macOS. Tabs and logins are untouched.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/Microsoft Edge", "Library/Application Support/Microsoft Edge/*/Code Cache", "Library/Application Support/Microsoft Edge/*/GPUCache"], min_age_hours: 0, free: true },
        Spec { id: "alt_browsers", name: "Opera GX, Arc, Vivaldi & Thunderbird Caches", description: "Cached web, shader, and bytecode files from Opera GX, Arc Browser, Vivaldi, and Thunderbird.", group: Group::Browsers, base: Home, patterns: &["Library/Caches/com.operasoftware.OperaGX", "Library/Application Support/com.operasoftware.OperaGX/Code Cache", "Library/Application Support/com.operasoftware.OperaGX/GPUCache", "Library/Caches/company.thebrowser.Browser", "Library/Application Support/Arc/User Data/*/Code Cache", "Library/Application Support/Arc/User Data/*/GPUCache", "Library/Caches/Vivaldi", "Library/Caches/Thunderbird/Profiles/*/cache2"], min_age_hours: 0, free: false },
        Spec { id: "app_caches", name: "Discord & VS Code Caches", description: "Caches from Discord and Visual Studio Code. Rebuilt automatically on next launch.", group: Group::Apps, base: Home, patterns: &["Library/Application Support/discord/Cache", "Library/Application Support/discord/Code Cache", "Library/Application Support/discord/GPUCache", "Library/Application Support/Code/Cache", "Library/Application Support/Code/CachedData", "Library/Application Support/Code/GPUCache"], min_age_hours: 0, free: false },
        Spec { id: "elgato_streamdeck_cache", name: "Elgato Stream Deck App Cache", description: "Elgato Stream Deck software Cache, Code Cache, and GPUCache. Profiles, custom icons, and actions are untouched.", group: Group::Apps, base: Home, patterns: &["Library/Caches/com.elgato.StreamDeck", "Library/Application Support/com.elgato.StreamDeck/Cache", "Library/Application Support/com.elgato.StreamDeck/Code Cache", "Library/Application Support/com.elgato.StreamDeck/GPUCache"], min_age_hours: 0, free: false },
        Spec { id: "peripheral_caches", name: "Logitech G HUB & Options+ Depots/Blob Cache", description: "Logitech G HUB & Logi Options+ media/blob storage, installer depots, and bytecode caches. Profiles (settings.db) are untouched.", group: Group::Apps, base: Home, patterns: &["Library/Caches/com.logitech.manager.daemon", "Library/Caches/com.logitech.Logi-Options-Plus", "Library/Application Support/LogiOptionsPlus/cache", "Library/Application Support/lghub/depots", "Library/Application Support/lghub/blob_storage", "Library/Application Support/lghub/Code Cache", "Library/Application Support/lghub/GPUCache"], min_age_hours: 0, free: false },
        Spec { id: "steam_cache", name: "Steam DepotCache & HTTP/Shader Cache", description: "Steam depotcache staging chunks, HTTP/HTML caches, and shadercache on macOS. Installed games and saves are untouched.", group: Group::Apps, base: Home, patterns: &["Library/Application Support/Steam/depotcache", "Library/Application Support/Steam/appcache/httpcache", "Library/Application Support/Steam/steamapps/shadercache"], min_age_hours: 0, free: false },
        Spec { id: "riot_valorant_logs", name: "Riot Client & Valorant Logs/Crashes", description: "Riot Client diagnostic logs and crash archives on macOS.", group: Group::Apps, base: Home, patterns: &["Library/Application Support/Riot Games/Riot Client/Logs", "Library/Logs/Riot Games"], min_age_hours: 0, free: false },
        Spec { id: "game_launchers", name: "Gaming Launchers & Shader/Update Caches", description: "Safe webcaches, depotcaches, shader caches, and logs from Steam, Epic Games, EA App/Origin, Riot Client, GOG Galaxy, Minecraft, and Roblox.", group: Group::Apps, base: Home, patterns: &["Library/Caches/com.epicgames.EpicGamesLauncher", "Library/Logs/Unreal Engine/EpicGamesLauncher", "Library/Application Support/Origin/DownloadCache", "Library/Caches/com.ea.mac.eaapp", "Library/Application Support/Steam/depotcache", "Library/Application Support/Steam/steamapps/shadercache", "Library/Application Support/Steam/appcache/httpcache", "Library/Application Support/Riot Games/Riot Client/Logs", "Library/Application Support/GOG.com/Galaxy/webcache", "Library/Application Support/minecraft/logs", "Library/Caches/com.roblox.RobloxPlayer"], min_age_hours: 0, free: false },
        Spec { id: "creator_ai_caches", name: "Creator, Media & Local AI App Caches", description: "Temporary caches, incomplete model downloads, and logs from ComfyUI, HuggingFace, PyTorch, Whisper, uv, Conda, Ollama, LM Studio, CapCut, OBS Studio, DaVinci Resolve, Adobe Media/CameraRaw, Canva, Notion, Postman, and Plex.", group: Group::Apps, base: Home, patterns: &["ComfyUI/temp", "ComfyUI/input/temp", "Library/Application Support/ComfyUI/temp", ".cache/huggingface/hub", ".cache/huggingface/xet", ".cache/torch", ".cache/whisper", ".cache/uv", "Library/Caches/uv", ".conda/pkgs", ".ollama/logs", ".cache/lm-studio", "Library/Application Support/LM Studio/Cache", "Library/Containers/com.lemon.lvoverseas/Data/Library/Caches", "Library/Application Support/obs-studio/logs", "Library/Application Support/obs-studio/crashes", "Library/Application Support/Blackmagic Design/DaVinci Resolve/logs", "Library/Caches/Adobe/Common/Media Cache Files", "Library/Caches/Adobe Camera Raw2", "Library/Caches/com.plexapp.mediaserver/Transcode", "Library/Application Support/Canva/Cache", "Library/Application Support/Canva/Code Cache", "Library/Application Support/Notion/Cache", "Library/Application Support/Notion/Code Cache", "Library/Application Support/Postman/logs", "Library/Application Support/Postman/Cache"], min_age_hours: 0, free: false },
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

pub fn linux_specs() -> Vec<Spec> {
    use Base::*;
    vec![
        Spec { id: "temp", name: "Temporary files", description: "Your files in /tmp older than 24 hours.", group: Group::System, base: Temp, patterns: &[""], min_age_hours: 24, free: true },
        Spec { id: "trash", name: "Trash bin", description: "Files in ~/.local/share/Trash older than 24 hours.", group: Group::System, base: Home, patterns: &[".local/share/Trash/files", ".local/share/Trash/info"], min_age_hours: 24, free: false },
        Spec { id: "shader_cache", name: "Mesa, Vulkan, RADV & NVIDIA GPU shader caches", description: "Compiled Mesa, RADV, AMDVLK, Vulkan and NVIDIA GLCache/DXCache shader caches. Rebuilt automatically.", group: Group::System, base: Home, patterns: &[".cache/mesa_shader_cache", ".cache/mesa_shader_cache_sf", ".cache/mesa_shader_cache_db", ".cache/radv_builtin_shaders", ".cache/amdvlk", ".cache/nvidia/GLCache", ".cache/nvidia/DXCache"], min_age_hours: 24, free: false },
        Spec { id: "chrome", name: "Google Chrome cache & GPU/Service Worker storage", description: "Cached web content, Code Cache, GPUCache, Dawn WebGPU cache and Service Worker storage.", group: Group::Browsers, base: Home, patterns: &[".cache/google-chrome", ".config/google-chrome/*/Code Cache", ".config/google-chrome/*/GPUCache", ".config/google-chrome/*/DawnCache", ".config/google-chrome/*/Service Worker/CacheStorage"], min_age_hours: 0, free: true },
        Spec { id: "edge", name: "Microsoft Edge cache & GPU/Service Worker storage", description: "Cached web content, Code Cache, GPUCache and Service Worker storage. Logins and history are untouched.", group: Group::Browsers, base: Home, patterns: &[".cache/microsoft-edge", ".config/microsoft-edge/*/Cache", ".config/microsoft-edge/*/Code Cache", ".config/microsoft-edge/*/GPUCache", ".config/microsoft-edge/*/Service Worker/CacheStorage"], min_age_hours: 0, free: true },
        Spec { id: "brave", name: "Brave Browser cache & GPU/Service Worker storage", description: "Cached web content, Code Cache, GPUCache and Service Worker storage.", group: Group::Browsers, base: Home, patterns: &[".cache/BraveSoftware", ".config/BraveSoftware/Brave-Browser/*/Code Cache", ".config/BraveSoftware/Brave-Browser/*/GPUCache", ".config/BraveSoftware/Brave-Browser/*/Service Worker/CacheStorage"], min_age_hours: 0, free: true },
        Spec { id: "firefox", name: "Firefox cache", description: "Cached web content across Firefox profiles.", group: Group::Browsers, base: Home, patterns: &[".cache/mozilla/firefox/*/cache2", ".cache/mozilla/firefox/*/startupCache"], min_age_hours: 0, free: true },
        Spec { id: "alt_browsers", name: "Vivaldi, Chromium, Opera & Thunderbird caches", description: "Cached web content from Vivaldi, Chromium, Opera, and Mozilla Thunderbird.", group: Group::Browsers, base: Home, patterns: &[".cache/vivaldi", ".config/vivaldi/*/Code Cache", ".config/vivaldi/*/GPUCache", ".cache/chromium", ".config/chromium/*/Code Cache", ".config/chromium/*/GPUCache", ".cache/opera", ".cache/thunderbird", ".thunderbird/*/cache2"], min_age_hours: 0, free: false },
        Spec { id: "app_caches", name: "Discord & VS Code caches", description: "Cached media, bytecode and workspace data from Discord and Visual Studio Code. Rebuilds on next launch.", group: Group::Apps, base: Home, patterns: &[".config/discord/Cache", ".config/discord/Code Cache", ".config/discord/GPUCache", ".config/Code/Cache", ".config/Code/CachedData", ".config/Code/GPUCache"], min_age_hours: 0, free: false },
        Spec { id: "spotify", name: "Spotify offline cache", description: "Streaming audio cache (does not delete downloaded playlists).", group: Group::Apps, base: Home, patterns: &[".cache/spotify/Data", ".cache/spotify/Storage"], min_age_hours: 0, free: false },
        Spec { id: "messenger_caches", name: "Messenger & Collaboration caches", description: "Cached media and webviews from Slack, Zoom, and Telegram Desktop. Chats and logins are untouched.", group: Group::Apps, base: Home, patterns: &[".config/Slack/Cache", ".config/Slack/Code Cache", ".config/Slack/GPUCache", ".config/Slack/Service Worker/CacheStorage", ".cache/zoom", ".local/share/TelegramDesktop/tdata/user_data/cache", ".local/share/TelegramDesktop/tdata/user_data/media_cache"], min_age_hours: 0, free: false },
        Spec { id: "flatpak_snap_caches", name: "Flatpak & Snap user app caches", description: "Per-app sandboxed cache directories in ~/.var/app/*/cache and ~/snap/*/*/.cache.", group: Group::Apps, base: Home, patterns: &[".var/app/*/cache", "snap/*/*/.cache"], min_age_hours: 24, free: false },
        Spec { id: "game_launchers", name: "Steam, SteamOS Proton & Minecraft caches", description: "Steam depotcache, Flatpak Steam, Vulkan shader caches, HTTP caches, Proton prefix temp/crash/D3D caches, and Minecraft logs. Game saves are untouched.", group: Group::Apps, base: Home, patterns: &[".steam/steam/depotcache", ".steam/steam/steamapps/shadercache", ".steam/steam/appcache/httpcache", ".steam/steam/logs", ".steam/steam/dumps", ".local/share/Steam/depotcache", ".local/share/Steam/steamapps/shadercache", ".local/share/Steam/appcache/httpcache", ".local/share/Steam/logs", ".var/app/com.valvesoftware.Steam/.local/share/Steam/depotcache", ".var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/shadercache", ".var/app/com.valvesoftware.Steam/.local/share/Steam/appcache/httpcache", ".var/app/com.valvesoftware.Steam/.local/share/Steam/logs", ".local/share/Steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/Temp", ".local/share/Steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/AppData/Local/Temp", ".local/share/Steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/AppData/Local/CrashDumps", ".local/share/Steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/AppData/Local/D3DSCache", ".steam/steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/Temp", ".steam/steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/AppData/Local/Temp", ".steam/steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/AppData/Local/CrashDumps", ".steam/steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/AppData/Local/D3DSCache", ".var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/Temp", ".var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/AppData/Local/Temp", ".minecraft/logs"], min_age_hours: 0, free: false },
        Spec { id: "creator_ai_caches", name: "OBS Studio, Postman & Local AI caches", description: "Logs, incomplete model downloads, and temporary caches from ComfyUI, HuggingFace, PyTorch, Whisper, uv, Conda, Ollama, LM Studio, OBS Studio, and Postman.", group: Group::Apps, base: Home, patterns: &["ComfyUI/temp", "ComfyUI/input/temp", ".cache/huggingface/hub", ".cache/huggingface/xet", ".cache/torch", ".cache/whisper", ".cache/uv", ".conda/pkgs", ".ollama/logs", ".cache/lm-studio", ".config/obs-studio/logs", ".config/obs-studio/crashes", ".config/Postman/logs", ".config/Postman/Cache", ".config/LM Studio/Cache"], min_age_hours: 0, free: false },
        Spec { id: "user_caches", name: "Thumbnail & desktop caches", description: "~/.cache/thumbnails and fontconfig caches older than 24 hours.", group: Group::Apps, base: Home, patterns: &[".cache/thumbnails", ".cache/fontconfig"], min_age_hours: 24, free: false },
        Spec { id: "logs", name: "User state logs", description: "~/.local/state/log diagnostic logs.", group: Group::System, base: Home, patterns: &[".local/state/log"], min_age_hours: 24, free: false },
        Spec { id: "downloads", name: "Old & Unused Downloads", description: "Files in your Downloads folder older than 30 days that haven't been opened or used recently.", group: Group::System, base: Downloads, patterns: &[""], min_age_hours: 30 * 24, free: false },
        Spec { id: "duplicates", name: "Duplicate Files", description: "Identical copies of files, photos, documents, and installers across your device. The original copy is always preserved.", group: Group::System, base: UserFolders, patterns: &[""], min_age_hours: 0, free: false },
        Spec { id: "docker_caches", name: "Docker Buildx & container temp caches", description: "User-scoped Docker Buildx activity and rootless container temporary storage caches.", group: Group::Developer, base: Home, patterns: &[".docker/buildx/activity", ".local/share/docker/tmp", ".local/share/containers/storage/tmp"], min_age_hours: 24, free: false },
        Spec { id: "dev_caches", name: "Developer package, build & IDE caches", description: "npm, pnpm, pip, Poetry, Ruff, Mypy, Bun, Composer, Yarn, Go, JetBrains, Gradle, Maven and Cargo download caches.", group: Group::Developer, base: Home, patterns: &[".npm/_cacache", ".cache/npm", ".local/share/pnpm/store", ".cache/pip", ".cache/pypoetry/cache", ".cache/ruff", ".cache/mypy", ".bun/install/cache", ".cache/composer", ".cache/yarn", ".cache/go-build", "go/pkg/mod/cache/download", ".cache/JetBrains", ".gradle/caches", ".m2/repository/.cache", ".cargo/registry/cache", ".cargo/registry/src"], min_age_hours: 0, free: false },
    ]
}

#[cfg(target_os = "windows")]
fn specs() -> Vec<Spec> {
    windows_specs()
}

#[cfg(target_os = "macos")]
fn specs() -> Vec<Spec> {
    macos_specs()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn specs() -> Vec<Spec> {
    linux_specs()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PublicRuleEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub group: String,
    pub platform: String,
    pub base: String,
    pub patterns: Vec<String>,
    pub min_age_hours: u64,
    pub free: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PublicOsRules {
    pub windows: Vec<PublicRuleEntry>,
    pub macos: Vec<PublicRuleEntry>,
    pub linux: Vec<PublicRuleEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct NetworkCallDisclosure {
    pub id: String,
    pub endpoint: String,
    pub method: String,
    pub trigger: String,
    pub gated_by_telemetry_toggle: bool,
    pub purpose: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PublicRuleCatalog {
    pub schema_version: u32,
    pub product: String,
    pub telemetry_default_enabled: bool,
    pub free_tier_policy: String,
    pub quarantine_policy: String,
    pub rules: PublicOsRules,
    pub network_calls: Vec<NetworkCallDisclosure>,
}

fn spec_to_public_entry(spec: Spec, platform: &str) -> PublicRuleEntry {
    PublicRuleEntry {
        id: spec.id.to_string(),
        name: spec.name.to_string(),
        description: spec.description.to_string(),
        group: spec.group.as_str().to_string(),
        platform: platform.to_string(),
        base: spec.base.as_str().to_string(),
        patterns: spec.patterns.iter().map(|p| (*p).to_string()).collect(),
        min_age_hours: spec.min_age_hours,
        free: spec.free,
    }
}

pub fn build_public_rules_catalog() -> PublicRuleCatalog {
    PublicRuleCatalog {
        schema_version: 1,
        product: "SWEEPR Cleaner".to_string(),
        telemetry_default_enabled: false,
        free_tier_policy: "SWEEPR Free: Unlimited Temp & Browser Cache Clean (to OS Recycle Bin); Pro unlocks Deep GPU/AI/Dev Caches, SHA-256 Duplicates, Uninstaller, Scheduler & 7-Day Undo Quarantine.".to_string(),
        quarantine_policy: "7-Day Undo Quarantine (configurable 2–10 GB disk budget, 5 GB default, same-volume O(1) move; OS Recycle Bin fallback if file exceeds budget; excludes shredded files, browser DBs, and registry edits).".to_string(),
        rules: PublicOsRules {
            windows: windows_specs()
                .into_iter()
                .map(|s| spec_to_public_entry(s, "windows"))
                .collect(),
            macos: macos_specs()
                .into_iter()
                .map(|s| spec_to_public_entry(s, "macos"))
                .collect(),
            linux: linux_specs()
                .into_iter()
                .map(|s| spec_to_public_entry(s, "linux"))
                .collect(),
        },
        network_calls: vec![
            NetworkCallDisclosure {
                id: "telemetry_event".to_string(),
                endpoint: "POST /v1/telemetry/event".to_string(),
                method: "POST".to_string(),
                trigger: "Opt-in usage/install events when telemetry_enabled is true".to_string(),
                gated_by_telemetry_toggle: true,
                purpose: "Optional product diagnostics and install attribution; completely blocked when Zero-Telemetry / Offline Mode is active (default).".to_string(),
            },
            NetworkCallDisclosure {
                id: "crash_report".to_string(),
                endpoint: "POST /v1/telemetry/crash".to_string(),
                method: "POST".to_string(),
                trigger: "Startup upload of sanitized panic report when telemetry_enabled is true".to_string(),
                gated_by_telemetry_toggle: true,
                purpose: "Uploads redacted Rust panic location/message only if user opts in to telemetry; blocked by default.".to_string(),
            },
            NetworkCallDisclosure {
                id: "background_update_check".to_string(),
                endpoint: "GET /v1/updates/latest.json, GET https://api.github.com/repos/BenCook1996/sweepr-desktop/releases/latest".to_string(),
                method: "GET".to_string(),
                trigger: "Startup/4h timer and Settings open when telemetry_enabled is true; manual 'Check Updates' and user-initiated 'Install Update' (plus release asset/signature download)".to_string(),
                gated_by_telemetry_toggle: true,
                purpose: "Checks latest signed desktop release version and SHA-256 checksum (and downloads verified installer/signature on user-initiated update). Automatic checks are disabled in Zero-Telemetry / Offline Mode.".to_string(),
            },
            NetworkCallDisclosure {
                id: "passive_pricing_lookup".to_string(),
                endpoint: "GET /api/pricing".to_string(),
                method: "GET".to_string(),
                trigger: "Background localized add-on price check when telemetry_enabled is true, or when user opens Upgrade modal".to_string(),
                gated_by_telemetry_toggle: true,
                purpose: "Displays localized GBP/USD/EUR pricing; passive background fetches are blocked in Zero-Telemetry / Offline Mode.".to_string(),
            },
            NetworkCallDisclosure {
                id: "experiment_assignment".to_string(),
                endpoint: "GET /api/experiments/assign".to_string(),
                method: "GET".to_string(),
                trigger: "Upgrade modal open when telemetry_enabled is true; uses local deterministic fallback variant A in Zero-Telemetry / Offline Mode".to_string(),
                gated_by_telemetry_toggle: true,
                purpose: "Optional paywall variant assignment; blocked completely when Zero-Telemetry / Offline Mode is active (default).".to_string(),
            },
            NetworkCallDisclosure {
                id: "conversion_offer".to_string(),
                endpoint: "GET /v1/conversion/offer".to_string(),
                method: "GET".to_string(),
                trigger: "User-initiated Upgrade modal open only (never runs on startup or in background)".to_string(),
                gated_by_telemetry_toggle: false,
                purpose: "Checks eligibility for a contextual upgrade discount coupon when the user explicitly opens the Upgrade modal.".to_string(),
            },
            NetworkCallDisclosure {
                id: "licensing_and_activation".to_string(),
                endpoint: "POST /v1/accounts, /v1/entitlement, /v1/checkout, /v1/account/send-otp, /v1/account/verify-otp, /api/device-link/*".to_string(),
                method: "POST/GET".to_string(),
                trigger: "User-initiated Pro activation, OTP/QR pairing, --activate-token, or cached-account entitlement refresh; skipped when unactivated in Zero-Telemetry / Offline Mode".to_string(),
                gated_by_telemetry_toggle: false,
                purpose: "Verifies Pro entitlement and issues short-lived Ed25519-signed device tokens; offline Ed25519 JWS tokens verify locally with zero network calls.".to_string(),
            },
            NetworkCallDisclosure {
                id: "password_breach_k_anonymity".to_string(),
                endpoint: "GET https://api.pwnedpasswords.com/range/<5-char-sha1-prefix>".to_string(),
                method: "GET".to_string(),
                trigger: "User-initiated Password Breach Check in Privacy tab".to_string(),
                gated_by_telemetry_toggle: false,
                purpose: "Checks k-anonymity 5-hex SHA-1 prefix locally; plaintext passwords and full hashes never leave the device.".to_string(),
            },
            NetworkCallDisclosure {
                id: "support_report".to_string(),
                endpoint: "POST /v1/support".to_string(),
                method: "POST".to_string(),
                trigger: "User-initiated Support form submission in Settings".to_string(),
                gated_by_telemetry_toggle: false,
                purpose: "Sends user-authored support message when explicitly submitted.".to_string(),
            },
        ],
    }
}

pub fn export_public_rules_catalog_json() -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&build_public_rules_catalog())
}

#[allow(dead_code)]
pub fn all_specs() -> Vec<Spec> {
    specs()
}

/// Resolve all built-in rules for the current OS. Called per scan so new browser
/// profiles etc. are picked up. Also deduplicates any overlapping roots across
/// rules so bytes are never double-counted.
pub fn all() -> Vec<Rule> {
    let mut seen_roots: Vec<PathBuf> = Vec::new();
    let mut seen_file_targets: Vec<FileGlobTarget> = Vec::new();
    specs()
        .into_iter()
        .map(|s| {
            let (raw_roots, raw_file_targets): (Vec<PathBuf>, Vec<FileGlobTarget>) = match s.base {
                Base::UserFolders => (user_folder_roots(), Vec::new()),
                _ => s
                    .base
                    .resolve()
                    .map(|b| {
                        let mut dirs = Vec::new();
                        let mut files = Vec::new();
                        for p in s.patterns {
                            let (d, f) = expand_spec_targets(&b, p);
                            dirs.extend(d);
                            files.extend(f);
                        }
                        (dirs, files)
                    })
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
            let mut file_targets = Vec::new();
            for ft in raw_file_targets {
                let covered_by_dir_root = seen_roots.iter().any(|existing| ft.dir.starts_with(existing));
                if !covered_by_dir_root && !seen_file_targets.iter().any(|e| e == &ft) {
                    seen_file_targets.push(ft.clone());
                    file_targets.push(ft);
                }
            }
            Rule {
                id: s.id.to_string(),
                name: s.name.to_string(),
                description: s.description.to_string(),
                group: s.group,
                roots,
                file_targets,
                min_age_hours: s.min_age_hours,
                free: s.free,
            }
        })
        .collect()
}

#[allow(dead_code)]
pub fn find(id: &str) -> Option<Rule> {
    all().into_iter().find(|r| r.id == id)
}

// ---------------------------------------------------------------------------
// Custom JSON Rules (`custom_rules.json` in data_dir — Audit #13)
// ---------------------------------------------------------------------------

const CUSTOM_RULES_FILENAME: &str = "custom_rules.json";
const MAX_CUSTOM_RULES: usize = 64;
const MAX_PATHS_PER_CUSTOM_RULE: usize = 32;
const MAX_CUSTOM_MIN_AGE_HOURS: u64 = 24 * 3650;

fn default_custom_description() -> String {
    "Custom cleanup rule".to_string()
}

fn default_custom_group() -> Group {
    Group::Apps
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct CustomRuleDefinition {
    pub id: String,
    pub name: String,
    #[serde(default = "default_custom_description")]
    pub description: String,
    #[serde(default = "default_custom_group")]
    pub group: Group,
    pub paths: Vec<String>,
    #[serde(default)]
    pub min_age_hours: u64,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CustomRuleInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub group: Option<Group>,
    pub paths: Vec<String>,
    #[serde(default)]
    pub min_age_hours: Option<u64>,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct CustomRuleView {
    pub id: String,
    pub name: String,
    pub description: String,
    pub group: Group,
    pub paths: Vec<String>,
    pub min_age_hours: u64,
    pub enabled: bool,
    pub valid: bool,
    pub warnings: Vec<String>,
    pub resolved_roots: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct CustomRuleValidation {
    pub valid: bool,
    pub errors: Vec<String>,
    pub resolved_paths: Vec<String>,
    pub normalized_id: String,
}

fn custom_rules_file(data_dir: &Path) -> PathBuf {
    data_dir.join(CUSTOM_RULES_FILENAME)
}

fn is_builtin_rule_id(id_lower: &str) -> bool {
    windows_specs()
        .into_iter()
        .chain(macos_specs())
        .chain(linux_specs())
        .any(|s| s.id.eq_ignore_ascii_case(id_lower))
}

pub fn normalize_custom_rule_id(raw: &str) -> String {
    raw.trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect::<String>()
        .trim_matches(|c| c == '_' || c == '-')
        .to_string()
}

pub fn validate_custom_rule_id(id: &str) -> Result<String, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err("Custom rule ID must be 1 to 64 characters.".into());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err("Custom rule ID may only contain lowercase letters, digits, '-' or '_'.".into());
    }
    if trimmed.starts_with('-') || trimmed.starts_with('_') {
        return Err("Custom rule ID must start with a letter or digit.".into());
    }
    if is_builtin_rule_id(trimmed) {
        return Err(format!("Rule ID '{trimmed}' collides with a built-in rule."));
    }
    Ok(trimmed.to_string())
}

fn protected_user_dirs() -> Vec<PathBuf> {
    let mut dirs_list = Vec::new();
    for d in [
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::picture_dir(),
        dirs::download_dir(),
        dirs::video_dir(),
        dirs::audio_dir(),
    ]
    .into_iter()
    .flatten()
    {
        dirs_list.push(d);
    }
    if let Some(home) = dirs::home_dir() {
        for sub in [
            "Desktop",
            "Documents",
            "Pictures",
            "Downloads",
            "Videos",
            "Movies",
            "Music",
            ".ssh",
            ".gnupg",
            ".aws",
            ".kube",
        ] {
            dirs_list.push(home.join(sub));
        }
    }
    dirs_list
}

fn is_forbidden_exact_or_system_root(p: &Path, data_dir: &Path) -> Option<String> {
    if crate::safety::is_within(p, data_dir) {
        return Some("Refusing path inside SWEEPR application data directory.".into());
    }
    if crate::duplicates::is_protected_system_path(p) {
        return Some("Refusing protected OS, startup, or SWEEPR system directory.".into());
    }
    for user_dir in protected_user_dirs() {
        if crate::safety::is_within(p, &user_dir) {
            return Some(format!(
                "Refusing path inside personal user folder ({}).",
                user_dir.display()
            ));
        }
    }
    for exact in [
        dirs::home_dir(),
        dirs::data_dir(),
        dirs::data_local_dir(),
        dirs::config_dir(),
    ]
    .into_iter()
    .flatten()
    {
        if crate::safety::is_within(p, &exact) && crate::safety::is_within(&exact, p) {
            return Some(format!("Refusing top-level user directory ({}).", exact.display()));
        }
    }
    #[cfg(windows)]
    {
        if let Some(sd) = std::env::var_os("SystemDrive") {
            let sd_str = sd.to_string_lossy();
            let base = PathBuf::from(format!("{sd_str}\\"));
            for sub in ["Users", "$Recycle.Bin", "Recovery", "System Volume Information"] {
                let target = base.join(sub);
                if sub == "Users" {
                    if crate::safety::is_within(p, &target) && crate::safety::is_within(&target, p) {
                        return Some("Refusing Users root directory.".into());
                    }
                } else if crate::safety::is_within(p, &target) {
                    return Some(format!("Refusing protected system directory ({}).", target.display()));
                }
            }
        }
    }
    #[cfg(unix)]
    {
        for sys in ["/dev", "/proc", "/sys", "/root"] {
            if crate::safety::is_within(p, Path::new(sys)) {
                return Some(format!("Refusing protected Unix directory ({sys})."));
            }
        }
        for exact in ["/", "/var", "/opt", "/home", "/Users", "/Volumes"] {
            let ep = Path::new(exact);
            if crate::safety::is_within(p, ep) && crate::safety::is_within(ep, p) {
                return Some(format!("Refusing top-level directory ({exact})."));
            }
        }
    }
    None
}

/// Strictly validate a custom rule target directory path.
/// Rejects relative paths, `..`, nonexistent paths, symlinks/reparse points on the target
/// or any ancestor, shallow/unsafe roots, data_dir, protected OS paths, and personal user folders.
pub fn validate_custom_rule_path(raw: &str, data_dir: &Path) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Target folder path cannot be empty.".into());
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err(format!("Target path '{trimmed}' must be an absolute path."));
    }
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir) || c.as_os_str() == "..")
        || trimmed.split(['/', '\\']).any(|seg| seg == "..")
    {
        return Err(format!("Target path '{trimmed}' must not contain '..' traversal."));
    }

    let md = std::fs::symlink_metadata(path)
        .map_err(|_| format!("Target folder '{}' does not exist or cannot be accessed.", path.display()))?;
    if crate::safety::metadata_is_link_like(&md) {
        return Err(format!(
            "Refusing symlink, junction, or reparse point '{}'.",
            path.display()
        ));
    }
    if !md.is_dir() {
        return Err(format!("Target '{}' is not a directory.", path.display()));
    }

    for anc in path.ancestors() {
        if anc.as_os_str().is_empty() {
            break;
        }
        if let Ok(amd) = std::fs::symlink_metadata(anc) {
            if crate::safety::metadata_is_link_like(&amd) {
                return Err(format!(
                    "Refusing path with symlink or reparse-point ancestor '{}'.",
                    anc.display()
                ));
            }
        }
    }

    let canon = std::fs::canonicalize(path)
        .map_err(|e| format!("Could not canonicalize '{}': {e}", path.display()))?;
    let canon_md = std::fs::symlink_metadata(&canon)
        .map_err(|e| format!("Could not inspect canonical path '{}': {e}", canon.display()))?;
    if crate::safety::metadata_is_link_like(&canon_md) || !canon_md.is_dir() {
        return Err(format!("Canonical path '{}' is not a regular directory.", canon.display()));
    }

    if !crate::safety::is_safe_root(path) || !crate::safety::is_safe_root(&canon) {
        return Err(format!(
            "Refusing unsafe or shallow root '{}'. Pick a dedicated cache/temp subfolder.",
            path.display()
        ));
    }

    if let Some(reason) = is_forbidden_exact_or_system_root(path, data_dir)
        .or_else(|| is_forbidden_exact_or_system_root(&canon, data_dir))
    {
        return Err(reason);
    }

    Ok(canon)
}

pub fn load_custom_rule_definitions(data_dir: &Path) -> Vec<CustomRuleDefinition> {
    let path = custom_rules_file(data_dir);
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<CustomRuleDefinition>>(&raw).unwrap_or_default()
}

fn save_custom_rule_definitions(
    data_dir: &Path,
    defs: &[CustomRuleDefinition],
) -> Result<(), String> {
    std::fs::create_dir_all(data_dir)
        .map_err(|e| format!("Could not create data directory: {e}"))?;
    let json = serde_json::to_string_pretty(defs)
        .map_err(|e| format!("Could not serialize custom rules: {e}"))?;
    let path = custom_rules_file(data_dir);
    crate::safety::atomic_write(&path, json.as_bytes())
        .map_err(|e| format!("Could not write custom_rules.json: {e}"))?;
    crate::safety::restrict_file_permissions(&path);
    Ok(())
}

pub fn validate_custom_rule_in(data_dir: &Path, input: &CustomRuleInput) -> CustomRuleValidation {
    let mut errors = Vec::new();
    let mut resolved_paths = Vec::new();

    let raw_id = input
        .id
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| normalize_custom_rule_id(&input.name));
    let normalized_id = match validate_custom_rule_id(&raw_id) {
        Ok(id) => id,
        Err(e) => {
            errors.push(e);
            raw_id
        }
    };

    let name = input.name.trim();
    if name.is_empty() || name.len() > 100 {
        errors.push("Custom rule name must be 1 to 100 characters.".into());
    }

    if let Some(desc) = input.description.as_deref() {
        if desc.trim().len() > 300 {
            errors.push("Custom rule description must be 300 characters or fewer.".into());
        }
    }

    if input.paths.is_empty() || input.paths.len() > MAX_PATHS_PER_CUSTOM_RULE {
        errors.push(format!(
            "Custom rule must specify between 1 and {MAX_PATHS_PER_CUSTOM_RULE} target folder paths."
        ));
    } else {
        for p in &input.paths {
            match validate_custom_rule_path(p, data_dir) {
                Ok(canon) => {
                    let s = canon.to_string_lossy().into_owned();
                    if !resolved_paths.iter().any(|existing| existing == &s) {
                        resolved_paths.push(s);
                    }
                }
                Err(e) => errors.push(e),
            }
        }
    }

    CustomRuleValidation {
        valid: errors.is_empty() && !resolved_paths.is_empty(),
        errors,
        resolved_paths,
        normalized_id,
    }
}

pub fn list_custom_rules_in(data_dir: &Path) -> Vec<CustomRuleView> {
    load_custom_rule_definitions(data_dir)
        .into_iter()
        .map(|def| {
            let mut warnings = Vec::new();
            let mut resolved_roots = Vec::new();
            if let Err(e) = validate_custom_rule_id(&def.id) {
                warnings.push(e);
            }
            for p in &def.paths {
                match validate_custom_rule_path(p, data_dir) {
                    Ok(canon) => resolved_roots.push(canon.to_string_lossy().into_owned()),
                    Err(e) => warnings.push(e),
                }
            }
            let valid = warnings.is_empty() && !resolved_roots.is_empty();
            CustomRuleView {
                id: def.id,
                name: def.name,
                description: def.description,
                group: def.group,
                paths: def.paths,
                min_age_hours: def.min_age_hours.min(MAX_CUSTOM_MIN_AGE_HOURS),
                enabled: def.enabled,
                valid,
                warnings,
                resolved_roots,
            }
        })
        .collect()
}

pub fn parse_custom_rules_import_json(raw: &str) -> Result<Vec<CustomRuleInput>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Custom rules JSON input is empty.".into());
    }
    if let Ok(list) = serde_json::from_str::<Vec<CustomRuleInput>>(trimmed) {
        return Ok(list);
    }
    #[derive(Deserialize)]
    struct RulesWrapper {
        rules: Vec<CustomRuleInput>,
    }
    if let Ok(wrapped) = serde_json::from_str::<RulesWrapper>(trimmed) {
        return Ok(wrapped.rules);
    }
    if let Ok(single) = serde_json::from_str::<CustomRuleInput>(trimmed) {
        return Ok(vec![single]);
    }
    Err("Invalid JSON format. Expected a rule object, an array of rules, or {\"rules\": [...]}.".into())
}

pub fn import_custom_rules_in(
    data_dir: &Path,
    raw_json: &str,
    replace: bool,
) -> Result<Vec<CustomRuleView>, String> {
    let inputs = parse_custom_rules_import_json(raw_json)?;
    if inputs.is_empty() {
        if replace {
            save_custom_rule_definitions(data_dir, &[])?;
            return Ok(Vec::new());
        }
        return Err("No custom rules found in JSON payload.".into());
    }
    let mut validated: Vec<CustomRuleDefinition> = Vec::new();
    let mut batch_ids = std::collections::HashSet::new();
    for inp in &inputs {
        let check = validate_custom_rule_in(data_dir, inp);
        if !check.valid {
            return Err(check.errors.join(" "));
        }
        if !batch_ids.insert(check.normalized_id.clone()) {
            return Err(format!("Duplicate custom rule ID '{}' in import.", check.normalized_id));
        }
        let desc = inp
            .description
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(default_custom_description);
        validated.push(CustomRuleDefinition {
            id: check.normalized_id,
            name: inp.name.trim().to_string(),
            description: desc,
            group: inp.group.unwrap_or_else(default_custom_group),
            paths: check.resolved_paths,
            min_age_hours: inp.min_age_hours.unwrap_or(0).min(MAX_CUSTOM_MIN_AGE_HOURS),
            enabled: inp.enabled.unwrap_or(true),
        });
    }

    let mut merged = if replace {
        Vec::new()
    } else {
        load_custom_rule_definitions(data_dir)
    };
    for def in validated {
        if let Some(existing) = merged.iter_mut().find(|r| r.id == def.id) {
            *existing = def;
        } else {
            merged.push(def);
        }
    }
    if merged.len() > MAX_CUSTOM_RULES {
        return Err(format!("Cannot store more than {MAX_CUSTOM_RULES} custom rules."));
    }
    save_custom_rule_definitions(data_dir, &merged)?;
    Ok(list_custom_rules_in(data_dir))
}

pub fn remove_custom_rule_in(data_dir: &Path, id: &str) -> Result<Vec<CustomRuleView>, String> {
    let target_id = id.trim();
    if target_id.is_empty() {
        return Err("Rule ID cannot be empty.".into());
    }
    let mut defs = load_custom_rule_definitions(data_dir);
    let before = defs.len();
    defs.retain(|r| !r.id.eq_ignore_ascii_case(target_id));
    if defs.len() == before {
        return Err(format!("Custom rule '{target_id}' not found."));
    }
    save_custom_rule_definitions(data_dir, &defs)?;
    Ok(list_custom_rules_in(data_dir))
}

/// Resolve all built-in rules plus enabled, re-validated custom rules from `data_dir/custom_rules.json`.
pub fn all_with_custom(data_dir: &Path) -> Vec<Rule> {
    let mut rules = all();
    let mut seen_roots: Vec<PathBuf> = rules
        .iter()
        .filter(|r| r.id != "duplicates")
        .flat_map(|r| r.roots.iter().cloned())
        .collect();
    let mut seen_ids: std::collections::HashSet<String> =
        rules.iter().map(|r| r.id.to_ascii_lowercase()).collect();

    for def in load_custom_rule_definitions(data_dir) {
        if !def.enabled {
            continue;
        }
        let Ok(id) = validate_custom_rule_id(&def.id) else {
            continue;
        };
        if !seen_ids.insert(id.clone()) {
            continue;
        }
        let mut roots = Vec::new();
        for raw_path in &def.paths {
            let Ok(canon) = validate_custom_rule_path(raw_path, data_dir) else {
                continue;
            };
            let overlaps = seen_roots
                .iter()
                .any(|existing| canon.starts_with(existing) || existing.starts_with(&canon));
            if !overlaps {
                seen_roots.push(canon.clone());
                roots.push(canon);
            }
        }
        if roots.is_empty() {
            continue;
        }
        let name = if def.name.trim().is_empty() {
            id.clone()
        } else {
            def.name.trim().to_string()
        };
        let description = if def.description.trim().is_empty() {
            default_custom_description()
        } else {
            def.description.trim().to_string()
        };
        rules.push(Rule {
            id,
            name,
            description,
            group: def.group,
            roots,
            file_targets: Vec::new(),
            min_age_hours: def.min_age_hours.min(MAX_CUSTOM_MIN_AGE_HOURS),
            free: false,
        });
    }
    rules
}

pub fn find_with_custom(data_dir: &Path, id: &str) -> Option<Rule> {
    all_with_custom(data_dir).into_iter().find(|r| r.id == id)
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

    #[test]
    fn gsc_traffic_winner_rules_present() {
        let specs = all_specs();
        #[cfg(target_os = "windows")]
        {
            let steam = specs.iter().find(|s| s.id == "steam_cache").expect("steam_cache rule");
            assert_eq!(steam.name, "Steam DepotCache & HTTP/Shader Cache");
            assert!(steam.patterns.contains(&"@pfx86/Steam/depotcache"));
            assert!(steam.patterns.contains(&"@pfx86/Steam/appcache/httpcache"));
            assert!(steam.patterns.contains(&"@pfx86/Steam/steamapps/shadercache"));

            let riot = specs.iter().find(|s| s.id == "riot_valorant_logs").expect("riot_valorant_logs rule");
            assert_eq!(riot.name, "Riot Client & Valorant Logs/Crashes");
            assert!(riot.patterns.contains(&"Riot Games/Riot Client/Logs"));
            assert!(riot.patterns.contains(&"VALORANT/Saved/Logs"));
            assert!(riot.patterns.contains(&"VALORANT/Saved/Crashes"));

            let genshin = specs.iter().find(|s| s.id == "genshin_hoyoplay_cache").expect("genshin_hoyoplay_cache rule");
            assert_eq!(genshin.name, "Genshin Impact / HoYoPlay Update & WebCaches");
            assert!(genshin.patterns.contains(&"@roaming/Cognosphere/HYP/1_0/fedata/Cache"));
            assert!(genshin.patterns.contains(&"@pfx86/Genshin Impact/Genshin Impact Game/GenshinImpact_Data/webCaches"));

            let logi = specs.iter().find(|s| s.id == "peripheral_caches").expect("peripheral_caches rule");
            assert_eq!(logi.name, "Logitech G HUB & Options+ Depots/Blob Cache");
            assert!(logi.patterns.contains(&"LGHUB/depots"));
            assert!(logi.patterns.contains(&"LogiOptionsPlus/cache"));

            let shader = specs.iter().find(|s| s.id == "shader_cache").expect("shader_cache rule");
            assert_eq!(shader.name, "NVIDIA DXCache / GLCache & AMD DxCache");
            assert!(shader.patterns.contains(&"NVIDIA/DXCache"));
            assert!(shader.patterns.contains(&"NVIDIA/GLCache"));
            assert!(shader.patterns.contains(&"AMD/DxCache"));
            assert!(shader.patterns.contains(&"AMD/DxcCache"));

            let elgato = specs.iter().find(|s| s.id == "elgato_streamdeck_cache").expect("elgato_streamdeck_cache rule");
            assert_eq!(elgato.name, "Elgato Stream Deck App Cache");
            assert!(elgato.patterns.contains(&"Elgato/StreamDeck/Cache"));
            assert!(elgato.patterns.contains(&"Elgato/StreamDeck/Code Cache"));
            assert!(elgato.patterns.contains(&"Elgato/StreamDeck/GPUCache"));
        }
        assert!(!specs.is_empty());
    }

    #[test]
    fn free_tier_includes_only_temp_and_standard_browser_caches() {
        let is_expected_free = |id: &str| matches!(id, "temp" | "chrome" | "edge" | "brave" | "firefox");

        for (os_name, list) in [
            ("windows", windows_specs()),
            ("macos", macos_specs()),
            ("linux", linux_specs()),
            ("current_os", all_specs()),
        ] {
            assert!(
                list.iter().any(|s| s.id == "temp" && s.free),
                "{os_name}: temp rule must be free: true"
            );
            for spec in &list {
                assert_eq!(
                    spec.free,
                    is_expected_free(spec.id),
                    "{os_name}: unexpected free={} for rule '{}'",
                    spec.free,
                    spec.id
                );
                if spec.free && spec.id != "temp" {
                    for pat in spec.patterns {
                        let lower = pat.to_ascii_lowercase();
                        assert!(
                            !lower.contains("cookie")
                                && !lower.contains("history")
                                && !lower.contains("login")
                                && !lower.contains("places.sqlite")
                                && !lower.contains("bookmarks"),
                            "{os_name}: free browser cache rule '{}' must not target non-cache pattern '{}'",
                            spec.id,
                            pat
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn public_rules_catalog_json_matches_rules_rs() {
        let catalog_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("docs")
            .join("public-rules-catalog.json");
        let raw = std::fs::read_to_string(&catalog_path)
            .expect("docs/public-rules-catalog.json must exist and be readable");
        let parsed: PublicRuleCatalog = serde_json::from_str(&raw)
            .expect("docs/public-rules-catalog.json must parse as PublicRuleCatalog");
        let expected = build_public_rules_catalog();
        assert_eq!(parsed, expected);
        assert!(!parsed.telemetry_default_enabled);
        assert!(!parsed.rules.windows.is_empty());
        assert!(!parsed.rules.macos.is_empty());
        assert!(!parsed.rules.linux.is_empty());
        assert!(!parsed.network_calls.is_empty());
    }

    #[test]
    fn linux_rules_parity_and_safety() {
        let specs = linux_specs();
        for required_id in [
            "temp",
            "trash",
            "shader_cache",
            "chrome",
            "edge",
            "brave",
            "firefox",
            "alt_browsers",
            "app_caches",
            "spotify",
            "messenger_caches",
            "flatpak_snap_caches",
            "game_launchers",
            "creator_ai_caches",
            "docker_caches",
            "dev_caches",
        ] {
            assert!(
                specs.iter().any(|s| s.id == required_id),
                "Missing expected Linux rule '{required_id}'"
            );
        }

        // Verify zero duplicate patterns across all Linux specs
        let mut seen_patterns = std::collections::HashSet::new();
        for s in &specs {
            for pat in s.patterns {
                if pat.is_empty() {
                    continue;
                }
                assert!(
                    seen_patterns.insert(*pat),
                    "Duplicate pattern '{}' found in Linux rule '{}'",
                    pat,
                    s.id
                );
            }
        }

        // Verify Proton compatdata patterns are strictly scoped to safe temp/crash/D3D subdirs
        let game_launchers = specs.iter().find(|s| s.id == "game_launchers").unwrap();
        for pat in game_launchers.patterns {
            if pat.contains("compatdata") {
                assert!(
                    pat.ends_with("/Temp")
                        || pat.ends_with("/CrashDumps")
                        || pat.ends_with("/D3DSCache"),
                    "Unsafe Proton compatdata pattern: {pat}"
                );
            }
        }

        // Verify expand resolves mock Linux directories cleanly
        let dir = std::env::temp_dir().join(format!("sweepr-linux-rules-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let proton_temp = dir.join(".local/share/Steam/steamapps/compatdata/12345/pfx/drive_c/users/steamuser/AppData/Local/Temp");
        let flatpak_cache = dir.join(".var/app/com.spotify.Client/cache");
        let snap_cache = dir.join("snap/firefox/common/.cache");
        let docker_cache = dir.join(".docker/buildx/activity");
        let cargo_src = dir.join(".cargo/registry/src");
        for p in [&proton_temp, &flatpak_cache, &snap_cache, &docker_cache, &cargo_src] {
            std::fs::create_dir_all(p).unwrap();
        }
        assert_eq!(
            expand(&dir, ".local/share/Steam/steamapps/compatdata/*/pfx/drive_c/users/steamuser/AppData/Local/Temp"),
            vec![proton_temp]
        );
        assert_eq!(expand(&dir, ".var/app/*/cache"), vec![flatpak_cache]);
        assert_eq!(expand(&dir, "snap/*/*/.cache"), vec![snap_cache]);
        assert_eq!(expand(&dir, ".docker/buildx/activity"), vec![docker_cache]);
        assert_eq!(expand(&dir, ".cargo/registry/src"), vec![cargo_src]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn privacy_trace_file_glob_targets_expand_safely() {
        let dir = std::env::temp_dir().join(format!("sweepr-privacy-glob-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let explorer = dir.join("Microsoft/Windows/Explorer");
        let recent = dir.join("Microsoft/Windows/Recent");
        let auto_dest = recent.join("AutomaticDestinations");
        std::fs::create_dir_all(&explorer).unwrap();
        std::fs::create_dir_all(&auto_dest).unwrap();

        std::fs::write(explorer.join("thumbcache_256.db"), b"thumb").unwrap();
        std::fs::write(explorer.join("iconcache_32.db"), b"icon").unwrap();
        std::fs::write(recent.join("secret.lnk"), b"lnk").unwrap();
        std::fs::write(recent.join("desktop.ini"), b"ini").unwrap();

        let (dirs_t, files_t) = expand_spec_targets(&dir, "Microsoft/Windows/Explorer/thumbcache_*.db");
        assert!(dirs_t.is_empty());
        assert_eq!(
            files_t,
            vec![FileGlobTarget {
                dir: explorer.clone(),
                pattern: "thumbcache_*.db".to_string(),
            }]
        );

        let (dirs_r, files_r) = expand_spec_targets(&dir, "Microsoft/Windows/Recent/*.lnk");
        assert!(dirs_r.is_empty());
        assert_eq!(
            files_r,
            vec![FileGlobTarget {
                dir: recent.clone(),
                pattern: "*.lnk".to_string(),
            }]
        );

        // Directory pattern still resolves directories normally
        let (dirs_auto, files_auto) =
            expand_spec_targets(&dir, "Microsoft/Windows/Recent/AutomaticDestinations");
        assert_eq!(dirs_auto, vec![auto_dest]);
        assert!(files_auto.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn custom_rule_validation_rejects_unsafe_paths_and_symlinks() {
        let base_tmp = std::fs::canonicalize(dirs::home_dir().unwrap_or_else(std::env::temp_dir)).unwrap();
        let root = base_tmp.join(format!(".sweepr-custom-rules-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let data_dir = root.join("app_data");
        let cache_dir = root.join("my_app").join("cache");
        let file_target = root.join("not_a_dir.txt");
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&cache_dir).unwrap();
        std::fs::write(&file_target, b"abc").unwrap();

        // Rejects relative, .., nonexistent, file, data_dir
        assert!(validate_custom_rule_path("relative/cache", &data_dir).is_err());
        assert!(validate_custom_rule_path(
            &format!("{}/..", cache_dir.display()),
            &data_dir
        ).is_err());
        assert!(validate_custom_rule_path(
            &format!("{}\\..", cache_dir.display()),
            &data_dir
        ).is_err());
        assert!(validate_custom_rule_path(
            &root.join("missing_dir").to_string_lossy(),
            &data_dir
        ).is_err());
        assert!(validate_custom_rule_path(&file_target.to_string_lossy(), &data_dir).is_err());
        assert!(validate_custom_rule_path(&data_dir.to_string_lossy(), &data_dir).is_err());
        assert!(validate_custom_rule_path(&data_dir.join("sub").to_string_lossy(), &data_dir).is_err());

        // Rejects user personal folders (both exact and nested subfolders)
        for user_dir in [
            dirs::desktop_dir(),
            dirs::document_dir(),
            dirs::picture_dir(),
            dirs::download_dir(),
        ]
        .into_iter()
        .flatten()
        {
            if user_dir.is_dir() {
                assert!(
                    validate_custom_rule_path(&user_dir.to_string_lossy(), &data_dir).is_err(),
                    "Must reject exact user dir {}",
                    user_dir.display()
                );
                let nested = user_dir.join("Subfolder");
                if nested.is_dir() {
                    assert!(
                        validate_custom_rule_path(&nested.to_string_lossy(), &data_dir).is_err(),
                        "Must reject nested user dir {}",
                        nested.display()
                    );
                }
            }
        }

        // Rejects Windows/Unix OS protected directories
        #[cfg(windows)]
        if let Ok(sys) = std::env::var("SystemRoot") {
            let sys32 = PathBuf::from(sys).join("System32");
            if sys32.is_dir() {
                assert!(validate_custom_rule_path(&sys32.to_string_lossy(), &data_dir).is_err());
            }
        }
        #[cfg(unix)]
        {
            assert!(validate_custom_rule_path("/etc", &data_dir).is_err());
        }

        // Rejects symlinked target or symlinked ancestor when symlinks can be created
        let symlink_target = root.join("sym_cache");
        let symlink_parent = root.join("sym_parent");
        #[cfg(unix)]
        let sym_ok = std::os::unix::fs::symlink(&cache_dir, &symlink_target).is_ok()
            && std::os::unix::fs::symlink(&root.join("my_app"), &symlink_parent).is_ok();
        #[cfg(windows)]
        let sym_ok = std::os::windows::fs::symlink_dir(&cache_dir, &symlink_target).is_ok()
            && std::os::windows::fs::symlink_dir(&root.join("my_app"), &symlink_parent).is_ok();
        if sym_ok {
            assert!(validate_custom_rule_path(&symlink_target.to_string_lossy(), &data_dir).is_err());
            assert!(validate_custom_rule_path(
                &symlink_parent.join("cache").to_string_lossy(),
                &data_dir
            ).is_err());
        }

        // Rejects built-in rule ID collision
        let collision_json = serde_json::json!({
            "id": "temp",
            "name": "Shadow Temp",
            "paths": [cache_dir.to_string_lossy()]
        })
        .to_string();
        assert!(import_custom_rules_in(&data_dir, &collision_json, false).is_err());

        // Accepts valid deep cache folder and persists round-trip in custom_rules.json
        let valid_json = serde_json::json!([
            {
                "id": "my_custom_cache",
                "name": "My App Cache",
                "description": "Custom build cache",
                "group": "developer",
                "paths": [cache_dir.to_string_lossy()],
                "min_age_hours": 12,
                "enabled": true
            }
        ])
        .to_string();
        let views = import_custom_rules_in(&data_dir, &valid_json, false).unwrap();
        assert_eq!(views.len(), 1);
        assert!(views[0].valid);
        assert_eq!(views[0].id, "my_custom_cache");

        let combined = all_with_custom(&data_dir);
        let custom = combined.iter().find(|r| r.id == "my_custom_cache").expect("custom rule loaded");
        assert!(!custom.free, "Custom rules must always be Pro-gated (free: false)");
        assert_eq!(custom.min_age_hours, 12);
        assert_eq!(custom.roots, vec![cache_dir.clone()]);

        let after_remove = remove_custom_rule_in(&data_dir, "my_custom_cache").unwrap();
        assert!(after_remove.is_empty());
        assert!(find_with_custom(&data_dir, "my_custom_cache").is_none());

        let _ = std::fs::remove_dir_all(&root);
    }
}

