//! API-key model allowlist matching, ported from the Node middleware
//! `apps/api/src/middleware/ModelAccess.ts`.

use crate::error::APIError;
use crate::features::api_keys::model::APIKeyRecord;

/// Strips the exact `srouter/` prefix the Node helper strips, then lowercases.
pub fn normalize_model_id(model: &str) -> String {
    model
        .strip_prefix("srouter/")
        .unwrap_or(model)
        .to_lowercase()
}

/// Reports whether `model` is on the key's allowlist; an empty or missing list
/// allows every model.
pub fn is_model_allowed(allowed_models: Option<&[String]>, model: &str) -> bool {
    let Some(allowed_models) = allowed_models else {
        return true;
    };
    if allowed_models.is_empty() {
        return true;
    }

    let requested = normalize_model_id(model);
    let requested_raw = model.to_lowercase();

    allowed_models.iter().any(|allowed| {
        let normalized = normalize_model_id(allowed);
        if normalized == requested || allowed.to_lowercase() == requested_raw {
            return true;
        }

        // Matching also works with or without a provider prefix, but only when
        // at least one side is a bare id: `openai/gpt-4o` must not match
        // `anthropic/gpt-4o`.
        let allowed_parts: Vec<&str> = normalized.split('/').collect();
        let requested_parts: Vec<&str> = requested.split('/').collect();

        allowed_parts.last() == requested_parts.last()
            && (allowed_parts.len() == 1 || requested_parts.len() == 1)
    })
}

/// Enforces the allowlist for a request carrying `api_key`; principals without
/// a key record (admin sessions, anonymous loopback) are unrestricted.
pub fn ensure_model_allowed(api_key: Option<&APIKeyRecord>, model: &str) -> Result<(), APIError> {
    let Some(record) = api_key else {
        return Ok(());
    };
    if model.is_empty() {
        return Ok(());
    }
    if is_model_allowed(record.allowed_models.as_deref(), model) {
        return Ok(());
    }

    Err(APIError::new(
        403,
        format!("Model '{model}' is not allowed for this API key"),
    )
    .with_code("model_not_allowed"))
}

#[cfg(test)]
mod tests {
    use crate::features::api_keys::model::APIKeyRecord;

    use super::{ensure_model_allowed, is_model_allowed, normalize_model_id};

    #[test]
    fn normalization_strips_srouter_and_lowercases() {
        assert_eq!(normalize_model_id("srouter/GPT-4o"), "gpt-4o");
        assert_eq!(normalize_model_id("openai/GPT-4o"), "openai/gpt-4o");
    }

    #[test]
    fn a_null_or_empty_list_allows_everything() {
        assert!(is_model_allowed(None, "gpt-4o"));
        assert!(is_model_allowed(Some(&[]), "gpt-4o"));
    }

    #[test]
    fn allowlist_membership_is_enforced() {
        let allowed = ["gpt-4o".to_owned(), "claude-3-5-sonnet-20241022".to_owned()];

        assert!(is_model_allowed(Some(&allowed), "gpt-4o"));
        assert!(!is_model_allowed(Some(&allowed), "gpt-4o-mini"));
        assert!(is_model_allowed(
            Some(&allowed),
            "claude-3-5-sonnet-20241022"
        ));
    }

    #[test]
    fn the_srouter_prefix_is_ignored_when_matching() {
        assert!(is_model_allowed(
            Some(&[String::from("gpt-4o")]),
            "srouter/gpt-4o"
        ));
        assert!(is_model_allowed(
            Some(&[String::from("srouter/gpt-4o")]),
            "gpt-4o"
        ));
    }

    #[test]
    fn provider_prefixes_match_in_both_directions() {
        assert!(is_model_allowed(
            Some(&[String::from("gpt-4o")]),
            "openai/gpt-4o"
        ));
        assert!(is_model_allowed(
            Some(&[String::from("openai/gpt-4o")]),
            "gpt-4o"
        ));
        assert!(is_model_allowed(
            Some(&[String::from("claude-3-5-sonnet")]),
            "anthropic/claude-3-5-sonnet"
        ));
        assert!(!is_model_allowed(
            Some(&[String::from("openai/gpt-4o")]),
            "openai/gpt-4o-mini"
        ));
    }

    #[test]
    fn cross_provider_qualified_models_are_rejected() {
        assert!(!is_model_allowed(
            Some(&[String::from("openai/gpt-4o")]),
            "anthropic/gpt-4o"
        ));
    }

    #[test]
    fn matching_is_case_insensitive() {
        assert!(is_model_allowed(Some(&[String::from("GPT-4o")]), "gpt-4o"));
        assert!(is_model_allowed(
            Some(&[String::from("gpt-4o")]),
            "srouter/GPT-4O"
        ));
    }

    #[test]
    fn an_empty_requested_model_skips_the_check() {
        let record = APIKeyRecord {
            id: String::from("key_1"),
            enabled: true,
            rate_limit: 0,
            quota_limit: 0.0,
            usage_tokens: 0.0,
            credit_limit: 0.0,
            usage_cost: 0.0,
            allowed_models: Some(vec![String::from("gpt-4o")]),
        };

        assert!(ensure_model_allowed(Some(&record), "").is_ok());
    }

    #[test]
    fn a_disallowed_model_is_rejected_with_the_frozen_envelope() {
        let record = APIKeyRecord {
            id: String::from("key_1"),
            enabled: true,
            rate_limit: 0,
            quota_limit: 0.0,
            usage_tokens: 0.0,
            credit_limit: 0.0,
            usage_cost: 0.0,
            allowed_models: Some(vec![String::from("gpt-4o")]),
        };

        let error = ensure_model_allowed(Some(&record), "claude-3-5-sonnet").unwrap_err();

        assert_eq!(error.status(), 403);
        let json = serde_json::to_value(error.to_envelope()).unwrap();
        assert_eq!(json["error"]["type"], "permission_error");
        assert_eq!(json["error"]["code"], "model_not_allowed");
        assert_eq!(
            json["error"]["message"],
            "Model 'claude-3-5-sonnet' is not allowed for this API key"
        );
    }
}
