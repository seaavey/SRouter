//! Provider authentication routes under `/v1/auth/*`, plus the small query and
//! JSON-body helpers every device or callback route shares.

mod antigravity;
mod cline;
mod codebuddy;
mod grok_web;
mod openai;
mod qoder;

use std::collections::HashMap;

use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Serialize;
use serde_json::Value;

use crate::config::APIConfig;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::state::AppState;

pub use antigravity::{
    create_antigravity_callback_pages_router,
    create_antigravity_callback_pages_router_with_endpoints, create_antigravity_callback_router,
    create_antigravity_callback_router_with_endpoints, create_antigravity_login_router,
};
pub use cline::create_cline_login_router;
pub use codebuddy::{
    CodeBuddyAuthEndpoints, create_codebuddy_login_router,
    create_codebuddy_login_router_with_endpoints,
};
pub use grok_web::create_grok_web_login_router;
pub use openai::{
    create_openai_callback_pages_router, create_openai_callback_router, create_openai_login_router,
};
pub use qoder::{
    create_qoder_callback_pages_router, create_qoder_callback_router, create_qoder_login_router,
};

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

/// A PKCE verifier of the length RFC 7636 requires: 43 base64url characters.
fn pkce_verifier() -> String {
    let mut bytes = [0u8; 32];
    let _ = getrandom::fill(&mut bytes);

    URL_SAFE_NO_PAD.encode(bytes)
}

/// The S256 challenge of a verifier, which is what the browser receives.
fn pkce_challenge(code_verifier: &str) -> String {
    use sha2::{Digest, Sha256};

    URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()))
}

/// The database a provider-auth route needs. A process without one answers 500
/// with the provider's own message.
fn require_database<'a>(state: &'a AppState, message: &str) -> Result<&'a AppDatabase, APIError> {
    state
        .database
        .as_ref()
        .ok_or_else(|| APIError::new(500, message))
}

/// The last four digits of a millisecond timestamp, which label a freshly
/// created account.
fn account_suffix(timestamp: i64) -> String {
    let digits = timestamp.to_string();

    digits[digits.len().saturating_sub(4)..].to_owned()
}

/// The login answer of an authorization-code provider: the browser URL plus the
/// PKCE material the client echoes back on the callback. The field names are
/// the ones the web client reads, so they stay camelCase.
#[derive(Serialize)]
struct LoginResponse {
    #[serde(rename = "authorizeUrl")]
    authorize_url: String,
    state: String,
    #[serde(rename = "codeVerifier")]
    code_verifier: String,
    #[serde(rename = "redirectUri")]
    redirect_uri: String,
}

/// The JSON answer a finished callback returns.
#[derive(Serialize)]
struct CallbackResponse {
    success: bool,
    message: &'static str,
    provider: ConnectedProvider,
}

/// The `code` and `state` of a finished redirect, however the client carried
/// them.
#[derive(Debug, Default, PartialEq, Eq)]
struct CallbackParams {
    code: String,
    state: String,
}

/// Reads `code` and `state` from the query string, the JSON body, or a pasted
/// `callback_url`, which is how the web client finishes a redirected login.
fn parse_callback(query: Option<&str>, body: &[u8]) -> Result<CallbackParams, APIError> {
    let missing = || APIError::new(400, constants::providers::oauth::CALLBACK_MISSING_PARAMS);
    let query = query_params(query);
    let parsed: Value = serde_json::from_slice(body).unwrap_or(Value::Null);

    let mut code = query
        .get("code")
        .cloned()
        .or_else(|| text_field(&parsed, "code"));
    let mut state = query
        .get("state")
        .cloned()
        .or_else(|| text_field(&parsed, "state"));

    if let Some(callback_url) = text_field(&parsed, "callback_url")
        && let Ok(url) = url::Url::parse(&callback_url)
    {
        let from_url: HashMap<String, String> = url.query_pairs().into_owned().collect();
        code = code.or_else(|| from_url.get("code").cloned());
        state = state.or_else(|| from_url.get("state").cloned());
    }

    Ok(CallbackParams {
        code: code.ok_or_else(missing)?,
        state: state.ok_or_else(missing)?,
    })
}

/// Rewrites a localhost/127.0.0.1 redirect URI onto the configured public
/// origin, the way `apps/api/src/utils/callbackUrl.ts` does. A non-local URI
/// (a user-supplied custom callback) passes through untouched.
fn resolve_callback_url(redirect_uri: &str, config: &APIConfig) -> String {
    let Some(public_base) = config.public_url.as_deref() else {
        return redirect_uri.to_owned();
    };

    let Ok(url) = url::Url::parse(redirect_uri) else {
        return redirect_uri.to_owned();
    };
    let is_local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if !is_local {
        return redirect_uri.to_owned();
    }

    let path = if url.path().starts_with("/v1") {
        url.path().to_owned()
    } else {
        format!("/v1{}", url.path())
    };

    format!("{public_base}{path}")
}

