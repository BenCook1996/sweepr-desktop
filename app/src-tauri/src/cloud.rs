//! CloudClean: finds wasted space inside locally-synced cloud drives
//! (OneDrive, Google Drive, Dropbox, iCloud Drive / iCloud Photos) as well as
//! heavy local email & messenger attachments.
//!
//! Everything runs on-device against the sync folders and local mail caches on
//! this PC. No OAuth, no Google/Microsoft sign-in approval, no uploads.
//!
//! Honest limits:
//! - Online-only placeholders (Files On-Demand / streamed / dataless files) are
//!   counted by their logical size but never read, because reading them would
//!   force a download. They can only join "likely" (name + size) duplicate groups.
//! - Deleting a file in a sync folder deletes it from the cloud too. Every
//!   provider keeps its own cloud recycle bin (typically 30 days) and we move
//!   local copies to the OS Recycle Bin / Trash.

use crate::error::{AppError, AppResult};
use crate::safety;
use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

/// Upper bound on files examined across all cloud roots in one scan.
const MAX_FILES: usize = 300_000;
/// Per-category cap on items returned to the UI (largest first).
const MAX_ITEMS_PER_CATEGORY: usize = 300;
const LARGE_VIDEO_BYTES: u64 = 200 * 1024 * 1024;
const INSTALLER_BYTES: u64 = 20 * 1024 * 1024;
const OLD_LARGE_BYTES: u64 = 100 * 1024 * 1024;
const OLD_AGE_SECS: u64 = 2 * 365 * 24 * 3600;
const MIN_DUPLICATE_BYTES: u64 = 64 * 1024;
const MIN_ATTACHMENT_BYTES: u64 = 512 * 1024; // 512 KB minimum for email/messenger attachment cleanup

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    OneDrive,
    GoogleDrive,
    Dropbox,
    ICloud,
}

impl Provider {
    pub fn id(self) -> &'static str {
        match self {
            Provider::OneDrive => "onedrive",
            Provider::GoogleDrive => "google_drive",
            Provider::Dropbox => "dropbox",
            Provider::ICloud => "icloud",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Provider::OneDrive => "Microsoft OneDrive",
            Provider::GoogleDrive => "Google Drive (Google One)",
            Provider::Dropbox => "Dropbox",
            Provider::ICloud => "iCloud Drive & Photos",
        }
    }

    fn from_id(id: &str) -> Option<Provider> {
        [Provider::OneDrive, Provider::GoogleDrive, Provider::Dropbox, Provider::ICloud]
            .into_iter()
            .find(|p| p.id() == id)
    }
}

pub fn provider_from_id(id: &str) -> Option<Provider> {
    Provider::from_id(id)
}

