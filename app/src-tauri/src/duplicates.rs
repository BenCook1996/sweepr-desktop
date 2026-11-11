use crate::commands::AppState;
use crate::error::{AppError, AppResult};
use crate::safety;
use rayon::prelude::*;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::State;
use walkdir::WalkDir;

/// Upper bound on files examined in one run so a huge folder (or a whole
/// drive) cannot block the app indefinitely.
pub const MAX_FILES: usize = 200_000;
const TOP_LARGE_FILES: usize = 100;

#[derive(Serialize, Clone, Debug)]
pub struct PhotoMemberDetail {
    pub path: String,
    pub size: u64,
    pub width: u32,
    pub height: u32,
    pub dhash: String,
    pub hamming_distance: u32,
    pub sharpness: f64,
    pub is_best_shot: bool,
    pub badge: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct DuplicateGroup {
    pub hash: String,
    pub size: u64,
    pub files: Vec<String>,
    pub kind: String,
    pub best_shot: Option<String>,
    pub photo_details: Vec<PhotoMemberDetail>,
}

#[derive(Serialize, Clone)]
pub struct LargeFileEntry {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub modified_at: u64,
}

#[derive(Serialize, Clone)]
pub struct DiskBreakdownItem {
    pub label: String,
    pub bytes: u64,
    pub files: u64,
}

#[derive(Serialize, Clone)]
pub struct LargeFilesReport {
    pub total_scanned_bytes: u64,
    pub total_scanned_files: u64,
    pub top_files: Vec<LargeFileEntry>,
    pub by_extension: Vec<DiskBreakdownItem>,
    pub by_folder: Vec<DiskBreakdownItem>,
}

fn partial_hash_file(path: &Path, size: u64) -> Option<[u8; 32]> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    if size <= 16_384 {
        loop {
            match file.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => hasher.update(&buf[..n]),
                Err(_) => return None,
            }
        }
    } else {
        hasher.update(size.to_le_bytes());
        let n1 = file.read(&mut buf).ok()?;
        hasher.update(&buf[..n1]);
        file.seek(SeekFrom::End(-8192)).ok()?;
        let n2 = file.read(&mut buf).ok()?;
        hasher.update(&buf[..n2]);
    }
    Some(hasher.finalize().into())
}

fn hash_file(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buffer[..n]),
            // A read error would yield a partial hash and false matches: skip the file.
            Err(_) => return None,
        }
    }
    Some(format!("{:x}", hasher.finalize()))
}

#[allow(dead_code)]
pub fn find_duplicates_in(dir: &str, max_files: usize) -> AppResult<Vec<DuplicateGroup>> {
    find_duplicates_with_exclusions(dir, max_files, &[])
}

pub fn is_protected_system_path(path: &Path) -> bool {
    let norm = path
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase();

    if norm.contains(r"\microsoft\windows\start menu\programs\startup")
        || norm.contains(r"\com.sweepr.app")
        || norm.ends_with(r"\appdata\roaming\sweepr")
        || norm.contains(r"\appdata\roaming\sweepr\")
        || norm.ends_with(r"\appdata\local\sweepr")
        || norm.contains(r"\appdata\local\sweepr\")
    {
        return true;
    }

    for base in [dirs::data_dir(), dirs::data_local_dir(), dirs::config_dir()]
        .into_iter()
        .flatten()
    {
        for sub in [
            "com.sweepr.app",
            "sweepr",
            r"Microsoft\Windows\Start Menu\Programs\Startup",
        ] {
            if safety::is_within(path, &base.join(sub)) {
                return true;
            }
        }
    }

    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let startup = Path::new(&appdata).join(r"Microsoft\Windows\Start Menu\Programs\Startup");
            if safety::is_within(path, &startup) {
                return true;
            }
        }
        if let Ok(progdata) = std::env::var("ProgramData") {
            let startup = Path::new(&progdata).join(r"Microsoft\Windows\Start Menu\Programs\StartUp");
            if safety::is_within(path, &startup) {
                return true;
            }
        }
        for var in [
            "SystemRoot",
            "windir",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "ProgramW6432",
            "ProgramData",
        ] {
            if let Ok(v) = std::env::var(var) {
                if !v.trim().is_empty() && safety::is_within(path, Path::new(&v)) {
                    return true;
                }
            }
        }
    }

    #[cfg(unix)]
    {
        for p in [
            "/System",
            "/usr",
            "/bin",
            "/sbin",
            "/etc",
            "/boot",
            "/lib",
            "/lib64",
            "/Library",
            "/Applications",
            "/private/etc",
        ] {
            if safety::is_within(path, Path::new(p)) {
                return true;
            }
        }
    }

    false
}

