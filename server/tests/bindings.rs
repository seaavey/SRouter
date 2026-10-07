//! The committed contract document: `server/bindings.ts`.
//!
//! Two properties are pinned here. The document is deterministic, so two
//! renderings are byte-identical and the committed file matches a regeneration;
//! and it is complete, so every type a response root references is present. A
//! shape change that is not re-exported fails `the_committed_document_matches_a_regeneration`.

use std::fs;
use std::path::PathBuf;

use srouter_server::bindings;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn committed() -> String {
    fs::read_to_string(manifest_dir().join("bindings.ts")).expect("`server/bindings.ts`")
}

#[test]
fn two_renderings_are_byte_identical() {
    let first = bindings::export().expect("the bindings render");
    let second = bindings::export().expect("the bindings render");

    assert_eq!(first, second, "the render is not deterministic");
}

#[test]
fn the_committed_document_matches_a_regeneration() {
    let rendered = bindings::export().expect("the bindings render");

    assert_eq!(
        committed(),
        rendered,
        "`server/bindings.ts` is stale; regenerate it with \
         `cargo run --manifest-path server/Cargo.toml --bin export_ts`"
    );
}

#[test]
fn the_document_is_exports_only() {
    let document = committed();

    assert!(!document.is_empty(), "the document is empty");

    // Only type declarations belong here. Another layout (`Namespaces`, `Files`)
    // would emit wrappers, so this fails if the exporter is ever reconfigured.
    for forbidden in [
        "interface ",
        "enum ",
        "namespace ",
        "declare ",
        "import ",
        "export const",
        "export function",
        "export default",
    ] {
        assert!(
            !document.contains(forbidden),
            "the bindings carry `{forbidden}`, which is not a type export"
        );
    }
}

#[test]
fn every_registered_root_is_exported() {
    let document = committed();

    // A root whose name does not appear in the document was registered but never
    // rendered, which means the graph lost it.
    for root in [
        "ApiInfo",
        "HealthResponse",
        "ErrorEnvelope",
        "SettingsResponse",
        "AdminStatus",
        "CreateAPIKeyInput",
        "UpdateAPIKeyInput",
        "APIKeyResponse",
        "CreatedAPIKeyResponse",
        "KeyListResponse",
        "CatalogModel",
        "ModelListResponse",
        "PricingListResponse",
        "QuotaResponse",
        "ProviderQuotaAccount",
        "LiveModelQuotaItem",
        "ProviderEntry",
        "ProviderStatus",
        "ProviderModel",
        "ProviderConnectionView",
        "ProviderListResponse",
        "CatalogResponse",
        "GroupedCatalog",
        "ProviderProtocol",
        "LogsResponse",
        "RequestLog",
        "UsageStatsReport",
        "AnalyticsReport",
        "LiveEvent",
    ] {
        assert!(
            document.contains(&format!("export type {root}")),
            "`{root}` is registered but missing from `server/bindings.ts`"
        );
    }
}

#[test]
fn the_wire_integer_fields_render_as_numbers() {
    let document = committed();

    // `i64`/`u64`/`usize` are forbidden to Specta, so every one of them carries a
    // `Number` override. If an override is dropped the render fails outright; this
    // test pins the observable result instead of relying on that failure.
    assert!(
        document.contains("export type RequestLog_Serialize"),
        "RequestLog is missing"
    );
    assert!(
        !document.contains("bigint"),
        "a bigint leaked into the bindings"
    );

    // The optional fields keep their nullability through the override.
    assert!(
        document.contains("\tinput?: number | null,"),
        "the `Option<i64>` override lost its nullability"
    );

    // A required `i64` stays required.
    assert!(
        document.contains("\tlatency_ms: number,"),
        "a required `i64` field stopped rendering as a plain number"
    );

    // One field is an aggregate the SQL can return as NULL, so it is optional on
    // the wire even though the Rust type is not.
    assert!(
        document.contains("\tavg_latency_ms: number | null,"),
        "the `avg_latency_ms` override lost its nullability"
    );
}
