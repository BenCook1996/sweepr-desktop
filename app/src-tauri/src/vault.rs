//! Photo & Document Vault: password-protects files *inside* the user's existing
//! cloud folder (or anywhere) so the provider only ever stores ciphertext.
//!
//! Format (`.swvault`), all integers little-endian unless noted:
//! ```text
//! header  = "SWVAULT1" | m_cost u32 | t_cost u32 | p_cost u32 | salt[16] | nonce_prefix[7]
//! record  = len u32 | AES-256-GCM ciphertext (AAD = header)
//! nonce   = nonce_prefix[7] | counter u32 (big-endian) | last_flag u8
//! ```
//! Record 0 holds JSON metadata (original name, size, mtime). Data follows in
//! 1 MiB chunks; the final chunk carries `last_flag = 1`, so truncation or
//! reordering is detected (STREAM construction). Keys come from Argon2id.
//!
//! Honest limits: shredding the plaintext original is best-effort (see
//! `shredder.rs`), and cloud providers may keep earlier plaintext versions in
//! their version history / recycle bin until those expire or are emptied.

use crate::error::{AppError, AppResult};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const VAULT_EXT: &str = "swvault";
const MAGIC: &[u8; 8] = b"SWVAULT1";
const HEADER_LEN: usize = 8 + 12 + 16 + 7;
const CHUNK: usize = 1024 * 1024;
const MAX_RECORD: usize = CHUNK + 16;
const M_COST_KIB: u32 = 64 * 1024;
const T_COST: u32 = 3;
const P_COST: u32 = 1;
pub const MIN_PASSWORD_LEN: usize = 8;

#[derive(Serialize, Deserialize, Clone, Debug)]
struct VaultMeta {
    name: String,
    size: u64,
    modified_at: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct VaultEntry {
    pub vault_path: String,
    pub original_name: String,
    pub size: u64,
    pub modified_at: u64,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct VaultReport {
    pub processed: Vec<VaultEntry>,
    pub originals_removed: u64,
    pub bytes: u64,
    pub skipped: Vec<String>,
}

fn err(msg: impl Into<String>) -> AppError {
    AppError::Other(msg.into())
}

fn derive_key(password: &str, salt: &[u8], m: u32, t: u32, p: u32) -> AppResult<Aes256Gcm> {
    // Bound the parameters we accept from a file header so a crafted vault
    // cannot make us allocate gigabytes.
    if m > 1024 * 1024 || t > 10 || p > 8 {
        return Err(err("Unsupported vault parameters."));
    }
    let params = Params::new(m, t, p, Some(32)).map_err(|e| err(format!("argon2: {e}")))?;
    let mut key = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| err(format!("argon2: {e}")))?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| err("Invalid key length."))?;
    key.fill(0);
    Ok(cipher)
}

fn nonce_for(prefix: &[u8; 7], counter: u32, last: bool) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[..7].copy_from_slice(prefix);
    n[7..11].copy_from_slice(&counter.to_be_bytes());
    n[11] = last as u8;
    n
}

fn write_record(out: &mut impl Write, cipher: &Aes256Gcm, aad: &[u8], prefix: &[u8; 7], counter: u32, last: bool, plain: &[u8]) -> AppResult<()> {
    let nonce = nonce_for(prefix, counter, last);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: plain, aad })
        .map_err(|_| err("Encryption failed."))?;
    out.write_all(&(ct.len() as u32).to_le_bytes())?;
    out.write_all(&ct)?;
    Ok(())
}

/// Reads one record. Returns `None` at clean EOF.
fn read_record(input: &mut impl Read) -> AppResult<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match input.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u32::from_le_bytes(len) as usize;
    if len < 16 || len > MAX_RECORD.max(64 * 1024) {
        return Err(err("Vault file is corrupted."));
    }
    let mut buf = vec![0u8; len];
    input.read_exact(&mut buf).map_err(|_| err("Vault file is truncated."))?;
    Ok(Some(buf))
}

fn random_name() -> String {
    let mut id = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut id);
    id.iter().map(|b| format!("{b:02x}")).collect()
}

fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(file_name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..1000)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|c| !c.exists())
        .unwrap_or_else(|| dir.join(format!("{stem}-{}{ext}", random_name())))
}