#[derive(Serialize, Clone, Debug)]
pub struct CloudRoot {
    pub provider: Provider,
    pub provider_id: String,
    pub label: String,
    pub path: String,
    /// True when files are streamed on demand (e.g. Google Drive virtual drive)
    /// and attributes cannot tell us whether a file is local.
    pub streamed: bool,
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

fn push_root(out: &mut Vec<CloudRoot>, provider: Provider, path: PathBuf, streamed: bool) {
    if path.as_os_str().is_empty() || !path.is_dir() {
        return;
    }
    let canon = std::fs::canonicalize(&path).unwrap_or(path.clone());
    // Skip roots already covered (same folder, or nested inside another root).
    if out.iter().any(|r| {
        let existing = Path::new(&r.path);
        safety::is_within(&canon, existing) || safety::is_within(existing, &canon)
    }) {
        return;
    }
    out.push(CloudRoot {
        provider,
        provider_id: provider.id().to_string(),
        label: provider.label().to_string(),
        path: path.to_string_lossy().to_string(),
        streamed,
    });
}

fn dropbox_paths_from_info_json() -> Vec<PathBuf> {
    let mut found = Vec::new();
    let candidates = [dirs::config_dir(), dirs::data_local_dir(), dirs::home_dir().map(|h| h.join(".dropbox"))];
    for base in candidates.into_iter().flatten() {
        let file = if base.ends_with(".dropbox") { base.join("info.json") } else { base.join("Dropbox").join("info.json") };
        let Ok(text) = std::fs::read_to_string(&file) else { continue };
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        for key in ["personal", "business"] {
            if let Some(p) = json.get(key).and_then(|v| v.get("path")).and_then(|v| v.as_str()) {
                found.push(PathBuf::from(p));
            }
        }
    }
    found
}

/// Detects locally mounted cloud-drive folders on this machine.
pub fn detect_cloud_roots() -> Vec<CloudRoot> {
    let mut out = Vec::new();
    let home = dirs::home_dir().unwrap_or_default();

    // OneDrive (personal + work/school)
    for var in ["OneDriveConsumer", "OneDriveCommercial", "OneDrive"] {
        if let Ok(v) = std::env::var(var) {
            push_root(&mut out, Provider::OneDrive, PathBuf::from(v), false);
        }
    }
    if let Ok(entries) = std::fs::read_dir(&home) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name == "OneDrive" || name.starts_with("OneDrive - ") {
                push_root(&mut out, Provider::OneDrive, e.path(), false);
            }
        }
    }

    // Dropbox
    for p in dropbox_paths_from_info_json() {
        push_root(&mut out, Provider::Dropbox, p, false);
    }
    push_root(&mut out, Provider::Dropbox, home.join("Dropbox"), false);

    // iCloud (Windows app + macOS)
    push_root(&mut out, Provider::ICloud, home.join("iCloudDrive"), false);
    push_root(&mut out, Provider::ICloud, home.join("Pictures").join("iCloud Photos"), false);
    push_root(&mut out, Provider::ICloud, home.join("Library/Mobile Documents/com~apple~CloudDocs"), false);

    // Google Drive for desktop: mirrored folders or the streamed virtual drive.
    push_root(&mut out, Provider::GoogleDrive, home.join("Google Drive"), false);
    push_root(&mut out, Provider::GoogleDrive, home.join("My Drive"), false);
    #[cfg(windows)]
    for letter in b'D'..=b'Z' {
        let my_drive = PathBuf::from(format!("{}:\\My Drive", letter as char));
        if my_drive.is_dir() {
            push_root(&mut out, Provider::GoogleDrive, my_drive, true);
        }
    }

    // macOS File Provider locations (~/Library/CloudStorage/*)
    if let Ok(entries) = std::fs::read_dir(home.join("Library/CloudStorage")) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let provider = if name.starts_with("OneDrive") {
                Some(Provider::OneDrive)
            } else if name.starts_with("GoogleDrive") {
                Some(Provider::GoogleDrive)
            } else if name.starts_with("Dropbox") {
                Some(Provider::Dropbox)
            } else {
                None
            };
            if let Some(p) = provider {
                push_root(&mut out, p, e.path(), p == Provider::GoogleDrive);
            }
        }
    }

    out
}

