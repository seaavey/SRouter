//! Pure translation between the OpenAI chat wire format and the Antigravity
//! (Google CloudCode IDE) envelope and Gemini SSE frames.
//!
//! This module performs no I/O. Remote image bytes arrive through an injected
//! fetcher ([`build_contents_async`]) and timestamps are parameters, so every
//! function here is deterministic and unit-testable in isolation. The executor
//! wires the SSRF-guarded fetcher and the system clock.
//!
//! Behaviour mirrors `packages/translator/src/antigravity.ts`. Two oracle
//! branches are not portable because the Rust request model has no field for
//! them: the legacy assistant `function_call` object and a caller-supplied
//! `thought_signature`. A tool call therefore always carries
//! `skip_thought_signature_validator`, exactly as the oracle does when no
//! signature is supplied.

use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;

use serde_json::{Value, json};

use crate::protocol::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ContentPartType, ToolCall,
};

/// An image resolved to `(mimeType, base64)`.
pub type InlineImage = (String, String);

// ─── requestId and envelope ────────────────────────────────────────────────

/// Inputs to [`build_ide_request_id`]. The conversation and trajectory ids are
/// derived from the session, the model, and the request type, so a retry of the
/// same turn keeps its identity.
pub struct IdeRequestIdArgs<'a> {
    /// A caller-supplied `requestId` reused verbatim when it already matches the
    /// IDE format.
    pub existing_request_id: Option<&'a str>,
    pub session_id: Option<&'a str>,
    pub model: &'a str,
    pub request_type: &'a str,
    /// Number of `contents` entries the request carries; the step is `2n - 1`.
    pub content_count: usize,
    pub now_ms: i64,
}

/// Builds the five-segment IDE requestId
/// `agent/<conversation>/<timestamp>/<trajectory>/<step>`. The backend validates
/// this shape, so a caller-supplied id is only reused when it matches.
pub fn build_ide_request_id(args: &IdeRequestIdArgs<'_>) -> String {
    if let Some(existing) = args.existing_request_id
        && is_valid_ide_request_id(existing)
    {
        return existing.to_owned();
    }

    let session = args
        .session_id
        .filter(|value| !value.is_empty())
        .unwrap_or("anonymous");
    let conversation_id = uuid_from_seed(&format!("antigravity:conversation:{session}"));
    let trajectory_id = uuid_from_seed(&format!(
        "antigravity:trajectory:{session}:{}:{}",
        args.model, args.request_type
    ));
    let step = args
        .content_count
        .saturating_mul(2)
        .saturating_sub(1)
        .max(1);

    format!(
        "agent/{conversation_id}/{}/{trajectory_id}/{step}",
        args.now_ms
    )
}

/// The oracle regex `^agent/[^/]+/\d+/[^/]+/\d+$`, without a regex engine.
pub fn is_valid_ide_request_id(value: &str) -> bool {
    let mut segments = value.split('/');
    if segments.next() != Some("agent") {
        return false;
    }
    let (Some(conversation), Some(timestamp), Some(trajectory), Some(step)) = (
        segments.next(),
        segments.next(),
        segments.next(),
        segments.next(),
    ) else {
        return false;
    };
    if segments.next().is_some() {
        return false;
    }

    !conversation.is_empty()
        && !timestamp.is_empty()
        && timestamp.bytes().all(|byte| byte.is_ascii_digit())
        && !trajectory.is_empty()
        && !step.is_empty()
        && step.bytes().all(|byte| byte.is_ascii_digit())
}

