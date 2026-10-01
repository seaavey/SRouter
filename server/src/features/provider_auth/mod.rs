//! Provider authentication routes under `/v1/auth/*`, plus the small query and
//! JSON-body helpers every device or callback route shares.

mod cline;
mod qoder;

use std::collections::HashMap;

use serde_json::Value;

pub use cline::create_cline_login_router;
pub use qoder::{create_qoder_callback_router, create_qoder_login_router};

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