/// True when the file's bytes are not on this device (reading would download it).
fn is_online_only(md: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;
        const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
        const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;
        let attrs = md.file_attributes();
        attrs & (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS) != 0
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::macos::fs::MetadataExt;
        const SF_DATALESS: u32 = 0x4000_0000;
        md.st_flags() & SF_DATALESS != 0
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = md;
        false
    }
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Scan report
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct CloudFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_at: u64,
    pub provider_id: String,
    pub online_only: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct CloudDuplicateGroup {
    pub key: String,
    pub size: u64,
    /// "verified" = identical SHA-256; "likely" = same name + size (at least one copy is online-only).
    pub confidence: String,
    pub cross_cloud: bool,
    /// Ordered: the first file is the recommended copy to keep.
    pub files: Vec<CloudFile>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ProviderUsage {
    pub provider_id: String,
    pub label: String,
    pub roots: Vec<String>,
    pub used_bytes: u64,
    pub files: u64,
    pub online_only_bytes: u64,
    pub reclaimable_bytes: u64,
    pub offloadable_bytes: u64,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct CloudScanReport {
    pub roots: Vec<CloudRoot>,
    pub providers: Vec<ProviderUsage>,
    pub duplicates: Vec<CloudDuplicateGroup>,
    pub screenshots: Vec<CloudFile>,
    pub large_videos: Vec<CloudFile>,
    pub installers: Vec<CloudFile>,
    pub old_large_files: Vec<CloudFile>,
    pub email_attachments: Vec<CloudFile>,
    pub total_bytes: u64,
    pub total_files: u64,
    pub online_only_bytes: u64,
    pub reclaimable_bytes: u64,
    pub truncated: bool,
    pub duration_ms: u64,
}

const VIDEO_EXTS: &[&str] = &["mp4", "mov", "m4v", "avi", "mkv", "wmv", "mts", "m2ts", "3gp", "webm", "hevc"];
const INSTALLER_EXTS: &[&str] = &["exe", "msi", "dmg", "pkg", "iso", "zip", "rar", "7z", "tar", "gz", "apk"];
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "heic", "webp"];
const EMAIL_MESSAGE_EXTS: &[&str] = &["eml", "msg", "ics", "vcf"];
const ATTACHMENT_DOC_EXTS: &[&str] = &[
    "eml", "msg", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "rar", "7z", "mp4", "mov", "avi", "mkv",
    "mp3", "wav", "m4a", "png", "jpg", "jpeg", "heic", "webp", "psd", "ai",
];
const SCREENSHOT_PREFIXES: &[&str] = &[
    "screenshot", "screen shot", "screen_shot", "capture d", "bildschirmfoto", "schermafbeelding",
    "captura de pantalla", "captura de ecrã", "istantanea", "schermata", "snip", "img_screen",
];

fn ext_of(name: &str) -> String {
    Path::new(name).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
}

fn is_screenshot(name: &str) -> bool {
    let lower = name.to_lowercase();
    IMAGE_EXTS.contains(&ext_of(name).as_str()) && SCREENSHOT_PREFIXES.iter().any(|p| lower.starts_with(p))
}

/// True when a file inside a cloud drive is a saved email message or lives in an email/messenger attachments folder.
fn is_cloud_email_attachment(path: &Path, name: &str, size: u64) -> bool {
    if size < MIN_ATTACHMENT_BYTES {
        return false;
    }
    let ext = ext_of(name);
    if EMAIL_MESSAGE_EXTS.contains(&ext.as_str()) {
        return true;
    }
    if !ATTACHMENT_DOC_EXTS.contains(&ext.as_str()) {
        return false;
    }
    path.to_string_lossy().split(&['/', '\\'][..]).any(|c| {
        let s = c.to_lowercase();
        s == "attachments"
            || s == "email attachments"
            || s == "mail attachments"
            || s == "outlook attachments"
            || s == "saved attachments"
            || s == "whatsapp"
            || s == "telegram desktop"
    })
}

/// Local email client attachment caches (Outlook SecureTemp, Windows Mail, Thunderbird, Apple MailDownloads).
/// We never return `.ost` / `.pst` / `.nst` monolithic mailbox databases so a user cannot accidentally delete
/// their whole mailbox.
pub fn detect_attachment_roots() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut push = |p: PathBuf| {
        if p.is_dir() && !out.iter().any(|existing| existing == &p) {
            out.push(p);
        }
    };
    if let Some(local) = dirs::data_local_dir() {
        // Outlook temporary attachment cache: %LOCALAPPDATA%\Microsoft\Windows\INetCache\Content.Outlook\*
        let content_outlook = local.join("Microsoft").join("Windows").join("INetCache").join("Content.Outlook");
        push(content_outlook.clone());
        if let Ok(entries) = std::fs::read_dir(&content_outlook) {
            for e in entries.flatten() {
                if e.path().is_dir() {
                    push(e.path());
                }
            }
        }
        // New Outlook / Windows Mail local attachment cache
        push(local.join("Packages").join("microsoft.windowscommunicationsapps_8wekyb3d8bbwe").join("LocalState").join("Files"));
        push(local.join("Microsoft").join("Olk").join("Attachments"));
        push(local.join("Microsoft").join("Outlook").join("Attachments"));
    }
    if let Some(home) = dirs::home_dir() {
        push(home.join("Downloads").join("Email Attachments"));
        push(home.join("Documents").join("Outlook Files").join("Attachments"));
        // macOS Apple Mail Downloads
        push(home.join("Library").join("Containers").join("com.apple.mail").join("Data").join("Library").join("Mail Downloads"));
        push(home.join("Library").join("Mail Downloads"));
    }
    out
}

