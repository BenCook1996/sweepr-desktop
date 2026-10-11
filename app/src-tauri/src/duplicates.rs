use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::PathBuf;
use walkdir::WalkDir;
use sha2::{Digest, Sha256};

#[derive(Serialize)]
pub struct DuplicateGroup {
    pub hash: String,
    pub size: u64,
    pub files: Vec<String>,
}

#[tauri::command]
pub fn find_duplicates(dir: String) -> Result<Vec<DuplicateGroup>, String> {
    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();

    // 1. Group by size first (fast)
    for entry in WalkDir::new(&dir).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            if let Ok(metadata) = entry.metadata() {
                let size = metadata.len();
                if size > 0 {
                    by_size.entry(size).or_default().push(entry.path().to_path_buf());
                }
            }
        }
    }

    // 2. Filter to sizes with >1 file
    let mut potential = Vec::new();
    for (size, paths) in by_size {
        if paths.len() > 1 {
            potential.push((size, paths));
        }
    }

    // 3. Group by full hash for remaining
    let mut results = Vec::new();
    for (size, paths) in potential {
        let mut by_hash: HashMap<String, Vec<String>> = HashMap::new();
        for path in paths {
            if let Ok(mut file) = File::open(&path) {
                let mut hasher = Sha256::new();
                let mut buffer = [0; 8192];
                while let Ok(n) = file.read(&mut buffer) {
                    if n == 0 {
                        break;
                    }
                    hasher.update(&buffer[..n]);
                }
                let hash = format!("{:x}", hasher.finalize());
                by_hash
                    .entry(hash)
                    .or_default()
                    .push(path.to_string_lossy().to_string());
            }
        }

        for (hash, files) in by_hash {
            if files.len() > 1 {
                results.push(DuplicateGroup { hash, size, files });
            }
        }
    }

    // Sort largest groups first
    results.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(results)
}
