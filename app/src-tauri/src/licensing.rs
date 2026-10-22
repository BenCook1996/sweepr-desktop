//! Server-backed entitlement checks.
//!
//! The server decides whether a user is entitled. It returns a short-lived
//! Ed25519-signed token (compact JWS, alg=EdDSA) bound to this device. The app
//! embeds only the PUBLIC key, so it can verify but never mint tokens.
//! A valid cached token gives an offline grace period until it expires (≤72h).

use crate::error::{AppError, AppResult};
use base64::engine::general_purpose::{
    STANDARD as B64_STD, STANDARD_NO_PAD as B64_STD_NOPAD, URL_SAFE as B64_URL,
    URL_SAFE_NO_PAD as B64,
};
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

pub type LicenseError = AppError;

const DEFAULT_API: &str = "https://sweeprcleaner.com";
const DEFAULT_PUBKEY_B64: &str = "t04hn-7TfW5RIemEhi4mKbZy6rHRYBO6HxeN5OOIR_8";
pub const PROJECT_ID: &str = "cleaner";

#[derive(Serialize, Deserialize, Clone)]
struct Account {
    account_id: String,
    refresh_token: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Claims {
    pub sub: String,
    pub device_id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub status: String,
    pub plan: String,
    #[serde(default)]
    pub addons: Vec<String>,
    pub exp: u64,
    #[serde(default)]
    pub iat: u64,
}

#[derive(Serialize, Clone)]
pub struct LicenseStatus {
    pub active: bool,
    pub status: String,
    pub plan: Option<String>,
    pub addons: Vec<String>,
    pub expires_at: Option<u64>,
    pub offline: bool,
    pub dev_unlock: bool,
}

#[derive(Default)]
struct State {
    account: Option<Account>,
    token: Option<(String, Claims)>,
}

pub struct Licensing {
    api: String,
    api_ok: bool,
    data_dir: PathBuf,
    device_id: String,
    pubkey: Option<VerifyingKey>,
    http: reqwest::Client,
    state: Mutex<State>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn load_or_create_fallback_device_id(data_dir: &Path) -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let fallback_path = data_dir.join("device_id.txt");
    if let Ok(existing) = std::fs::read_to_string(&fallback_path) {
        let trimmed = existing.trim();
        if trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
            return trimmed.to_ascii_lowercase();
        }
    }

    let r1 = RandomState::new().build_hasher().finish();
    let r2 = RandomState::new().build_hasher().finish();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut h = Sha256::new();
    h.update(b"sweepr-fallback-device-id-v1:");
    h.update(r1.to_le_bytes());
    h.update(r2.to_le_bytes());
    h.update(nanos.to_le_bytes());
    h.update(std::process::id().to_le_bytes());
    let generated: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();

    let _ = std::fs::create_dir_all(data_dir);
    let _ = std::fs::write(&fallback_path, &generated);
    generated
}