fn scan_local_attachment_roots(exclusions: &[PathBuf]) -> Vec<CloudFile> {
    let mut out = Vec::new();
    for root in detect_attachment_roots() {
        let walker = WalkDir::new(&root)
            .max_depth(4)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !safety::is_excluded(e.path(), exclusions));
        for entry in walker.flatten() {
            if out.len() >= MAX_ITEMS_PER_CATEGORY {
                break;
            }
            if entry.file_type().is_symlink() || !entry.file_type().is_file() || is_sync_internal(entry.path()) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let ext = ext_of(&name);
            if matches!(ext.as_str(), "ost" | "pst" | "nst" | "db" | "sqlite" | "msf") {
                continue;
            }
            if !ATTACHMENT_DOC_EXTS.contains(&ext.as_str()) {
                continue;
            }
            let Ok(md) = std::fs::symlink_metadata(entry.path()) else { continue };
            if md.len() < MIN_ATTACHMENT_BYTES {
                continue;
            }
            let modified_at = md
                .modified()
                .ok()
                .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.push(CloudFile {
                path: entry.path().to_string_lossy().to_string(),
                name,
                size: md.len(),
                modified_at,
                provider_id: "onedrive".into(),
                online_only: false,
            });
        }
    }
    out
}

/// Provider sync metadata / temp files we must never touch.
fn is_sync_internal(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    name == "desktop.ini"
        || name == ".ds_store"
        || name == "icon\r"
        || name.starts_with(".dropbox")
        || name.starts_with("~$")
        || name.ends_with(".tmp")
        || name.ends_with(".gdoc")
        || name.ends_with(".gsheet")
        || name.ends_with(".gslides")
        || path.components().any(|c| {
            let s = c.as_os_str().to_string_lossy().to_lowercase();
            s == ".dropbox.cache" || s == ".tmp.drivedownload" || s == ".tmp.driveupload" || s == ".shortcut-targets-by-id"
        })
}

fn hash_prefix(path: &Path, len: usize) -> Option<[u8; 32]> {
    let mut file = File::open(path).ok()?;
    let mut buf = vec![0u8; len];
    let mut read = 0;
    while read < len {
        match file.read(&mut buf[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(_) => return None,
        }
    }
    Some(Sha256::digest(&buf[..read]).into())
}

fn hash_full(path: &Path) -> Option<[u8; 32]> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buf[..n]),
            Err(_) => return None,
        }
    }
    Some(hasher.finalize().into())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Rank which copy to keep: prefer locally available, then shortest path
/// (closest to the drive root, usually the "original"), then oldest.
fn sort_keep_first(files: &mut [CloudFile]) {
    files.sort_by(|a, b| {
        a.online_only
            .cmp(&b.online_only)
            .then(a.path.len().cmp(&b.path.len()))
            .then(a.modified_at.cmp(&b.modified_at))
    });
}

