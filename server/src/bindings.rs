//! The TypeScript view of the JSON wire shapes this build serves.
//!
//! [`types`] registers the response roots; every type reachable from them is
//! rendered too, so one call covers the whole surface. [`export`] turns that
//! graph into text, and [`targets`] names the two committed results of it:
//! `server/bindings.ts`, the contract document, and
//! `client/src/generated/typed.ts`, the copy the app imports.
//!
//! The document describes the JSON shapes, not HTTP: there is no route, method,
//! or security scheme in it, so nothing here ties a shape to the endpoint that
//! answers it. The table below is that tie, for responses and request bodies
//! alike; the live bytes are pinned by `server/tests/wire.rs` and the route
//! suites.
//!
//! Roots and the endpoint each answers:
//!
//! | Type                    | Endpoint                                       |
//! | ----------------------- | ---------------------------------------------- |
//! | `HealthResponse`        | `GET /health`                                  |
//! | `ApiInfo`               | `GET /`, `GET /v1`                             |
//! | `SettingsResponse`      | `GET`, `PATCH` `/v1/settings`                  |
//! | `AdminStatus`           | `GET /v1/admin/status`                         |
//! | `AdminAuthResult`       | `POST /v1/admin/setup`, `POST /v1/admin/login` |
//! | `AdminSetupInput`       | `POST /v1/admin/setup` body                    |
//! | `AdminLoginInput`       | `POST /v1/admin/login` body                    |
//! | `KeyListResponse`       | `GET /v1/keys`                                 |
//! | `APIKeyResponse`        | that list, plus the `PATCH` answer             |
//! | `CreatedAPIKeyResponse` | `POST /v1/keys`                                |
//! | `CreateAPIKeyInput`     | `POST /v1/keys` body                           |
//! | `UpdateAPIKeyInput`     | `PATCH /v1/keys/:id` body                      |
//! | `ModelListResponse`     | `GET /v1/models`                               |
//! | `CatalogModel`          | one entry of that list                         |
//! | `PricingListResponse`   | `GET /v1/models/pricing`                       |
//! | `QuotaResponse`         | `GET /v1/quota`, `GET /v1/qouta`               |
//! | `ProviderListResponse`  | `GET /v1/providers`                            |
//! | `CatalogResponse`       | `GET /v1/providers/catalog`                    |
//! | `LogsResponse`          | `GET /v1/logs`                                 |
//! | `RequestLog`            | one entry of that list, `GET /v1/logs/:id`     |
//! | `UsageStatsReport`      | `GET /v1/logs/stats`                           |
//! | `UsageData`             | that report's `data` object                    |
//! | `UsageTotals`           | the per-category totals inside `data`          |
//! | `AnalyticsReport`       | `GET /v1/logs/analytics`                       |
//! | `LiveEvent`             | the `/v1/logs/stream` SSE payloads             |
//! | `ErrorEnvelope`         | every error response                           |
//! | `ErrorCode`             | that envelope's `code`, a closed union         |

use std::borrow::Cow;
use std::path::PathBuf;

use specta::datatype::{DataType, Enum, Fields, NamedDataType, Reference, Struct, Variant};
use specta::{Format, FormatError, Types};

use crate::app::{ApiInfo, HealthResponse};
use crate::constants::ErrorCode;
use crate::error::ErrorEnvelope;
use crate::features::admin_auth::routes::{
    AdminAuthResult, AdminLoginInput, AdminSetupInput, AdminStatus,
};
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
    AnalyticsReport, RequestLog, UsageCacheTokens, UsageCostTotals, UsageData, UsageRequestTotals,
    UsageStatsReport, UsageTokenTotals, UsageTotals,
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
        .register::<ErrorCode>()
        .register::<SettingsResponse>()
        .register::<AdminStatus>()
        .register::<AdminAuthResult>()
        .register::<AdminSetupInput>()
        .register::<AdminLoginInput>()
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
        .register::<UsageData>()
        .register::<UsageTotals>()
        .register::<UsageRequestTotals>()
        .register::<UsageTokenTotals>()
        .register::<UsageCacheTokens>()
        .register::<UsageCostTotals>()
        .register::<AnalyticsReport>()
        .register::<LiveEvent>()
}

/// Renders the TypeScript bindings for [`types`].
pub fn export() -> Result<String, specta_typescript::Error> {
    let types = types();
    let document = specta_typescript::Typescript::default().export(&types, WireShapes)?;
    Ok(format!("{document}{}", error_code_values(&types)?))
}

