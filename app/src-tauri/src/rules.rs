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

struct Spec {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    group: Group,
    base: Base,
    patterns: &'static [&'static str],
    min_age_hours: u64,
    free: bool,
}

#[allow(dead_code)]
#[derive(Clone, Copy)]
enum Base {
    Downloads,
    Home,
    Temp,
    LocalAppData,
    RoamingAppData,
    UserFolders,
}

impl Base {
    fn resolve(self) -> Option<PathBuf> {
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

/// Expand a `/`-separated relative pattern (with `*` segments) against `base`,
/// returning only directories that exist.
fn expand(base: &Path, pattern: &str) -> Vec<PathBuf> {
    let mut current = vec![base.to_path_buf()];
    for seg in pattern.split('/').filter(|s| !s.is_empty()) {
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
        Spec { id: "crash_dumps", name: "Crash dumps & error reports", description: "Diagnostic dumps, Windows Error Reporting archives and CLR usage logs.", group: Group::System, base: LocalAppData, patterns: &["CrashDumps", "Microsoft/Windows/WER/ReportArchive", "Microsoft/Windows/WER/ReportQueue", "Diagnostics", "Microsoft/CLR_v4.0/UsageLogs"], min_age_hours: 0, free: false },
        Spec { id: "delivery_opt", name: "Windows Update & Delivery Optimization", description: "Delivery Optimization peer cache and installer package caches.", group: Group::System, base: LocalAppData, patterns: &["Microsoft/Windows/DeliveryOptimization/Cache", "Package Cache"], min_age_hours: 24, free: false },
        Spec { id: "shader_cache", name: "Graphics shader caches", description: "DirectX/GPU shader caches. They rebuild automatically.", group: Group::System, base: LocalAppData, patterns: &["D3DSCache", "NVIDIA/DXCache", "NVIDIA/GLCache", "AMD/DxCache"], min_age_hours: 24, free: false },
        Spec { id: "chrome", name: "Google Chrome cache", description: "Cached web content. Close Chrome first for best results. Logins and history are not touched.", group: Group::Browsers, base: LocalAppData, patterns: &["Google/Chrome/User Data/*/Cache", "Google/Chrome/User Data/*/Code Cache", "Google/Chrome/User Data/*/GPUCache"], min_age_hours: 0, free: false },
        Spec { id: "edge", name: "Microsoft Edge cache", description: "Cached web content. Logins and history are not touched.", group: Group::Browsers, base: LocalAppData, patterns: &["Microsoft/Edge/User Data/*/Cache", "Microsoft/Edge/User Data/*/Code Cache", "Microsoft/Edge/User Data/*/GPUCache"], min_age_hours: 0, free: false },
        Spec { id: "brave", name: "Brave cache", description: "Cached web content. Logins and history are not touched.", group: Group::Browsers, base: LocalAppData, patterns: &["BraveSoftware/Brave-Browser/User Data/*/Cache", "BraveSoftware/Brave-Browser/User Data/*/Code Cache"], min_age_hours: 0, free: false },
        Spec { id: "firefox", name: "Firefox cache", description: "Cached web content. Logins and history are not touched.", group: Group::Browsers, base: LocalAppData, patterns: &["Mozilla/Firefox/Profiles/*/cache2"], min_age_hours: 0, free: false },
        Spec { id: "app_caches", name: "App Caches", description: "Caches from installed desktop apps. They rebuild on next launch.", group: Group::Apps, base: RoamingAppData, patterns: &["discord/Cache", "discord/Code Cache", "Code/Cache", "Code/CachedData", "Microsoft/Teams/Cache", "Slack/Cache"], min_age_hours: 0, free: false },
        Spec { id: "spotify", name: "Spotify offline cache", description: "Streaming cache (not your downloaded playlists).", group: Group::Apps, base: LocalAppData, patterns: &["Spotify/Data"], min_age_hours: 0, free: false },
        Spec { id: "downloads", name: "Old & Unused Downloads", description: "Files in your Downloads folder older than 30 days that haven't been opened or used recently.", group: Group::System, base: Downloads, patterns: &[""], min_age_hours: 30 * 24, free: false },
        Spec { id: "duplicates", name: "Duplicate Files", description: "Identical copies of files, photos, documents, and installers across your device. The original copy is always preserved.", group: Group::System, base: UserFolders, patterns: &[""], min_age_hours: 0, free: false },
        Spec { id: "dev_caches", name: "Developer package caches", description: "npm, pnpm, pip, Yarn, NuGet and Composer download caches. Packages re-download when needed.", group: Group::Developer, base: LocalAppData, patterns: &["npm-cache/_cacache", "pnpm/store", "pip/cache", "Yarn/Cache", "NuGet/v3-cache", "Composer/cache"], min_age_hours: 0, free: false },
        Spec { id: "build_caches", name: "Gradle & Cargo build caches", description: "Cached Gradle and Rust Cargo registry archives in your user profile (~/.gradle/caches, ~/.cargo/registry/cache).", group: Group::Developer, base: Home, patterns: &[".gradle/caches", ".cargo/registry/cache"], min_age_hours: 24 * 7, free: false },
        Spec { id: "messenger_caches", name: "Messenger & Collaboration caches", description: "Cached media and webviews from Slack, Microsoft Teams, Zoom, WhatsApp, and Telegram Desktop. Chats and logins are not touched.", group: Group::Apps, base: RoamingAppData, patterns: &["Slack/Cache", "Slack/Code Cache", "Slack/GPUCache", "Slack/Service Worker/CacheStorage", "Microsoft/Teams/Cache", "Microsoft/Teams/Code Cache", "Microsoft/Teams/GPUCache", "Zoom/data/WebViewCache", "Telegram Desktop/tdata/user_data/cache", "Telegram Desktop/tdata/user_data/media_cache"], min_age_hours: 0, free: false },
        Spec { id: "recent_activity", name: "Windows Activity & JumpList traces", description: "Recent file jump lists and Explorer activity caches.", group: Group::System, base: RoamingAppData, patterns: &["Microsoft/Windows/Recent/AutomaticDestinations", "Microsoft/Windows/Recent/CustomDestinations"], min_age_hours: 24, free: false },
        Spec { id: "system_slimmer", name: "Windows Installer & INet cache slimmer", description: "Temporary Windows INetCache and Error Reporting archives.", group: Group::System, base: LocalAppData, patterns: &["Microsoft/Windows/INetCache/IE", "Microsoft/Windows/WER/ReportArchive", "Microsoft/Windows/WER/ReportQueue", "Packages/MSTeams_8wekyb3d8bbwe/LocalCache/Microsoft/MSTeams/EBWebView/Default/Cache"], min_age_hours: 24, free: false },
    ]
}

#[cfg(target_os = "macos")]
fn specs() -> Vec<Spec> {
    use Base::*;
    vec![
        Spec { id: "temp", name: "Temporary files", description: "Per-user temp files older than 24 hours.", group: Group::System, base: Temp, patterns: &[""], min_age_hours: 24, free: false },
        Spec { id: "trash", name: "Trash bin", description: "Items in your ~/.Trash folder older than 24 hours.", group: Group::System, base: Home, patterns: &[".Trash"], min_age_hours: 24, free: false },
        Spec { id: "user_caches", name: "App & browser caches", description: "~/Library/Caches (including Homebrew & browser caches). Apps rebuild these automatically.", group: Group::Apps, base: Home, patterns: &["Library/Caches"], min_age_hours: 24, free: false },
        Spec { id: "logs", name: "User & crash logs", description: "~/Library/Logs and CrashReporter diagnostic logs.", group: Group::System, base: Home, patterns: &["Library/Logs", "Library/Application Support/CrashReporter"], min_age_hours: 24, free: false },
        Spec { id: "xcode", name: "Xcode derived data", description: "Build products. Xcode regenerates them on next build.", group: Group::Developer, base: Home, patterns: &["Library/Developer/Xcode/DerivedData"], min_age_hours: 0, free: false },
        Spec { id: "downloads", name: "Old & Unused Downloads", description: "Files in your Downloads folder older than 30 days that haven't been opened or used recently.", group: Group::System, base: Downloads, patterns: &[""], min_age_hours: 30 * 24, free: false },
        Spec { id: "duplicates", name: "Duplicate Files", description: "Identical copies of files, photos, documents, and installers across your device. The original copy is always preserved.", group: Group::System, base: UserFolders, patterns: &[""], min_age_hours: 0, free: false },
        Spec { id: "dev_caches", name: "Developer package & build caches", description: "npm, Gradle and Cargo download caches.", group: Group::Developer, base: Home, patterns: &[".npm/_cacache", ".gradle/caches", ".cargo/registry/cache"], min_age_hours: 0, free: false },
    ]
}

#[cfg(all(unix, not(target_os = "macos")))]
fn specs() -> Vec<Spec> {
    use Base::*;
    vec![
        Spec { id: "temp", name: "Temporary files", description: "Your files in /tmp older than 24 hours.", group: Group::System, base: Temp, patterns: &[""], min_age_hours: 24, free: false },
        Spec { id: "trash", name: "Trash bin", description: "Files in ~/.local/share/Trash older than 24 hours.", group: Group::System, base: Home, patterns: &[".local/share/Trash/files", ".local/share/Trash/info"], min_age_hours: 24, free: false },
        Spec { id: "user_caches", name: "App & browser caches", description: "~/.cache. Apps rebuild these automatically.", group: Group::Apps, base: Home, patterns: &[".cache"], min_age_hours: 24, free: false },
        Spec { id: "logs", name: "User state logs", description: "~/.local/state/log diagnostic logs.", group: Group::System, base: Home, patterns: &[".local/state/log"], min_age_hours: 24, free: false },
        Spec { id: "downloads", name: "Old & Unused Downloads", description: "Files in your Downloads folder older than 30 days that haven't been opened or used recently.", group: Group::System, base: Downloads, patterns: &[""], min_age_hours: 30 * 24, free: false },
        Spec { id: "duplicates", name: "Duplicate Files", description: "Identical copies of files, photos, documents, and installers across your device. The original copy is always preserved.", group: Group::System, base: UserFolders, patterns: &[""], min_age_hours: 0, free: false },
        Spec { id: "dev_caches", name: "Developer package & build caches", description: "npm, Gradle and Cargo download caches.", group: Group::Developer, base: Home, patterns: &[".npm/_cacache", ".gradle/caches", ".cargo/registry/cache"], min_age_hours: 0, free: false },
    ]
}

/// Resolve all rules for the current OS. Called per scan so new browser
/// profiles etc. are picked up.
pub fn all() -> Vec<Rule> {
    specs()
        .into_iter()
        .map(|s| {
            let roots = match s.base {
                Base::UserFolders => user_folder_roots(),
                _ => s
                    .base
                    .resolve()
                    .map(|b| s.patterns.iter().flat_map(|p| expand(&b, p)).collect())
                    .unwrap_or_default(),
            };
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