fn find_duplicates(files: &[CloudFile]) -> Vec<CloudDuplicateGroup> {
    let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, f) in files.iter().enumerate() {
        if f.size >= MIN_DUPLICATE_BYTES {
            by_size.entry(f.size).or_default().push(i);
        }
    }
    let candidates: Vec<Vec<usize>> = by_size.into_values().filter(|v| v.len() > 1).collect();

    // Stage 1: verified duplicates among locally available files (prefix hash, then full hash).
    let verified: Vec<Vec<usize>> = candidates
        .par_iter()
        .flat_map_iter(|idxs| {
            let local: Vec<usize> = idxs.iter().copied().filter(|&i| !files[i].online_only).collect();
            let mut out = Vec::new();
            if local.len() < 2 {
                return out;
            }
            let mut by_prefix: HashMap<[u8; 32], Vec<usize>> = HashMap::new();
            for i in local {
                if let Some(h) = hash_prefix(Path::new(&files[i].path), 64 * 1024) {
                    by_prefix.entry(h).or_default().push(i);
                }
            }
            for group in by_prefix.into_values().filter(|g| g.len() > 1) {
                let mut by_full: HashMap<[u8; 32], Vec<usize>> = HashMap::new();
                for i in group {
                    if let Some(h) = hash_full(Path::new(&files[i].path)) {
                        by_full.entry(h).or_default().push(i);
                    }
                }
                out.extend(by_full.into_values().filter(|g| g.len() > 1));
            }
            out
        })
        .collect();

    let mut grouped: HashSet<usize> = HashSet::new();
    let mut groups = Vec::new();
    for idxs in verified {
        grouped.extend(idxs.iter().copied());
        let mut members: Vec<CloudFile> = idxs.iter().map(|&i| files[i].clone()).collect();
        sort_keep_first(&mut members);
        let first = hash_full(Path::new(&members[0].path)).map(|h| hex(&h)).unwrap_or_default();
        groups.push(make_group(first, "verified", members));
    }

    // Stage 2: likely duplicates (same file name + size) involving online-only copies.
    for idxs in candidates {
        let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
        for i in idxs.into_iter().filter(|i| !grouped.contains(i)) {
            by_name.entry(files[i].name.to_lowercase()).or_default().push(i);
        }
        for (name, members) in by_name.into_iter().filter(|(_, m)| m.len() > 1) {
            if !members.iter().any(|&i| files[i].online_only) {
                continue; // fully local but hashes differ: not duplicates
            }
            let mut list: Vec<CloudFile> = members.iter().map(|&i| files[i].clone()).collect();
            sort_keep_first(&mut list);
            let key = format!("{}:{}", list[0].size, name);
            groups.push(make_group(key, "likely", list));
        }
    }

    groups.sort_by(|a, b| {
        let wa = a.size * (a.files.len() as u64 - 1);
        let wb = b.size * (b.files.len() as u64 - 1);
        wb.cmp(&wa)
    });
    groups
}

fn make_group(key: String, confidence: &str, files: Vec<CloudFile>) -> CloudDuplicateGroup {
    let providers: HashSet<&str> = files.iter().map(|f| f.provider_id.as_str()).collect();
    CloudDuplicateGroup {
        key,
        size: files[0].size,
        confidence: confidence.to_string(),
        cross_cloud: providers.len() > 1,
        files,
    }
}

fn top_n(mut v: Vec<CloudFile>) -> Vec<CloudFile> {
    v.sort_by(|a, b| b.size.cmp(&a.size));
    v.truncate(MAX_ITEMS_PER_CATEGORY);
    v
}

