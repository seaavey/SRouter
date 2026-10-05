//! Quota checker feature providing provider OAuth quota data.
//!
//! Exposes `GET /v1/quota` and the retained compatibility misspelling `GET /v1/qouta`.
//! Legacy evidence and contract:
//! - `docs/api-v1-contract.md` row 94 (`/v1/quota`, `/v1/qouta` (GET), API-key auth).
//! - `apps/api/src/routes/v1/quota.ts` (route definitions).
//! - `apps/api/src/logic/quota.logic.ts` (60s caching, in-flight coalescing, OAuth provider filtering).
//! - `packages/providers/src/quota/openai-codex.ts` (`wham/usage` API parsing).
//! - `packages/types/src/quota.ts` (QuotaResponse, ProviderQuotaAccount, LiveModelQuotaItem).
//! - `apps/api/tests/quota-oauth-filter.test.ts` (filter non-OAuth providers, graceful handling).

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock};

use crate::error::APIError;
pub use crate::features::providers::codex::quota::CODEX_USAGE_URL;
use crate::features::providers::codex::quota::fetch_codex_quota;
pub use crate::features::providers::quota::{LiveModelQuotaItem, ProviderQuotaAccount};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{
    ProviderForQuota, list_providers_for_quota, matches_base_id,
};
use crate::state::AppState;

/// In-memory cache time-to-live matching Node oracle (60 seconds).
const CACHE_TTL_SECS: u64 = 60;

/// Top-level response for `GET /v1/quota` and `GET /v1/qouta`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaResponse {
    pub object: &'static str,
    pub total_accounts: usize,
    pub providers: Vec<ProviderQuotaAccount>,
}

#[derive(Debug, Deserialize)]
pub struct QuotaQueryParams {
    pub refresh: Option<String>,
    pub force: Option<String>,
}

struct CachedQuota {
    expires_at: Instant,
    data: QuotaResponse,
}

/// Thread-safe in-memory cache with concurrent request coalescing.
pub struct QuotaCache {
    inner: RwLock<Option<CachedQuota>>,
    coalesce_lock: Mutex<()>,
    usage_url_override: Option<String>,
}

impl Default for QuotaCache {
    fn default() -> Self {
        Self::new()
    }
}

impl QuotaCache {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(None),
            coalesce_lock: Mutex::new(()),
            usage_url_override: None,
        }
    }

    /// Creates a cache configured with an upstream URL override (used in test fixtures).
    pub fn with_usage_url(usage_url: String) -> Self {
        Self {
            inner: RwLock::new(None),
            coalesce_lock: Mutex::new(()),
            usage_url_override: Some(usage_url),
        }
    }

    /// Retrieves quota information, returning cached data if fresh and unforced.
    pub async fn get_quota_info(
        &self,
        database: Option<&AppDatabase>,
        force_refresh: bool,
    ) -> Result<QuotaResponse, APIError> {
        if !force_refresh {
            let read = self.inner.read().await;
            if let Some(cached) = &*read
                && Instant::now() < cached.expires_at
            {
                return Ok(cached.data.clone());
            }
        }

        // Stampede protection: coalesce simultaneous cache misses
        let _guard = self.coalesce_lock.lock().await;

        if !force_refresh {
            let read = self.inner.read().await;
            if let Some(cached) = &*read
                && Instant::now() < cached.expires_at
            {
                return Ok(cached.data.clone());
            }
        }

        let response = fetch_live_quota(database, self.usage_url_override.as_deref()).await?;

        let mut write = self.inner.write().await;
        *write = Some(CachedQuota {
            expires_at: Instant::now() + Duration::from_secs(CACHE_TTL_SECS),
            data: response.clone(),
        });

        Ok(response)
    }
}

/// Mounts `/quota` and the retained compatibility alias `/qouta`.
pub fn create_quota_router() -> Router<AppState> {
    Router::new()
        .route("/quota", get(get_quota))
        .route("/qouta", get(get_quota))
}

async fn get_quota(
    State(state): State<AppState>,
    Query(query): Query<QuotaQueryParams>,
) -> Result<Json<QuotaResponse>, APIError> {
    let force = query.refresh.as_deref() == Some("true") || query.force.as_deref() == Some("true");
    let result = state
        .quota_cache
        .get_quota_info(state.database.as_ref(), force)
        .await?;
    Ok(Json(result))
}

/// Inspects database for OAuth providers and fetches their live quotas concurrently.
async fn fetch_live_quota(
    database: Option<&AppDatabase>,
    usage_url_override: Option<&str>,
) -> Result<QuotaResponse, APIError> {
    let Some(database) = database else {
        return Ok(QuotaResponse {
            object: "quota",
            total_accounts: 0,
            providers: Vec::new(),
        });
    };

    let all_providers = list_providers_for_quota(database).await?;
    let oauth_providers: Vec<_> = all_providers
        .into_iter()
        .filter(is_oauth_provider)
        .collect();

    if oauth_providers.is_empty() {
        return Ok(QuotaResponse {
            object: "quota",
            total_accounts: 0,
            providers: Vec::new(),
        });
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let usage_url = usage_url_override.unwrap_or(CODEX_USAGE_URL);

    // Concurrently fetch quota across accounts with error isolation
    let fetch_futures = oauth_providers.iter().map(|provider| {
        let client = &client;
        async move {
            let driver = if provider.provider_id.is_empty() {
                &provider.id
            } else {
                &provider.provider_id
            };

            if matches_base_id(driver, "openai_codex") {
                match fetch_codex_quota(client, provider, usage_url, now_secs).await {
                    Ok(acc) => acc,
                    Err(err) => {
                        tracing::debug!(
                            provider_id = %provider.id,
                            error = %err,
                            "Codex quota fetch failed or was unavailable"
                        );
                        None
                    }
                }
            } else {
                // Other OAuth providers without live quota endpoints are safely omitted
                None
            }
        }
    });

    let results = futures_util::future::join_all(fetch_futures).await;
    let accounts: Vec<ProviderQuotaAccount> = results.into_iter().flatten().collect();

    Ok(QuotaResponse {
        object: "quota",
        total_accounts: accounts.len(),
        providers: accounts,
    })
}

/// Identifies providers eligible for OAuth quota inspection. Non-OAuth providers
/// (e.g. regular API keys) are filtered out.
pub(crate) fn is_oauth_provider(p: &ProviderForQuota) -> bool {
    if p.category == "oauth" {
        return true;
    }
    let driver = if p.provider_id.is_empty() {
        &p.id
    } else {
        &p.provider_id
    };
    matches_base_id(driver, "openai_codex")
        || matches_base_id(driver, "antigravity")
        || matches_base_id(driver, "codebuddy-cn")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_provider_detection_matches_supported_drivers() {
        let make_provider = |id: &str, provider_id: &str, category: &str| ProviderForQuota {
            id: id.to_string(),
            name: "Test".to_string(),
            provider_id: provider_id.to_string(),
            category: category.to_string(),
            enabled: true,
            credentials_raw: "{}".to_string(),
        };

        assert!(is_oauth_provider(&make_provider(
            "p1",
            "openai_codex",
            "custom"
        )));
        assert!(is_oauth_provider(&make_provider("p2", "", "oauth")));
        assert!(is_oauth_provider(&make_provider(
            "antigravity",
            "",
            "custom"
        )));
        assert!(!is_oauth_provider(&make_provider("p3", "openai", "custom")));
    }
}