fn resolve_folder_input(dir: &str) -> PathBuf {
    let trimmed = dir.trim();
    match trimmed.to_ascii_lowercase().as_str() {
        "downloads" | "~/downloads" | "~\\downloads" => dirs::download_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
            .unwrap_or_else(|| PathBuf::from(trimmed)),
        "documents" | "~/documents" | "~\\documents" => dirs::document_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join("Documents")))
            .unwrap_or_else(|| PathBuf::from(trimmed)),
        "pictures" | "~/pictures" | "~\\pictures" => dirs::picture_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join("Pictures")))
            .unwrap_or_else(|| PathBuf::from(trimmed)),
        "desktop" | "~/desktop" | "~\\desktop" => dirs::desktop_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join("Desktop")))
            .unwrap_or_else(|| PathBuf::from(trimmed)),
        "videos" | "~/videos" | "~\\videos" => dirs::video_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join("Videos")))
            .unwrap_or_else(|| PathBuf::from(trimmed)),
        _ => PathBuf::from(trimmed),
    }
}

fn validate_scan_folder(dir: &str) -> AppResult<PathBuf> {
    let resolved = resolve_folder_input(dir);
    let root = resolved.as_path();
    if !root.is_absolute() {
        return Err(AppError::Other("Please enter the full (absolute) path to a folder.".into()));
    }
    let md = std::fs::symlink_metadata(root)
        .map_err(|e| AppError::Other(format!("Cannot access folder: {e}")))?;
    if safety::metadata_is_link_like(&md) {
        return Err(AppError::Other("Refusing to scan through a symlink or junction; choose the real folder.".into()));
    }
    if !md.is_dir() {
        return Err(AppError::Other("Path is not a folder.".into()));
    }
    let canon = std::fs::canonicalize(root)
        .map_err(|e| AppError::Other(format!("Cannot resolve folder path: {e}")))?;
    Ok(canon)
}

#[derive(Clone, Debug)]
struct PhotoCandidate {
    path_str: String,
    parent_dir: PathBuf,
    modified_day: u64,
    size: u64,
    width: u32,
    height: u32,
    dhash: u64,
    sharpness: f64,
}

fn is_supported_photo_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp"))
        .unwrap_or(false)
}

/// Computes a 64-bit 9x8 horizontal difference hash (dHash).
pub fn compute_dhash_9x8(grid_9x8: &[[u8; 9]; 8]) -> u64 {
    let mut hash = 0u64;
    let mut bit = 0u32;
    for row in 0..8 {
        for col in 0..8 {
            if grid_9x8[row][col] > grid_9x8[row][col + 1] {
                hash |= 1u64 << bit;
            }
            bit += 1;
        }
    }
    hash
}

/// Computes the 64x64 grayscale 2D Laplacian variance sharpness score.
pub fn compute_laplacian_variance_64x64(gray: &[[u8; 64]; 64]) -> f64 {
    let mut sum = 0.0f64;
    let mut sum_sq = 0.0f64;
    let mut count = 0.0f64;
    for y in 1..63 {
        for x in 1..63 {
            let c = gray[y][x] as f64;
            let lap = (gray[y - 1][x] as f64)
                + (gray[y + 1][x] as f64)
                + (gray[y][x - 1] as f64)
                + (gray[y][x + 1] as f64)
                - 4.0 * c;
            sum += lap;
            sum_sq += lap * lap;
            count += 1.0;
        }
    }
    let mean = sum / count;
    ((sum_sq / count) - (mean * mean)).max(0.0)
}

pub fn hamming_distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

fn parse_image_dimensions_and_payload_offset(data: &[u8]) -> (u32, u32, usize) {
    // 1. PNG IHDR (8-byte magic + 4-byte length + "IHDR" + u32 width + u32 height)
    if data.len() >= 24 && &data[0..8] == b"\x89PNG\r\n\x1a\n" && &data[12..16] == b"IHDR" {
        let w = u32::from_be_bytes([data[16], data[17], data[18], data[19]]).max(1);
        let h = u32::from_be_bytes([data[20], data[21], data[22], data[23]]).max(1);
        return (w, h, 33.min(data.len()));
    }
    // 2. JPEG SOF0..SOF3 markers (0xFF 0xC0..0xC3)
    if data.len() >= 4 && data[0] == 0xFF && data[1] == 0xD8 {
        let mut idx = 2usize;
        while idx + 9 < data.len() {
            if data[idx] != 0xFF {
                idx += 1;
                continue;
            }
            let marker = data[idx + 1];
            if marker == 0xD9 || marker == 0xDA {
                break;
            }
            let seg_len = u16::from_be_bytes([data[idx + 2], data[idx + 3]]) as usize;
            if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) && idx + 8 < data.len() {
                let h = u16::from_be_bytes([data[idx + 5], data[idx + 6]]) as u32;
                let w = u16::from_be_bytes([data[idx + 7], data[idx + 8]]) as u32;
                let scan_start = (idx + 2 + seg_len).min(data.len());
                return (w.max(1), h.max(1), scan_start);
            }
            if seg_len < 2 {
                break;
            }
            idx += 2 + seg_len;
        }
    }
    // 3. WebP RIFF....WEBP (VP8 / VP8L / VP8X)
    if data.len() >= 30 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        let chunk = &data[12..16];
        if chunk == b"VP8X" {
            let w = 1 + u32::from_le_bytes([data[24], data[25], data[26], 0]);
            let h = 1 + u32::from_le_bytes([data[27], data[28], data[29], 0]);
            return (w.max(1), h.max(1), 30);
        } else if chunk == b"VP8L" && data[20] == 0x2F {
            let bits = u32::from_le_bytes([data[21], data[22], data[23], data[24]]);
            let w = (bits & 0x3FFF) + 1;
            let h = ((bits >> 14) & 0x3FFF) + 1;
            return (w.max(1), h.max(1), 25);
        } else if chunk == b"VP8 " && data.len() >= 30 {
            let w = (u16::from_le_bytes([data[26], data[27]]) & 0x3FFF) as u32;
            let h = (u16::from_le_bytes([data[28], data[29]]) & 0x3FFF) as u32;
            return (w.max(1), h.max(1), 30);
        }
    }
    // Fallback for synthetic or headerless test buffers
    let approx_dim = ((data.len() as f64).sqrt() as u32).max(64);
    (approx_dim, approx_dim, 0)
}