/// Runs the full on-device diagnostic over every detected cloud root.
pub fn scan_cloud(roots: Vec<CloudRoot>, exclusions: &[PathBuf]) -> CloudScanReport {
    let started = std::time::Instant::now();
    let now = now_secs();
    let mut files: Vec<CloudFile> = Vec::new();
    let mut truncated = false;

    'roots: for root in &roots {
        let walker = WalkDir::new(&root.path).follow_links(false).into_iter().filter_entry(|e| {
            !(e.file_type().is_dir() && is_sync_internal(e.path())) && !safety::is_excluded(e.path(), exclusions)
        });
        for entry in walker.flatten() {
            if files.len() >= MAX_FILES {
                truncated = true;
                break 'roots;
            }
            if entry.file_type().is_symlink() || !entry.file_type().is_file() || is_sync_internal(entry.path()) {
                continue;
            }
            let Ok(md) = std::fs::symlink_metadata(entry.path()) else { continue };
            if md.file_type().is_symlink() {
                continue;
            }
            let modified_at = md
                .modified()
                .ok()
                .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            files.push(CloudFile {
                path: entry.path().to_string_lossy().to_string(),
                name: entry.file_name().to_string_lossy().to_string(),
                size: md.len(),
                modified_at,
                provider_id: root.provider_id.clone(),
                // Streamed drives give no reliable "is local" signal: never read them.
                online_only: root.streamed || is_online_only(&md),
            });
        }
    }

    let duplicates = find_duplicates(&files);

    let mut screenshots = Vec::new();
    let mut large_videos = Vec::new();
    let mut installers = Vec::new();
    let mut old_large_files = Vec::new();
    let mut email_attachments = scan_local_attachment_roots(exclusions);
    let mut seen_attachment_paths: HashSet<String> = email_attachments.iter().map(|f| f.path.clone()).collect();

    for f in &files {
        let ext = ext_of(&f.name);
        if is_cloud_email_attachment(Path::new(&f.path), &f.name, f.size) && seen_attachment_paths.insert(f.path.clone()) {
            email_attachments.push(f.clone());
        }
        if is_screenshot(&f.name) {
            screenshots.push(f.clone());
        } else if VIDEO_EXTS.contains(&ext.as_str()) && f.size >= LARGE_VIDEO_BYTES {
            large_videos.push(f.clone());
        } else if INSTALLER_EXTS.contains(&ext.as_str()) && f.size >= INSTALLER_BYTES {
            installers.push(f.clone());
        } else if f.size >= OLD_LARGE_BYTES && f.modified_at > 0 && now.saturating_sub(f.modified_at) > OLD_AGE_SECS {
            old_large_files.push(f.clone());
        }
    }

    // Reclaimable (safe junk) vs offloadable (keep, but move off the cloud).
    // Track by path so a file in several buckets is only counted once.
    let mut reclaim_paths: HashSet<&str> = HashSet::new();
    for g in &duplicates {
        for f in g.files.iter().skip(1) {
            reclaim_paths.insert(&f.path);
        }
    }
    for f in screenshots.iter().chain(installers.iter()).chain(email_attachments.iter()) {
        reclaim_paths.insert(&f.path);
    }
    let mut offload_paths: HashSet<&str> = HashSet::new();
    for f in large_videos.iter().chain(old_large_files.iter()) {
        if !reclaim_paths.contains(f.path.as_str()) {
            offload_paths.insert(&f.path);
        }
    }

    let mut providers: Vec<ProviderUsage> = Vec::new();
    let mut order: Vec<Provider> = Vec::new();
    for r in &roots {
        if !order.contains(&r.provider) {
            order.push(r.provider);
        }
    }
    for p in order {
        let mine: Vec<&CloudFile> = files.iter().filter(|f| f.provider_id == p.id()).collect();
        let used: u64 = mine.iter().map(|f| f.size).sum();
        let online: u64 = mine.iter().filter(|f| f.online_only).map(|f| f.size).sum();
        let reclaim: u64 = mine.iter().filter(|f| reclaim_paths.contains(f.path.as_str())).map(|f| f.size).sum();
        let offload: u64 = mine.iter().filter(|f| offload_paths.contains(f.path.as_str())).map(|f| f.size).sum();
        providers.push(ProviderUsage {
            provider_id: p.id().to_string(),
            label: p.label().to_string(),
            roots: roots.iter().filter(|r| r.provider == p).map(|r| r.path.clone()).collect(),
            used_bytes: used,
            files: mine.len() as u64,
            online_only_bytes: online,
            reclaimable_bytes: reclaim,
            offloadable_bytes: offload,
        });
    }

    let local_attachment_reclaim: u64 = email_attachments
        .iter()
        .filter(|f| !roots.iter().any(|r| safety::is_within(Path::new(&f.path), Path::new(&r.path))))
        .map(|f| f.size)
        .sum();
    let cloud_reclaim: u64 = providers.iter().map(|p| p.reclaimable_bytes).sum();

    CloudScanReport {
        total_bytes: files.iter().map(|f| f.size).sum::<u64>() + local_attachment_reclaim,
        total_files: files.len() as u64 + email_attachments.len() as u64,
        online_only_bytes: files.iter().filter(|f| f.online_only).map(|f| f.size).sum(),
        reclaimable_bytes: cloud_reclaim + local_attachment_reclaim,
        roots,
        providers,
        duplicates: duplicates.into_iter().take(MAX_ITEMS_PER_CATEGORY).collect(),
        screenshots: top_n(screenshots),
        large_videos: top_n(large_videos),
        installers: top_n(installers),
        old_large_files: top_n(old_large_files),
        email_attachments: top_n(email_attachments),
        truncated,
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, Default)]
pub struct CloudActionReport {
    pub files_processed: u64,
    pub bytes: u64,
    pub skipped: Vec<String>,
}