/// A UUID-shaped string whose first sixteen bytes are a SHA-256 of the seed,
/// with the version and variant nibbles pinned. This is the oracle's
/// `uuidFromSeed`, not RFC 4122 name-based v5.
fn uuid_from_seed(seed: &str) -> String {
    use sha2::{Digest, Sha256};

    let seed = if seed.is_empty() { "antigravity" } else { seed };
    let digest = Sha256::digest(seed.as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex = hex::encode(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// Inputs to [`build_envelope`].
pub struct EnvelopeArgs<'a> {
    pub project_id: &'a str,
    /// The upstream wire model name (already mapped by [`parse_model_name`]).
    pub model: &'a str,
    pub request_type: &'a str,
    pub request: Value,
    pub existing_request_id: Option<&'a str>,
    pub session_id: Option<&'a str>,
    pub enabled_credit_types: Option<&'a [String]>,
    pub now_ms: i64,
}

/// Wraps a request in the IDE envelope the `daily-cloudcode` host expects.
pub fn build_envelope(args: EnvelopeArgs<'_>) -> Value {
    let content_count = args
        .request
        .get("contents")
        .and_then(Value::as_array)
        .map_or(1, Vec::len);
    let session = args
        .request
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or_else(|| args.session_id.filter(|value| !value.is_empty()))
        .unwrap_or("anonymous");
    let request_id = build_ide_request_id(&IdeRequestIdArgs {
        existing_request_id: args.existing_request_id,
        session_id: Some(session),
        model: args.model,
        request_type: args.request_type,
        content_count,
        now_ms: args.now_ms,
    });

    let mut envelope = json!({
        "project": args.project_id,
        "model": args.model,
        "userAgent": "antigravity",
        "requestType": args.request_type,
        "requestId": request_id,
        "request": args.request,
    });
    if let Some(credits) = args.enabled_credit_types.filter(|types| !types.is_empty()) {
        envelope["enabledCreditTypes"] = json!(credits);
    }
    envelope
}

// ─── model mapping ─────────────────────────────────────────────────────────

/// Maps a public Antigravity id (optionally `provider/id`) to the CloudCode
/// wire name. Unknown ids pass through.
pub fn parse_model_name(raw_model: &str) -> String {
    let model = raw_model.split('/').nth(1).unwrap_or(raw_model);
    match model {
        "gemini-3.8-flash-high" | "gemini-3.8-flash-medium" | "gemini-3.8-flash-low" => {
            "gemini-3.8-flash-tiered".to_owned()
        }
        "gemini-3.7-flash-high" | "gemini-3.7-flash-medium" | "gemini-3.7-flash-low" => {
            "gemini-3.7-flash-tiered".to_owned()
        }
        "gemini-3.5-flash-high" => "gemini-3-flash-agent".to_owned(),
        "gemini-3.1-pro-high" => "gemini-pro-agent".to_owned(),
        "gemini-3.5-flash-medium" => "gemini-3.5-flash-low".to_owned(),
        "gemini-3.5-flash-low" => "gemini-3.5-flash-extra-low".to_owned(),
        other => other.to_owned(),
    }
}

/// The pro-family fallback chain attempted on HTTP 400. Any other model is its
/// own single candidate.
pub fn model_fallbacks(raw_model: &str) -> Vec<String> {
    let clean = parse_model_name(raw_model);
    let raw = raw_model.split('/').nth(1).unwrap_or(raw_model);
    fallback_chain(&clean)
        .or_else(|| fallback_chain(raw))
        .unwrap_or_else(|| vec![clean])
}

fn fallback_chain(model: &str) -> Option<Vec<String>> {
    let chain: &[&str] = match model {
        "gemini-3.1-pro-high" | "gemini-pro-agent" => {
            &["gemini-pro-agent", "gemini-3.1-pro-high", "gemini-3-pro"]
        }
        "gemini-3.1-pro-low" => &["gemini-pro-agent", "gemini-3.1-pro-low", "gemini-3-pro"],
        _ => return None,
    };
    Some(chain.iter().map(|name| (*name).to_owned()).collect())
}

/// Per-family output cap that keeps an oversized `max_tokens` from drawing a
/// 400 from the upstream.
pub fn output_cap(model_id: Option<&str>) -> u32 {
    let Some(model_id) = model_id else {
        return 8192;
    };
    let lower = model_id.to_lowercase();
    if lower.contains("thinking") || lower.contains("opus") || lower.contains("sonnet") {
        64000
    } else if lower.contains("pro") || lower.contains("flash") {
        65536
    } else {
        8192
    }
}

// ─── contents ──────────────────────────────────────────────────────────────

/// How a remote (`http(s)`) image URL is handled. The sync path leaves a text
/// placeholder; the async path substitutes the fetched bytes, or drops the
/// image when the fetch failed.
enum RemoteImages<'a> {
    Placeholder,
    Resolved(&'a BTreeMap<String, InlineImage>),
}

/// Builds Gemini `contents` from the request messages. Remote image URLs become
/// text placeholders, mirroring the oracle's synchronous builder.
pub fn build_contents(request: &ChatCompletionRequest) -> Vec<Value> {
    build_contents_with(request, &RemoteImages::Placeholder)
}

/// Builds Gemini `contents`, resolving remote image URLs through the injected
/// fetcher (the executor passes an SSRF-guarded implementation). A failed fetch
/// drops that image, exactly as the oracle's async builder does.
pub async fn build_contents_async<F, Fut>(request: &ChatCompletionRequest, fetch: F) -> Vec<Value>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Option<InlineImage>>,
{
    let mut resolved = BTreeMap::new();
    for url in remote_image_urls(request) {
        if let Some(image) = fetch(url.clone()).await {
            resolved.insert(url, image);
        }
    }
    build_contents_with(request, &RemoteImages::Resolved(&resolved))
}

fn build_contents_with(request: &ChatCompletionRequest, remote: &RemoteImages<'_>) -> Vec<Value> {
    let tool_call_names = tool_call_name_map(request);
    let mut merged: Vec<(&'static str, Vec<Value>)> = Vec::new();

    for message in &request.messages {
        let role = if message.role == ChatRole::Assistant {
            "model"
        } else {
            "user"
        };
        let parts = message_parts(message, &tool_call_names, remote);
        if parts.is_empty() {
            continue;
        }
        match merged.last_mut() {
            Some(last) if last.0 == role => last.1.extend(parts),
            _ => merged.push((role, parts)),
        }
    }

    if merged.is_empty() {
        merged.push(("user", vec![json!({ "text": "..." })]));
    }

    let mut contents: Vec<Value> = merged
        .into_iter()
        .map(|(role, parts)| json!({ "role": role, "parts": parts }))
        .collect();
    strip_trailing_assistant_turn(&mut contents);
    contents
}

/// The `tool_call_id` → function name map used to name a tool result.
fn tool_call_name_map(request: &ChatCompletionRequest) -> BTreeMap<String, String> {
    let mut names = BTreeMap::new();
    for message in &request.messages {
        if let Some(tool_calls) = &message.tool_calls {
            for call in tool_calls {
                if !call.id.is_empty() && !call.function.name.is_empty() {
                    names.insert(call.id.clone(), call.function.name.clone());
                }
            }
        }
    }
    names
}

fn message_parts(
    message: &ChatMessage,
    tool_call_names: &BTreeMap<String, String>,
    remote: &RemoteImages<'_>,
) -> Vec<Value> {
    let mut parts = Vec::new();

    if message.role == ChatRole::Assistant
        && message
            .tool_calls
            .as_ref()
            .is_some_and(|calls| !calls.is_empty())
    {
        let text = match &message.content {
            ChatContent::Text(text) => text.trim().to_owned(),
            _ => String::new(),
        };
        if !text.is_empty() {
            let text = strip_competitive_agent_prompts(&strip_zero_width_str(&text));
            if !text.is_empty() {
                parts.push(json!({ "text": text }));
            }
        }
        for call in message.tool_calls.as_ref().expect("checked above") {
            parts.push(function_call_part(call));
        }
    } else if message.role == ChatRole::Tool {
        let raw_name = message
            .tool_call_id
            .as_deref()
            .and_then(|id| tool_call_names.get(id))
            .map(String::as_str)
            .or_else(|| message.name.as_deref().filter(|name| !name.is_empty()))
            .or_else(|| message.tool_call_id.as_deref().filter(|id| !id.is_empty()))
            .unwrap_or("function");
        parts.push(json!({
            "functionResponse": {
                "name": sanitize_function_name(raw_name),
                "response": tool_response(&message.content),
            }
        }));
    } else {
        match &message.content {
            ChatContent::Text(text) => {
                let text = strip_competitive_agent_prompts(&strip_zero_width_str(text));
                if !text.is_empty() {
                    parts.push(json!({ "text": text }));
                }
            }
            ChatContent::Parts(content_parts) => {
                for part in content_parts {
                    match part.kind {
                        ContentPartType::Text => {
                            if let Some(text) = part.text.as_deref().filter(|text| !text.is_empty())
                            {
                                let text =
                                    strip_competitive_agent_prompts(&strip_zero_width_str(text));
                                if !text.is_empty() {
                                    parts.push(json!({ "text": text }));
                                }
                            }
                        }
                        ContentPartType::ImageUrl => {
                            if let Some(url) =
                                part.image_url.as_ref().map(|image| image.url.as_str())
                            {
                                push_image_part(url, remote, &mut parts);
                            }
                        }
                    }
                }
            }
            ChatContent::Null => {}
        }
    }

    if parts.is_empty() {
        parts.push(json!({ "text": "..." }));
    }
    parts
}

/// An assistant tool call as a Gemini `functionCall` part. The Rust model does
/// not carry a `thought_signature`, so the oracle's skip marker is always used.
fn function_call_part(call: &ToolCall) -> Value {
    json!({
        "functionCall": {
            "name": sanitize_function_name(&call.function.name),
            "args": parse_tool_arguments(&call.function.arguments),
        },
        "thought_signature": "skip_thought_signature_validator",
    })
}

fn parse_tool_arguments(arguments: &str) -> Value {
    let source = if arguments.is_empty() {
        "{}"
    } else {
        arguments
    };
    match serde_json::from_str::<Value>(source) {
        Ok(parsed) => strip_zero_width(parsed),
        Err(_) => json!({ "raw": arguments }),
    }
}

/// A tool result as a Gemini `functionResponse` payload. An object body is
/// passed through; anything else is wrapped under `output`.
fn tool_response(content: &ChatContent) -> Value {
    match content {
        ChatContent::Text(text) => match serde_json::from_str::<Value>(text) {
            Ok(parsed) if parsed.is_object() => strip_zero_width(parsed),
            Ok(parsed) if parsed.is_null() => json!({ "output": "" }),
            Ok(parsed) => json!({ "output": parsed }),
            Err(_) => json!({ "output": text }),
        },
        ChatContent::Parts(parts) => json!({ "output": parts }),
        ChatContent::Null => json!({ "output": "" }),
    }
}

fn push_image_part(url: &str, remote: &RemoteImages<'_>, parts: &mut Vec<Value>) {
    if let Some((mime_type, data)) = data_uri_image(url) {
        parts.push(json!({ "inlineData": { "mimeType": mime_type, "data": data } }));
        return;
    }
    if !is_remote_url(url) {
        return;
    }
    match remote {
        RemoteImages::Placeholder => parts.push(json!({ "text": format!("[Image: {url}]") })),
        RemoteImages::Resolved(images) => {
            if let Some((mime_type, data)) = images.get(url) {
                parts.push(json!({ "inlineData": { "mimeType": mime_type, "data": data } }));
            }
        }
    }
}

/// Collects the distinct remote image URLs a request carries, ignoring any
/// message whose parts the builder does not walk (assistant tool-call turns).
fn remote_image_urls(request: &ChatCompletionRequest) -> Vec<String> {
    let mut urls = Vec::new();
    for message in &request.messages {
        if message.role == ChatRole::Assistant
            && message
                .tool_calls
                .as_ref()
                .is_some_and(|calls| !calls.is_empty())
        {
            continue;
        }
        if let ChatContent::Parts(parts) = &message.content {
            for part in parts {
                if part.kind == ContentPartType::ImageUrl
                    && let Some(url) = part.image_url.as_ref().map(|image| &image.url)
                    && is_remote_url(url)
                    && !urls.contains(url)
                {
                    urls.push(url.clone());
                }
            }
        }
    }
    urls
}

/// Splits a `data:<mime>;base64,<data>` URI. Mirrors the oracle regex
/// `^data:([^;]+);base64,(.+)$` (no newlines in the payload).
fn data_uri_image(url: &str) -> Option<InlineImage> {
    let rest = url.strip_prefix("data:")?;
    let (mime, after) = rest.split_once(';')?;
    if mime.is_empty() {
        return None;
    }
    let data = after.strip_prefix("base64,")?;
    if data.is_empty() || data.contains('\n') {
        return None;
    }
    Some((mime.to_owned(), data.to_owned()))
}

fn is_remote_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// Drops a trailing `model` turn (CloudCode rejects a request ending on one),
/// keeping at least one turn.
pub fn strip_trailing_assistant_turn(contents: &mut Vec<Value>) {
    while contents.len() > 1
        && contents
            .last()
            .and_then(|content| content.get("role"))
            .and_then(Value::as_str)
            == Some("model")
    {
        contents.pop();
    }
}

// ─── text helpers ──────────────────────────────────────────────────────────

/// Removes the zero-width characters the oracle strips: U+200B–U+200D, U+FEFF.
pub fn strip_zero_width(value: Value) -> Value {
    match value {
        Value::String(text) => Value::String(strip_zero_width_str(&text)),
        Value::Array(items) => Value::Array(items.into_iter().map(strip_zero_width).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, item)| (key, strip_zero_width(item)))
                .collect(),
        ),
        other => other,
    }
}

fn strip_zero_width_str(text: &str) -> String {
    text.chars()
        .filter(|character| {
            !matches!(
                *character,
                '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}'
            )
        })
        .collect()
}

/// Competitive-agent identity sentences that trip the backend's 429 filter.
const COMPETITIVE_AGENT_PROMPTS: &[&str] = &[
    "you are a claude agent",
    "built on anthropic's claude agent sdk",
    "you are claude code",
    "you are an ai assistant created by anthropic",
];

/// Removes the first occurrence of each competing-agent sentence (up to the
/// next period or newline), then collapses the resulting blank lines. Port of
/// the oracle's four case-insensitive regexes.
pub fn strip_competitive_agent_prompts(text: &str) -> String {
    let mut result = text.to_owned();
    for phrase in COMPETITIVE_AGENT_PROMPTS {
        result = remove_first_phrase(&result, phrase);
        result = collapse_newlines(&result);
        result = result.trim_start().to_owned();
    }
    result
}

fn remove_first_phrase(text: &str, phrase: &str) -> String {
    let Some(start) = find_phrase(text, phrase) else {
        return text.to_owned();
    };
    let phrase_end = start + phrase.len();
    let mut end = phrase_end;
    for character in text[phrase_end..].chars() {
        if character == '.' || character == '\n' {
            break;
        }
        end += character.len_utf8();
    }
    if text[end..].starts_with('.') {
        end += 1;
    }
    while let Some(character) = text[end..].chars().next()
        && character.is_whitespace()
    {
        end += character.len_utf8();
    }
    format!("{}{}", &text[..start], &text[end..])
}

/// Finds `needle` case-insensitively at a word boundary, returning its byte
/// offset. The phrases are ASCII, so ASCII case folding is exact.
fn find_phrase(haystack: &str, needle: &str) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    let characters: Vec<(usize, char)> = haystack.char_indices().collect();
    let wanted: Vec<char> = needle.chars().collect();
    if characters.len() < wanted.len() {
        return None;
    }

    'outer: for start in 0..=(characters.len() - wanted.len()) {
        for (offset, expected) in wanted.iter().enumerate() {
            if !characters[start + offset].1.eq_ignore_ascii_case(expected) {
                continue 'outer;
            }
        }
        let begin = characters[start].0;
        let before = haystack[..begin].chars().next_back();
        let after = characters
            .get(start + wanted.len())
            .map(|(_, character)| *character);
        if before.is_some_and(is_word_character) || after.is_some_and(is_word_character) {
            continue;
        }
        return Some(begin);
    }
    None
}

