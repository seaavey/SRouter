//! Per-request access log: one `info` event for every request, success or failure, with the
//! method, path, redacted query, status, duration, redacted headers, a redacted request-body
//! summary, and the response type/size. Development visibility without leaking credentials:
//! sensitive header names, query keys, and JSON fields are replaced with `[REDACTED]`, and any
//! body is truncated before it reaches the log.

use std::time::Instant;

use axum::body::{Body, to_bytes};
use axum::extract::Request;
use axum::http::{HeaderMap, header};
use axum::middleware::Next;
use axum::response::Response;
use serde_json::Value;

/// Largest request body the log buffers for a summary; larger or chunked bodies pass through
/// untouched and are reported as uncaptured.
const BODY_CAPTURE_LIMIT: usize = 64 * 1024;
/// Longest body/header text rendered in one log line.
const DISPLAY_LIMIT: usize = 2048;

/// Logs one access event per request, then hands the request (body intact) to the rest of the
/// chain. The response body is never buffered, so SSE streams stay streaming.
pub async fn log_access(request: Request, next: Next) -> Response {
    let started = Instant::now();
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let query = request.uri().query().map(redact_query);
    let request_headers = summarize_headers(request.headers());

    let (parts, body) = request.into_parts();
    let (body, request_body) = capture_body(&parts.headers, body).await;
    let response = next.run(Request::from_parts(parts, body)).await;

    let status = response.status();
    let response_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| truncate(value, 128))
        .unwrap_or_else(|| "-".to_owned());
    let response_bytes = response
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("-")
        .to_owned();

    tracing::info!(
        %method,
        path = %path,
        query = query.as_deref().unwrap_or(""),
        status = status.as_u16(),
        duration_ms = started.elapsed().as_millis() as u64,
        request_headers = %request_headers,
        request_body = %request_body,
        response_type = %response_type,
        response_bytes = %response_bytes,
        "request"
    );

    response
}

/// Buffers a small, length-declared body for the summary and rebuilds it; anything larger or
/// chunked is forwarded untouched and reported as uncaptured.
async fn capture_body(headers: &HeaderMap, body: Body) -> (Body, String) {
    let length = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<usize>().ok());
    let chunked = headers
        .get(header::TRANSFER_ENCODING)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().contains("chunked"));

    match length {
        Some(length) if length <= BODY_CAPTURE_LIMIT => {
            match to_bytes(body, BODY_CAPTURE_LIMIT).await {
                Ok(bytes) => {
                    let summary = summarize_body(&bytes);
                    (Body::from(bytes), summary)
                }
                Err(_) => (Body::empty(), "<body read failed>".to_owned()),
            }
        }
        Some(_) => (body, "<body over capture limit>".to_owned()),
        None if chunked => (body, "<chunked body not captured>".to_owned()),
        // No content length and no chunked encoding means there is no request body.
        None => (body, String::new()),
    }
}

/// Renders a request body: JSON is redacted field by field, anything else is truncated raw with
/// obvious bearer/`sk-` tokens masked.
fn summarize_body(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    match serde_json::from_slice::<Value>(bytes) {
        Ok(mut value) => {
            redact_json(&mut value);
            truncate(&value.to_string(), DISPLAY_LIMIT)
        }
        Err(_) => {
            let text = String::from_utf8_lossy(bytes);
            truncate(&redact_plain(&text), DISPLAY_LIMIT)
        }
    }
}