/// The callback URI a login uses when the client did not supply one. The Rust
/// server hosts every callback on the main listener (`/v1/auth/.../callback`),
/// so the base is the public origin when configured and loopback otherwise.
/// The Node `:1455` OAuth listener is deliberately not ported (single-port
/// ruling, `TODO.md` section 1.4).
fn default_callback_uri(config: &APIConfig, path: &str) -> String {
    match config.public_url.as_deref() {
        Some(public_base) => format!("{public_base}/v1{path}"),
        None => format!("http://localhost:{}/v1{path}", config.port),
    }
}

/// The browser result page a finished login renders. Every dynamic value is
/// escaped and no token is ever shown, so a redirect landing here is safe to
/// display even on a shared machine.
fn success_page(message: &str, provider: &ConnectedProvider) -> Response {
    let message = escape_html(message);
    let name = escape_html(&provider.name);
    let id = escape_html(&provider.id);
    let body = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
         <title>Provider connected</title></head><body>\
         <h1>{message}</h1>\
         <p>Connected account: <strong>{name}</strong></p>\
         <p>Connection id: <code>{id}</code></p>\
         <p>You can close this tab.</p></body></html>"
    );

    Html(body).into_response()
}

/// The same page shape for a failure, carrying the API message and status.
fn error_page(error: &APIError) -> Response {
    let message = escape_html(error.message());
    let status = StatusCode::from_u16(error.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let body = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
         <title>Provider login failed</title></head><body>\
         <h1>Login gagal</h1>\
         <p>{message}</p></body></html>"
    );

    (status, Html(body)).into_response()
}

/// Escapes the characters that could break out of the page text.
fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::config::APIConfig;

    use super::{CallbackParams, default_callback_uri, parse_callback, resolve_callback_url};

    fn config(environment: &[(&str, &str)]) -> APIConfig {
        let mut map = HashMap::from([("HOME".to_owned(), "/tmp/srouter-test-home".to_owned())]);
        for (key, value) in environment {
            map.insert((*key).to_owned(), (*value).to_owned());
        }

        APIConfig::from_env_map(&map).expect("test configuration")
    }

    #[test]
    fn the_callback_reads_code_and_state_from_any_carrier() {
        let from_query =
            parse_callback(Some("code=code-1&state=state-1"), b"").expect("query parameters parse");
        assert_eq!(from_query.code, "code-1");
        assert_eq!(from_query.state, "state-1");

        let from_url = parse_callback(
            None,
            br#"{"callback_url":"http://localhost:1455/auth/openai/callback?code=code-2&state=state-2"}"#,
        )
        .expect("callback url parses");
        assert_eq!(
            from_url,
            CallbackParams {
                code: "code-2".to_owned(),
                state: "state-2".to_owned(),
            }
        );
    }

    #[test]
    fn a_callback_without_code_or_state_is_rejected() {
        let error = parse_callback(None, b"{}").expect_err("both fields are required");

        assert_eq!(error.status(), 400);
    }

    #[test]
    fn a_public_origin_rewrites_local_callbacks_but_not_custom_ones() {
        let configured = config(&[("SROUTER_PUBLIC_URL", "https://srouter.example.com/")]);

        assert_eq!(
            resolve_callback_url("http://localhost:1455/auth/openai/callback", &configured),
            "https://srouter.example.com/v1/auth/openai/callback"
        );
        assert_eq!(
            resolve_callback_url("http://127.0.0.1:1455/auth/callback", &configured),
            "https://srouter.example.com/v1/auth/callback"
        );
        assert_eq!(
            resolve_callback_url("http://localhost:3000/v1/auth/callback", &configured),
            "https://srouter.example.com/v1/auth/callback"
        );
        assert_eq!(
            resolve_callback_url("https://myapp.example.com/cb", &configured),
            "https://myapp.example.com/cb"
        );
    }

    #[test]
    fn without_a_public_origin_callbacks_pass_through_unchanged() {
        let loopback = config(&[]);

        assert_eq!(
            resolve_callback_url("http://localhost:1455/auth/callback", &loopback),
            "http://localhost:1455/auth/callback"
        );
    }

    #[test]
    fn the_default_callback_lives_on_the_main_listener() {
        let loopback = config(&[]);
        assert_eq!(
            default_callback_uri(&loopback, "/auth/openai/callback"),
            "http://localhost:3000/v1/auth/openai/callback"
        );

        let public = config(&[("SROUTER_PUBLIC_URL", "https://srouter.example.com")]);
        assert_eq!(
            default_callback_uri(&public, "/auth/openai/callback"),
            "https://srouter.example.com/v1/auth/openai/callback"
        );
    }
}