fn is_word_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_'
}

fn collapse_newlines(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut run = 0usize;
    for character in text.chars() {
        if character == '\n' {
            run += 1;
            if run <= 2 {
                result.push('\n');
            }
        } else {
            run = 0;
            result.push(character);
        }
    }
    result
}

/// Parses the markdown tool-call the model sometimes emits:
/// `[Tool call: name]\nArguments: {json}`. Returns the name and parsed args.
pub fn parse_textual_tool_call(text: &str) -> Option<(String, Value)> {
    let normalized = strip_zero_width_str(text);
    let marker = "[Tool call:";
    let mut search_from = 0;

    while let Some(relative) = normalized[search_from..].find(marker) {
        let start = search_from + relative + marker.len();
        if let Some(parsed) = parse_tool_call_at(&normalized, start) {
            return Some(parsed);
        }
        search_from = start;
    }
    None
}

fn parse_tool_call_at(text: &str, start: usize) -> Option<(String, Value)> {
    let after_marker = text[start..].trim_start();
    let close = after_marker.find(']')?;
    let name_region = &after_marker[..close];
    if name_region.contains('\n') {
        return None;
    }
    let name = name_region.trim();
    if name.is_empty() {
        return None;
    }

    let raw_arguments = parse_arguments_marker(&after_marker[close + 1..])?;
    if raw_arguments.is_empty() {
        return None;
    }
    let parsed: Value = serde_json::from_str(&raw_arguments).ok()?;
    Some((name.to_owned(), strip_zero_width(parsed)))
}

/// Consumes `\s*\nArguments:` and returns the trimmed argument text.
fn parse_arguments_marker(rest: &str) -> Option<String> {
    let mut previous_newline = false;
    let mut index = 0;

    while index < rest.len() {
        if rest[index..].starts_with("Arguments:") {
            if !previous_newline {
                return None;
            }
            return Some(rest[index + "Arguments:".len()..].trim().to_owned());
        }
        let character = rest[index..].chars().next()?;
        if character == '\n' {
            previous_newline = true;
        } else if character.is_whitespace() {
            previous_newline = false;
        } else {
            return None;
        }
        index += character.len_utf8();
    }
    None
}

// ─── tools and schema cleanup ──────────────────────────────────────────────

/// Fields Google `generateContent` rejects (thinking/reasoning knobs of other
/// providers). Removed from the request body's top level.
const REQUEST_BLACKLIST: &[&str] = &[
    "output_config",
    "output_format",
    "thinking",
    "reasoning_effort",
    "reasoning",
    "enable_thinking",
    "thinking_budget",
    "thinkingConfig",
];

/// Removes the blacklisted fields from a request body in place.
pub fn strip_blacklisted_request(request: &mut Value) {
    if let Some(object) = request.as_object_mut() {
        for key in REQUEST_BLACKLIST {
            object.remove(*key);
        }
    }
}

/// The validated function-calling mode the IDE expects alongside tools.
pub fn tool_config() -> Value {
    json!({ "functionCallingConfig": { "mode": "VALIDATED" } })
}

/// Builds the Gemini `tools` array: a single `functionDeclarations` entry with
/// sanitized names and cleaned schemas, or an empty array when no function
/// tools are supplied.
pub fn build_tools(request: &ChatCompletionRequest) -> Vec<Value> {
    let Some(tools) = &request.tools else {
        return Vec::new();
    };
    if tools.is_empty() {
        return Vec::new();
    }

    let mut declarations = Vec::new();
    let mut seen = BTreeSet::new();
    for tool in tools {
        let function = &tool.function;
        let name = sanitize_function_name(&function.name);
        if !seen.insert(name.clone()) {
            continue;
        }
        let parameters = match &function.parameters {
            Some(parameters) => clean_schema(parameters),
            None => json!({
                "type": "object",
                "properties": {
                    "reason": { "type": "string", "description": "Brief explanation" }
                },
                "required": ["reason"]
            }),
        };
        declarations.push(json!({
            "name": name,
            "description": function.description.clone().unwrap_or_default(),
            "parameters": parameters,
        }));
    }

    if declarations.is_empty() {
        Vec::new()
    } else {
        vec![json!({ "functionDeclarations": declarations })]
    }
}

/// The generation config: `maxOutputTokens` clamped by the family cap, `topP`
/// (default 1.0), `topK` 40, and `temperature` when the caller set one.
pub fn build_generation_config(request: &ChatCompletionRequest, model_name: &str) -> Value {
    let cap = output_cap(Some(model_name));
    let max_output_tokens = request
        .max_tokens
        .map_or(cap, |requested| requested.min(cap));

    let mut config = json!({
        "maxOutputTokens": max_output_tokens,
        "topP": request.top_p.unwrap_or(1.0),
        "topK": 40,
    });
    if let Some(temperature) = request.temperature {
        config["temperature"] = json!(temperature);
    }
    config
}

