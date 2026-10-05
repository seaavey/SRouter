//! Provider quota contract shared by the provider fetchers that produce it and
//! the quota aggregator that serves `GET /v1/quota`.

use serde::{Deserialize, Serialize};

/// An account's quota overview.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderQuotaAccount {
    pub id: String,
    pub provider: String,
    pub account: String,
    pub enabled: bool,
    pub quota_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_quotas: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quotas: Option<Vec<LiveModelQuotaItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_metrics: Option<Vec<serde_json::Value>>,
}

/// A specific rate-limit window or model quota entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveModelQuotaItem {
    pub name: String,
    pub used: u32,
    pub limit: u32,
    pub percentage: String,
    pub percentage_value: u32,
    pub reset_in: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_time: Option<String>,
    pub status: &'static str,
}