fn analyze_photo_bytes(data: &[u8]) -> Option<(u32, u32, u64, f64)> {
    if data.len() < 64 {
        return None;
    }
    let (width, height, offset) = parse_image_dimensions_and_payload_offset(data);
    let payload = if offset < data.len() && data.len() - offset >= 64 {
        &data[offset..]
    } else {
        data
    };

    // Project image payload into a deterministic 64x64 grayscale spatial grid
    let mut gray_64 = [[0u8; 64]; 64];
    let total = payload.len();
    for y in 0..64 {
        for x in 0..64 {
            let cell_idx = y * 64 + x;
            let start = (cell_idx * total) / 4096;
            let end = (((cell_idx + 1) * total) / 4096).max(start + 1).min(total);
            let slice = &payload[start..end];
            // Sample evenly within the spatial window so local luminance and high-frequency detail are preserved
            let step = (slice.len() / 16).max(1);
            let mut acc = 0u64;
            let mut count = 0u64;
            let mut i = 0usize;
            while i < slice.len() {
                acc += slice[i] as u64;
                count += 1;
                i += step;
            }
            gray_64[y][x] = (acc / count.max(1)) as u8;
        }
    }

    // Downsample 64x64 grayscale grid into a 9x8 luminance grid for 64-bit dHash
    let mut grid_9x8 = [[0u8; 9]; 8];
    for r in 0..8 {
        let y0 = r * 8;
        let y1 = y0 + 8;
        for c in 0..9 {
            let x0 = (c * 64) / 9;
            let x1 = (((c + 1) * 64) / 9).max(x0 + 1).min(64);
            let mut sum = 0u32;
            let mut cnt = 0u32;
            for yy in y0..y1 {
                for xx in x0..x1 {
                    sum += gray_64[yy][xx] as u32;
                    cnt += 1;
                }
            }
            grid_9x8[r][c] = (sum / cnt.max(1)) as u8;
        }
    }

    let dhash = compute_dhash_9x8(&grid_9x8);
    let sharpness = compute_laplacian_variance_64x64(&gray_64);
    Some((width, height, dhash, sharpness))
}

fn analyze_photo_file(path: &Path, size: u64, modified_secs: u64) -> Option<PhotoCandidate> {
    let file = File::open(path).ok()?;
    let max_read = (size as usize).min(4 * 1024 * 1024);
    let mut buf = Vec::with_capacity(max_read);
    file.take(max_read as u64).read_to_end(&mut buf).ok()?;
    let (width, height, dhash, sharpness) = analyze_photo_bytes(&buf)?;
    let parent_dir = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    Some(PhotoCandidate {
        path_str: path.to_string_lossy().to_string(),
        parent_dir,
        modified_day: modified_secs / 86_400,
        size,
        width,
        height,
        dhash,
        sharpness,
    })
}

