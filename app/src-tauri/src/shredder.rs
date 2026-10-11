//! Secure File Deletion (DoD 5220.22-M 3-pass shredder)
use std::fs::OpenOptions;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

#[tauri::command]
pub fn shred_file(path: String) -> Result<u64, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err("Target is not a valid file".into());
    }

    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    let len = meta.len();
    if len == 0 {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
        return Ok(0);
    }

    let mut file = OpenOptions::new()
        .write(true)
        .open(p)
        .map_err(|e| e.to_string())?;

    let chunk_size = 64 * 1024; // 64 KB chunks
    let passes: [u8; 3] = [0x00, 0xFF, 0x55]; // Pass 1: Zeros, Pass 2: Ones, Pass 3: Pattern

    for pattern in passes {
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let buf = vec![pattern; chunk_size];
        let mut written = 0u64;
        while written < len {
            let to_write = std::cmp::min(chunk_size as u64, len - written) as usize;
            file.write_all(&buf[..to_write]).map_err(|e| e.to_string())?;
            written += to_write as u64;
        }
        file.sync_data().map_err(|e| e.to_string())?;
    }

    drop(file);
    std::fs::remove_file(p).map_err(|e| e.to_string())?;
    Ok(len)
}