fn hardware_device_id(data_dir: &Path) -> String {
    let raw = match machine_uid::get() {
        Ok(uid) if !uid.trim().is_empty() => uid.trim().to_string(),
        _ => load_or_create_fallback_device_id(data_dir),
    };
    let mut h = Sha256::new();
    h.update(raw.as_bytes());
    h.update(b"sweepr-device-v1");
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// The verifying key is baked in at compile time. A runtime environment
/// override is honoured ONLY in debug builds: in release builds anyone could
/// otherwise launch the exe with their own key and a self-signed token.
fn load_pubkey() -> Option<VerifyingKey> {
    #[cfg(debug_assertions)]
    let b64 = option_env!("SWEEPR_LICENSE_PUBKEY")
        .map(str::to_string)
        .or_else(|| std::env::var("SWEEPR_LICENSE_PUBKEY").ok())
        .unwrap_or_else(|| DEFAULT_PUBKEY_B64.to_string());
    #[cfg(not(debug_assertions))]
    let b64 = option_env!("SWEEPR_LICENSE_PUBKEY")
        .unwrap_or(DEFAULT_PUBKEY_B64)
        .to_string();
    let bytes: [u8; 32] = B64.decode(b64.trim()).ok()?.try_into().ok()?;
    VerifyingKey::from_bytes(&bytes).ok()
}

/// Licence server URL. Runtime override only in debug builds (see `load_pubkey`).
/// Checks `SWEEPR_CRM_URL` first (centralized multi-project CRM hub), then `SWEEPR_API_URL`.
fn load_api_url() -> String {
    #[cfg(debug_assertions)]
    let api = std::env::var("SWEEPR_CRM_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("SWEEPR_API_URL").ok().filter(|s| !s.trim().is_empty()))
        .or_else(|| option_env!("SWEEPR_CRM_URL").map(str::to_string))
        .or_else(|| option_env!("SWEEPR_API_URL").map(str::to_string));
    #[cfg(not(debug_assertions))]
    let api = option_env!("SWEEPR_CRM_URL")
        .or(option_env!("SWEEPR_API_URL"))
        .map(str::to_string);
    api.unwrap_or_else(|| DEFAULT_API.to_string()).trim_end_matches('/').to_string()
}

/// HTTPS is required, except for a local development server.
pub fn is_acceptable_api_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    if lower.starts_with("https://") {
        return lower.len() > "https://".len();
    }
    if let Some(rest) = lower.strip_prefix("http://") {
        let host_port = rest.split('/').next().unwrap_or("");
        if host_port.contains('@') {
            return false;
        }
        let host = if host_port.starts_with('[') {
            host_port.split(']').next().map(|h| format!("{h}]")).unwrap_or_default()
        } else {
            host_port.split(':').next().unwrap_or("").to_string()
        };
        return matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]");
    }
    false
}

pub fn verify_binary_signature_with_key(
    key: &VerifyingKey,
    data: &[u8],
    sig_b64_or_hex: &str,
) -> Result<(), LicenseError> {
    let bad = |m: &str| AppError::License(m.to_string());
    let trimmed = sig_b64_or_hex.trim();
    if trimmed.is_empty() {
        return Err(bad("missing binary signature"));
    }
    let sig_bytes = if trimmed.len() == 128 && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        (0..64)
            .map(|i| u8::from_str_radix(&trimmed[i * 2..i * 2 + 2], 16).ok())
            .collect::<Option<Vec<u8>>>()
            .ok_or_else(|| bad("invalid hex signature"))?
    } else {
        B64_STD
            .decode(trimmed)
            .or_else(|_| B64_STD_NOPAD.decode(trimmed))
            .or_else(|_| B64.decode(trimmed))
            .or_else(|_| B64_URL.decode(trimmed))
            .map_err(|_| bad("bad signature encoding"))?
    };
    let sig = Signature::from_slice(&sig_bytes).map_err(|_| bad("bad signature length"))?;
    key.verify_strict(data, &sig)
        .map_err(|_| bad("binary signature verification failed"))
}

pub fn verify_token(token: &str, key: &VerifyingKey, device_id: &str) -> AppResult<Claims> {
    let bad = |m: &str| AppError::License(m.to_string());
    let mut parts = token.split('.');
    let (Some(h), Some(p), Some(s), None) = (parts.next(), parts.next(), parts.next(), parts.next()) else {
        return Err(bad("malformed token"));
    };
    let header: serde_json::Value =
        serde_json::from_slice(&B64.decode(h).map_err(|_| bad("bad header"))?)?;
    if header.get("alg").and_then(|v| v.as_str()) != Some("EdDSA") {
        return Err(bad("unexpected alg"));
    }
    let sig_bytes = B64.decode(s).map_err(|_| bad("bad signature encoding"))?;
    let sig = Signature::from_slice(&sig_bytes).map_err(|_| bad("bad signature"))?;
    key.verify_strict(format!("{h}.{p}").as_bytes(), &sig)
        .map_err(|_| bad("signature verification failed"))?;

    let claims: Claims = serde_json::from_slice(&B64.decode(p).map_err(|_| bad("bad payload"))?)?;
    let now_ts = now();
    if claims.exp <= now_ts {
        return Err(bad("token expired"));
    }
    if claims.exp > now_ts + 72 * 3600 + 300 {
        return Err(bad("token lifetime exceeds maximum horizon"));
    }
    if claims.iat > now_ts + 300 {
        return Err(bad("future iat"));
    }
    if claims.device_id != device_id {
        return Err(bad("token issued for another device"));
    }
    if let Some(ref pid) = claims.project_id {
        let norm = pid.trim().to_ascii_lowercase();
        if !norm.is_empty() && norm != PROJECT_ID && norm != "all" {
            let has_bundle = claims
                .addons
                .iter()
                .any(|a| a.eq_ignore_ascii_case("sweepr_secure_bundle"));
            if !has_bundle {
                return Err(bad("token issued for a different SWEEPR product"));
            }
        }
    }
    if !matches!(claims.status.as_str(), "active" | "trialing") {
        return Err(AppError::PaymentRequired);
    }
    Ok(claims)
}