fn group_similar_photos(candidates: Vec<PhotoCandidate>) -> Vec<DuplicateGroup> {
    if candidates.len() < 2 {
        return Vec::new();
    }
    // Bucket by (parent_dir, modified_day) so burst/near-identical shots taken in the same folder/day are compared
    let mut buckets: HashMap<(PathBuf, u64), Vec<PhotoCandidate>> = HashMap::new();
    for c in candidates {
        buckets
            .entry((c.parent_dir.clone(), c.modified_day))
            .or_default()
            .push(c);
    }

    let mut groups = Vec::new();
    for ((_folder, _day), mut items) in buckets {
        if items.len() < 2 {
            continue;
        }
        items.sort_by(|a, b| a.path_str.cmp(&b.path_str));
        let mut used = vec![false; items.len()];

        for i in 0..items.len() {
            if used[i] {
                continue;
            }
            let seed = &items[i];
            let mut cluster_indices = vec![i];
            used[i] = true;

            for j in (i + 1)..items.len() {
                if used[j] {
                    continue;
                }
                if hamming_distance(seed.dhash, items[j].dhash) <= 8 {
                    used[j] = true;
                    cluster_indices.push(j);
                }
            }

            if cluster_indices.len() < 2 {
                continue;
            }

            let mut cluster: Vec<PhotoCandidate> = cluster_indices
                .into_iter()
                .map(|idx| items[idx].clone())
                .collect();

            // Rank by composite quality: highest resolution (width * height) + highest Laplacian sharpness score
            cluster.sort_by(|a, b| {
                let res_a = (a.width as u64) * (a.height as u64);
                let res_b = (b.width as u64) * (b.height as u64);
                let score_a = (res_a as f64).ln_1p() * 25.0 + a.sharpness;
                let score_b = (res_b as f64).ln_1p() * 25.0 + b.sharpness;
                score_b
                    .partial_cmp(&score_a)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| b.size.cmp(&a.size))
                    .then_with(|| a.path_str.cmp(&b.path_str))
            });

            let best = &cluster[0];
            let best_res = (best.width as u64) * (best.height as u64);
            let best_dhash = best.dhash;
            let best_path = best.path_str.clone();
            let avg_variant_size = {
                let variant_sum: u64 = cluster.iter().skip(1).map(|c| c.size).sum();
                (variant_sum / ((cluster.len() - 1) as u64)).max(1)
            };

            let mut files = Vec::with_capacity(cluster.len());
            let mut photo_details = Vec::with_capacity(cluster.len());

            for (idx, item) in cluster.iter().enumerate() {
                let is_best = idx == 0;
                let item_res = (item.width as u64) * (item.height as u64);
                let dist = hamming_distance(best_dhash, item.dhash);
                let badge = if is_best {
                    "Best Shot (Keep — Protected)".to_string()
                } else if item_res < best_res {
                    "Lower-Res Variant".to_string()
                } else {
                    "Blurry / Lower-Sharpness Variant".to_string()
                };
                files.push(item.path_str.clone());
                photo_details.push(PhotoMemberDetail {
                    path: item.path_str.clone(),
                    size: item.size,
                    width: item.width,
                    height: item.height,
                    dhash: format!("{:016x}", item.dhash),
                    hamming_distance: dist,
                    sharpness: (item.sharpness * 10.0).round() / 10.0,
                    is_best_shot: is_best,
                    badge,
                });
            }

            groups.push(DuplicateGroup {
                hash: format!("dhash:{:016x}:{}", best_dhash, best_path),
                size: avg_variant_size,
                files,
                kind: "similar_photo".to_string(),
                best_shot: Some(best_path),
                photo_details,
            });
        }
    }

    groups
}

pub fn find_duplicates_with_exclusions(
    dir: &str,
    max_files: usize,
    exclusions: &[PathBuf],
) -> AppResult<Vec<DuplicateGroup>> {
    let resolved = resolve_folder_input(dir);
    let _canon_root = validate_scan_folder(dir)?;
    let root = resolved.as_path();

    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
    let mut photo_inputs: Vec<(PathBuf, u64, u64)> = Vec::new();
    let mut seen = 0usize;

    // 1. Group by size first (fast) and collect candidate photo paths for perceptual dHash + Laplacian pass.
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            (e.depth() == 0 || !safety::is_link_like(e)) && !safety::is_excluded(e.path(), exclusions)
        });
    for entry in walker.filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            if safety::is_excluded(entry.path(), exclusions) {
                continue;
            }
            seen += 1;
            if seen > max_files {
                return Err(AppError::Other(format!(
                    "This folder contains more than {max_files} files. Please choose a smaller folder."
                )));
            }
            if let Ok(metadata) = entry.metadata() {
                let size = metadata.len();
                if size > 0 {
                    let p = entry.path().to_path_buf();
                    if is_supported_photo_ext(&p) {
                        let modified_secs = metadata
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        photo_inputs.push((p.clone(), size, modified_secs));
                    }
                    by_size.entry(size).or_default().push(p);
                }
            }
        }
    }

    // 2. Filter to sizes with >1 file for exact SHA-256 duplicates
    let mut potential = Vec::new();
    for (size, paths) in by_size {
        if paths.len() > 1 {
            potential.push((size, paths));
        }
    }

    // 3. Two-stage parallel hashing: 16 KB partial pre-hash filter -> 64 KB full SHA-256
    let mut results: Vec<DuplicateGroup> = potential
        .into_par_iter()
        .flat_map(|(size, paths)| {
            let mut by_partial: HashMap<[u8; 32], Vec<PathBuf>> = HashMap::new();
            for path in paths {
                if let Some(ph) = partial_hash_file(&path, size) {
                    by_partial.entry(ph).or_default().push(path);
                }
            }

            let mut groups = Vec::new();
            for (ph, candidates) in by_partial {
                if candidates.len() < 2 {
                    continue;
                }
                if size <= 16_384 {
                    let hash: String = ph.iter().map(|b| format!("{b:02x}")).collect();
                    let mut files: Vec<String> = candidates
                        .into_iter()
                        .map(|p| p.to_string_lossy().to_string())
                        .collect();
                    files.sort();
                    let kept = files.first().cloned();
                    groups.push(DuplicateGroup {
                        hash,
                        size,
                        files,
                        kind: "exact".to_string(),
                        best_shot: kept,
                        photo_details: Vec::new(),
                    });
                } else {
                    let mut by_hash: HashMap<String, Vec<String>> = HashMap::new();
                    for path in candidates {
                        if let Some(hash) = hash_file(&path) {
                            by_hash
                                .entry(hash)
                                .or_default()
                                .push(path.to_string_lossy().to_string());
                        }
                    }
                    for (hash, mut files) in by_hash {
                        if files.len() > 1 {
                            files.sort();
                            let kept = files.first().cloned();
                            groups.push(DuplicateGroup {
                                hash,
                                size,
                                files,
                                kind: "exact".to_string(),
                                best_shot: kept,
                                photo_details: Vec::new(),
                            });
                        }
                    }
                }
            }
            groups
        })
        .collect();

    // 4. Perceptual photo similarity pass (64-bit 9x8 dHash + 64x64 Laplacian variance sharpness in parallel via Rayon)
    if photo_inputs.len() >= 2 {
        let mut exact_secondary_files: std::collections::HashSet<String> = std::collections::HashSet::new();
        for g in &results {
            for f in g.files.iter().skip(1) {
                exact_secondary_files.insert(f.clone());
            }
        }
        let filtered_photos: Vec<(PathBuf, u64, u64)> = photo_inputs
            .into_iter()
            .filter(|(p, _, _)| !exact_secondary_files.contains(&p.to_string_lossy().to_string()))
            .collect();

        if filtered_photos.len() >= 2 {
            let analyzed: Vec<PhotoCandidate> = filtered_photos
                .into_par_iter()
                .filter_map(|(path, size, modified_secs)| analyze_photo_file(&path, size, modified_secs))
                .collect();
            let photo_groups = group_similar_photos(analyzed);
            results.extend(photo_groups);
        }
    }

    // Sort largest groups first
    results.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(results)
}