/// Replaces sensitive JSON fields in place, recursively.
fn redact_json(value: &mut Value) {
    match value {
        Value::Object(entries) => {
            for (key, entry) in entries.iter_mut() {
                if is_sensitive_name(key) {
                    *entry = Value::String("[REDACTED]".to_owned());
                } else {
                    redact_json(entry);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(redact_json),
        _ => {}
    }
}

/// Masks `Bearer <token>` and `sk-...` runs in a non-JSON body.
fn redact_plain(text: &str) -> String {
    let mut rendered = String::with_capacity(text.len());
    let mut after_bearer = false;

    for (index, word) in text.split(' ').enumerate() {
        if index > 0 {
            rendered.push(' ');
        }
        if after_bearer || word.starts_with("sk-") {
            rendered.push_str("[REDACTED]");
            after_bearer = false;
        } else {
            rendered.push_str(word);
            after_bearer = word.ends_with("Bearer") || word.ends_with("Bearer:");
        }
    }

    rendered
}

/// `key=value` pairs with sensitive values masked; parameter order and encoding are preserved.
fn redact_query(query: &str) -> String {
    query
        .split('&')
        .map(|pair| match pair.split_once('=') {
            Some((key, _)) if is_sensitive_param(key) => format!("{key}=[REDACTED]"),
            _ => pair.to_owned(),
        })
        .collect::<Vec<_>>()
        .join("&")
}

/// Sorted `name=value` header summary with sensitive names masked.
fn summarize_headers(headers: &HeaderMap) -> String {
    let mut entries: Vec<String> = headers
        .iter()
        .map(|(name, value)| {
            let name = name.as_str().to_ascii_lowercase();
            if is_sensitive_name(&name) {
                format!("{name}=[REDACTED]")
            } else {
                let value = value
                    .to_str()
                    .map(|value| truncate(value, 256))
                    .unwrap_or_else(|_| "<binary>".to_owned());
                format!("{name}={value}")
            }
        })
        .collect();
    entries.sort();

    truncate(&entries.join(" "), DISPLAY_LIMIT)
}

/// Header or JSON field names that must never reach the log.
fn is_sensitive_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();

    matches!(
        name.as_str(),
        "authorization" | "proxy-authorization" | "cookie" | "set-cookie"
    ) || name.contains("token")
        || name.contains("secret")
        || name.contains("password")
        || name.contains("api-key")
        || name.contains("apikey")
        || name.contains("api_key")
}

/// Query parameters that must never reach the log, matching the header/JSON policy.
fn is_sensitive_param(name: &str) -> bool {
    is_sensitive_name(name)
        || matches!(name.to_ascii_lowercase().as_str(), "code" | "state" | "key")
}

/// Truncates on a character boundary, marking that output was cut.
fn truncate(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_owned();
    }

    let cut: String = value.chars().take(limit).collect();
    format!("{cut}…[truncated]")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{redact_query, summarize_body, summarize_headers};
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn json_bodies_are_redacted_field_by_field() {
        let body = json!({
            "model": "openai_codex/gpt-5.5",
            "apiKey": "secret-key",
            "accessToken": "token-value",
            "nested": { "refresh_token": "r", "keep": "ok" }
        })
        .to_string();

        let summary = summarize_body(body.as_bytes());

        assert!(summary.contains("openai_codex/gpt-5.5"));
        assert!(summary.contains("\"keep\":\"ok\""));
        assert!(!summary.contains("secret-key"));
        assert!(!summary.contains("token-value"));
        assert!(summary.contains("[REDACTED]"));
    }

    #[test]
    fn non_json_bodies_mask_bearer_and_key_tokens() {
        let summary = summarize_body(b"Authorization: Bearer abc.def.ghi and sk-live-1234");

        assert!(!summary.contains("abc.def.ghi"), "{summary}");
        assert!(!summary.contains("sk-live-1234"), "{summary}");
        assert!(summary.contains("[REDACTED]"));
    }

    #[test]
    fn sensitive_headers_and_query_parameters_are_masked() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", HeaderValue::from_static("Bearer secret"));
        headers.insert("content-type", HeaderValue::from_static("application/json"));

        let rendered = summarize_headers(&headers);
        assert!(rendered.contains("authorization=[REDACTED]"), "{rendered}");
        assert!(
            rendered.contains("content-type=application/json"),
            "{rendered}"
        );

        let query = redact_query("code=abc&state=xyz&model=gpt");
        assert_eq!(query, "code=[REDACTED]&state=[REDACTED]&model=gpt");
    }
}
