use serde::ser::{Serialize, SerializeStruct, Serializer};

/// Errors returned to the frontend. Serialised as `{ kind, message }` so the UI
/// can branch on `kind` (e.g. show the paywall on `payment_required`).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("An active subscription is required for this action")]
    PaymentRequired,
    #[error("Network error: {0}")]
    Network(String),
    #[error("License error: {0}")]
    License(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::PaymentRequired => "payment_required",
            AppError::Network(_) => "network",
            AppError::License(_) => "license",
            AppError::NotFound(_) => "not_found",
            AppError::Other(_) => "other",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_connect() || e.is_timeout() {
            return AppError::Network(
                "Could not connect to the Sweepr server. Please check your internet connection and try again.".into(),
            );
        }
        if let Some(status) = e.status() {
            return match status.as_u16() {
                409 => AppError::License("This account already has an active subscription.".into()),
                429 => AppError::Network("Too many requests. Please wait a moment and try again.".into()),
                503 => AppError::Network("Checkout service is temporarily unavailable. Please try again shortly.".into()),
                code => AppError::Network(format!("Server returned an unexpected error (HTTP {code}).")),
            };
        }
        AppError::Network("Unable to complete network request. Please try again.".into())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
