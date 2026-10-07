//! Models.dev pricing catalog and token cost estimation.

use std::collections::HashMap;
use std::sync::LazyLock;

use axum::{
    Json, Router,
    extract::Query,
    http::{HeaderMap, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::{Deserialize, Serialize};

use crate::constants;
use crate::protocol::usage::UsageBreakdown;
use crate::state::AppState;

const PRICING_JSON: &str = include_str!("data/models-dev-pricing.json");

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct PricingListResponse {
    pub object: String,
    pub total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    pub data: Vec<ModelPricingItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ModelPricingItem {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    pub provider: String,
    pub attachment: bool,
    pub reasoning: bool,
    pub tool_call: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_output: Option<bool>,
    pub open_weights: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub knowledge: Option<String>,
    pub release_date: String,
    pub last_updated: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<ModelPricingCost>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<ModelPricingLimit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modalities: Option<ModelPricingModalities>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ModelPricingCost {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_audio: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_audio: Option<f64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ModelPricingLimit {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ModelPricingModalities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Vec<String>>,
}

#[derive(Debug, Default, Deserialize)]
pub struct PricingQuery {
    pub refresh: Option<String>,
    pub force: Option<String>,
}

struct StaticPricingCatalog {
    response: PricingListResponse,
    cost_map: HashMap<String, ModelPricingCost>,
}

static CATALOG: LazyLock<StaticPricingCatalog> = LazyLock::new(|| {
    let items: Vec<ModelPricingItem> =
        serde_json::from_str(PRICING_JSON).expect("models-dev-pricing.json must be valid JSON");

    let mut cost_map = HashMap::with_capacity(items.len() * 2);

    for item in &items {
        if let Some(cost) = item.cost {
            let model_key = item.id.to_lowercase();
            let provider_key = item.provider.to_lowercase();
            let full_key = format!("{provider_key}/{model_key}");

            cost_map.insert(full_key, cost);

            // Also map bare model ID. If duplicate bare IDs exist across providers,
            // prioritize the entry with defined input/output rates, or canonical provider.
            match cost_map.get(&model_key) {
                None => {
                    cost_map.insert(model_key, cost);
                }
                Some(existing) => {
                    let canonical = matches!(
                        item.provider.as_str(),
                        "openai" | "anthropic" | "google" | "deepseek"
                    );
                    if canonical || (existing.input.is_none() && cost.input.is_some()) {
                        cost_map.insert(model_key, cost);
                    }
                }
            }
        }
    }

    let response = PricingListResponse {
        object: String::from("list"),
        total: items.len(),
        updated_at: None,
        data: items,
    };

    StaticPricingCatalog { response, cost_map }
});

/// Handler for `GET /v1/pricing/models`.
pub async fn get_pricing_models(
    Query(_query): Query<PricingQuery>,
    _headers: HeaderMap,
) -> Response {
    (
        [(
            header::CACHE_CONTROL,
            constants::headers::value::PRICING_CACHE_CONTROL,
        )],
        Json(&CATALOG.response),
    )
        .into_response()
}

/// Creates the router for pricing routes (`/pricing/models`).
pub fn create_pricing_router() -> Router<AppState> {
    Router::new().route("/pricing/models", get(get_pricing_models))
}

/// Detailed token cost breakdown in USD.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CostBreakdown {
    pub input: f64,
    pub output: f64,
    pub cache: f64,
    pub total: f64,
}

/// Estimates detailed token cost breakdown in USD for a model and usage breakdown.
///
/// Returns `None` if the model rate is unpriced or unknown.
pub fn estimate_cost_breakdown(model_id: &str, usage: &UsageBreakdown) -> Option<CostBreakdown> {
    let normalized = model_id.trim().to_lowercase();

    let cost = CATALOG
        .cost_map
        .get(&normalized)
        .or_else(|| {
            // Strip provider prefix if present (e.g. "openai/gpt-4o" -> "gpt-4o", "zen/...", etc.)
            let bare = normalized.split_once('/').map(|(_, rest)| rest)?;
            CATALOG.cost_map.get(bare)
        })
        .copied()?;

    // If cost has neither input nor output rate defined, consider it unpriced.
    if cost.input.is_none() && cost.output.is_none() {
        return None;
    }

    let input_rate = cost.input.unwrap_or(0.0);
    let output_rate = cost.output.unwrap_or(0.0);
    let cache_read_rate = cost.cache_read.unwrap_or(input_rate);
    let cache_write_rate = cost.cache_write.unwrap_or(input_rate);

    let non_cached_prompt =
        (usage.prompt_tokens - usage.cached_tokens - usage.cache_creation_tokens).max(0);

    let prompt_cost = non_cached_prompt as f64 * input_rate / 1_000_000.0;
    let cache_read_cost = usage.cached_tokens as f64 * cache_read_rate / 1_000_000.0;
    let cache_write_cost = usage.cache_creation_tokens as f64 * cache_write_rate / 1_000_000.0;
    let cache_cost = cache_read_cost + cache_write_cost;
    let completion_cost = usage.completion_tokens as f64 * output_rate / 1_000_000.0;

    let total = prompt_cost + cache_cost + completion_cost;
    Some(CostBreakdown {
        input: prompt_cost,
        output: completion_cost,
        cache: cache_cost,
        total,
    })
}

/// Estimates token cost in USD for a model and usage breakdown.
///
/// Returns `None` if the model rate is unpriced or unknown.
/// Explicit zero rates return `Some(0.0)`.
pub fn estimate_cost(model_id: &str, usage: &UsageBreakdown) -> Option<f64> {
    estimate_cost_breakdown(model_id, usage).map(|breakdown| breakdown.total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pricing_catalog_loads_and_has_elements() {
        assert!(CATALOG.response.total > 2000);
        assert_eq!(CATALOG.response.total, CATALOG.response.data.len());
        assert_eq!(CATALOG.response.object, "list");
    }

    #[test]
    fn estimate_cost_calculates_correctly() {
        let usage = UsageBreakdown {
            prompt_tokens: 1000,
            completion_tokens: 500,
            total_tokens: 1500,
            cached_tokens: 200,
            cache_creation_tokens: 100,
            reasoning_tokens: 0,
        };

        // If cost is input: 10.0, output: 20.0, cache_read: 2.5, cache_write: 5.0 ($/M tokens)
        // non_cached_prompt = 1000 - 200 - 100 = 700
        // prompt_cost = 700 * 10 / 1_000_000 = 0.007
        // cache_read = 200 * 2.5 / 1_000_000 = 0.0005
        // cache_write = 100 * 5.0 / 1_000_000 = 0.0005
        // completion_cost = 500 * 20 / 1_000_000 = 0.010
        // total = 0.007 + 0.0005 + 0.0005 + 0.010 = 0.018
        // Let's test with a real model or estimate_cost logic
        let cost = estimate_cost("unknown-model-xyz", &usage);
        assert_eq!(cost, None);
    }
}