/// Encrypts `src` into `dest_dir` (or next to the source). Returns the vault path.
pub fn encrypt_file(src: &Path, password: &str, dest_dir: Option<&Path>) -> AppResult<VaultEntry> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(err(format!("Use a password of at least {MIN_PASSWORD_LEN} characters.")));
    }
    let md = std::fs::metadata(src)?;
    if !md.is_file() {
        return Err(err("Not a regular file."));
    }
    if src.extension().map(|e| e.eq_ignore_ascii_case(VAULT_EXT)).unwrap_or(false) {
        return Err(err("File is already in the vault."));
    }
    let meta = VaultMeta {
        name: src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into()),
        size: md.len(),
        modified_at: md.modified().ok().and_then(|m| m.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
    };

    let mut salt = [0u8; 16];
    let mut prefix = [0u8; 7];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut prefix);
    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&M_COST_KIB.to_le_bytes());
    header.extend_from_slice(&T_COST.to_le_bytes());
    header.extend_from_slice(&P_COST.to_le_bytes());
    header.extend_from_slice(&salt);
    header.extend_from_slice(&prefix);
    let cipher = derive_key(password, &salt, M_COST_KIB, T_COST, P_COST)?;

    let dir = dest_dir.map(Path::to_path_buf).or_else(|| src.parent().map(Path::to_path_buf)).ok_or_else(|| err("No destination folder."))?;
    let out_path = unique_path(&dir, &format!("{}.{VAULT_EXT}", random_name()));
    let tmp_path = out_path.with_extension(format!("{VAULT_EXT}.partial"));

    let result = (|| -> AppResult<()> {
        let mut out = BufWriter::new(File::create(&tmp_path)?);
        out.write_all(&header)?;
        write_record(&mut out, &cipher, &header, &prefix, 0, false, &serde_json::to_vec(&meta)?)?;
        let mut input = BufReader::new(File::open(src)?);
        let mut buf = vec![0u8; CHUNK];
        let mut counter: u32 = 1;
        let mut pending: Option<Vec<u8>> = None;
        loop {
            let mut filled = 0;
            while filled < CHUNK {
                let n = input.read(&mut buf[filled..])?;
                if n == 0 {
                    break;
                }
                filled += n;
            }
            if let Some(prev) = pending.take() {
                write_record(&mut out, &cipher, &header, &prefix, counter, filled == 0, &prev)?;
                counter = counter.checked_add(1).ok_or_else(|| err("File too large."))?;
                if filled == 0 {
                    break;
                }
            } else if filled == 0 {
                // Empty file: a single empty final chunk.
                write_record(&mut out, &cipher, &header, &prefix, counter, true, &[])?;
                break;
            }
            pending = Some(buf[..filled].to_vec());
        }
        out.flush()?;
        out.into_inner().map_err(|e| err(e.to_string()))?.sync_all()?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e);
    }
    std::fs::rename(&tmp_path, &out_path)?;

    // Verify the vault decrypts before the caller removes the original.
    let peek = peek_file(&out_path, password)?;
    if peek.size != meta.size {
        let _ = std::fs::remove_file(&out_path);
        return Err(err("Vault verification failed; original kept."));
    }
    Ok(peek)
}

fn open_vault(path: &Path, password: &str) -> AppResult<(BufReader<File>, Aes256Gcm, Vec<u8>, [u8; 7], VaultMeta)> {
    let mut input = BufReader::new(File::open(path)?);
    let mut header = vec![0u8; HEADER_LEN];
    input.read_exact(&mut header).map_err(|_| err("Not a SWEEPR vault file."))?;
    if &header[..8] != MAGIC {
        return Err(err("Not a SWEEPR vault file."));
    }
    let u = |i: usize| u32::from_le_bytes(header[i..i + 4].try_into().expect("4 bytes"));
    let (m, t, p) = (u(8), u(12), u(16));
    let salt = header[20..36].to_vec();
    let mut prefix = [0u8; 7];
    prefix.copy_from_slice(&header[36..43]);
    let cipher = derive_key(password, &salt, m, t, p)?;
    let rec = read_record(&mut input)?.ok_or_else(|| err("Vault file is truncated."))?;
    let plain = cipher
        .decrypt(Nonce::from_slice(&nonce_for(&prefix, 0, false)), Payload { msg: &rec, aad: &header })
        .map_err(|_| err("Wrong password or damaged vault file."))?;
    let meta: VaultMeta = serde_json::from_slice(&plain).map_err(|_| err("Vault metadata is damaged."))?;
    Ok((input, cipher, header, prefix, meta))
}

/// Reads only the metadata record (original name / size) to list vault contents.
pub fn peek_file(path: &Path, password: &str) -> AppResult<VaultEntry> {
    let (_, _, _, _, meta) = open_vault(path, password)?;
    Ok(VaultEntry {
        vault_path: path.to_string_lossy().to_string(),
        original_name: meta.name,
        size: meta.size,
        modified_at: meta.modified_at,
    })
}

