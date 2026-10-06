//! The Grok Web cookie connect flow: the operator posts the session cookie
//! (as JSON, as raw text, or as an uploaded `.txt` file), the server probes
//! grok.com for the issued `x-userid`, and a verified cookie is stored as a
//! provider connection.
//!
//! Verification reuses the executor's page probe, so the connect route and the
//! chat path agree on what a valid cookie looks like: `200` plus `x-userid`
//! means usable, a redirect to `accounts.x.ai` means expired.

use std::time::Duration;

use axum::body::to_bytes;
use axum::extract::{FromRequest, Multipart, Request, State};
use axum::http::{StatusCode, header};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::Value;

use super::{ConnectedProvider, require_database, text_field};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::grok_web::executor::{probe_client, probe_uid};
use crate::features::providers::grok_web::types::GROK_WEB_PROVIDER;
use crate::infrastructure::database::providers::{
    GrokWebConnectionWrite, upsert_grok_web_connection,
};
use crate::state::AppState;

/// Upper bound for the connect-time page probe; a healthy grok.com answers in
/// well under a second.
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Upper bound for a raw or JSON connect body; a cookie file is tiny.
const COOKIE_BODY_LIMIT: usize = 64 * 1024;

/// Longest accepted `sso` value: well past any real session token and far
/// below the body limit, so an oversized paste never reaches the probe.
const SSO_MAX_LEN: usize = 8192;

/// Routes the admin session guard: posting the Grok Web session cookie.
pub fn create_grok_web_login_router() -> Router<AppState> {
    Router::new().route("/auth/grok-web/connect", post(connect))
}

/// `POST /v1/auth/grok-web/connect` verifies and stores the cookie. The body
/// carries the cookie as JSON under `cookie`, `sso`, or `api_key`, as the raw
/// text itself, or as a multipart upload of a `.txt` cookie file; every shape
/// is reduced to the bare `sso` value before the probe.
async fn connect(
    State(state): State<AppState>,
    request: Request,
) -> Result<(StatusCode, Json<ConnectedProvider>), APIError> {
    let posted = posted_cookie(request, &state).await?;
    let sso = extract_sso(&posted);
    validate_sso(&sso)?;

    let database = require_database(&state, constants::providers::grok_web::DATABASE_REQUIRED)?;
    let endpoints = state.providers.grok_web_endpoints().unwrap_or_default();

    let client = probe_client()?;
    probe_uid(&client, &endpoints.page_url, &sso, PROBE_TIMEOUT).await?;

    let timestamp = now_ms();
    let id = format!("grok-web_{timestamp}");
    let name = "Grok Web".to_owned();
    upsert_grok_web_connection(
        database,
        &GrokWebConnectionWrite {
            id: id.clone(),
            name: name.clone(),
            sso,
        },
    )
    .await?;

    // The connection exists now, so the static model list can appear in the
    // catalog before the operator's next request reads it.
    state.providers.maybe_refresh_catalogs(true).await;

    Ok((
        StatusCode::CREATED,
        Json(ConnectedProvider {
            id,
            provider_id: GROK_WEB_PROVIDER.id.to_owned(),
            name,
            category: GROK_WEB_PROVIDER.category.to_owned(),
            protocol: GROK_WEB_PROVIDER.protocol,
            enabled: true,
            created_at: timestamp,
        }),
    ))
}

/// The cookie text of a connect request, from whichever shape the client
/// used: a JSON object, the raw body, or a multipart form.
async fn posted_cookie(request: Request, state: &AppState) -> Result<String, APIError> {
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if content_type.starts_with("multipart/form-data") {
        return posted_cookie_multipart(request, state).await;
    }

    let body = to_bytes(request.into_body(), COOKIE_BODY_LIMIT)
        .await
        .map_err(|_| invalid_cookie_payload())?;

    let looks_json = content_type.starts_with("application/json")
        || body.iter().find(|byte| !byte.is_ascii_whitespace()) == Some(&b'{');
    if looks_json {
        return cookie_json_field(&body);
    }

    Ok(String::from_utf8_lossy(&body).into_owned())
}

/// The cookie field of a JSON connect body.
fn cookie_json_field(body: &[u8]) -> Result<String, APIError> {
    let parsed: Value = serde_json::from_slice(body).map_err(|_| invalid_cookie_payload())?;

    ["cookie", "sso", "api_key", "apiKey"]
        .iter()
        .find_map(|key| text_field(&parsed, key))
        .ok_or_else(invalid_cookie_payload)
}