/// Function names must match `[a-zA-Z_][a-zA-Z0-9_.:\-]{0,63}`.
pub fn sanitize_function_name(name: &str) -> String {
    if name.is_empty() {
        return "_unknown".to_owned();
    }
    let mut sanitized: String = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | ':' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect();
    if !sanitized
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic() || character == '_')
    {
        sanitized.insert(0, '_');
    }
    sanitized.chars().take(64).collect()
}

/// Schema keywords Google rejects. Dropped recursively, along with any `x-`
/// extension key.
const UNSUPPORTED_SCHEMA_CONSTRAINTS: &[&str] = &[
    "minLength",
    "maxLength",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minItems",
    "maxItems",
    "format",
    "multipleOf",
    "uniqueItems",
    "contains",
    "unevaluatedProperties",
    "unevaluatedItems",
    "contentSchema",
    "default",
    "examples",
    "$schema",
    "$defs",
    "definitions",
    "const",
    "$ref",
    "$comment",
    "deprecated",
    "readOnly",
    "writeOnly",
    "additionalProperties",
    "propertyNames",
    "patternProperties",
    "enumDescriptions",
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    "dependencies",
    "dependentSchemas",
    "dependentRequired",
    "title",
    "optional",
    "if",
    "then",
    "else",
    "contentMediaType",
    "contentEncoding",
    "cornerRadius",
    "fillColor",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "gap",
    "padding",
    "strokeColor",
    "strokeThickness",
    "textColor",
];

/// Cleans a JSON Schema for Antigravity compatibility. Port of the oracle's
/// `cleanJSONSchemaForAntigravity` pipeline, in the same order.
pub fn clean_schema(schema: &Value) -> Value {
    let mut cleaned = schema.clone();
    if !cleaned.is_object() && !cleaned.is_array() {
        return cleaned;
    }
    convert_const_to_enum(&mut cleaned);
    convert_enum_values_to_strings(&mut cleaned);
    merge_all_of(&mut cleaned);
    flatten_any_of_one_of(&mut cleaned);
    flatten_type_arrays(&mut cleaned);
    ensure_object_type(&mut cleaned);
    ensure_array_items(&mut cleaned);
    remove_unsupported_keywords(&mut cleaned);
    cleanup_required(&mut cleaned);
    add_placeholders(&mut cleaned);
    cleaned
}

fn convert_const_to_enum(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                convert_const_to_enum(item);
            }
        }
        Value::Object(map) => {
            if map.contains_key("const") && !map.get("enum").is_some_and(js_truthy) {
                let constant = map.remove("const").unwrap_or(Value::Null);
                map.insert("enum".to_owned(), Value::Array(vec![constant]));
            }
            for item in map.values_mut() {
                convert_const_to_enum(item);
            }
        }
        _ => {}
    }
}

fn convert_enum_values_to_strings(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                convert_enum_values_to_strings(item);
            }
        }
        Value::Object(map) => {
            if let Some(Value::Array(values)) = map.get_mut("enum") {
                for entry in values.iter_mut() {
                    *entry = Value::String(js_string(entry));
                }
            }
            if map.get("enum").is_some_and(Value::is_array)
                && !map.get("type").is_some_and(js_truthy)
            {
                map.insert("type".to_owned(), Value::String("string".to_owned()));
            }
            for item in map.values_mut() {
                convert_enum_values_to_strings(item);
            }
        }
        _ => {}
    }
}

fn merge_all_of(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                merge_all_of(item);
            }
        }
        Value::Object(map) => {
            if let Some(all_of) = map.get("allOf").and_then(Value::as_array).cloned() {
                let mut properties = serde_json::Map::new();
                let mut required = Vec::new();
                let mut saw_properties = false;
                let mut saw_required = false;

                for item in &all_of {
                    if let Some(item_properties) = item.get("properties").and_then(Value::as_object)
                    {
                        saw_properties = true;
                        for (key, entry) in item_properties {
                            properties.insert(key.clone(), entry.clone());
                        }
                    }
                    if let Some(item_required) = item.get("required").and_then(Value::as_array) {
                        saw_required = true;
                        for entry in item_required {
                            if let Some(name) = entry.as_str()
                                && !required.iter().any(|existing| existing == name)
                            {
                                required.push(name.to_owned());
                            }
                        }
                    }
                }

                map.remove("allOf");
                if saw_properties {
                    let mut merged = map
                        .get("properties")
                        .and_then(Value::as_object)
                        .cloned()
                        .unwrap_or_default();
                    for (key, entry) in properties {
                        merged.insert(key, entry);
                    }
                    map.insert("properties".to_owned(), Value::Object(merged));
                }
                if saw_required {
                    let mut merged = map
                        .get("required")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    for name in required {
                        merged.push(Value::String(name));
                    }
                    map.insert("required".to_owned(), Value::Array(merged));
                }
            }
            for item in map.values_mut() {
                merge_all_of(item);
            }
        }
        _ => {}
    }
}

fn flatten_any_of_one_of(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                flatten_any_of_one_of(item);
            }
        }
        Value::Object(map) => {
            flatten_variants(map, "anyOf");
            flatten_variants(map, "oneOf");
            for item in map.values_mut() {
                flatten_any_of_one_of(item);
            }
        }
        _ => {}
    }
}

fn flatten_variants(map: &mut serde_json::Map<String, Value>, key: &str) {
    let Some(variants) = map.get(key).and_then(Value::as_array).cloned() else {
        return;
    };
    if variants.is_empty() {
        return;
    }
    let non_null: Vec<&Value> = variants
        .iter()
        .filter(|variant| {
            !variant.is_null() && variant.get("type").and_then(Value::as_str) != Some("null")
        })
        .collect();
    if non_null.is_empty() {
        return;
    }

    let selected = non_null[select_best(&non_null)].clone();
    map.remove(key);
    if let Value::Object(selected) = selected {
        for (selected_key, entry) in selected {
            map.insert(selected_key, entry);
        }
    }
}

fn select_best(items: &[&Value]) -> usize {
    let mut best_index = 0;
    let mut best_score = -1i32;
    for (index, item) in items.iter().enumerate() {
        let kind = item.get("type").and_then(Value::as_str);
        let score = if kind == Some("object") || item.get("properties").is_some() {
            3
        } else if kind == Some("array") || item.get("items").is_some() {
            2
        } else if kind.is_some_and(|kind| kind != "null") {
            1
        } else {
            0
        };
        if score > best_score {
            best_score = score;
            best_index = index;
        }
    }
    best_index
}

fn flatten_type_arrays(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                flatten_type_arrays(item);
            }
        }
        Value::Object(map) => {
            if let Some(types) = map.get("type").and_then(Value::as_array).cloned() {
                let first = types
                    .iter()
                    .find(|entry| entry.as_str() != Some("null"))
                    .cloned()
                    .unwrap_or_else(|| Value::String("string".to_owned()));
                map.insert("type".to_owned(), first);
            }
            for item in map.values_mut() {
                flatten_type_arrays(item);
            }
        }
        _ => {}
    }
}

fn ensure_object_type(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                ensure_object_type(item);
            }
        }
        Value::Object(map) => {
            if map.get("properties").is_some_and(js_truthy)
                && !map.get("type").is_some_and(js_truthy)
            {
                map.insert("type".to_owned(), Value::String("object".to_owned()));
            }
            for item in map.values_mut() {
                ensure_object_type(item);
            }
        }
        _ => {}
    }
}

fn ensure_array_items(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                ensure_array_items(item);
            }
        }
        Value::Object(map) => {
            let is_array = map
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind.eq_ignore_ascii_case("array"));
            if is_array && !map.get("items").is_some_and(Value::is_object) {
                let fallback = map
                    .get("prefixItems")
                    .and_then(Value::as_array)
                    .and_then(|items| items.iter().find(|item| item.is_object()))
                    .cloned()
                    .or_else(|| map.get("contains").filter(|item| item.is_object()).cloned());
                map.insert(
                    "items".to_owned(),
                    fallback.unwrap_or_else(|| json!({ "type": "string" })),
                );
            }
            map.remove("prefixItems");
            for item in map.values_mut() {
                ensure_array_items(item);
            }
        }
        _ => {}
    }
}