/// Returns the canonical path when `path` is a regular file inside a detected cloud root
/// or a local email attachment cache folder.
pub fn validate_cloud_file(path: &str, roots: &[CloudRoot]) -> AppResult<PathBuf> {
    let p = Path::new(path.trim());
    if !p.is_absolute() {
        return Err(AppError::Other("Expected an absolute path.".into()));
    }
    let md = std::fs::symlink_metadata(p).map_err(|e| AppError::Other(format!("Cannot access file: {e}")))?;
    // Cloud placeholders are reparse points, so only true symlinks/junctions are refused here.
    if md.file_type().is_symlink() || !md.is_file() {
        return Err(AppError::Other("Not a regular file.".into()));
    }
    if is_sync_internal(p) {
        return Err(AppError::Other("Refusing to touch cloud sync metadata.".into()));
    }
    let ext = p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if matches!(ext.as_str(), "ost" | "pst" | "nst") {
        return Err(AppError::Other("Refusing to delete active Outlook mailbox database files (.ost/.pst).".into()));
    }
    let in_cloud = roots.iter().any(|r| safety::is_within(p, Path::new(&r.path)));
    let in_attachments = detect_attachment_roots().iter().any(|r| safety::is_within(p, r));
    if !in_cloud && !in_attachments {
        return Err(AppError::Other("File is not inside a detected cloud drive or email attachment folder.".into()));
    }
    Ok(p.to_path_buf())
}

/// Moves files to the OS Recycle Bin / Trash. The provider then removes them
/// from the cloud (recoverable from the provider's own recycle bin).
pub fn delete_cloud_files(paths: &[String]) -> CloudActionReport {
    let roots = detect_cloud_roots();
    let mut rep = CloudActionReport::default();
    for path in paths {
        match validate_cloud_file(path, &roots) {
            Ok(p) => {
                let size = std::fs::symlink_metadata(&p).map(|m| m.len()).unwrap_or(0);
                match trash::delete(&p) {
                    Ok(()) => {
                        rep.files_processed += 1;
                        rep.bytes += size;
                    }
                    Err(e) => rep.skipped.push(format!("{path}: {e}")),
                }
            }
            Err(e) => rep.skipped.push(format!("{path}: {e}")),
        }
    }
    rep
}

