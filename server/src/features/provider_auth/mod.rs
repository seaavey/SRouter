//! Provider authentication routes under `/v1/auth/*`, plus the small query and
//! JSON-body helpers every device or callback route shares.

mod cline;
mod grok_web;
mod qoder;

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

use crate::error::APIError;

pub use cline::create_cline_login_router;
pub use grok_web::create_grok_web_login_router;
pub use qoder::{create_qoder_callback_router, create_qoder_login_router};

/// The wire protocol a connected provider speaks.
#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum Protocol {
    OpenAI,
    Anthropic,
}

impl Protocol {
    /// Maps a provider metadata `protocol` name onto the enum. Unknown names
    /// keep the OpenAI shape, which is what every seed provider speaks.
    fn from_name(name: &str) -> Self {
        match name {
            "anthropic" => Self::Anthropic,
            _ => Self::OpenAI,
        }
    }
}

/// The connected provider, echoed back so the client can show what was stored.
#[derive(Serialize)]
struct ConnectedProvider {
    id: String,
    provider_id: String,
    name: String,
    category: String,
    protocol: Protocol,
    enabled: bool,
    created_at: i64,
}

/// The poll round-trip outcome the client switches on.
#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum PollStatus {
    Pending,
    Ok,
}

#[derive(Serialize)]
struct PollResponse {
    status: PollStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<ConnectedProvider>,
}

impl PollResponse {
    fn pending(error: Option<String>) -> Self {
        Self {
            status: PollStatus::Pending,
            error,
            provider: None,
        }
    }

    fn ok(provider: ConnectedProvider) -> Self {
        Self {
            status: PollStatus::Ok,
            error: None,
            provider: Some(provider),
        }
    }
}

/// Why one poll round trip did not produce a connection.
enum PollFailure {
    /// The browser has not approved yet; the caller releases the claim.
    Pending,
    /// The upstream answered with something the client should see.
    Message(String),
    /// A failure the route turns into an error response.
    Fatal(APIError),
}

/// Percent-decoded `key=value` pairs of a raw query string.
fn query_params(query: Option<&str>) -> HashMap<String, String> {
    query
        .unwrap_or_default()
        .split('&')
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;

            Some((percent_decode(key), percent_decode(value)))
        })
        .collect()
}

/// Decodes one query component. `+` stands for a space, which is what a client
/// sending a form-encoded query does.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                match std::str::from_utf8(&bytes[index + 1..index + 3])
                    .ok()
                    .and_then(|hex| u8::from_str_radix(hex, 16).ok())
                {
                    Some(byte) => {
                        decoded.push(byte);
                        index += 3;
                    }
                    None => {
                        decoded.push(b'%');
                        index += 1;
                    }
                }
            }
            b'+' => {
                decoded.push(b' ');
                index += 1;
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

/// The `state` a client posted as a JSON body.
fn state_from_body(body: &[u8]) -> Option<String> {
    let parsed: Value = serde_json::from_slice(body).ok()?;

    text_field(&parsed, "state")
}

/// A non-empty string field of a JSON object, trimmed.
fn text_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}