fn remove_unsupported_keywords(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                remove_unsupported_keywords(item);
            }
        }
        Value::Object(map) => {
            let keys: Vec<String> = map.keys().cloned().collect();
            for key in keys {
                if UNSUPPORTED_SCHEMA_CONSTRAINTS.contains(&key.as_str()) || key.starts_with("x-") {
                    map.remove(&key);
                    continue;
                }
                if let Some(child) = map.get_mut(&key)
                    && (child.is_object() || child.is_array())
                {
                    remove_unsupported_keywords(child);
                }
            }
        }
        _ => {}
    }
}

fn cleanup_required(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                cleanup_required(item);
            }
        }
        Value::Object(map) => {
            if let (Some(Value::Array(required)), Some(properties)) = (
                map.get("required").cloned(),
                map.get("properties").and_then(Value::as_object),
            ) {
                let valid: Vec<Value> = required
                    .into_iter()
                    .filter(|entry| {
                        entry
                            .as_str()
                            .is_some_and(|name| properties.contains_key(name))
                    })
                    .collect();
                if valid.is_empty() {
                    map.remove("required");
                } else {
                    map.insert("required".to_owned(), Value::Array(valid));
                }
            }
            for item in map.values_mut() {
                cleanup_required(item);
            }
        }
        _ => {}
    }
}

fn add_placeholders(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                add_placeholders(item);
            }
        }
        Value::Object(map) => {
            if map.is_empty() {
                fill_reason_placeholder(map);
                return;
            }
            if map.get("type").and_then(Value::as_str) == Some("object") {
                let empty = map
                    .get("properties")
                    .and_then(Value::as_object)
                    .is_none_or(serde_json::Map::is_empty);
                if empty {
                    fill_reason_placeholder(map);
                }
            }
            for item in map.values_mut() {
                add_placeholders(item);
            }
        }
        _ => {}
    }
}

fn fill_reason_placeholder(map: &mut serde_json::Map<String, Value>) {
    map.insert("type".to_owned(), Value::String("object".to_owned()));
    map.insert(
        "properties".to_owned(),
        json!({
            "reason": {
                "type": "string",
                "description": "Brief explanation of why you are calling this tool"
            }
        }),
    );
    map.insert("required".to_owned(), json!(["reason"]));
}

fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|value| value != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Null => "null".to_owned(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

// ─── Gemini SSE → OpenAI chunks ────────────────────────────────────────────

/// Mutable state carried across the frames of one upstream stream.
#[derive(Clone, Debug, Default)]
pub struct GeminiStreamState {
    pub message_id: Option<String>,
    pub model: String,
    pub function_index: usize,
    pub gemini_tool_call_count: usize,
    pub finish_reason: Option<String>,
    pub usage: Option<Value>,
    pub tool_name_map: Option<BTreeMap<String, String>>,
    pub remaining_credits: Option<Value>,
}

impl GeminiStreamState {
    pub fn new(model: &str) -> Self {
        Self {
            model: model.to_owned(),
            ..Self::default()
        }
    }

    pub fn with_tool_names(model: &str, tool_name_map: Option<BTreeMap<String, String>>) -> Self {
        Self {
            model: model.to_owned(),
            tool_name_map,
            ..Self::default()
        }
    }
}

/// Converts one Gemini/Antigravity frame into zero or more OpenAI chunks. The
/// first frame that carries a candidate opens with an `assistant` role delta.
/// Returns `None` when the frame produces no output.
pub fn gemini_stream_to_openai_chunks(
    chunk: &Value,
    state: &mut GeminiStreamState,
    now_ms: i64,
) -> Option<Vec<Value>> {
    let response = chunk
        .get("response")
        .filter(|value| !value.is_null())
        .unwrap_or(chunk);
    let candidate = response
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|candidates| candidates.first())?;

    let mut results = Vec::new();

    if state.message_id.is_none() {
        state.message_id = response
            .get("responseId")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| Some(format!("msg_{now_ms}")));
        if let Some(version) = response.get("modelVersion").and_then(Value::as_str) {
            state.model = version.to_owned();
        }
        state.function_index = 0;
        state.gemini_tool_call_count = 0;
        results.push(build_chunk(
            state,
            json!({ "role": "assistant" }),
            Value::Null,
            now_ms,
        ));
    }

    if let Some(parts) = candidate
        .get("content")
        .and_then(|content| content.get("parts"))
        .and_then(Value::as_array)
    {
        for part in parts {
            let function_call = part.get("functionCall");
            let thought_signature = part
                .get("thought_signature")
                .and_then(Value::as_str)
                .filter(|signature| !signature.is_empty())
                .or_else(|| {
                    function_call
                        .and_then(|call| call.get("thought_signature"))
                        .and_then(Value::as_str)
                        .filter(|signature| !signature.is_empty())
                });
            let is_thought = part.get("thought").and_then(Value::as_bool) == Some(true);
            let text = part
                .get("text")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty());

            if let Some(signature) = thought_signature {
                if let Some(text) = text {
                    results.push(build_chunk(
                        state,
                        text_delta(text, is_thought),
                        Value::Null,
                        now_ms,
                    ));
                }
                if let Some(function_call) = function_call {
                    results.push(emit_function_call(
                        function_call,
                        state,
                        Some(signature),
                        now_ms,
                    ));
                }
                continue;
            }

            if let Some(text) = text {
                if let Some((name, args)) = parse_textual_tool_call(text) {
                    results.push(emit_function_call(
                        &json!({ "name": name, "args": args }),
                        state,
                        None,
                        now_ms,
                    ));
                } else {
                    results.push(build_chunk(
                        state,
                        text_delta(text, is_thought),
                        Value::Null,
                        now_ms,
                    ));
                }
            }

            if let Some(function_call) = function_call {
                results.push(emit_function_call(function_call, state, None, now_ms));
            }

            if let Some(inline) = part.get("inlineData").or_else(|| part.get("inline_data"))
                && let Some(data) = inline.get("data").and_then(Value::as_str)
            {
                let mime_type = inline
                    .get("mimeType")
                    .or_else(|| inline.get("mime_type"))
                    .and_then(Value::as_str)
                    .unwrap_or("image/png");
                results.push(build_chunk(
                    state,
                    json!({
                        "images": [{
                            "type": "image_url",
                            "image_url": { "url": format!("data:{mime_type};base64,{data}") }
                        }]
                    }),
                    Value::Null,
                    now_ms,
                ));
            }
        }
    }

    if let Some(usage_meta) = response
        .get("usageMetadata")
        .filter(|value| !value.is_null())
        .or_else(|| chunk.get("usageMetadata").filter(|value| !value.is_null()))
    {
        state.usage = Some(map_usage(usage_meta));
    }

    if let Some(credits) = chunk
        .get("remainingCredits")
        .filter(|value| value.is_array())
        .or_else(|| {
            response
                .get("remainingCredits")
                .filter(|value| value.is_array())
        })
    {
        state.remaining_credits = Some(credits.clone());
    }

    if let Some(reason) = candidate.get("finishReason").and_then(Value::as_str) {
        let mut finish_reason = if reason == "STOP" {
            "stop".to_owned()
        } else {
            reason.to_lowercase()
        };
        if finish_reason == "stop" && state.gemini_tool_call_count > 0 {
            finish_reason = "tool_calls".to_owned();
        }
        let mut final_chunk = build_chunk(
            state,
            json!({}),
            Value::String(finish_reason.clone()),
            now_ms,
        );
        if let Some(usage) = &state.usage {
            final_chunk["usage"] = usage.clone();
        }
        results.push(final_chunk);
        state.finish_reason = Some(finish_reason);
    }

    if results.is_empty() {
        None
    } else {
        Some(results)
    }
}

fn text_delta(text: &str, is_thought: bool) -> Value {
    if is_thought {
        json!({ "reasoning_content": text })
    } else {
        json!({ "content": text })
    }
}

