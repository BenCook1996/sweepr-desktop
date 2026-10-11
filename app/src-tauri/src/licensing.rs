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

const DEFAULT_API: &str = "http://localhost:8787";

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

fn load_pubkey() -> Option<VerifyingKey> {
    let b64 = option_env!("SWEEPR_LICENSE_PUBKEY")
        .map(str::to_string)
        .or_else(|| std::env::var("SWEEPR_LICENSE_PUBKEY").ok())?;
    let bytes: [u8; 32] = B64.decode(b64.trim()).ok()?.try_into().ok()?;
    VerifyingKey::from_bytes(&bytes).ok()
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

impl Licensing {
    pub fn new(data_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&data_dir);
        let api = std::env::var("SWEEPR_API_URL")
            .ok()
            .or_else(|| option_env!("SWEEPR_API_URL").map(str::to_string))
            .unwrap_or_else(|| DEFAULT_API.to_string());
        let device_id = device_id();
        let pubkey = load_pubkey();

        let mut state = State::default();
        state.account = std::fs::read(data_dir.join("account.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok());
        if let (Some(key), Ok(tok)) = (&pubkey, std::fs::read_to_string(data_dir.join("entitlement.jws"))) {
            if let Ok(claims) = verify_token(tok.trim(), key, &device_id) {
                state.token = Some((tok.trim().to_string(), claims));
            }
        }

        Self {
            api,
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

    fn dev_unlock() -> bool {
        cfg!(debug_assertions) && std::env::var("SWEEPR_DEV_UNLOCK").as_deref() == Ok("1")
    }

    async fn ensure_account(&self, st: &mut State) -> AppResult<Account> {
        if let Some(a) = &st.account {
            return Ok(a.clone());
        }
        let acc: Account = self
            .http
            .post(format!("{}/v1/accounts", self.api))
            .json(&serde_json::json!({ "device_id": self.device_id }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        std::fs::write(self.data_dir.join("account.json"), serde_json::to_vec(&acc)?)?;
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
            let acc = self.ensure_account(&mut st).await?;
            Ok(self
                .http
                .post(format!("{}/v1/entitlement", self.api))
                .bearer_auth(&acc.refresh_token)
                .json(&serde_json::json!({ "device_id": self.device_id }))
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?)
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

    async fn post_for_url(&self, path: &str) -> AppResult<String> {
        let mut st = self.state.lock().await;
        let acc = self.ensure_account(&mut st).await?;
        let r: UrlResponse = self
            .http
            .post(format!("{}{}", self.api, path))
            .bearer_auth(&acc.refresh_token)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(r.url)
    }

    pub async fn checkout_url(&self) -> AppResult<String> {
        self.post_for_url("/v1/checkout").await
    }

    pub async fn portal_url(&self) -> AppResult<String> {
        self.post_for_url("/v1/portal").await
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
}