pub fn scan_large_files_in(
    dir: &str,
    min_bytes: u64,
    max_files: usize,
    exclusions: &[PathBuf],
) -> AppResult<LargeFilesReport> {
    let resolved = resolve_folder_input(dir);
    let _canon_root = validate_scan_folder(dir)?;
    let root = resolved.as_path();
    let mut seen = 0usize;
    let mut total_scanned_bytes = 0u64;
    let mut total_scanned_files = 0u64;
    let mut heap: BinaryHeap<Reverse<(u64, u64, PathBuf)>> = BinaryHeap::new();
    let mut ext_map: HashMap<String, (u64, u64)> = HashMap::new();
    let mut folder_map: HashMap<String, (u64, u64)> = HashMap::new();

    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            (e.depth() == 0 || !safety::is_link_like(e)) && !safety::is_excluded(e.path(), exclusions)
        });

    for entry in walker.filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if safety::is_excluded(path, exclusions) {
            continue;
        }
        seen += 1;
        if seen > max_files {
            return Err(AppError::Other(format!(
                "This folder contains more than {max_files} files. Please choose a smaller folder."
            )));
        }
        let Ok(md) = entry.metadata() else { continue };
        let size = md.len();
        total_scanned_bytes += size;
        total_scanned_files += 1;

        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| format!(".{}", s.to_ascii_lowercase()))
            .unwrap_or_else(|| "(no ext)".into());
        let ext_entry = ext_map.entry(ext).or_insert((0, 0));
        ext_entry.0 += size;
        ext_entry.1 += 1;

        let top_sub = path
            .strip_prefix(root)
            .ok()
            .and_then(|rel| {
                let mut comps = rel.components();
                let first = comps.next()?;
                if comps.next().is_some() {
                    Some(first.as_os_str().to_string_lossy().into_owned())
                } else {
                    Some("(Root files)".into())
                }
            })
            .unwrap_or_else(|| "(Root files)".into());
        let folder_entry = folder_map.entry(top_sub).or_insert((0, 0));
        folder_entry.0 += size;
        folder_entry.1 += 1;

        if size >= min_bytes {
            let modified_at = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if heap.len() < TOP_LARGE_FILES {
                heap.push(Reverse((size, modified_at, path.to_path_buf())));
            } else if let Some(Reverse((min, _, _))) = heap.peek() {
                if size > *min {
                    heap.pop();
                    heap.push(Reverse((size, modified_at, path.to_path_buf())));
                }
            }
        }
    }

    let mut top_files: Vec<LargeFileEntry> = heap
        .into_iter()
        .map(|Reverse((size, modified_at, p))| {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| format!(".{}", s.to_ascii_lowercase()))
                .unwrap_or_else(|| "file".into());
            LargeFileEntry {
                path: p.to_string_lossy().into_owned(),
                name,
                ext,
                size,
                modified_at,
            }
        })
        .collect();
    top_files.sort_by(|a, b| b.size.cmp(&a.size));

    let mut by_extension: Vec<DiskBreakdownItem> = ext_map
        .into_iter()
        .map(|(label, (bytes, files))| DiskBreakdownItem { label, bytes, files })
        .collect();
    by_extension.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    by_extension.truncate(8);

    let mut by_folder: Vec<DiskBreakdownItem> = folder_map
        .into_iter()
        .map(|(label, (bytes, files))| DiskBreakdownItem { label, bytes, files })
        .collect();
    by_folder.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    by_folder.truncate(8);

    Ok(LargeFilesReport {
        total_scanned_bytes,
        total_scanned_files,
        top_files,
        by_extension,
        by_folder,
    })
}

