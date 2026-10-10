//! Wire helpers shared by more than one provider driver.
//!
//! These were copied verbatim into several drivers — the request header fold,
//! the random hex id generator, the upstream error-message extraction, the
//! bearer header, the token estimate, and the streamed-error reader. They are
//! pure and provider-agnostic, so they live here instead of once per driver.

use std::collections::BTreeMap;

use reqwest::header::{HeaderName, HeaderValue};
use serde_json::Value;

use crate::protocol::model::{ChatContent, ChatMessage};
use crate::protocol::usage::UsageBreakdown;

/// Applies a provider's header map onto a request, silently skipping any name
/// or value the HTTP layer rejects.
pub(crate) fn apply_headers(
    request: reqwest::RequestBuilder,
    headers: &BTreeMap<&'static str, String>,
) -> reqwest::RequestBuilder {
    headers.iter().fold(request, |request, (name, value)| {
        match (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            (Ok(name), Ok(value)) => request.header(name, value),
            _ => request,
        }
    })
}

/// A random lowercase hex string of `2 * length` characters.
pub(crate) fn random_hex(length: usize) -> String {
    let mut bytes = vec![0u8; length];
    let _ = getrandom::fill(&mut bytes);
    hex::encode(bytes)
}

/// The message of an upstream error body, which providers answer either as a
/// flat string or as the OpenAI `{ "error": { "message" } }` object.
pub(crate) fn error_message(payload: &Value) -> Option<String> {
    field_error_message(payload.get("error")?)
}

/// Reads one message out of an `error` value of either spelling.
pub(crate) fn field_error_message(error: &Value) -> Option<String> {
    if let Some(message) = error.as_str() {
        return Some(message.to_owned());
    }
    error
        .get("message")
        .or_else(|| error.get("code"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

/// Reports whether an upstream error payload is an OAuth `invalid_grant`.
pub(crate) fn payload_reports_invalid_grant(payload: &Value) -> bool {
    error_message(payload).is_some_and(|message| message.to_lowercase().contains("invalid_grant"))
}

/// The `Authorization` value for a plain access token. A provider that prefixes
/// the token keeps its own builder.
pub(crate) fn bearer_token(token: &str) -> String {
    format!("Bearer {token}")
}

/// A rough token count for a response the upstream sent without usage: four
/// characters per token, never zero.
pub(crate) fn estimate_usage(messages: &[ChatMessage], completion: &str) -> UsageBreakdown {
    let prompt_chars: usize = messages
        .iter()
        .map(|message| match &message.content {
            ChatContent::Text(text) => text.chars().count(),
            ChatContent::Parts(parts) => parts
                .iter()
                .filter_map(|part| part.text.as_ref())
                .map(|text| text.chars().count())
                .sum(),
            ChatContent::Null => 0,
        })
        .sum();
    let prompt_tokens = (prompt_chars / 4).max(1) as i64;
    let completion_tokens = (completion.chars().count() / 4).max(1) as i64;

    UsageBreakdown {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
        ..Default::default()
    }
}

/// The failure message of a streamed OpenAI-shaped frame, if it reports one.
/// `fallback` names the provider for the `finish_reason: "error"` case that
/// carries no message of its own.
pub(crate) fn stream_error_message(value: &Value, fallback: &str) -> Option<String> {
    if let Some(message) = error_message(value) {
        return Some(message);
    }

    let choice = value.get("choices")?.as_array()?.first()?;
    if choice.get("finish_reason").and_then(Value::as_str) != Some("error") {
        return None;
    }

    choice
        .get("error")
        .and_then(|error| {
            error
                .get("message")
                .or_else(|| error.get("code"))
                .and_then(Value::as_str)
                .or_else(|| error.as_str())
        })
        .map(str::to_owned)
        .or_else(|| Some(fallback.to_owned()))
}
