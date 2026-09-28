//! Usage breakdown parsing and normalization for chat completions.
//! Extracts token metrics including prompt (input), completion (output),
//! and cached tokens across OpenAI, Anthropic, and Gemini usage representations.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Normalized token accounting across upstream providers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageBreakdown {
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub cached_tokens: i64,
    pub cache_creation_tokens: i64,
    pub reasoning_tokens: i64,
}

impl UsageBreakdown {
    /// Extracts token breakdown from a JSON object representing usage.
    /// Compatible with OpenAI, Anthropic, and Gemini usage schemas.
    pub fn from_value(value: &Value) -> Self {
        if !value.is_object() {
            return Self::default();
        }

        let prompt_details = value.get("prompt_tokens_details");
        let completion_details = value.get("completion_tokens_details");
        let usage_metadata = value
            .get("usage_metadata")
            .or_else(|| value.get("usageMetadata"));

        // 1. prompt_tokens:
        // OpenAI prompt_tokens, Anthropic input_tokens, or Gemini promptTokenCount
        let prompt_tokens = extract_number(value, "prompt_tokens")
            .or_else(|| extract_number(value, "input_tokens"))
            .or_else(|| usage_metadata.and_then(|m| extract_number(m, "promptTokenCount")))
            .unwrap_or(0);

        // 2. completion_tokens:
        // OpenAI completion_tokens, Anthropic output_tokens, or Gemini candidatesTokenCount
        let completion_tokens = extract_number(value, "completion_tokens")
            .or_else(|| extract_number(value, "output_tokens"))
            .or_else(|| usage_metadata.and_then(|m| extract_number(m, "candidatesTokenCount")))
            .unwrap_or(0);

        // 3. cached_tokens:
        // - OpenAI: prompt_tokens_details.cached_tokens
        // - Anthropic: cache_read_input_tokens
        // - Gemini: cachedContentTokenCount / cached_tokens
        let cached_tokens = prompt_details
            .and_then(|d| extract_number(d, "cached_tokens"))
            .or_else(|| extract_number(value, "cache_read_input_tokens"))
            .or_else(|| usage_metadata.and_then(|m| extract_number(m, "cachedContentTokenCount")))
            .or_else(|| usage_metadata.and_then(|m| extract_number(m, "cached_tokens")))
            .unwrap_or(0);

        // 4. cache_creation_tokens:
        // - Anthropic: cache_creation_input_tokens
        // - Gemini: cacheCreationInputTokenCount
        let cache_creation_tokens = extract_number(value, "cache_creation_input_tokens")
            .or_else(|| {
                usage_metadata.and_then(|m| extract_number(m, "cacheCreationInputTokenCount"))
            })
            .unwrap_or(0);

        // 5. reasoning_tokens:
        // - OpenAI: completion_tokens_details.reasoning_tokens
        // - or top-level reasoning_tokens
        let reasoning_tokens = completion_details
            .and_then(|d| extract_number(d, "reasoning_tokens"))
            .or_else(|| extract_number(value, "reasoning_tokens"))
            .unwrap_or(0);

        // 6. total_tokens:
        let total_tokens = extract_number(value, "total_tokens")
            .or_else(|| usage_metadata.and_then(|m| extract_number(m, "totalTokenCount")))
            .unwrap_or(prompt_tokens + completion_tokens);

        Self {
            prompt_tokens,
            completion_tokens,
            total_tokens,
            cached_tokens,
            cache_creation_tokens,
            reasoning_tokens,
        }
    }

    /// Serializes the breakdown into standard OpenAI chat completion usage JSON.
    pub fn to_openai_json(&self) -> Value {
        let mut obj = serde_json::json!({
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
        });

        if self.cached_tokens > 0 {
            obj["prompt_tokens_details"] = serde_json::json!({
                "cached_tokens": self.cached_tokens,
            });
        }

        if self.reasoning_tokens > 0 {
            obj["completion_tokens_details"] = serde_json::json!({
                "reasoning_tokens": self.reasoning_tokens,
            });
        }

        obj
    }
}

