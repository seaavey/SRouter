//! Reads the model catalog from the official CodeBuddy package's `product.json`.
//!
//! CodeBuddy exposes no model-listing endpoint to personal accounts: the live
//! product-config endpoint (`GET /v3/config`) carries a `models` array only for
//! enterprise deployments, and the enterprise-only
//! `/console/enterprises/{enterpriseId}/config/models` answers 403 otherwise.
//! The official client (`@tencent-ai/codebuddy-code`) ships its authoritative
//! model list in the package's `product.json`, so the server reads that file
//! instead of keeping a list of its own. A live `/v3/config` still merges on top
//! when the account is enterprise.
//!
//! The path is resolved from `CODEBUDDY_PRODUCT_JSON` when set, otherwise from
//! the usual global install locations. A missing or unreadable file is not an
//! error: the caller keeps whatever snapshot it already has.

use std::path::{Path, PathBuf};

use serde_json::Value;

/// Explicit override for the `product.json` location.
pub const PRODUCT_JSON_ENV: &str = "CODEBUDDY_PRODUCT_JSON";

/// Package directory relative to a Node global `lib` or a project `node_modules`.
const PACKAGE_TAIL: &str = "@tencent-ai/codebuddy-code/product.json";

/// Resolves the `product.json` path: the environment override first, then the
/// global install locations (`nvm`, `npm -g`, system prefixes, project-local).
pub fn resolve_product_json_path() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var(PRODUCT_JSON_ENV) {
        let explicit = explicit.trim();
        if !explicit.is_empty() {
            let path = PathBuf::from(explicit);
            if path.is_file() {
                return Some(path);
            }
        }
    }

    candidate_paths().into_iter().find(|path| path.is_file())
}

fn candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);

        let nvm = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm) {
            let mut versions: Vec<PathBuf> = entries
                .flatten()
                .map(|entry| entry.path().join("lib/node_modules").join(PACKAGE_TAIL))
                .collect();
            // Newest-looking directory last is not guaranteed; sort for a stable
            // pick across boots.
            versions.sort();
            candidates.extend(versions);
        }

        candidates.push(home.join(".npm-global/lib/node_modules").join(PACKAGE_TAIL));
        candidates.push(home.join("node_modules").join(PACKAGE_TAIL));
    }

    candidates.push(PathBuf::from("/usr/lib/node_modules").join(PACKAGE_TAIL));
    candidates.push(PathBuf::from("/usr/local/lib/node_modules").join(PACKAGE_TAIL));
    candidates.push(PathBuf::from("node_modules").join(PACKAGE_TAIL));

    candidates
}

/// Reads and parses the model ids from a resolved `product.json`. A missing
/// path or an unreadable/malformed file yields `None` so the caller keeps its
/// current snapshot.
pub fn load_product_models(path: Option<&Path>) -> Option<Vec<String>> {
    let text = std::fs::read_to_string(path?).ok()?;
    parse_product_models(&text)
}

/// Parses the `models[].id` list of a `product.json` payload, trimmed, sorted,
/// and deduplicated. Returns `None` when the payload has no `models` array.
pub fn parse_product_models(text: &str) -> Option<Vec<String>> {
    let value: Value = serde_json::from_str(text).ok()?;
    let entries = value.get("models")?.as_array()?;

    let mut models: Vec<String> = entries
        .iter()
        .filter_map(|entry| entry.get("id")?.as_str())
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .collect();
    models.sort();
    models.dedup();

    Some(models)
}

#[cfg(test)]
mod tests {
    use super::parse_product_models;

    #[test]
    fn parses_and_orders_the_product_model_ids() {
        let models = parse_product_models(
            r#"{"models":[{"id":"gpt-6-astra"},{"id":" deepseek-v4.1-flash "},{"id":"gpt-6-astra"}]}"#,
        )
        .expect("models parse");

        assert_eq!(models, vec!["deepseek-v4.1-flash", "gpt-6-astra"]);
    }

    #[test]
    fn drops_blank_and_missing_ids() {
        let models =
            parse_product_models(r#"{"models":[{"id":""},{"name":"no-id"},{"id":"hy4-preview"}]}"#)
                .expect("models parse");

        assert_eq!(models, vec!["hy4-preview"]);
    }

    #[test]
    fn a_payload_without_a_models_array_is_not_a_catalog() {
        assert!(parse_product_models(r#"{"agents":[]}"#).is_none());
        assert!(parse_product_models("not json").is_none());
    }

    #[test]
    fn an_empty_models_array_parses_to_an_empty_list() {
        assert_eq!(parse_product_models(r#"{"models":[]}"#), Some(Vec::new()));
    }
}