#[derive(Deserialize)]
struct EntitlementResponse {
    status: String,
    token: Option<String>,
}

#[derive(Deserialize)]
struct CheckoutResponse {
    #[serde(default)]
    activated: bool,
    url: Option<String>,
    account_id: Option<String>,
    refresh_token: Option<String>,
    token: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct SealedAccount {
    v: u8,
    ct: String,
    tag: String,
}

fn seal_keystream(device_id: &str, len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len);
    let mut counter = 0u32;
    while out.len() < len {
        let mut h = Sha256::new();
        h.update(b"sweepr-account-seal-v1:");
        h.update(device_id.as_bytes());
        h.update(counter.to_le_bytes());
        out.extend_from_slice(&h.finalize());
        counter += 1;
    }
    out.truncate(len);
    out
}

fn seal_mac(device_id: &str, ct: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"sweepr-account-mac-v1:");
    h.update(device_id.as_bytes());
    h.update(ct);
    h.finalize().into()
}

fn save_account(path: &std::path::Path, acc: &Account, device_id: &str) -> AppResult<()> {
    let plain = serde_json::to_vec(acc)?;
    let ks = seal_keystream(device_id, plain.len());
    let ct: Vec<u8> = plain.iter().zip(ks.iter()).map(|(a, b)| a ^ b).collect();
    let tag = seal_mac(device_id, &ct);
    let sealed = SealedAccount {
        v: 1,
        ct: B64.encode(&ct),
        tag: B64.encode(tag),
    };
    std::fs::write(path, serde_json::to_vec(&sealed)?)?;
    Ok(())
}