fn build_chunk(
    state: &GeminiStreamState,
    delta: Value,
    finish_reason: Value,
    now_ms: i64,
) -> Value {
    let id = state
        .message_id
        .clone()
        .unwrap_or_else(|| now_ms.to_string());
    json!({
        "id": format!("chatcmpl-{id}"),
        "object": "chat.completion.chunk",
        "created": now_ms / 1000,
        "model": state.model,
        "choices": [{
            "index": 0,
            "delta": delta,
            "finish_reason": finish_reason,
        }],
    })
}

fn emit_function_call(
    function_call: &Value,
    state: &mut GeminiStreamState,
    thought_signature: Option<&str>,
    now_ms: i64,
) -> Value {
    let raw_name = function_call
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let name = state
        .tool_name_map
        .as_ref()
        .and_then(|names| names.get(raw_name))
        .map_or(raw_name, String::as_str);
    let args = strip_zero_width(
        function_call
            .get("args")
            .cloned()
            .unwrap_or_else(|| json!({})),
    );
    let tool_call_index = state.function_index;
    state.function_index += 1;
    state.gemini_tool_call_count += 1;
    let signature = thought_signature
        .filter(|signature| !signature.is_empty())
        .or_else(|| {
            function_call
                .get("thought_signature")
                .and_then(Value::as_str)
                .filter(|signature| !signature.is_empty())
        });

    let mut call = json!({
        "index": tool_call_index,
        "id": format!("{name}-{now_ms}-{tool_call_index}"),
        "type": "function",
        "function": { "name": name, "arguments": args.to_string() },
    });
    if let Some(signature) = signature {
        call["thought_signature"] = Value::String(signature.to_owned());
    }

    build_chunk(state, json!({ "tool_calls": [call] }), Value::Null, now_ms)
}

fn map_usage(meta: &Value) -> Value {
    let prompt_tokens = token_count(meta, &["promptTokenCount"]);
    let completion_tokens = token_count(meta, &["candidatesTokenCount", "candidates_tokens_count"]);
    let cached_tokens = token_count(meta, &["cachedContentTokenCount", "totalCachedTokens"]);

    let mut usage = json!({
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    });
    if cached_tokens > 0 {
        usage["prompt_tokens_details"] = json!({ "cached_tokens": cached_tokens });
    }
    usage
}

fn token_count(meta: &Value, keys: &[&str]) -> i64 {
    for key in keys {
        if let Some(value) = meta.get(*key).filter(|value| !value.is_null()) {
            return match value {
                Value::Number(number) => number.as_f64().unwrap_or(0.0) as i64,
                Value::String(text) => text.parse::<f64>().unwrap_or(0.0) as i64,
                _ => 0,
            };
        }
    }
    0
}

// ─── accumulation ──────────────────────────────────────────────────────────

#[derive(Default)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