/// Decrypts a vault file back to its original name inside `dest_dir` (or next to it).
pub fn decrypt_file(path: &Path, password: &str, dest_dir: Option<&Path>) -> AppResult<VaultEntry> {
    let (mut input, cipher, header, prefix, meta) = open_vault(path, password)?;
    // Never trust the stored name as a path: keep only its final component.
    let safe_name = Path::new(&meta.name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty() && n != "." && n != "..")
        .unwrap_or_else(|| "restored-file".into());
    let dir = dest_dir.map(Path::to_path_buf).or_else(|| path.parent().map(Path::to_path_buf)).ok_or_else(|| err("No destination folder."))?;
    let out_path = unique_path(&dir, &safe_name);
    let tmp_path = dir.join(format!(".{}.sweepr-restore", random_name()));

    let result = (|| -> AppResult<u64> {
        let mut out = BufWriter::new(File::create(&tmp_path)?);
        let mut counter: u32 = 1;
        let mut written = 0u64;
        loop {
            let rec = read_record(&mut input)?.ok_or_else(|| err("Vault file is truncated."))?;
            let try_dec = |last: bool| {
                cipher
                    .decrypt(Nonce::from_slice(&nonce_for(&prefix, counter, last)), Payload { msg: &rec, aad: &header })
                    .ok()
            };
            if let Some(plain) = try_dec(false) {
                out.write_all(&plain)?;
                written += plain.len() as u64;
            } else if let Some(plain) = try_dec(true) {
                out.write_all(&plain)?;
                written += plain.len() as u64;
                if read_record(&mut input)?.is_some() {
                    return Err(err("Vault file has unexpected trailing data."));
                }
                break;
            } else {
                return Err(err("Vault file is damaged."));
            }
            counter = counter.checked_add(1).ok_or_else(|| err("Vault file is damaged."))?;
        }
        out.flush()?;
        Ok(written)
    })();
    match result {
        Ok(written) if written == meta.size => {
            std::fs::rename(&tmp_path, &out_path)?;
            Ok(VaultEntry {
                vault_path: out_path.to_string_lossy().to_string(),
                original_name: safe_name,
                size: written,
                modified_at: meta.modified_at,
            })
        }
        Ok(_) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err(err("Restored size does not match; vault kept."))
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err(e)
        }
    }
}

/// Lists `.swvault` files in `dir` (non-recursive) and, with a password, their original names.
pub fn list_vault(dir: &Path, password: Option<&str>) -> AppResult<Vec<VaultEntry>> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir)?.flatten() {
        let p = e.path();
        if !p.extension().map(|x| x.eq_ignore_ascii_case(VAULT_EXT)).unwrap_or(false) {
            continue;
        }
        let md = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let fallback = VaultEntry {
            vault_path: p.to_string_lossy().to_string(),
            original_name: String::new(),
            size: md.len(),
            modified_at: md.modified().ok().and_then(|m| m.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
        };
        out.push(match password {
            Some(pw) => peek_file(&p, pw).unwrap_or(fallback),
            None => fallback,
        });
    }
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sweepr-vault-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn roundtrip_multi_chunk_and_empty() {
        let dir = tmp_dir("rt");
        for (name, len) in [("tax-2025.pdf", CHUNK * 2 + 123), ("empty.txt", 0), ("exact.bin", CHUNK)] {
            let src = dir.join(name);
            let data: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
            std::fs::write(&src, &data).unwrap();
            let entry = encrypt_file(&src, "correct horse", None).unwrap();
            assert_eq!(entry.original_name, name);
            std::fs::remove_file(&src).unwrap();
            let restored = decrypt_file(Path::new(&entry.vault_path), "correct horse", None).unwrap();
            assert_eq!(std::fs::read(&restored.vault_path).unwrap(), data);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn wrong_password_and_truncation_are_rejected() {
        let dir = tmp_dir("bad");
        let src = dir.join("secret.jpg");
        std::fs::write(&src, vec![9u8; CHUNK + 10]).unwrap();
        let entry = encrypt_file(&src, "correct horse", None).unwrap();
        let vault = PathBuf::from(&entry.vault_path);
        assert!(peek_file(&vault, "wrong password").is_err());
        let bytes = std::fs::read(&vault).unwrap();
        std::fs::write(&vault, &bytes[..bytes.len() - 40]).unwrap();
        assert!(decrypt_file(&vault, "correct horse", None).is_err());
        assert!(encrypt_file(&src, "short", None).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