/// Moves files out of the cloud into a local / external folder, preserving
/// `<target>/<provider>/<relative path>`. Online-only files are downloaded
/// first by the provider when they are read.
pub fn offload_cloud_files(paths: &[String], target_dir: &str) -> AppResult<CloudActionReport> {
    let roots = detect_cloud_roots();
    let target = PathBuf::from(target_dir.trim());
    if !target.is_absolute() || !target.is_dir() {
        return Err(AppError::Other("Choose an existing destination folder.".into()));
    }
    if roots.iter().any(|r| safety::is_within(&target, Path::new(&r.path))) {
        return Err(AppError::Other("The destination is itself a cloud folder. Pick a local or external drive.".into()));
    }
    let mut rep = CloudActionReport::default();
    for path in paths {
        let result = validate_cloud_file(path, &roots).and_then(|src| {
            let root = roots
                .iter()
                .find(|r| safety::is_within(&src, Path::new(&r.path)))
                .ok_or_else(|| AppError::Other("No cloud root".into()))?;
            let rel = src.strip_prefix(&root.path).unwrap_or_else(|_| Path::new(src.file_name().unwrap_or_default()));
            let mut dest = target.join(root.provider_id.as_str()).join(rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)?;
            }
            if dest.exists() {
                let stem = dest.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                let ext = dest.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
                dest.set_file_name(format!("{stem} (offloaded {}){ext}", now_secs()));
            }
            let size = std::fs::copy(&src, &dest)?;
            let copied = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
            if copied != size {
                let _ = std::fs::remove_file(&dest);
                return Err(AppError::Other("Copy verification failed; original kept.".into()));
            }
            trash::delete(&src).map_err(|e| AppError::Other(format!("Copied, but could not remove original: {e}")))?;
            Ok(size)
        });
        match result {
            Ok(size) => {
                rep.files_processed += 1;
                rep.bytes += size;
            }
            Err(e) => rep.skipped.push(format!("{path}: {e}")),
        }
    }
    Ok(rep)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_attachment_detection_finds_saved_messages_and_attachment_folders() {
        let p_eml = Path::new("C:\\Users\\Alice\\OneDrive\\Documents\\invoice.eml");
        assert!(is_cloud_email_attachment(p_eml, "invoice.eml", MIN_ATTACHMENT_BYTES + 100));

        let p_att = Path::new("C:\\Users\\Alice\\OneDrive\\Email Attachments\\statement.pdf");
        assert!(is_cloud_email_attachment(p_att, "statement.pdf", MIN_ATTACHMENT_BYTES + 100));

        let p_regular = Path::new("C:\\Users\\Alice\\OneDrive\\Documents\\report.pdf");
        assert!(!is_cloud_email_attachment(p_regular, "report.pdf", MIN_ATTACHMENT_BYTES + 100));
    }

    #[test]
    fn screenshot_detection() {
        assert!(is_screenshot("Screenshot 2024-01-01 101010.png"));
        assert!(is_screenshot("Bildschirmfoto 2023.jpg"));
        assert!(!is_screenshot("holiday.jpg"));
        assert!(!is_screenshot("Screenshot notes.txt"));
    }

    #[test]
    fn provider_ids_roundtrip() {
        for p in [Provider::OneDrive, Provider::GoogleDrive, Provider::Dropbox, Provider::ICloud] {
            assert_eq!(Provider::from_id(p.id()), Some(p));
        }
    }

    #[test]
    fn finds_verified_duplicates_and_keeps_shortest_path() {
        let dir = std::env::temp_dir().join(format!("sweepr-cloud-test-{}", std::process::id()));
        let nested = dir.join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();
        let data = vec![7u8; (MIN_DUPLICATE_BYTES as usize) + 10];
        let f1 = dir.join("photo.jpg");
        let f2 = nested.join("photo copy.jpg");
        std::fs::write(&f1, &data).unwrap();
        std::fs::write(&f2, &data).unwrap();
        let mk = |p: &Path, provider: &str| CloudFile {
            path: p.to_string_lossy().to_string(),
            name: p.file_name().unwrap().to_string_lossy().to_string(),
            size: data.len() as u64,
            modified_at: 0,
            provider_id: provider.into(),
            online_only: false,
        };
        let groups = find_duplicates(&[mk(&f2, "dropbox"), mk(&f1, "onedrive")]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].confidence, "verified");
        assert!(groups[0].cross_cloud);
        assert_eq!(groups[0].files[0].path, f1.to_string_lossy());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