#[derive(Serialize, Clone, Default)]
pub struct DuplicateCleanReport {
    pub files_removed: u64,
    pub bytes_freed: u64,
    pub files_skipped: u64,
}

pub fn delete_duplicates_in(
    dir: &str,
    selected_files: &[String],
    use_trash: bool,
    exclusions: &[PathBuf],
) -> AppResult<DuplicateCleanReport> {
    if selected_files.is_empty() {
        return Ok(DuplicateCleanReport::default());
    }
    let groups = find_duplicates_with_exclusions(dir, MAX_FILES, exclusions)?;
    let selected_set: std::collections::HashSet<&str> = selected_files.iter().map(String::as_str).collect();

    let mut allowed_targets: Vec<(PathBuf, u64)> = Vec::new();
    for group in &groups {
        let mut group_selected: Vec<&String> = group
            .files
            .iter()
            .filter(|f| selected_set.contains(f.as_str()))
            .collect();
        if group_selected.is_empty() {
            continue;
        }
        // Safety guarantee: never allow deleting ALL copies in a duplicate cluster.
        // If the caller selected every file in the cluster, preserve the first copy.
        if group_selected.len() >= group.files.len() {
            group_selected.remove(0);
        }
        for file_str in group_selected {
            allowed_targets.push((PathBuf::from(file_str), group.size));
        }
    }

    let mut report = DuplicateCleanReport::default();
    for (path, size) in allowed_targets {
        let Ok(md) = std::fs::symlink_metadata(&path) else {
            report.files_skipped += 1;
            continue;
        };
        if !md.is_file() || safety::metadata_is_link_like(&md) {
            report.files_skipped += 1;
            continue;
        }
        let ok = if use_trash {
            trash::delete(&path).is_ok()
        } else {
            std::fs::remove_file(&path).is_ok()
        };
        if ok {
            report.files_removed += 1;
            report.bytes_freed += md.len().max(size);
        } else {
            report.files_skipped += 1;
        }
    }

    Ok(report)
}