fn extract_number(obj: &Value, key: &str) -> Option<i64> {
    obj.get(key).and_then(|v| {
        if let Some(n) = v.as_i64() {
            Some(n)
        } else if let Some(n) = v.as_u64() {
            Some(n as i64)
        } else if let Some(s) = v.as_str() {
            s.parse::<i64>().ok()
        } else {
            None
        }
    })
}

/// Normalizes `response["usage"]` in-place to ensure cached tokens details
/// are populated and consistent, returning the parsed breakdown.
pub fn normalize_response_usage(response: &mut Value) -> UsageBreakdown {
    let breakdown = match response.get("usage") {
        Some(val) => UsageBreakdown::from_value(val),
        None => UsageBreakdown::default(),
    };

    if response.is_object() {
        if let Some(usage_obj) = response.get_mut("usage").and_then(|u| u.as_object_mut()) {
            if breakdown.cached_tokens > 0 && !usage_obj.contains_key("prompt_tokens_details") {
                usage_obj.insert(
                    "prompt_tokens_details".to_string(),
                    serde_json::json!({ "cached_tokens": breakdown.cached_tokens }),
                );
            }
        } else {
            response["usage"] = breakdown.to_openai_json();
        }
    }

    breakdown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_openai_usage_with_cached_tokens() {
        let json = serde_json::json!({
            "prompt_tokens": 120,
            "completion_tokens": 40,
            "total_tokens": 160,
            "prompt_tokens_details": {
                "cached_tokens": 64
            },
            "completion_tokens_details": {
                "reasoning_tokens": 10
            }
        });

        let breakdown = UsageBreakdown::from_value(&json);
        assert_eq!(breakdown.prompt_tokens, 120);
        assert_eq!(breakdown.completion_tokens, 40);
        assert_eq!(breakdown.total_tokens, 160);
        assert_eq!(breakdown.cached_tokens, 64);
        assert_eq!(breakdown.reasoning_tokens, 10);
    }

    #[test]
    fn parses_anthropic_usage_format() {
        let json = serde_json::json!({
            "input_tokens": 500,
            "output_tokens": 80,
            "cache_read_input_tokens": 300,
            "cache_creation_input_tokens": 50
        });

        let breakdown = UsageBreakdown::from_value(&json);
        assert_eq!(breakdown.prompt_tokens, 500);
        assert_eq!(breakdown.completion_tokens, 80);
        assert_eq!(breakdown.total_tokens, 580);
        assert_eq!(breakdown.cached_tokens, 300);
        assert_eq!(breakdown.cache_creation_tokens, 50);
    }

    #[test]
    fn parses_gemini_usage_metadata() {
        let json = serde_json::json!({
            "usageMetadata": {
                "promptTokenCount": 200,
                "candidatesTokenCount": 50,
                "totalTokenCount": 250,
                "cachedContentTokenCount": 150
            }
        });

        let breakdown = UsageBreakdown::from_value(&json);
        assert_eq!(breakdown.prompt_tokens, 200);
        assert_eq!(breakdown.completion_tokens, 50);
        assert_eq!(breakdown.total_tokens, 250);
        assert_eq!(breakdown.cached_tokens, 150);
    }

    #[test]
    fn normalize_response_usage_populates_prompt_tokens_details() {
        let mut response = serde_json::json!({
            "id": "chatcmpl-test",
            "usage": {
                "input_tokens": 200,
                "output_tokens": 50,
                "cache_read_input_tokens": 128
            }
        });

        let breakdown = normalize_response_usage(&mut response);
        assert_eq!(breakdown.cached_tokens, 128);
        assert_eq!(
            response["usage"]["prompt_tokens_details"]["cached_tokens"],
            128
        );
    }
}