/// Aggregates OpenAI chunks into one buffered `chat.completion`. The content
/// falls back to the reasoning text when the model produced only thoughts, and
/// the finish reason is the last non-null one seen.
pub fn accumulate_chunks(chunks: &[Value], model: &str, now_ms: i64) -> Value {
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut tool_calls: BTreeMap<usize, ToolCallAccumulator> = BTreeMap::new();
    let mut usage = None;

    for chunk in chunks {
        if let Some(chunk_usage) = chunk.get("usage").filter(|value| !value.is_null()) {
            usage = Some(chunk_usage.clone());
        }
        let Some(delta) = chunk
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("delta"))
        else {
            continue;
        };

        if let Some(text) = delta.get("content").and_then(Value::as_str) {
            content.push_str(text);
        }
        if let Some(text) = delta
            .get("reasoning_content")
            .and_then(Value::as_str)
            .or_else(|| delta.get("reasoning").and_then(Value::as_str))
        {
            reasoning.push_str(text);
        }

        for call in delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let entry = tool_calls.entry(index).or_default();
            if let Some(id) = call
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            {
                entry.id = id.to_owned();
            }
            if let Some(name) = call
                .get("function")
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty())
            {
                entry.name = name.to_owned();
            }
            if let Some(arguments) = call
                .get("function")
                .and_then(|function| function.get("arguments"))
                .and_then(Value::as_str)
            {
                entry.arguments.push_str(arguments);
            }
        }
    }

    let finish_reason = chunks
        .iter()
        .filter_map(|chunk| {
            chunk
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|choices| choices.first())
                .and_then(|choice| choice.get("finish_reason"))
                .and_then(Value::as_str)
        })
        .next_back()
        .unwrap_or("stop")
        .to_owned();

    let calls: Vec<Value> = tool_calls
        .into_values()
        .map(|entry| {
            json!({
                "id": entry.id,
                "type": "function",
                "function": { "name": entry.name, "arguments": entry.arguments }
            })
        })
        .collect();
    let has_tool_calls = !calls.is_empty();

    let effective_content = if !content.is_empty() {
        Value::String(content.clone())
    } else if !reasoning.is_empty() {
        Value::String(reasoning.clone())
    } else {
        Value::Null
    };

    let mut message = json!({ "role": "assistant", "content": effective_content });
    if !reasoning.is_empty() {
        message["reasoning_content"] = Value::String(reasoning);
    }
    if has_tool_calls {
        message["tool_calls"] = Value::Array(calls);
    }

    let mut response = json!({
        "id": format!("chatcmpl-{now_ms}"),
        "object": "chat.completion",
        "created": now_ms / 1000,
        "model": model,
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": finish_reason,
        }],
    });
    if let Some(usage) = usage {
        response["usage"] = usage;
    }
    response
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    const NOW: i64 = 1_700_000_000_000;

    fn request(value: Value) -> ChatCompletionRequest {
        serde_json::from_value(value).expect("request parses")
    }

    #[test]
    fn request_id_matches_the_oracle_regex() {
        let id = build_ide_request_id(&IdeRequestIdArgs {
            existing_request_id: None,
            session_id: Some("session-1"),
            model: "gemini-3.7-flash-tiered",
            request_type: "agent",
            content_count: 3,
            now_ms: NOW,
        });

        assert!(is_valid_ide_request_id(&id), "{id}");
        assert_eq!(id.split('/').count(), 5);
        assert!(id.starts_with("agent/"));
        assert!(id.ends_with("/5"), "{id}");
        assert_eq!(
            id,
            build_ide_request_id(&IdeRequestIdArgs {
                existing_request_id: None,
                session_id: Some("session-1"),
                model: "gemini-3.7-flash-tiered",
                request_type: "agent",
                content_count: 3,
                now_ms: NOW,
            })
        );
    }

    #[test]
    fn an_existing_valid_request_id_is_reused_and_an_invalid_one_is_not() {
        let reused = build_ide_request_id(&IdeRequestIdArgs {
            existing_request_id: Some("agent/abc/123/def/7"),
            session_id: Some("session-1"),
            model: "m",
            request_type: "agent",
            content_count: 1,
            now_ms: NOW,
        });
        assert_eq!(reused, "agent/abc/123/def/7");

        let rebuilt = build_ide_request_id(&IdeRequestIdArgs {
            existing_request_id: Some("agent/jetski/not-a-number/def/7"),
            session_id: Some("session-1"),
            model: "m",
            request_type: "agent",
            content_count: 1,
            now_ms: NOW,
        });
        assert_ne!(rebuilt, "agent/jetski/not-a-number/def/7");
        assert!(is_valid_ide_request_id(&rebuilt));
    }

    #[test]
    fn alias_table_maps_every_row() {
        for (raw, expected) in [
            ("gemini-3.8-flash-high", "gemini-3.8-flash-tiered"),
            ("gemini-3.8-flash-medium", "gemini-3.8-flash-tiered"),
            ("gemini-3.8-flash-low", "gemini-3.8-flash-tiered"),
            ("gemini-3.7-flash-high", "gemini-3.7-flash-tiered"),
            ("gemini-3.7-flash-medium", "gemini-3.7-flash-tiered"),
            ("gemini-3.7-flash-low", "gemini-3.7-flash-tiered"),
            ("gemini-3.5-flash-high", "gemini-3-flash-agent"),
            ("gemini-3.1-pro-high", "gemini-pro-agent"),
            ("gemini-3.5-flash-medium", "gemini-3.5-flash-low"),
            ("gemini-3.5-flash-low", "gemini-3.5-flash-extra-low"),
            ("gemini-3.6-flash-high", "gemini-3.6-flash-high"),
            ("claude-opus-4-6-thinking", "claude-opus-4-6-thinking"),
            ("gpt-oss-120b-medium", "gpt-oss-120b-medium"),
        ] {
            assert_eq!(parse_model_name(raw), expected, "{raw}");
        }
        assert_eq!(
            parse_model_name("antigravity/gemini-3.7-flash-high"),
            "gemini-3.7-flash-tiered"
        );
    }

    #[test]
    fn output_caps_follow_the_family() {
        assert_eq!(output_cap(Some("gemini-3.7-flash-high")), 65536);
        assert_eq!(output_cap(Some("gemini-pro-agent")), 65536);
        assert_eq!(output_cap(Some("claude-opus-4-6-thinking")), 64000);
        assert_eq!(output_cap(Some("claude-sonnet-4-6")), 64000);
        assert_eq!(output_cap(Some("gpt-oss-120b-medium")), 8192);
        assert_eq!(output_cap(None), 8192);
    }

    #[test]
    fn fallbacks_are_the_pro_cascade() {
        assert_eq!(
            model_fallbacks("gemini-3.1-pro-high"),
            vec!["gemini-pro-agent", "gemini-3.1-pro-high", "gemini-3-pro"]
        );
        assert_eq!(
            model_fallbacks("gemini-3.1-pro-low"),
            vec!["gemini-pro-agent", "gemini-3.1-pro-low", "gemini-3-pro"]
        );
        assert_eq!(
            model_fallbacks("antigravity/gemini-pro-agent"),
            vec!["gemini-pro-agent", "gemini-3.1-pro-high", "gemini-3-pro"]
        );
        assert_eq!(
            model_fallbacks("gemini-3.7-flash-high"),
            vec!["gemini-3.7-flash-tiered"]
        );
    }

    #[test]
    fn envelope_carries_the_ide_fields_and_credit_types() {
        let credits = vec!["GOOGLE_ONE_AI".to_owned()];
        let envelope = build_envelope(EnvelopeArgs {
            project_id: "proj-1",
            model: "gemini-3.7-flash-tiered",
            request_type: "agent",
            request: json!({
                "contents": [{ "role": "user", "parts": [{ "text": "hi" }] }],
                "sessionId": "sess-9",
            }),
            existing_request_id: None,
            session_id: None,
            enabled_credit_types: Some(&credits),
            now_ms: NOW,
        });

        assert_eq!(envelope["project"], "proj-1");
        assert_eq!(envelope["model"], "gemini-3.7-flash-tiered");
        assert_eq!(envelope["userAgent"], "antigravity");
        assert_eq!(envelope["requestType"], "agent");
        assert_eq!(envelope["enabledCreditTypes"], json!(["GOOGLE_ONE_AI"]));
        assert_eq!(envelope["request"]["sessionId"], "sess-9");
        let request_id = envelope["requestId"].as_str().expect("request id");
        assert!(is_valid_ide_request_id(request_id), "{request_id}");
        assert!(request_id.ends_with("/1"), "{request_id}");

        let without = build_envelope(EnvelopeArgs {
            project_id: "proj-1",
            model: "gemini-3.7-flash-tiered",
            request_type: "agent",
            request: json!({ "contents": [] }),
            existing_request_id: None,
            session_id: None,
            enabled_credit_types: None,
            now_ms: NOW,
        });
        assert!(without.get("enabledCreditTypes").is_none());
    }

    #[test]
    fn contents_remap_roles_and_map_tool_calls() {
        let req = request(json!({
            "model": "antigravity/gemini-3.7-flash-high",
            "messages": [
                { "role": "user", "content": "What is the weather in Tokyo?" },
                {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_weather_1",
                        "type": "function",
                        "function": { "name": "get_weather", "arguments": "{\"location\":\"Tokyo\"}" }
                    }]
                },
                {
                    "role": "tool",
                    "tool_call_id": "call_weather_1",
                    "content": "{\"temperature\":\"22C\",\"condition\":\"Sunny\"}"
                }
            ]
        }));

        let contents = build_contents(&req);
        assert_eq!(contents.len(), 3);
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(
            contents[0]["parts"][0]["text"],
            "What is the weather in Tokyo?"
        );
        assert_eq!(contents[1]["role"], "model");
        assert_eq!(
            contents[1]["parts"][0]["functionCall"]["name"],
            "get_weather"
        );
        assert_eq!(
            contents[1]["parts"][0]["functionCall"]["args"],
            json!({ "location": "Tokyo" })
        );
        assert_eq!(
            contents[1]["parts"][0]["thought_signature"],
            "skip_thought_signature_validator"
        );
        assert!(contents[1]["parts"][0].get("text").is_none());
        assert_eq!(contents[2]["role"], "user");
        assert_eq!(
            contents[2]["parts"][0]["functionResponse"]["name"],
            "get_weather"
        );
        assert_eq!(
            contents[2]["parts"][0]["functionResponse"]["response"],
            json!({ "temperature": "22C", "condition": "Sunny" })
        );
    }

    #[test]
    fn contents_inline_data_uri_images_and_placeholder_remote_urls() {
        let req = request(json!({
            "model": "antigravity/gemini-3.8-flash-high",
            "messages": [{
                "role": "user",
                "content": [
                    { "type": "text", "text": "Look" },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA" } },
                    { "type": "image_url", "image_url": { "url": "https://example.com/cat.png" } }
                ]
            }]
        }));

        let contents = build_contents(&req);
        let parts = contents[0]["parts"].as_array().expect("parts");
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], json!({ "text": "Look" }));
        assert_eq!(
            parts[1],
            json!({ "inlineData": { "mimeType": "image/png", "data": "AAAA" } })
        );
        assert_eq!(
            parts[2],
            json!({ "text": "[Image: https://example.com/cat.png]" })
        );
    }

    #[test]
    fn contents_strip_zero_width_and_the_trailing_model_turn() {
        let req = request(json!({
            "model": "antigravity/gemini-3.7-flash-high",
            "messages": [
                { "role": "user", "content": "Hi\u{200B} there\u{FEFF}" },
                { "role": "assistant", "content": "{\u{200C}" }
            ]
        }));

        let contents = build_contents(&req);
        assert_eq!(contents.len(), 1);
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[0]["parts"][0]["text"], "Hi there");
    }

    #[test]
    fn tools_emit_function_declarations_with_cleaned_schemas() {
        let req = request(json!({
            "model": "antigravity/gemini-3.7-flash-high",
            "messages": [{ "role": "user", "content": "hi" }],
            "tools": [{
                "type": "function",
                "function": {
                    "name": "clarify",
                    "description": "Ask a question",
                    "parameters": {
                        "type": "object",
                        "properties": { "choices": { "type": "array" } },
                        "required": ["choices"]
                    }
                }
            }]
        }));

        let tools = build_tools(&req);
        let declarations = tools[0]["functionDeclarations"]
            .as_array()
            .expect("declarations");
        assert_eq!(declarations.len(), 1);
        assert_eq!(declarations[0]["name"], "clarify");
        assert_eq!(declarations[0]["description"], "Ask a question");
        assert_eq!(
            declarations[0]["parameters"]["properties"]["choices"]["items"],
            json!({ "type": "string" })
        );
        assert_eq!(
            tool_config(),
            json!({ "functionCallingConfig": { "mode": "VALIDATED" } })
        );
    }

    #[test]
    fn schema_cleanup_drops_unsupported_keys_and_fills_arrays() {
        let cleaned = clean_schema(&json!({
            "type": "object",
            "title": "Thing",
            "additionalProperties": false,
            "$ref": "#/$defs/x",
            "properties": {
                "when": { "type": "string", "format": "date-time", "minLength": 1 },
                "tags": { "type": "array" },
                "x-custom": { "type": "string" }
            },
            "required": ["when", "missing"]
        }));

        assert!(cleaned.get("title").is_none());
        assert!(cleaned.get("additionalProperties").is_none());
        assert!(cleaned.get("$ref").is_none());
        let properties = cleaned["properties"].as_object().expect("properties");
        assert!(properties.get("x-custom").is_none());
        assert!(properties["when"].get("format").is_none());
        assert!(properties["when"].get("minLength").is_none());
        assert_eq!(properties["tags"]["items"], json!({ "type": "string" }));
        assert_eq!(cleaned["required"], json!(["when"]));

        let constant = clean_schema(&json!({ "const": "a" }));
        assert_eq!(constant, json!({ "enum": ["a"], "type": "string" }));
    }

    #[test]
    fn generation_config_clamps_to_the_family_cap() {
        let req = request(json!({
            "model": "antigravity/gemini-3.7-flash-high",
            "messages": [{ "role": "user", "content": "hi" }],
            "max_tokens": 200000,
            "top_p": 0.5,
            "temperature": 0.2
        }));

        let config = build_generation_config(&req, "gemini-3.7-flash-tiered");
        assert_eq!(config["maxOutputTokens"], 65536);
        assert_eq!(config["topP"], 0.5);
        assert_eq!(config["topK"], 40);
        assert_eq!(config["temperature"], 0.2);

        let defaults = build_generation_config(
            &request(json!({
                "model": "antigravity/gemini-3.7-flash-high",
                "messages": [{ "role": "user", "content": "hi" }]
            })),
            "gemini-3.7-flash-tiered",
        );
        assert_eq!(defaults["maxOutputTokens"], 65536);
        assert_eq!(defaults["topP"], 1.0);
        assert!(defaults.get("temperature").is_none());
    }

    #[test]
    fn blacklisted_request_fields_are_removed() {
        let mut body = json!({
            "contents": [],
            "thinking": { "type": "enabled" },
            "reasoning_effort": "high",
            "keep": true
        });
        strip_blacklisted_request(&mut body);
        assert!(body.get("thinking").is_none());
        assert!(body.get("reasoning_effort").is_none());
        assert_eq!(body["keep"], true);
    }

    #[test]
    fn textual_tool_call_parses_markdown() {
        let parsed = parse_textual_tool_call(
            "[Tool call: get_current_weather]\nArguments: {\"location\": \"San Francisco\"}",
        )
        .expect("parsed");
        assert_eq!(parsed.0, "get_current_weather");
        assert_eq!(parsed.1, json!({ "location": "San Francisco" }));

        assert!(parse_textual_tool_call("no tool call here").is_none());
    }

    #[test]
    fn stream_emits_role_then_text() {
        let mut state = GeminiStreamState::new("gemini-3.7-flash-high");
        let chunks = gemini_stream_to_openai_chunks(
            &json!({
                "response": {
                    "responseId": "resp-1",
                    "candidates": [{
                        "content": { "parts": [{ "text": "Hello" }], "role": "model" }
                    }]
                }
            }),
            &mut state,
            NOW,
        )
        .expect("chunks");

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0]["id"], "chatcmpl-resp-1");
        assert_eq!(chunks[0]["object"], "chat.completion.chunk");
        assert_eq!(chunks[0]["model"], "gemini-3.7-flash-high");
        assert_eq!(
            chunks[0]["choices"][0]["delta"],
            json!({ "role": "assistant" })
        );
        assert_eq!(chunks[0]["choices"][0]["finish_reason"], Value::Null);
        assert_eq!(
            chunks[1]["choices"][0]["delta"],
            json!({ "content": "Hello" })
        );
    }

    #[test]
    fn stream_maps_thought_parts_to_reasoning() {
        let mut state = GeminiStreamState::new("gemini-3.7-flash-high");
        let chunks = gemini_stream_to_openai_chunks(
            &json!({
                "candidates": [{
                    "content": { "parts": [{ "text": "thinking...", "thought": true }] }
                }]
            }),
            &mut state,
            NOW,
        )
        .expect("chunks");

        assert_eq!(
            chunks[1]["choices"][0]["delta"],
            json!({ "reasoning_content": "thinking..." })
        );
    }

    #[test]
    fn stream_maps_function_calls_with_generated_ids() {
        let mut state = GeminiStreamState::new("gemini-3.7-flash-high");
        let chunks = gemini_stream_to_openai_chunks(
            &json!({
                "candidates": [{
                    "content": {
                        "parts": [{
                            "functionCall": { "name": "get_weather", "args": { "location": "Tokyo" } }
                        }]
                    }
                }]
            }),
            &mut state,
            NOW,
        )
        .expect("chunks");

        let call = &chunks[1]["choices"][0]["delta"]["tool_calls"][0];
        assert_eq!(call["index"], 0);
        assert_eq!(call["id"], format!("get_weather-{NOW}-0"));
        assert_eq!(call["type"], "function");
        assert_eq!(call["function"]["name"], "get_weather");
        assert_eq!(call["function"]["arguments"], "{\"location\":\"Tokyo\"}");
        assert_eq!(state.gemini_tool_call_count, 1);
    }

    #[test]
    fn stream_maps_usage_metadata_and_finish_reason() {
        let mut state = GeminiStreamState::new("gemini-3.7-flash");
        let chunks = gemini_stream_to_openai_chunks(
            &json!({
                "response": {
                    "candidates": [{
                        "content": { "parts": [{ "text": "hi" }] },
                        "finishReason": "STOP"
                    }],
                    "usageMetadata": {
                        "promptTokenCount": 5000,
                        "candidatesTokenCount": 150,
                        "cachedContentTokenCount": 4096
                    }
                }
            }),
            &mut state,
            NOW,
        )
        .expect("chunks");

        let final_chunk = chunks.last().expect("final chunk");
        assert_eq!(final_chunk["choices"][0]["finish_reason"], "stop");
        assert_eq!(
            final_chunk["usage"],
            json!({
                "prompt_tokens": 5000,
                "completion_tokens": 150,
                "total_tokens": 5150,
                "prompt_tokens_details": { "cached_tokens": 4096 }
            })
        );
        assert_eq!(state.usage.as_ref().expect("usage")["total_tokens"], 5150);
        assert_eq!(state.finish_reason.as_deref(), Some("stop"));
    }

    #[test]
    fn accumulate_builds_the_buffered_completion() {
        let mut state = GeminiStreamState::new("gemini-3.7-flash");
        let chunks = gemini_stream_to_openai_chunks(
            &json!({
                "response": {
                    "responseId": "resp-2",
                    "candidates": [{
                        "content": { "parts": [{ "text": "hello" }] },
                        "finishReason": "STOP"
                    }],
                    "usageMetadata": { "promptTokenCount": 2, "candidatesTokenCount": 3 }
                }
            }),
            &mut state,
            NOW,
        )
        .expect("chunks");

        let response = accumulate_chunks(&chunks, "gemini-3.7-flash", NOW);
        assert_eq!(response["object"], "chat.completion");
        assert_eq!(response["model"], "gemini-3.7-flash");
        assert_eq!(response["choices"][0]["message"]["content"], "hello");
        assert_eq!(response["choices"][0]["finish_reason"], "stop");
        assert_eq!(response["usage"]["total_tokens"], 5);
    }

    #[test]
    fn accumulate_joins_content_reasoning_and_tool_calls() {
        let chunks = vec![
            json!({ "choices": [{ "delta": { "content": "hel", "reasoning_content": "why " } }] }),
            json!({ "choices": [{ "delta": { "content": "lo" } }] }),
            json!({ "choices": [{ "delta": { "reasoning_content": "not" } }] }),
            json!({
                "choices": [{
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "id": "call-1",
                            "function": { "name": "search", "arguments": "{\"q\"" }
                        }]
                    }
                }]
            }),
            json!({
                "choices": [{
                    "delta": { "tool_calls": [{ "index": 0, "function": { "arguments": ":\"rust\"}" } }] },
                    "finish_reason": "tool_calls"
                }]
            }),
            json!({ "choices": [], "usage": { "prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5 } }),
        ];

        let response = accumulate_chunks(&chunks, "gemini-3.7-flash", NOW);
        assert_eq!(response["choices"][0]["message"]["content"], "hello");
        assert_eq!(
            response["choices"][0]["message"]["reasoning_content"],
            "why not"
        );
        assert_eq!(
            response["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
            "{\"q\":\"rust\"}"
        );
        assert_eq!(response["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(response["usage"]["total_tokens"], 5);
    }
}