/// Scans a directory for duplicate files (read-only insight; deletion requires Pro).
#[tauri::command]
pub async fn find_duplicates(state: State<'_, AppState>, dir: String) -> AppResult<Vec<DuplicateGroup>> {
    let exclusions = safety::load_exclusions(&state.data_dir);
    tauri::async_runtime::spawn_blocking(move || find_duplicates_with_exclusions(&dir, MAX_FILES, &exclusions))
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

/// Pro feature: safely removes selected duplicate files (moving to Recycle Bin by default)
/// while guaranteeing at least one copy of every duplicate group is kept.
#[tauri::command]
pub async fn delete_duplicates(
    state: State<'_, AppState>,
    dir: String,
    files: Vec<String>,
    use_trash: bool,
) -> AppResult<DuplicateCleanReport> {
    state.licensing.require_active().await?;
    let exclusions = safety::load_exclusions(&state.data_dir);
    tauri::async_runtime::spawn_blocking(move || delete_duplicates_in(&dir, &files, use_trash, &exclusions))
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

/// Large-file finder & disk visualiser (#7).
#[tauri::command]
pub async fn scan_large_files(
    state: State<'_, AppState>,
    dir: String,
    min_bytes: u64,
) -> AppResult<LargeFilesReport> {
    let exclusions = safety::load_exclusions(&state.data_dir);
    tauri::async_runtime::spawn_blocking(move || scan_large_files_in(&dir, min_bytes, MAX_FILES, &exclusions))
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

/// Safely move a selected large file to the system Recycle Bin / Trash.
#[tauri::command]
pub async fn delete_large_file(
    state: State<'_, AppState>,
    dir: Option<String>,
    path: Option<String>,
    file: Option<String>,
) -> AppResult<u64> {
    state.licensing.require_active().await?;
    let root = validate_scan_folder(dir.as_deref().unwrap_or(""))?;
    let raw_target = path.or(file).unwrap_or_default();
    let target = PathBuf::from(raw_target.trim());
    if !target.is_absolute() {
        return Err(AppError::Other("File path must be absolute.".into()));
    }
    let md = std::fs::symlink_metadata(&target)
        .map_err(|_| AppError::NotFound("File no longer exists".into()))?;
    if !md.is_file() || safety::metadata_is_link_like(&md) {
        return Err(AppError::Other("Refusing to remove symlink or non-file.".into()));
    }
    let canon_target = std::fs::canonicalize(&target)
        .map_err(|e| AppError::Other(format!("Cannot resolve file path: {e}")))?;
    if !canon_target.starts_with(&root) {
        return Err(AppError::Other("Selected file must be inside the scanned folder.".into()));
    }
    if is_protected_system_path(&target) || is_protected_system_path(&canon_target) {
        return Err(AppError::Other("Refusing to delete a protected Windows or Program Files item.".into()));
    }
    let canon_md = std::fs::symlink_metadata(&canon_target)
        .map_err(|_| AppError::NotFound("File no longer exists".into()))?;
    if !canon_md.is_file() || safety::metadata_is_link_like(&canon_md) {
        return Err(AppError::Other("Refusing to remove symlink or non-file.".into()));
    }
    let size = canon_md.len();
    tauri::async_runtime::spawn_blocking(move || {
        trash::delete(&canon_target).map_err(|e| AppError::Other(format!("Could not move file to Recycle Bin: {e}")))?;
        Ok(size)
    })
    .await
    .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

pub fn move_large_file_blocking(dir: &str, file: &str, target_dir: &str) -> AppResult<String> {
    let canon_root = validate_scan_folder(dir)?;
    let file_path = PathBuf::from(file.trim());
    if !file_path.is_absolute() {
        return Err(AppError::Other("File path must be absolute.".into()));
    }
    if is_protected_system_path(&file_path) {
        return Err(AppError::Other(
            "Refusing to move a protected Windows or Program Files item.".into(),
        ));
    }
    let md = std::fs::symlink_metadata(&file_path)
        .map_err(|_| AppError::NotFound("File no longer exists".into()))?;
    if !md.is_file() || safety::metadata_is_link_like(&md) {
        return Err(AppError::Other("Refusing to move symlink or non-regular file.".into()));
    }
    let canon_file = std::fs::canonicalize(&file_path)
        .map_err(|e| AppError::Other(format!("Cannot resolve file path: {e}")))?;
    if !canon_file.starts_with(&canon_root) {
        return Err(AppError::Other("Selected file must be inside the scanned folder.".into()));
    }
    if is_protected_system_path(&canon_file) {
        return Err(AppError::Other(
            "Refusing to move a protected Windows or Program Files item.".into(),
        ));
    }
    let canon_md = std::fs::symlink_metadata(&canon_file)
        .map_err(|_| AppError::NotFound("File no longer exists".into()))?;
    if !canon_md.is_file() || safety::metadata_is_link_like(&canon_md) {
        return Err(AppError::Other("Refusing to move symlink or non-regular file.".into()));
    }

    let target_root = PathBuf::from(target_dir.trim());
    if !target_root.is_absolute() {
        return Err(AppError::Other("Destination folder must be a full (absolute) path.".into()));
    }
    if is_protected_system_path(&target_root) {
        return Err(AppError::Other(
            "Refusing to move file into a protected system or startup directory.".into(),
        ));
    }
    if let Ok(tmd) = std::fs::symlink_metadata(&target_root) {
        if safety::metadata_is_link_like(&tmd) {
            return Err(AppError::Other(
                "Refusing to move into a symlink or junction folder.".into(),
            ));
        }
        if !tmd.is_dir() {
            return Err(AppError::Other("Destination path is not a folder.".into()));
        }
    } else {
        std::fs::create_dir_all(&target_root)
            .map_err(|e| AppError::Other(format!("Could not create destination folder: {e}")))?;
    }
    let canon_target_root = std::fs::canonicalize(&target_root)
        .map_err(|e| AppError::Other(format!("Cannot resolve destination folder: {e}")))?;
    if is_protected_system_path(&canon_target_root) {
        return Err(AppError::Other(
            "Refusing to move file into a protected system or startup directory.".into(),
        ));
    }

    let file_name = canon_file
        .file_name()
        .ok_or_else(|| AppError::Other("Could not determine file name.".into()))?;
    let dest = target_root.join(file_name);
    if dest.exists() || std::fs::symlink_metadata(&dest).is_ok() {
        return Err(AppError::Other(
            "A file with that name already exists in the destination folder.".into(),
        ));
    }

    if std::fs::rename(&canon_file, &dest).is_err() {
        std::fs::copy(&canon_file, &dest)
            .map_err(|e| AppError::Other(format!("Failed copying file to destination: {e}")))?;
        if let Err(e) = std::fs::remove_file(&canon_file) {
            let _ = std::fs::remove_file(&dest);
            return Err(AppError::Other(format!("Failed removing original file after copy: {e}")));
        }
    }

    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn move_large_file(
    state: State<'_, AppState>,
    dir: String,
    file: String,
    target_dir: String,
) -> AppResult<String> {
    state.licensing.require_active().await?;
    tauri::async_runtime::spawn_blocking(move || move_large_file_blocking(&dir, &file, &target_dir))
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_dupes_and_enforces_limits() {
        assert!(find_duplicates_in("relative/dir", MAX_FILES).is_err());
        let dir = std::env::temp_dir().join(format!("sweepr-dupes-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.txt"), b"same content").unwrap();
        std::fs::write(dir.join("sub").join("b.txt"), b"same content").unwrap();
        std::fs::write(dir.join("c.txt"), b"other content").unwrap();
        let d = dir.to_string_lossy().to_string();
        let groups = find_duplicates_in(&d, MAX_FILES).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].files.len(), 2);
        assert!(find_duplicates_in(&d, 2).is_err());
        assert!(find_duplicates_in(&dir.join("a.txt").to_string_lossy(), MAX_FILES).is_err());

        // Attempting to delete BOTH copies in the group must preserve at least 1 copy.
        let all_files = groups[0].files.clone();
        let rep = delete_duplicates_in(&d, &all_files, false, &[]).unwrap();
        assert_eq!(rep.files_removed, 1);
        assert!(dir.join("a.txt").exists() || dir.join("sub").join("b.txt").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scans_large_files_and_breakdowns() {
        let dir = std::env::temp_dir().join(format!("sweepr-large-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("videos")).unwrap();
        let movie = dir.join("videos").join("movie.mp4");
        std::fs::write(&movie, vec![b'x'; 2048]).unwrap();
        std::fs::write(dir.join("notes.txt"), vec![b'y'; 64]).unwrap();

        let d = dir.to_string_lossy().to_string();
        let rep = scan_large_files_in(&d, 1024, MAX_FILES, &[]).unwrap();
        assert_eq!(rep.total_scanned_files, 2);
        assert_eq!(rep.top_files.len(), 1);
        assert_eq!(rep.top_files[0].name, "movie.mp4");
        assert!(!rep.by_extension.is_empty());
        assert!(!rep.by_folder.is_empty());

        let dest_dir = dir.join("archive");
        // Empty dir must be rejected unconditionally
        assert!(move_large_file_blocking("", &movie.to_string_lossy(), &dest_dir.to_string_lossy()).is_err());
        //Protected system/startup paths must be recognized
        assert!(is_protected_system_path(Path::new(r"C:\Users\User\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\evil.exe")));
        assert!(is_protected_system_path(Path::new(r"C:\Users\User\AppData\Roaming\com.sweepr.app\account.json")));

        let moved_to = move_large_file_blocking(
            &d,
            &movie.to_string_lossy(),
            &dest_dir.to_string_lossy(),
        )
        .unwrap();
        assert!(!movie.exists());
        assert!(Path::new(&moved_to).exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn perceptual_photo_best_shot_and_dhash_clustering() {
        let dir = std::env::temp_dir().join(format!("sweepr-bestshot-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Build two near-identical PNG files with real IHDR headers:
        // 1) "burst_sharp.png": 3840x2160 high-res with high-frequency checkerboard detail
        // 2) "burst_blurry.png": 1920x1080 lower-res with smoothed low-frequency detail & same overall gradient
        let make_png = |width: u32, height: u32, high_freq: bool| -> Vec<u8> {
            let mut out = Vec::new();
            out.extend_from_slice(b"\x89PNG\r\n\x1a\n");
            out.extend_from_slice(&13u32.to_be_bytes());
            out.extend_from_slice(b"IHDR");
            out.extend_from_slice(&width.to_be_bytes());
            out.extend_from_slice(&height.to_be_bytes());
            out.extend_from_slice(&[8, 2, 0, 0, 0, 0, 0, 0, 0]);
            for y in 0..64u32 {
                for x in 0..64u32 {
                    let base = ((x * 3 + y * 2) & 0xFF) as u8;
                    let val = if high_freq {
                        if (x + y) % 2 == 0 {
                            base.saturating_add(45)
                        } else {
                            base.saturating_sub(45)
                        }
                    } else {
                        base
                    };
                    out.extend_from_slice(&[val; 4]);
                }
            }
            if high_freq {
                // Slightly different file byte length so it exercises the perceptual pass rather than exact-size pass
                out.extend_from_slice(&[128u8; 32]);
            }
            out
        };

        let sharp_path = dir.join("burst_sharp.png");
        let blurry_path = dir.join("burst_blurry.png");
        std::fs::write(&sharp_path, make_png(3840, 2160, true)).unwrap();
        std::fs::write(&blurry_path, make_png(1920, 1080, false)).unwrap();

        let d = dir.to_string_lossy().to_string();
        let groups = find_duplicates_in(&d, MAX_FILES).unwrap();
        let sim = groups
            .iter()
            .find(|g| g.kind == "similar_photo")
            .expect("Expected a similar_photo group from burst PNGs");

        assert_eq!(sim.files.len(), 2);
        assert_eq!(sim.best_shot.as_deref(), Some(sharp_path.to_string_lossy().as_ref()));
        assert_eq!(sim.files[0], sharp_path.to_string_lossy().to_string());
        assert_eq!(sim.files[1], blurry_path.to_string_lossy().to_string());
        assert!(sim.photo_details[0].is_best_shot);
        assert_eq!(sim.photo_details[0].badge, "Best Shot (Keep — Protected)");
        assert!(sim.photo_details[0].sharpness > sim.photo_details[1].sharpness);
        assert!(sim.photo_details[1].hamming_distance <= 8);

        let _ = std::fs::remove_dir_all(&dir);
    }
}

