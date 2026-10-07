//! Provider quota contract shared by the provider fetchers that produce it and
//! the quota aggregator that serves `GET /v1/quota`.

use serde::{Deserialize, Serialize};

/// An account's quota overview.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ProviderQuotaAccount {
    pub id: String,
    pub provider: String,
    pub account: String,
    pub enabled: bool,
    pub quota_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<specta_typescript::Number>)]
    #[specta(optional)]
    pub total_quotas: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub quotas: Option<Vec<LiveModelQuotaItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub usage_metrics: Option<Vec<ProviderUsageMetric>>,
}

/// One `usage_metrics` row: what a provider driver reports about a model's
/// logged usage.
///
/// No driver in this build fills it (`usage_metrics` is always `None`), but the
/// shape is the one Node declares (`packages/types/src/quota.ts`,
/// `ProviderUsageMetric`), so a client can read the field without a hole in its
/// types.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ProviderUsageMetric {
    pub model: String,
    #[specta(type = specta_typescript::Number)]
    pub total_requests: i64,
    #[specta(type = specta_typescript::Number)]
    pub total_tokens: i64,
    #[specta(type = specta_typescript::Number)]
    pub prompt_tokens: i64,
    #[specta(type = specta_typescript::Number)]
    pub completion_tokens: i64,
    pub last_used_at: Option<String>,
}

/// The three verdicts a fetch reports for a quota window. Rendered as a closed
/// union because the fetchers compute it from the remaining percentage.
struct QuotaStatus;

impl specta::Type for QuotaStatus {
    fn definition(_: &mut specta::Types) -> specta::datatype::DataType {
        specta::datatype::DataType::Reference(specta_typescript::define(
            "\"exhausted\" | \"warning\" | \"ok\"",
        ))
    }
}

/// A specific rate-limit window or model quota entry.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct LiveModelQuotaItem {
    pub name: String,
    pub used: u32,
    pub limit: u32,
    pub percentage: String,
    pub percentage_value: u32,
    pub reset_in: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub reset_time: Option<String>,
    #[specta(type = QuotaStatus)]
    pub status: &'static str,
}