fn load_account(path: &std::path::Path, device_id: &str) -> Option<Account> {
    let bytes = std::fs::read(path).ok()?;
    if let Ok(sealed) = serde_json::from_slice::<SealedAccount>(&bytes) {
        if sealed.v == 1 {
            let ct = B64.decode(sealed.ct.trim()).ok()?;
            let tag = B64.decode(sealed.tag.trim()).ok()?;
            let expected = seal_mac(device_id, &ct);
            if tag.len() == expected.len() && tag.iter().zip(expected.iter()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0 {
                let ks = seal_keystream(device_id, ct.len());
                let plain: Vec<u8> = ct.iter().zip(ks.iter()).map(|(a, b)| a ^ b).collect();
                return serde_json::from_slice(&plain).ok();
            }
        }
    }
    // Backwards-compatible fallback for legacy plaintext account.json (upgrades on next write).
    if let Ok(acc) = serde_json::from_slice::<Account>(&bytes) {
        let _ = save_account(path, &acc, device_id);
        return Some(acc);
    }
    None
}

impl Licensing {
    pub fn new(data_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&data_dir);
        let api = load_api_url();
        // Release builds refuse to talk to a plain-HTTP, non-local licence
        // server (tokens/refresh tokens would travel in clear text).
        let api_ok = cfg!(debug_assertions) || is_acceptable_api_url(&api);
        if !is_acceptable_api_url(&api) {
            eprintln!(
                "sweepr: licence server URL {api:?} is not HTTPS{}",
                if api_ok { " (allowed in debug build only)" } else { "; licence requests are disabled" }
            );
        }
        let device_id = hardware_device_id(&data_dir);
        let pubkey = load_pubkey();

        let mut state = State::default();
        state.account = load_account(&data_dir.join("account.json"), &device_id);
        if let (Some(key), Ok(tok)) = (&pubkey, std::fs::read_to_string(data_dir.join("entitlement.jws"))) {
            if let Ok(claims) = verify_token(tok.trim(), key, &device_id) {
                state.token = Some((tok.trim().to_string(), claims));
            }
        }

        Self {
            api,
            api_ok,
            data_dir,
            device_id,
            pubkey,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("http client"),
            state: Mutex::new(state),
        }
    }

    pub fn verify_binary_signature(
        &self,
        data: &[u8],
        sig_b64_or_hex: &str,
    ) -> Result<(), LicenseError> {
        let key = self
            .pubkey
            .as_ref()
            .ok_or_else(|| AppError::License("app built without SWEEPR_LICENSE_PUBKEY".into()))?;
        verify_binary_signature_with_key(key, data, sig_b64_or_hex)
    }

    pub fn api_url(&self) -> &str {
        &self.api
    }

    /// The app's private data directory (licence cache etc.).
    pub fn data_dir(&self) -> &std::path::Path {
        &self.data_dir
    }

    /// Base URL for licence requests, or an error if it is insecure.
    fn api_base(&self) -> AppResult<&str> {
        if self.api_ok {
            Ok(&self.api)
        } else {
            Err(AppError::License(format!("insecure licence server URL (HTTPS required): {}", self.api)))
        }
    }

    fn dev_unlock() -> bool {
        cfg!(debug_assertions) && std::env::var("SWEEPR_DEV_UNLOCK").as_deref() == Ok("1")
    }

    async fn ensure_account(&self, st: &mut State) -> AppResult<Account> {
        if let Some(a) = &st.account {
            return Ok(a.clone());
        }
        let acc: Account = self
            .http
            .post(format!("{}/v1/accounts", self.api_base()?))
            .header("x-sweepr-project", PROJECT_ID)
            .json(&serde_json::json!({
                "device_id": self.device_id,
                "project_id": PROJECT_ID,
                "device_type": "pc"
            }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        save_account(&self.data_dir.join("account.json"), &acc, &self.device_id)?;
        st.account = Some(acc.clone());
        Ok(acc)
    }

    /// Returns the current entitlement. Uses the cached token unless `force`
    /// is set or it has expired. Falls back to the cached token when offline.
    pub async fn status(&self, force: bool) -> AppResult<LicenseStatus> {
        if Self::dev_unlock() {
            return Ok(LicenseStatus {
                active: true,
                status: "dev".into(),
                plan: Some("dev".into()),
                addons: vec!["battery_care".into(), "cloud_vault".into()],
                expires_at: None,
                offline: false,
                dev_unlock: true,
            });
        }
        let mut st = self.state.lock().await;

        if !force {
            if let Some((_, c)) = &st.token {
                if c.exp > now() {
                    return Ok(active_status(c, false));
                }
            }
        }

        let Some(key) = self.pubkey.clone() else {
            return Err(AppError::License("app built without SWEEPR_LICENSE_PUBKEY".into()));
        };

        let result: AppResult<EntitlementResponse> = async {
            let mut acc = self.ensure_account(&mut st).await?;
            let resp = self
                .http
                .post(format!("{}/v1/entitlement", self.api_base()?))
                .header("x-sweepr-project", PROJECT_ID)
                .bearer_auth(&acc.refresh_token)
                .json(&serde_json::json!({
                    "device_id": self.device_id,
                    "project_id": PROJECT_ID,
                    "device_type": "pc"
                }))
                .send()
                .await?;
            if resp.status().as_u16() == 401 {
                st.account = None;
                let _ = std::fs::remove_file(self.data_dir.join("account.json"));
                acc = self.ensure_account(&mut st).await?;
                return Ok(self
                    .http
                    .post(format!("{}/v1/entitlement", self.api_base()?))
                    .header("x-sweepr-project", PROJECT_ID)
                    .bearer_auth(&acc.refresh_token)
                    .json(&serde_json::json!({
                        "device_id": self.device_id,
                        "project_id": PROJECT_ID,
                        "device_type": "pc"
                    }))
                    .send()
                    .await?
                    .error_for_status()?
                    .json()
                    .await?);
            }
            Ok(resp.error_for_status()?.json().await?)
        }
        .await;

        match result {
            Ok(resp) => match resp.token {
                Some(tok) => {
                    let claims = verify_token(&tok, &key, &self.device_id)?;
                    let _ = std::fs::write(self.data_dir.join("entitlement.jws"), &tok);
                    let s = active_status(&claims, false);
                    st.token = Some((tok, claims));
                    Ok(s)
                }
                None => {
                    st.token = None;
                    let _ = std::fs::remove_file(self.data_dir.join("entitlement.jws"));
                    Ok(LicenseStatus {
                        active: false,
                        status: resp.status,
                        plan: None,
                        addons: Vec::new(),
                        expires_at: None,
                        offline: false,
                        dev_unlock: false,
                    })
                }
            },
            Err(AppError::Network(e)) => match &st.token {
                Some((_, c)) if c.exp > now() => Ok(active_status(c, true)),
                _ => Err(AppError::Network(e)),
            },
            Err(e) => Err(e),
        }
    }

    pub async fn require_active(&self) -> AppResult<()> {
        if self.status(false).await?.active {
            Ok(())
        } else {
            Err(AppError::PaymentRequired)
        }
    }

    pub async fn require_addon(&self, addon: &str) -> AppResult<()> {
        let st = self.status(false).await?;
        if st.dev_unlock
            || (st.active
                && st.addons.iter().any(|a| {
                    a.eq_ignore_ascii_case(addon)
                        || a.eq_ignore_ascii_case("sweepr_secure_bundle")
                }))
        {
            Ok(())
        } else {
            Err(AppError::PaymentRequired)
        }
    }

    /// Initiates checkout for `email` / `plan`, or immediately activates this
    /// device and returns `Ok(None)` when `email` already has an active
    /// subscription on the server.
    pub async fn checkout_url(&self, email: Option<&str>, plan: Option<&str>) -> AppResult<Option<String>> {
        self.checkout_url_with_addon(email, plan, None).await
    }

    pub async fn checkout_url_with_addon(
        &self,
        email: Option<&str>,
        plan: Option<&str>,
        addon: Option<&str>,
    ) -> AppResult<Option<String>> {
        let mut map = serde_json::Map::new();
        map.insert("device_id".into(), serde_json::Value::String(self.device_id.clone()));
        map.insert("project_id".into(), serde_json::Value::String(PROJECT_ID.to_string()));
        if let Some(e) = email.map(str::trim).filter(|e| !e.is_empty()) {
            map.insert("email".into(), serde_json::Value::String(e.to_string()));
        }
        if let Some(p) = plan.map(str::trim).filter(|p| matches!(*p, "monthly" | "annual")) {
            map.insert("plan".into(), serde_json::Value::String(p.to_string()));
        }
        let wanted_addon = addon.map(str::trim).filter(|a| !a.is_empty());
        if let Some(a) = wanted_addon {
            map.insert("addons".into(), serde_json::json!([a]));
            if a.eq_ignore_ascii_case("battery_care") {
                map.insert("batteryCareAddon".into(), serde_json::Value::Bool(true));
            } else if a.eq_ignore_ascii_case("cloud_vault") {
                map.insert("cloudVaultAddon".into(), serde_json::Value::Bool(true));
            }
        }
        let body = serde_json::Value::Object(map);

        let mut st = self.state.lock().await;
        if let Some((_, c)) = &st.token {
            if c.exp > now() {
                if let Some(req_addon) = wanted_addon {
                    if c.addons.iter().any(|a| a.eq_ignore_ascii_case(req_addon)) {
                        return Ok(None);
                    }
                } else {
                    return Ok(None);
                }
            }
        }
        let send_checkout = async {
            let mut acc = self.ensure_account(&mut st).await?;
            let mut resp = self
                .http
                .post(format!("{}/v1/checkout", self.api_base()?))
                .header("x-sweepr-project", PROJECT_ID)
                .bearer_auth(&acc.refresh_token)
                .json(&body)
                .send()
                .await?;
            if resp.status().as_u16() == 401 {
                st.account = None;
                let _ = std::fs::remove_file(self.data_dir.join("account.json"));
                acc = self.ensure_account(&mut st).await?;
                resp = self
                    .http
                    .post(format!("{}/v1/checkout", self.api_base()?))
                    .header("x-sweepr-project", PROJECT_ID)
                    .bearer_auth(&acc.refresh_token)
                    .json(&body)
                    .send()
                    .await?;
            }
            if resp.status().as_u16() == 409 {
                return Ok(CheckoutResponse {
                    activated: true,
                    url: None,
                    account_id: None,
                    refresh_token: None,
                    token: None,
                });
            }
            let r: CheckoutResponse = resp.error_for_status()?.json().await?;
            Ok::<CheckoutResponse, AppError>(r)
        }
        .await;

        match send_checkout {
            Ok(r) if r.activated => {
                if let (Some(account_id), Some(refresh_token)) = (r.account_id, r.refresh_token) {
                    let acc = Account { account_id, refresh_token };
                    save_account(&self.data_dir.join("account.json"), &acc, &self.device_id)?;
                    st.account = Some(acc);
                    st.token = None;
                }
                if let (Some(tok), Some(key)) = (r.token, self.pubkey.as_ref()) {
                    if let Ok(claims) = verify_token(&tok, key, &self.device_id) {
                        let _ = std::fs::write(self.data_dir.join("entitlement.jws"), &tok);
                        st.token = Some((tok, claims));
                        return Ok(None);
                    }
                }
                drop(st);
                if let Ok(s) = self.status(true).await {
                    if s.active {
                        return Ok(None);
                    }
                }
                let base = self.api_base()?;
                Ok(Some(format!("{base}/order")))
            }
            Ok(r) => {
                if let Some(url) = r.url {
                    if !is_acceptable_api_url(&url) {
                        return Err(AppError::License("server returned an unexpected URL".into()));
                    }
                    Ok(Some(url))
                } else {
                    Err(AppError::License("server did not return a checkout URL".into()))
                }
            }
            Err(_) => {
                let base = self.api_base()?;
                let mut url = format!("{base}/order");
                let mut sep = '?';
                if let Some(e) = email.map(str::trim).filter(|e| !e.is_empty()) {
                    let encoded: String = e
                        .bytes()
                        .flat_map(|b| match b {
                            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                                vec![b as char]
                            }
                            _ => format!("%{:02X}", b).chars().collect(),
                        })
                        .collect();
                    url = format!("{url}{sep}email={encoded}");
                    sep = '&';
                }
                if let Some(a) = wanted_addon {
                    url = format!("{url}{sep}addon={a}");
                }
                Ok(Some(url))
            }
        }
    }

    /// Step 1 of linking an existing email purchase to this desktop device.
    pub async fn request_email_otp(&self, email: &str) -> AppResult<()> {
        let email = email.trim();
        if email.is_empty() || !email.contains('@') {
            return Err(AppError::License("Please enter a valid email address.".into()));
        }
        self.http
            .post(format!("{}/v1/account/send-otp", self.api_base()?))
            .header("x-sweepr-project", PROJECT_ID)
            .json(&serde_json::json!({ "email": email, "project_id": PROJECT_ID }))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// Step 2 of linking an existing email purchase: verifies the 6-digit OTP and binds this device.
    pub async fn verify_email_otp(&self, email: &str, code: &str) -> AppResult<LicenseStatus> {
        let email = email.trim();
        let code = code.trim();
        if email.is_empty() || !email.contains('@') {
            return Err(AppError::License("Please enter a valid email address.".into()));
        }
        if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::License("Please enter a valid 6-digit Subscription Key.".into()));
        }

        let resp = self
            .http
            .post(format!("{}/v1/account/verify-otp", self.api_base()?))
            .header("x-sweepr-project", PROJECT_ID)
            .json(&serde_json::json!({
                "email": email,
                "code": code,
                "device_id": self.device_id,
                "device_type": "pc",
                "project_id": PROJECT_ID,
            }))
            .send()
            .await?;
        if resp.status().as_u16() == 403 {
            return Err(AppError::License("Device limit reached for this subscription.".into()));
        }
        if resp.status().is_success() {
            #[derive(Deserialize)]
            struct VerifyOtpResponse {
                account_id: String,
                refresh_token: String,
                token: Option<String>,
            }
            let parsed: VerifyOtpResponse = resp.json().await?;
            {
                let mut st = self.state.lock().await;
                let acc = Account {
                    account_id: parsed.account_id,
                    refresh_token: parsed.refresh_token,
                };
                save_account(&self.data_dir.join("account.json"), &acc, &self.device_id)?;
                st.account = Some(acc);
                st.token = None;
                if let (Some(tok), Some(key)) = (parsed.token, self.pubkey.as_ref()) {
                    if let Ok(claims) = verify_token(&tok, key, &self.device_id) {
                        let _ = std::fs::write(self.data_dir.join("entitlement.jws"), &tok);
                        let status = active_status(&claims, false);
                        st.token = Some((tok, claims));
                        return Ok(status);
                    }
                }
            }
            return self.status(true).await;
        }

        Err(AppError::License(
            "Invalid or expired 6-digit Subscription Key. Click 'Email me a new key' to receive a fresh code.".into(),
        ))
    }
}

