//! Server-backed entitlement checks.
//!
//! The server decides whether a user is entitled. It returns a short-lived
//! Ed25519-signed token (compact JWS, alg=EdDSA) bound to this device. The app
//! embeds only the PUBLIC key, so it can verify but never mint tokens.
//! A valid cached token gives an offline grace period until it expires (≤72h).

use crate::error::{AppError, AppResult};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

const DEFAULT_API: &str = "https://sweeprcleaner.com";

#[derive(Serialize, Deserialize, Clone)]
struct Account {
    account_id: String,
    refresh_token: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Claims {
    pub sub: String,
    pub device_id: String,
    pub status: String,
    pub plan: String,
    pub exp: u64,
}

#[derive(Serialize, Clone)]
pub struct LicenseStatus {
    pub active: bool,
    pub status: String,
    pub plan: Option<String>,
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

fn device_id() -> String {
    let raw = machine_uid::get().unwrap_or_else(|_| "unknown-machine".into());
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
        .or_else(|| std::env::var("SWEEPR_LICENSE_PUBKEY").ok())?;
    #[cfg(not(debug_assertions))]
    let b64 = option_env!("SWEEPR_LICENSE_PUBKEY")?.to_string();
    let bytes: [u8; 32] = B64.decode(b64.trim()).ok()?.try_into().ok()?;
    VerifyingKey::from_bytes(&bytes).ok()
}

/// Licence server URL. Runtime override only in debug builds (see `load_pubkey`).
fn load_api_url() -> String {
    #[cfg(debug_assertions)]
    let api = std::env::var("SWEEPR_API_URL")
        .ok()
        .or_else(|| option_env!("SWEEPR_API_URL").map(str::to_string));
    #[cfg(not(debug_assertions))]
    let api = option_env!("SWEEPR_API_URL").map(str::to_string);
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
    if claims.exp <= now() {
        return Err(bad("token expired"));
    }
    if claims.device_id != device_id {
        return Err(bad("token issued for another device"));
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
struct UrlResponse {
    url: String,
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
        let device_id = device_id();
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
            .json(&serde_json::json!({ "device_id": self.device_id }))
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
            return Ok(LicenseStatus { active: true, status: "dev".into(), plan: Some("dev".into()), expires_at: None, offline: false, dev_unlock: true });
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
                .bearer_auth(&acc.refresh_token)
                .json(&serde_json::json!({ "device_id": self.device_id }))
                .send()
                .await?;
            if resp.status().as_u16() == 401 {
                st.account = None;
                let _ = std::fs::remove_file(self.data_dir.join("account.json"));
                acc = self.ensure_account(&mut st).await?;
                return Ok(self
                    .http
                    .post(format!("{}/v1/entitlement", self.api_base()?))
                    .bearer_auth(&acc.refresh_token)
                    .json(&serde_json::json!({ "device_id": self.device_id }))
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
                    Ok(LicenseStatus { active: false, status: resp.status, plan: None, expires_at: None, offline: false, dev_unlock: false })
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

    async fn post_for_url(&self, path: &str, body: Option<serde_json::Value>) -> AppResult<String> {
        let mut st = self.state.lock().await;
        let mut acc = self.ensure_account(&mut st).await?;
        let mut req = self
            .http
            .post(format!("{}{}", self.api_base()?, path))
            .bearer_auth(&acc.refresh_token);
        if let Some(ref b) = body {
            req = req.json(b);
        }
        let mut resp = req.send().await?;
        if resp.status().as_u16() == 401 {
            st.account = None;
            let _ = std::fs::remove_file(self.data_dir.join("account.json"));
            acc = self.ensure_account(&mut st).await?;
            let mut retry_req = self
                .http
                .post(format!("{}{}", self.api_base()?, path))
                .bearer_auth(&acc.refresh_token);
            if let Some(ref b) = body {
                retry_req = retry_req.json(b);
            }
            resp = retry_req.send().await?;
        }
        let r: UrlResponse = resp
            .error_for_status()?
            .json()
            .await?;
        // The URL is handed to the OS opener, so only allow web URLs.
        if !is_acceptable_api_url(&r.url) {
            return Err(AppError::License("server returned an unexpected URL".into()));
        }
        Ok(r.url)
    }

    pub async fn checkout_url(&self, email: Option<&str>, plan: Option<&str>) -> AppResult<String> {
        let mut map = serde_json::Map::new();
        if let Some(e) = email.map(str::trim).filter(|e| !e.is_empty()) {
            map.insert("email".into(), serde_json::Value::String(e.to_string()));
        }
        if let Some(p) = plan.map(str::trim).filter(|p| matches!(*p, "monthly" | "annual")) {
            map.insert("plan".into(), serde_json::Value::String(p.to_string()));
        }
        let body = if map.is_empty() { None } else { Some(serde_json::Value::Object(map)) };
        match self.post_for_url("/v1/checkout", body).await {
            Ok(url) => Ok(url),
            Err(_) => {
                let base = self.api_base()?;
                let mut url = format!("{base}/order");
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
                    url = format!("{url}?email={encoded}");
                }
                Ok(url)
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
            .json(&serde_json::json!({ "email": email }))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// Step 2 of linking an existing email purchase: verifies the 6-digit OTP and binds this device.
    pub async fn verify_email_otp(&self, email: &str, code: &str) -> AppResult<LicenseStatus> {
        let email = email.trim();
        let code = code.trim();
        if email.is_empty() || code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
            return Err(AppError::License("Please enter a valid 6-digit verification code.".into()));
        }
        let resp = self
            .http
            .post(format!("{}/v1/account/verify-otp", self.api_base()?))
            .json(&serde_json::json!({
                "email": email,
                "code": code,
                "device_id": self.device_id,
                "device_type": "pc",
            }))
            .send()
            .await?;
        if resp.status().as_u16() == 403 {
            return Err(AppError::License("Device limit reached for this subscription.".into()));
        }
        if !resp.status().is_success() {
            return Err(AppError::License("Invalid or expired verification code.".into()));
        }
        let acc: Account = resp.json().await?;
        {
            let mut st = self.state.lock().await;
            save_account(&self.data_dir.join("account.json"), &acc, &self.device_id)?;
            st.account = Some(acc);
            st.token = None;
        }
        self.status(true).await
    }
}

fn active_status(c: &Claims, offline: bool) -> LicenseStatus {
    LicenseStatus {
        active: true,
        status: c.status.clone(),
        plan: Some(c.plan.clone()),
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
        let canceled = make_token(&sk, serde_json::json!({"sub":"a","device_id":"d","status":"canceled","plan":"m","exp": now() + 60}));
        assert!(matches!(verify_token(&canceled, &vk, "d"), Err(AppError::PaymentRequired)));
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
}