/// The runtime half of `ErrorCode`: `export const ErrorCode = { … }`.
///
/// TypeScript erases types before running, so a closed union alone leaves
/// nothing on the client to name — `ErrorCode.authentication_required` would be
/// a property of a value that does not exist. The const object supplies it, and
/// `satisfies Record<ErrorCode, ErrorCode>` makes the compiler reject the object
/// the moment it disagrees with the union, so the two cannot drift.
///
/// Both halves are read from the same [`Types`] graph through [`WireShapes`],
/// which is what keeps a newly added variant appearing in both or neither.
fn error_code_values(types: &Types) -> Result<String, specta_typescript::Error> {
    let formatted = WireShapes
        .map_types(types)
        .map_err(|source| specta_typescript::Error::framework("formatting ErrorCode", source))?;

    let named = formatted
        .into_sorted_iter()
        .find(|named| named.name == "ErrorCode")
        .ok_or_else(|| {
            specta_typescript::Error::framework(
                "formatting ErrorCode",
                "the type is not registered",
            )
        })?;

    let variants = match named.ty.as_ref() {
        Some(DataType::Enum(enm)) => &enm.variants,
        _ => {
            return Err(specta_typescript::Error::framework(
                "formatting ErrorCode",
                "it no longer renders as an enum",
            ));
        }
    };

    let mut block = String::from("\nexport const ErrorCode = {\n");
    for (name, _) in variants {
        block.push_str(&format!("\t{name}: \"{name}\",\n"));
    }
    block.push_str("} as const satisfies Record<ErrorCode, ErrorCode>;\n");
    Ok(block)
}

/// The committed files a rendering of [`export`] is written to.
///
/// Both carry the same bytes: `server/bindings.ts` is what the contract suite
/// reads, and the copy under `client/` is what the app imports. The drift test
/// pins each one to a fresh render, so the two can never disagree.
pub fn targets() -> [PathBuf; 2] {
    let server = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo = server
        .parent()
        .expect("`server/` sits inside the repository root")
        .to_path_buf();

    [
        server.join("bindings.ts"),
        repo.join("client/src/generated/typed.ts"),
    ]
}

/// Renders one shape per type through `specta-serde`'s unified formatter.
///
/// The unified formatter refuses `skip_serializing_if`, and the phase formatter
/// answers that by exporting `X_Serialize` and `X_Deserialize` for every type
/// that reaches such a field, plus `X = X_Serialize | X_Deserialize`. The
/// distinction is real — a field the server omits when it is null is also a field
/// a request body may simply leave out — but a response reader only ever sees one
/// of the two shapes, and every one of those fields already carries
/// `#[specta(optional)]`, which describes the same fact without splitting the
/// graph.
///
/// So this formatter hands the unified formatter a copy of the graph with the
/// runtime attribute removed from the fields. Only the exported document changes:
/// the serializers still omit the field, and the drift test that compares
/// `server/bindings.ts` with a regeneration still holds.
struct WireShapes;

impl Format for WireShapes {
    fn map_types(&self, types: &Types) -> Result<Cow<'_, Types>, FormatError> {
        let mut unified = types.clone();
        unified.iter_mut(strip);

        specta_serde::Format.map_types(&unified)
    }

    fn map_type(&self, types: &Types, ty: &DataType) -> Result<Cow<'_, DataType>, FormatError> {
        specta_serde::Format.map_type(types, ty)
    }
}

/// Recursively drops the conditional-omission runtime attribute.
fn strip(ty: &mut NamedDataType) {
    if let Some(ty) = ty.ty.as_mut() {
        strip_datatype(ty);
    }
}

fn strip_datatype(ty: &mut DataType) {
    match ty {
        DataType::Struct(strct) => strip_struct(strct),
        DataType::Enum(enm) => strip_enum(enm),
        DataType::List(list) => strip_datatype(&mut list.ty),
        DataType::Tuple(tuple) => tuple.elements.iter_mut().for_each(strip_datatype),
        DataType::Nullable(inner) => strip_datatype(inner),
        DataType::Intersection(parts) => parts.iter_mut().for_each(strip_datatype),
        DataType::Map(map) => {
            strip_datatype(map.key_ty_mut());
            strip_datatype(map.value_ty_mut());
        }
        DataType::Reference(reference) => {
            if let Reference::Named(named) = reference
                && let specta::datatype::NamedReferenceType::Inline { dt, .. } = &mut named.inner
            {
                strip_datatype(dt);
            }
        }
        DataType::Primitive(_) | DataType::Generic(_) => {}
    }
}

fn strip_struct(strct: &mut Struct) {
    strip_fields(&mut strct.fields);
}

fn strip_enum(enm: &mut Enum) {
    for (_, variant) in &mut enm.variants {
        strip_variant(variant);
    }
}

fn strip_variant(variant: &mut Variant) {
    strip_fields(&mut variant.fields);
}

fn strip_fields(fields: &mut Fields) {
    match fields {
        Fields::Unit => {}
        Fields::Unnamed(unnamed) => {
            for field in &mut unnamed.fields {
                strip_field(field);
            }
        }
        Fields::Named(named) => {
            for (_, field) in &mut named.fields {
                strip_field(field);
            }
        }
    }
}

fn strip_field(field: &mut specta::datatype::Field) {
    field.attributes.remove(CONDITIONAL_OMISSION);
    if let Some(ty) = field.ty.as_mut() {
        strip_datatype(ty);
    }
}

/// The wire attribute that makes Serde omit a field, and the one marker that
/// forces `specta-serde` into its phase split.
const CONDITIONAL_OMISSION: &str = "serde:field:skip_serializing_if";