fn active_status(c: &Claims, offline: bool) -> LicenseStatus {
    let mut addons = c.addons.clone();
    if addons.iter().any(|a| a.eq_ignore_ascii_case("sweepr_secure_bundle")) {
        if !addons.iter().any(|a| a.eq_ignore_ascii_case("battery_care")) {
            addons.push("battery_care".to_string());
        }
        if !addons.iter().any(|a| a.eq_ignore_ascii_case("cloud_vault")) {
            addons.push("cloud_vault".to_string());
        }
    }
    LicenseStatus {
        active: true,
        status: c.status.clone(),
        plan: Some(c.plan.clone()),
        addons,
        expires_at: Some(c.exp),
        offline,
        dev_unlock: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn make_token(sk: &SigningKey, claims: serde_json::Value) -> String {
        let h = B64.encode(br#"{"alg":"EdDSA","typ":"JWT"}"#);
        let p = B64.encode(claims.to_string());
        let sig = sk.sign(format!("{h}.{p}").as_bytes());
        format!("{h}.{p}.{}", B64.encode(sig.to_bytes()))
    }

    #[test]
    fn verifies_valid_and_rejects_tampered() {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let vk = sk.verifying_key();
        let claims = serde_json::json!({"sub":"a","device_id":"d","status":"active","plan":"monthly","exp": now() + 3600});
        let tok = make_token(&sk, claims);
        assert!(verify_token(&tok, &vk, "d").is_ok());
        assert!(verify_token(&tok, &vk, "other-device").is_err());

        let mut parts: Vec<&str> = tok.split('.').collect();
        let forged = B64.encode(br#"{"sub":"a","device_id":"d","status":"active","plan":"x","exp":99999999999}"#);
        parts[1] = &forged;
        assert!(verify_token(&parts.join("."), &vk, "d").is_err());
    }

    #[test]
    fn rejects_expired_and_canceled() {
        let sk = SigningKey::from_bytes(&[9u8; 32]);
        let vk = sk.verifying_key();
        let expired = make_token(&sk, serde_json::json!({"sub":"a","device_id":"d","status":"active","plan":"m","exp": 1}));
        assert!(verify_token(&expired, &vk, "d").is_err());
        let too_far_future = make_token(&sk, serde_json::json!({"sub":"a","device_id":"d","status":"active","plan":"m","exp": now() + 72 * 3600 + 600}));
        assert!(verify_token(&too_far_future, &vk, "d").is_err());
        let future_iat = make_token(&sk, serde_json::json!({"sub":"a","device_id":"d","status":"active","plan":"m","exp": now() + 3600,"iat": now() + 600}));
        assert!(verify_token(&future_iat, &vk, "d").is_err());
        let canceled = make_token(&sk, serde_json::json!({"sub":"a","device_id":"d","status":"canceled","plan":"m","exp": now() + 60}));
        assert!(matches!(verify_token(&canceled, &vk, "d"), Err(AppError::PaymentRequired)));
    }

    #[test]
    fn binary_signature_and_fallback_device_id() {
        let sk = SigningKey::from_bytes(&[11u8; 32]);
        let vk = sk.verifying_key();
        let payload = b"MZ\x90\x00test-installer-binary";
        let sig = sk.sign(payload);
        let b64_std = B64_STD.encode(sig.to_bytes());
        let b64_url = B64.encode(sig.to_bytes());
        let hex_sig: String = sig.to_bytes().iter().map(|b| format!("{b:02x}")).collect();

        assert!(verify_binary_signature_with_key(&vk, payload, &b64_std).is_ok());
        assert!(verify_binary_signature_with_key(&vk, payload, &b64_url).is_ok());
        assert!(verify_binary_signature_with_key(&vk, payload, &hex_sig).is_ok());
        assert!(verify_binary_signature_with_key(&vk, b"MZtampered", &b64_std).is_err());
        assert!(verify_binary_signature_with_key(&vk, payload, "").is_err());

        let dir = std::env::temp_dir().join(format!("sweepr-devid-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let id1 = load_or_create_fallback_device_id(&dir);
        let id2 = load_or_create_fallback_device_id(&dir);
        assert_eq!(id1.len(), 64);
        assert_eq!(id1, id2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn api_url_policy() {
        assert!(is_acceptable_api_url("https://api.sweepr.app"));
        assert!(is_acceptable_api_url("http://localhost:8787"));
        assert!(is_acceptable_api_url("http://127.0.0.1:8787/x"));
        assert!(is_acceptable_api_url("http://[::1]:8787"));
        assert!(!is_acceptable_api_url("http://api.sweepr.app"));
        assert!(!is_acceptable_api_url("http://localhost.evil.com"));
        assert!(!is_acceptable_api_url("http://localhost:1@evil.com"));
        assert!(!is_acceptable_api_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_acceptable_api_url("https://"));
    }

    #[test]
    fn enforces_multi_project_crm_scoping_and_bundle_unlock() {
        let sk = SigningKey::from_bytes(&[13u8; 32]);
        let vk = sk.verifying_key();

        // 1. Token scoped to "cleaner" is accepted
        let cleaner_tok = make_token(
            &sk,
            serde_json::json!({
                "sub": "acc_1",
                "device_id": "d",
                "project_id": "cleaner",
                "status": "active",
                "plan": "pro_annual",
                "exp": now() + 3600
            }),
        );
        assert!(verify_token(&cleaner_tok, &vk, "d").is_ok());

        // 2. Token scoped to another SWEEPR product ("vpn") without bundle is rejected
        let vpn_tok = make_token(
            &sk,
            serde_json::json!({
                "sub": "acc_1",
                "device_id": "d",
                "project_id": "vpn",
                "status": "active",
                "plan": "pro_annual",
                "exp": now() + 3600
            }),
        );
        assert!(verify_token(&vpn_tok, &vk, "d").is_err());

        // 3. Token with cross-project `sweepr_secure_bundle` is accepted and unlocks addons
        let bundle_tok = make_token(
            &sk,
            serde_json::json!({
                "sub": "acc_1",
                "device_id": "d",
                "project_id": "shopsafe",
                "status": "active",
                "plan": "pro_annual",
                "addons": ["sweepr_secure_bundle"],
                "exp": now() + 3600
            }),
        );
        let bundle_claims = verify_token(&bundle_tok, &vk, "d").expect("bundle token valid");
        let status = active_status(&bundle_claims, false);
        assert!(status.active);
        assert!(status.addons.contains(&"battery_care".to_string()));
        assert!(status.addons.contains(&"cloud_vault".to_string()));
    }
}