/// The cookie text of a multipart form: the uploaded file wins, then a field
/// named like the JSON keys.
async fn posted_cookie_multipart(request: Request, state: &AppState) -> Result<String, APIError> {
    let mut multipart = Multipart::from_request(request, state)
        .await
        .map_err(|_| invalid_cookie_payload())?;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| invalid_cookie_payload())?
    {
        let is_file = field.file_name().is_some();
        let is_cookie_field = matches!(field.name(), Some("cookie" | "sso" | "api_key" | "apiKey"));
        if !is_file && !is_cookie_field {
            continue;
        }

        let text = field.text().await.map_err(|_| invalid_cookie_payload())?;
        let text = text.trim();
        if !text.is_empty() {
            return Ok(text.to_owned());
        }
    }

    Err(invalid_cookie_payload())
}

/// The bare `sso` value out of whatever the operator pasted: the token
/// itself, an `sso=<value>` pair inside a cookie line, or a row of a
/// Netscape `cookies.txt` export.
fn extract_sso(raw: &str) -> String {
    if let Some(value) = raw.lines().find_map(netscape_sso) {
        return value;
    }

    raw.split([';', '\n'])
        .find_map(|pair| {
            let (name, value) = pair.trim().split_once('=')?;
            (name.trim() == "sso").then(|| value.trim().to_owned())
        })
        .unwrap_or_else(|| raw.trim().to_owned())
}

/// The `sso` value of one tab-separated Netscape cookie row: domain, flag,
/// path, secure, expiry, name, value.
fn netscape_sso(row: &str) -> Option<String> {
    let fields: Vec<&str> = row.split('\t').collect();
    if fields.len() < 7 || fields[5] != "sso" {
        return None;
    }

    let value = fields[6].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_owned())
    }
}

/// The extracted token before it becomes an outbound `Cookie` header and a
/// stored credential: non-empty, bounded, and restricted to RFC 6265
/// cookie octets, so control characters, separators, and quotes cannot ride
/// along into the probe request or the database.
fn validate_sso(sso: &str) -> Result<(), APIError> {
    let bounded = !sso.is_empty() && sso.len() <= SSO_MAX_LEN;
    if bounded && sso.bytes().all(is_cookie_octet) {
        Ok(())
    } else {
        Err(invalid_cookie_value())
    }
}

/// RFC 6265 cookie-octet: `%x21 / %x23-2B / %x2D-3A / %x3C-5B / %x5D-7E`
/// (visible ASCII without space, quote, comma, semicolon, or backslash).
fn is_cookie_octet(byte: u8) -> bool {
    byte == 0x21
        || (0x23..=0x2B).contains(&byte)
        || (0x2D..=0x3A).contains(&byte)
        || (0x3C..=0x5B).contains(&byte)
        || (0x5D..=0x7E).contains(&byte)
}

fn invalid_cookie_payload() -> APIError {
    APIError::new(400, constants::providers::grok_web::COOKIE_PAYLOAD_INVALID)
}

fn invalid_cookie_value() -> APIError {
    APIError::new(400, constants::providers::grok_web::COOKIE_VALUE_INVALID)
}

#[cfg(test)]
mod tests {
    use super::{SSO_MAX_LEN, extract_sso, validate_sso};

    #[test]
    fn every_accepted_shape_reduces_to_the_bare_sso_value() {
        assert_eq!(extract_sso("fixture-valid"), "fixture-valid");
        assert_eq!(extract_sso("sso=fixture-valid"), "fixture-valid");
        assert_eq!(
            extract_sso("sso=fixture-valid; sso_csrf=ignored"),
            "fixture-valid"
        );
        assert_eq!(
            extract_sso("a=1\nsso=fixture-valid\nb=2"),
            "fixture-valid",
            "one name=value pair per line is a cookie line too"
        );
        assert_eq!(
            extract_sso("grok.com\tTRUE\t/\tTRUE\t1790000000\tsso\tfixture-valid"),
            "fixture-valid",
            "a Netscape cookies.txt row"
        );
    }

    #[test]
    fn a_cookie_value_must_be_a_bounded_printable_ascii_token() {
        assert!(validate_sso("fixture-valid").is_ok());
        assert!(validate_sso(&"a".repeat(SSO_MAX_LEN)).is_ok());

        assert!(validate_sso("").is_err(), "empty");
        assert!(
            validate_sso(&"a".repeat(SSO_MAX_LEN + 1)).is_err(),
            "over the cap"
        );
        assert!(validate_sso("fixture\u{1}-valid").is_err(), "control byte");
        assert!(validate_sso("fixture\r\nvalid").is_err(), "CRLF");
        assert!(validate_sso("fixture valid").is_err(), "space");
        assert!(validate_sso("sso=a; b=2").is_err(), "semicolon");
        assert!(validate_sso("quote\"inside").is_err(), "quote");
        assert!(validate_sso("kafé").is_err(), "non-ASCII");
    }
}
