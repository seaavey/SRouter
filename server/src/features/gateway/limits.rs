//! Context-window admission for the OpenCode Zen free tier.
//!
//! Zen answers an over-long request with a `400` after a full round trip, and
//! the body has already been billed as a rejection. Rejecting it here costs
//! nothing and gives the caller the same shape OpenAI uses.
//!
//! The window is read per model from the pricing snapshot rather than assumed:
//! `longcat-2.5-preview-free` holds 1M tokens while `mimo-v2.6-flash-free`
//! holds 200k, so one constant would either refuse legitimate traffic or admit
//! doomed requests.

use crate::constants;
use crate::error::APIError;
use crate::features::catalog::context_limit;
use crate::features::providers::OPENCODE_ZEN_MODELS;
use crate::protocol::model::{ChatCompletionRequest, ChatContent};

/// Used for a Zen model the pricing snapshot does not cover. Deliberately the
/// lowest window the free tier serves, so an unknown model is refused early
/// instead of forwarded to an upstream that will reject it anyway.
const UNKNOWN_ZEN_MODEL_CONTEXT: usize = 300_000;

/// Rejects a request that cannot fit the window of the model it names.
pub(crate) fn ensure_within_context_limit(request: &ChatCompletionRequest) -> Result<(), APIError> {
    let Some(bare_model) = zen_model_id(&request.model) else {
        return Ok(());
    };

    let max = context_limit(&bare_model).unwrap_or(UNKNOWN_ZEN_MODEL_CONTEXT);
    let requested = estimate_request_tokens(request);
    if requested <= max {
        return Ok(());
    }

    Err(APIError::new(
        400,
        constants::gateway::context_length_exceeded(max, requested),
    )
    .with_code(constants::ErrorCode::ContextLengthExceeded)
    .with_param("messages"))
}

/// The bare id when `model` names an OpenCode Zen model, in any spelling the
/// registry accepts: `opencode_zen/…`, `opencode/…`, `zen/…`, or the bare id
/// itself. A bare id is the shape `/v1/models` advertises, so a prefix-only
/// check would leave the guard off for the traffic it exists to catch.
fn zen_model_id(model: &str) -> Option<String> {
    let model = model.trim().to_lowercase();
    let bare = model
        .split_once('/')
        .map_or(model.as_str(), |(_, rest)| rest);

    let prefixed = model
        .split_once('/')
        .is_some_and(|(prefix, _)| matches!(prefix, "opencode_zen" | "opencode" | "zen"));

    if prefixed || OPENCODE_ZEN_MODELS.iter().any(|known| known.id == bare) {
        Some(bare.to_owned())
    } else {
        None
    }
}

/// Approximates the token count of the whole request the way the gateway's
/// other estimators do: four characters per token, plus a per-message envelope
/// and a fixed cost per image.
///
/// `tools` is counted because it travels upstream with the prompt and can dwarf
/// it — a large tool schema is the easiest way to blow a window without sending
/// a single long message.
fn estimate_request_tokens(request: &ChatCompletionRequest) -> usize {
    let mut tokens = 0;

    for message in &request.messages {
        tokens += 4;
        match &message.content {
            ChatContent::Text(text) => tokens += text.chars().count().div_ceil(4),
            ChatContent::Parts(parts) => {
                for part in parts {
                    if let Some(text) = &part.text {
                        tokens += text.chars().count().div_ceil(4);
                    } else if part.image_url.is_some() {
                        tokens += 1600;
                    }
                }
            }
            ChatContent::Null => {}
        }
    }

    if let Some(tools) = &request.tools {
        for tool in tools {
            tokens += 20;
            let schema = tool
                .function
                .parameters
                .as_ref()
                .map(|parameters| parameters.to_string())
                .unwrap_or_default();
            tokens += (tool.function.name.chars().count()
                + tool
                    .function
                    .description
                    .as_deref()
                    .unwrap_or("")
                    .chars()
                    .count()
                + schema.chars().count())
            .div_ceil(4);
        }
    }

    tokens.saturating_add(request.max_tokens.unwrap_or(0) as usize)
}

#[cfg(test)]
mod tests {
    use super::{estimate_request_tokens, zen_model_id};
    use crate::protocol::model::parse_chat_completion_request;

    fn request(body: serde_json::Value) -> crate::protocol::model::ChatCompletionRequest {
        parse_chat_completion_request(body).expect("valid request")
    }

    #[test]
    fn every_spelling_of_a_zen_model_resolves_to_its_bare_id() {
        assert_eq!(
            zen_model_id("opencode_zen/beam-free").as_deref(),
            Some("beam-free")
        );
        assert_eq!(zen_model_id("zen/beam-free").as_deref(), Some("beam-free"));
        assert_eq!(
            zen_model_id("opencode/beam-free").as_deref(),
            Some("beam-free")
        );
        assert_eq!(
            zen_model_id("OPENCODE_ZEN/Beam-Free").as_deref(),
            Some("beam-free")
        );
        // The shape `/v1/models` advertises.
        assert_eq!(zen_model_id("beam-free").as_deref(), Some("beam-free"));
        assert_eq!(zen_model_id("big-pickle").as_deref(), Some("big-pickle"));
    }

    #[test]
    fn another_provider_is_left_to_its_own_upstream() {
        assert_eq!(zen_model_id("gpt-4o"), None);
        assert_eq!(zen_model_id("openai/gpt-4o"), None);
        assert_eq!(zen_model_id("qd/qfmodel"), None);
    }

    #[test]
    fn tool_schemas_count_towards_the_window() {
        let without = request(serde_json::json!({
            "model": "zen/beam-free",
            "messages": [{ "role": "user", "content": "hi" }]
        }));
        let with = request(serde_json::json!({
            "model": "zen/beam-free",
            "messages": [{ "role": "user", "content": "hi" }],
            "tools": [{
                "type": "function",
                "function": {
                    "name": "lookup",
                    "description": "x".repeat(4_000),
                    "parameters": { "type": "object", "properties": {} }
                }
            }]
        }));

        assert!(
            estimate_request_tokens(&with) > estimate_request_tokens(&without) + 900,
            "a 4k-character tool description must add roughly 1k tokens"
        );
    }

    #[test]
    fn the_output_budget_counts_towards_the_window() {
        let capped = request(serde_json::json!({
            "model": "zen/beam-free",
            "messages": [{ "role": "user", "content": "hi" }],
            "max_tokens": 500
        }));

        assert!(estimate_request_tokens(&capped) >= 500);
    }
}
