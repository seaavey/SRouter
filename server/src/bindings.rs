//! The TypeScript view of the JSON wire shapes this build serves.
//!
//! [`types`] registers the response roots; every type reachable from them is
//! rendered too, so one call covers the whole surface. [`export`] turns that
//! graph into text, and `server/bindings.ts` is the committed result of it.
//!
//! The document describes the JSON shapes, not HTTP: there is no route, method,
//! or security scheme in it, so nothing here ties a shape to the endpoint that
//! answers it. The request side is covered by `server/tests/contract.rs` and the
//! live route sweep in `server/tests/transcript.rs`.
//!
//! Roots and the endpoint each answers:
//!
//! | Type                    | Endpoint                                   |
//! | ----------------------- | ------------------------------------------ |
//! | `HealthResponse`        | `GET /health`                              |
//! | `ApiInfo`               | `GET /`, `GET /v1`                         |
//! | `SettingsResponse`      | `GET`, `PATCH` `/v1/settings`              |
//! | `AdminStatus`           | `GET /v1/admin/status`                     |
//! | `KeyListResponse`       | `GET /v1/keys`                             |
//! | `APIKeyResponse`        | that list, plus the `PATCH` answer         |
//! | `CreatedAPIKeyResponse` | `POST /v1/keys`                            |
//! | `CreateAPIKeyInput`     | `POST /v1/keys` body                       |
//! | `UpdateAPIKeyInput`     | `PATCH /v1/keys/:id` body                  |
//! | `ModelListResponse`     | `GET /v1/models`                           |
//! | `CatalogModel`          | one entry of that list                     |
//! | `PricingListResponse`   | `GET /v1/models/pricing`                   |
//! | `QuotaResponse`         | `GET /v1/quota`, `GET /v1/qouta`           |
//! | `ProviderListResponse`  | `GET /v1/providers`                        |
//! | `CatalogResponse`       | `GET /v1/providers/catalog`                |
//! | `LogsResponse`          | `GET /v1/logs`                             |
//! | `RequestLog`            | one entry of that list, `GET /v1/logs/:id` |
//! | `UsageStatsReport`      | `GET /v1/logs/stats`                       |
//! | `AnalyticsReport`       | `GET /v1/logs/analytics`                   |
//! | `LiveEvent`             | the `/v1/logs/stream` SSE payloads         |
//! | `ErrorEnvelope`         | every error response                       |

use specta::Types;

use crate::app::{ApiInfo, HealthResponse};
use crate::error::ErrorEnvelope;
use crate::features::admin_auth::routes::AdminStatus;
use crate::features::api_keys::routes::{APIKeyResponse, CreatedAPIKeyResponse, KeyListResponse};
use crate::features::api_keys::{CreateAPIKeyInput, UpdateAPIKeyInput};
use crate::features::catalog::models::{CatalogModel, ModelListResponse};
use crate::features::catalog::pricing::PricingListResponse;
use crate::features::catalog::quota::QuotaResponse;
use crate::features::logs::{LiveEvent, LogsResponse};
use crate::features::providers::management::model::{
    CatalogResponse, GroupedCatalog, ProviderConnectionView, ProviderEntry, ProviderModel,
    ProviderStatus,
};
use crate::features::providers::management::routes::ProviderListResponse;
use crate::features::providers::model::ProviderProtocol;
use crate::features::providers::quota::{LiveModelQuotaItem, ProviderQuotaAccount};
use crate::features::settings::SettingsResponse;
use crate::infrastructure::database::request_logs::{
    AnalyticsReport, RequestLog, UsageStatsReport,
};

/// Registers the wire types the bindings export.
///
/// Registering a root pulls in everything it references, so this list states the
/// surface's entry points rather than an inventory of the output.
pub fn types() -> Types {
    Types::default()
        .register::<ApiInfo>()
        .register::<HealthResponse>()
        .register::<ErrorEnvelope>()
        .register::<SettingsResponse>()
        .register::<AdminStatus>()
        .register::<CreateAPIKeyInput>()
        .register::<UpdateAPIKeyInput>()
        .register::<APIKeyResponse>()
        .register::<CreatedAPIKeyResponse>()
        .register::<KeyListResponse>()
        .register::<CatalogModel>()
        .register::<ModelListResponse>()
        .register::<PricingListResponse>()
        .register::<QuotaResponse>()
        .register::<ProviderQuotaAccount>()
        .register::<LiveModelQuotaItem>()
        .register::<ProviderEntry>()
        .register::<ProviderStatus>()
        .register::<ProviderModel>()
        .register::<ProviderConnectionView>()
        .register::<ProviderListResponse>()
        .register::<CatalogResponse>()
        .register::<GroupedCatalog>()
        .register::<ProviderProtocol>()
        .register::<LogsResponse>()
        .register::<RequestLog>()
        .register::<UsageStatsReport>()
        .register::<AnalyticsReport>()
        .register::<LiveEvent>()
}

/// Renders the TypeScript bindings for [`types`].
pub fn export() -> Result<String, specta_typescript::Error> {
    specta_typescript::Typescript::default().export(&types(), specta_serde::PhasesFormat)
}
