# Provider Catalog Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the `/v1/providers` catalog, detail, hidden-model, and enabled-toggle routes from the Rust server so the web Providers page has a data source when `server/` is the running gateway.

**Architecture:** Reads and writes go through free async functions that take `&AppDatabase`, the pattern already used by `catalog_flags.rs` and `request_logs.rs` — no new trait, fake, or DI layer. Response types live in a new `features/providers/management/` module built from the static `ProviderMetadata` seed, while the provider registry stays the single source of advertised models. Reads degrade to the seed catalog when no database is configured; writes fail loudly instead of pretending to persist.

**Tech Stack:** Rust edition 2024 (stable toolchain), axum 0.8, sqlx 0.9 (SQLite first, Postgres unsupported for these writes), serde/serde_json (`Value` hand-parsing for request bodies), tokio 1 (tests), tower 0.5 (dev, `oneshot`).

**Spec:** `docs/api-v1-contract.md` (frozen route and error shapes; the Providers rows are updated by Task 6), `docs/api-database-contract.md` (schema v2 table ownership), `docs/superpowers/plans/2026-09-24-srouter-api-rust-migration.md` (parent migration plan). Behavioral source of truth is the Node implementation: `apps/api/src/logic/providers.logic.ts`, `apps/api/src/controllers/providers.controller.ts`, `apps/api/src/routes/v1/providers.ts:13-65`, `apps/api/src/logic/models.logic.ts:17-23`, `packages/db/src/{settings,hiddenModels}.ts`.

## Context

`server/` currently serves 16 routes; `apps/api` serves ~92. The `providers`, `provider_model_overrides`, and `settings` tables already exist in schema v2 (`server/migrations/0002_v2_schema.sql:42-64,120-123`), but no line of Rust reads them yet, so the Providers page has no backing data on the Rust build.

This slice closes the read side plus the writes that can be built without touching the chat/messages dispatch path. Deliberate scope limits:

- **No round-robin.** `PATCH /providers/:id/round-robin` is not built, and the `round_robin` field is never emitted — a field that can never be `true` is a dead column.
- **No connection CRUD** (`POST /v1/providers`, `DELETE /v1/providers/:id`) **and no `/verify`** — both require credential storage, an SSRF guard, and a dynamic registry.
- **opencode_zen only.** The Rust seed catalog stays at one entry (`OPENCODE_ZEN_PROVIDER`); Node's 16 seed providers are not ported.
- `GET /v1/providers/{providerId}` emits **`hidden: bool` + `favorite: bool`** per model rather than a filtered list — the admin view must see hidden models in order to restore them.
- `GET /v1/models` **does** filter out hidden models and disabled providers (Node behavior).

## Global Constraints

- Only `server/` changes. `apps/api`, `packages/*`, and `apps/web` are untouched in this slice.
- No new dependency in `server/Cargo.toml`; no new table — `server/tests/schema.rs:10-21,44,62` asserts `V2_TABLES.len() == 10`.
- No new trait + fake + DI: the pattern is **free async functions taking `&AppDatabase`**, like `server/src/infrastructure/database/catalog_flags.rs` and `request_logs.rs`.
- Handlers reach the database through `state.database: Option<AppDatabase>` (`server/src/state.rs:92`). **Reads** degrade to the catalog without a database (empty set, `connected_count: 0`, `enabled: true`), following `catalog_flags.rs:14-16`. **Writes** return `APIError::new(500, ...)` when it is `None` or when the backend is Postgres, following `postgres_unsupported()` in `server/src/infrastructure/database/api_keys.rs:311-316`.
- SQL always uses `?` placeholders with `.bind()`; row mapping uses `row.try_get::<T, _>(...)` with `map_err`, no `unwrap()`/`expect()` in production code.
- `credentials` is **never** selected into handler memory and never appears in a response. The connection struct has no credential field at all — a security deviation from Node, which leaks `connections[].apiKey` (`providers.logic.ts:247`).
- JSON field names are snake_case: `connected_count` (not Node's `connectedCount`). The web consequences are recorded in Follow-up.
- Tests use `support::TestDatabase` (unique tmp SQLite file) only; the production database must never be opened.
- Run focused cargo tests per target (`cargo test --test providers`); never the full suite — the dev machine cannot afford it.
- Code, comments, identifiers, and commit messages are English; comments only explain "why".

## File Structure

| File                                                  | Responsibility                                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/features/providers/management/mod.rs`     | new — declare `model`, `routes`; export `create_providers_read_router` (Task 1) then `create_providers_management_router` (Task 3)                                          |
| `server/src/features/providers/management/model.rs`   | new — response types `ProviderEntry`/`ProviderStatus`/`ProviderModel`/`ProviderConnectionView`/`CatalogResponse` plus construction from `ProviderMetadata`                  |
| `server/src/features/providers/management/routes.rs`  | new — 7 handlers + payload parsing (style of `features/api_keys/routes.rs`)                                                                                                 |
| `server/src/infrastructure/database/providers.rs`     | new — management-side store: `list_connections`, `hidden_models_for_provider`, `hide_model`, `restore_model`, `provider_enabled`, `set_provider_enabled`, `provider_exists` |
| `server/src/infrastructure/database/catalog_flags.rs` | modify — add `hidden_model_ids` + `disabled_provider_ids` for the `/v1/models` filter                                                                                       |
| `server/src/infrastructure/database/mod.rs`           | modify — register `pub mod providers;`                                                                                                                                      |
| `server/src/features/providers/mod.rs`                | modify — `pub mod management;` + router re-export                                                                                                                           |
| `server/src/features/providers/registry.rs`           | modify — `disabled_keys()` (alias closure)                                                                                                                                  |
| `server/src/features/gateway/models.rs`               | modify — filter hidden models and disabled providers in list and single                                                                                                     |
| `server/src/app.rs`                                   | modify — mount the two new routers                                                                                                                                          |
| `server/tests/providers.rs`                           | new — all HTTP endpoint tests                                                                                                                                               |
| `server/tests/models.rs`                              | modify — hidden/disabled filter tests                                                                                                                                       |
| `docs/api-v1-contract.md`                             | modify — Providers row deviation notes (`:77-90`)                                                                                                                           |

Final response shape (list and catalog use `models: []` like Node; `connections` appears only in the detail):

```json
{
    "id": "opencode_zen",
    "name": "OpenCode Zen",
    "category": "free_tier",
    "protocol": "openai",
    "default_base_url": "https://opencode.ai/zen/v1",
    "requires_api_key": false,
    "requires_oauth": false,
    "supports_custom_url": true,
    "enabled": true,
    "status": {
        "state": "no_connections",
        "message": "Free Tier Ready (Unlimited)",
        "connected_count": 0
    },
    "models": []
}
```

The detail adds `"connections": [{ "id", "provider_id", "name", "alias", "category", "protocol", "base_url", "enabled", "created_at" }]` and fills `models: [{ "id", "object", "owned_by", "hidden", "favorite" }]`.

---

### Task 1: Connection store + list and catalog

**Files:** Create `server/src/infrastructure/database/providers.rs`, `server/src/features/providers/management/{mod.rs,model.rs,routes.rs}`; Modify `server/src/infrastructure/database/mod.rs`, `server/src/features/providers/mod.rs`, `server/src/app.rs`; Test `server/tests/providers.rs`

**Interfaces:**

- Consumes: `OPENCODE_ZEN_PROVIDER: ProviderMetadata` (`features/providers/opencode/types.rs:39`), `AppDatabase::sqlite_pool()` (`infrastructure/database/mod.rs:51`).
- Produces:
    - `providers::list_connections(&AppDatabase) -> Result<Vec<ProviderConnection>, APIError>`, struct `ProviderConnection { id, provider_id, name, alias: Option<String>, category, protocol, base_url: Option<String>, enabled: bool, created_at: i64 }` — **no credential field**.
    - `management::model::ProviderEntry` (`Serialize`), `ProviderEntry::from_metadata(ProviderMetadata, bool /*enabled*/, usize /*connected_count*/) -> Self`, `ProviderStatus`, `CatalogResponse { total: usize, categories: GroupedCatalog }`.
    - `management::routes::create_providers_read_router() -> Router<AppState>` (the management router is created in Task 3).

- [ ] **Step 1: Write the failing test** — start `server/tests/providers.rs` with this harness (the admin session mirrors `server/tests/api_keys.rs:21-35`, GET requests mirror `server/tests/models.rs:15-47`). The `admin_request` helper is added in Task 3, not now (an unused function is a warning).

```rust
mod support;

use axum::{Router, body::Body, http::Request};
use http_body_util::BodyExt;
use srouter_server::{AppState, ProviderRegistry, SecurityState, app::create_router};
use support::TestDatabase;

const SESSION_TOKEN: &str = "test-session-token";

async fn app(database: &TestDatabase) -> Router {
    let security =
        support::sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let state = AppState::with_security(
        support::test_config(),
        ProviderRegistry::with_defaults().expect("default providers"),
        security,
    )
    .with_database(database.connect().await.expect("connect"));

    create_router(state)
}

fn get_request(uri: &str) -> Request<Body> {
    support::with_loopback_client(
        Request::builder().method("GET").uri(uri).body(Body::empty()).unwrap(),
    )
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn providers_list_returns_the_seeded_entry() {
    let database = TestDatabase::new().unwrap();
    let body = json_body(
        app(&database)
            .await
            .oneshot(get_request("/v1/providers"))
            .await
            .unwrap(),
    )
    .await;

    assert_eq!(body["object"], "list");
    let entry = &body["data"][0];
    assert_eq!(entry["id"], "opencode_zen");
    assert_eq!(entry["status"]["connected_count"], 0);
    assert_eq!(entry["status"]["state"], "no_connections");
    assert_eq!(entry["enabled"], serde_json::json!(true));
    assert!(entry.get("round_robin").is_none());
    assert!(entry.get("connections").is_none());
}
```

Import `hash_session_token` from `srouter_server::features::admin_auth`, the same way `server/tests/api_keys.rs` does.

- [ ] **Step 1b: Write the no-database path test** — pins Review Focus #5: a read still returns 200 from the seed catalog, not 500.

```rust
#[tokio::test]
async fn providers_list_serves_the_seed_without_a_database() {
    let state = AppState::with_security(
        support::test_config(),
        ProviderRegistry::with_defaults().unwrap(),
        SecurityState::unconfigured(),
    );

    let body = json_body(
        create_router(state)
            .oneshot(get_request("/v1/providers/catalog"))
            .await
            .unwrap(),
    )
    .await;

    assert_eq!(body["total"], 1);
    assert_eq!(body["categories"]["free_tier"][0]["enabled"], serde_json::json!(true));
}
```

Plus a `catalog_groups_the_seeded_entry_by_category` test (`GET /v1/providers/catalog` → `total == 1`, `categories.free_tier[0].id == "opencode_zen"`, the other three categories empty arrays).

- [ ] **Step 2: Run it, confirm it fails** — `cd server && cargo test --test providers` → `providers_list_returns_the_seeded_entry` panics on `body["data"][0]` (empty array, the route does not exist yet) and `providers_list_serves_the_seed_without_a_database` fails because `total` is absent.

- [ ] **Step 3: Implement `providers.rs`.** Query `SELECT id, provider_id, name, alias, category, protocol, base_url, enabled, meta, created_at FROM providers ORDER BY created_at DESC`, no binds. Filter **seed rows in Rust**, not SQL: parse `meta` with `serde_json::from_str::<JsonValue>` and skip rows where `meta["provider_specific_data"]["__seed__"] == "true"` — exactly where the Node marker lands (`infrastructure/database/migrations.rs:318-327`; malformed meta is treated as non-seed, like `migrations.rs:321` which ignores broken JSON). The `credentials` column is not selected. Postgres or `None` → `Ok(vec![])` for a read.

- [ ] **Step 4: Implement the types + read router.** Store `ProviderEntry` from `ProviderMetadata` by value (that struct is `Copy` over `&'static str`), no `.clone()`; `status.state` = `"connected"` when `connected_count > 0`, else `"no_connections"`; `status.message` = `metadata.status_message`. List = one entry with `models: vec![]`; catalog = four arrays filled by filtering on `category`.

- [ ] **Step 5: Mount the read router in `app.rs`.** The read router gets only the API-key guard (Node installs no rate limit on `/providers`):

```rust
let providers_read_routes =
    create_providers_read_router().layer(from_fn_with_state(state.clone(), api_key_auth));
```

then `.merge(providers_read_routes)` into `v1_routes` (`app.rs:57-61`). **Do not** add it to `v1_compat_routes` — like `/v1/keys`, the alias `/v1/v1/providers` must 404. The write router is mounted in Task 3.

- [ ] **Step 6: Run it, confirm it passes** — `cargo test --test providers` (3 tests) + `cargo test --test models` (existing tests must not change).

- [ ] **Step 7: Commit**

```bash
git add server/src/infrastructure/database/providers.rs server/src/infrastructure/database/mod.rs \
  server/src/features/providers/mod.rs server/src/features/providers/management \
  server/src/app.rs server/tests/providers.rs
git commit -m "feat(server): list provider catalog entries from the database"
```

---

### Task 2: `GET /v1/providers/{providerId}` with `hidden` + `favorite` flags

**Files:** Modify `server/src/features/providers/management/{model.rs,routes.rs}`, `server/src/infrastructure/database/providers.rs`, `server/src/infrastructure/database/catalog_flags.rs`; Test `server/tests/providers.rs`

**Interfaces:**

- Consumes: `ProviderRegistry::list_models()` (`registry.rs:74`), `favorite_model_ids` (`catalog_flags.rs:12`).
- Produces: `ProviderEntry::with_details(self, connections: Vec<ProviderConnectionView>, models: Vec<ProviderModel>) -> Self`; `ProviderModel { id, object, owned_by, hidden, favorite }`; `ProviderConnectionView` (Serialize, snake_case, no secret); `catalog_flags::hidden_model_ids(&AppDatabase) -> Result<HashSet<String>, APIError>` (lowercased, holds `model_id` of rows with `hidden = 1`).

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn provider_detail_reports_hidden_and_favorite_flags_per_model() {
    let database = TestDatabase::new().unwrap();
    let pool = database.connect().await.unwrap();
    let sqlite = pool.sqlite_pool().unwrap();

    sqlx::query(
        "INSERT INTO provider_model_overrides (provider_id, model_id, custom, hidden, created_at) \
         VALUES (?, ?, 0, 1, ?)",
    )
    .bind("opencode_zen")
    .bind("zen/big-pickle")
    .bind(1_700_000_000_i64)
    .execute(sqlite)
    .await
    .unwrap();

    sqlx::query("INSERT INTO favorite_models (model_id, created_at) VALUES (?, ?)")
        .bind("zen/space-bunny-free")
        .bind(1_700_000_000_i64)
        .execute(sqlite)
        .await
        .unwrap();

    let body = json_body(
        app(&database)
            .await
            .oneshot(get_request("/v1/providers/opencode_zen"))
            .await
            .unwrap(),
    )
    .await;
    let model = |id: &str| {
        body["models"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["id"] == id)
            .unwrap()
            .clone()
    };

    assert_eq!(model("zen/big-pickle")["hidden"], serde_json::json!(true));
    assert_eq!(model("zen/big-pickle")["favorite"], serde_json::json!(false));
    assert_eq!(
        model("zen/space-bunny-free")["favorite"],
        serde_json::json!(true)
    );
    assert_eq!(body["connections"], serde_json::json!([]));
}

#[tokio::test]
async fn provider_detail_never_echoes_stored_credentials() {
    let database = TestDatabase::new().unwrap();
    let pool = database.connect().await.unwrap();

    sqlx::query(
        "INSERT INTO providers (id, provider_id, name, category, protocol, base_url, enabled, \
         credentials, meta, created_at) \
         VALUES ('conn_1', 'opencode_zen', 'Zen Work', 'free_tier', 'openai', \
         'https://opencode.ai/zen/v1', 1, '{\"api_key\":\"sr-secret-never-echoed\"}', '{}', 1)",
    )
    .execute(pool.sqlite_pool().unwrap())
    .await
    .unwrap();

    let body = json_body(
        app(&database)
            .await
            .oneshot(get_request("/v1/providers/opencode_zen"))
            .await
            .unwrap(),
    )
    .await;

    assert_eq!(body["connections"][0]["id"], "conn_1");
    assert_eq!(body["status"]["connected_count"], 1);
    assert_eq!(body["status"]["state"], "connected");
    assert!(!body.to_string().contains("sr-secret-never-echoed"));
}
```

Add `provider_detail_is_case_insensitive_and_rejects_unknown_ids` too: `/v1/providers/OpenCode_Zen` → 200, `/v1/providers/zen` → **404** with `error.message == "Provider 'zen' not found"` (the catalog holds base ids only; aliases are deliberately not served here).

- [ ] **Step 2: Run it, confirm it fails** — `cargo test --test providers` → 404 for every detail request (the route does not exist yet).

- [ ] **Step 3: Implement.** The read router's route list grows by `.route("/providers/{providerId}", get(get_provider))`; matchit gives static segments priority, so `/providers/catalog` still wins over the param (verified by Task 1's tests staying green). Handler: match the path param case-insensitively against `OPENCODE_ZEN_PROVIDER.id`; anything else is 404 (`APIError::new(404, format!("Provider '{id}' not found"))`, style of `features/api_keys/routes.rs:96`). Models = `state.providers.list_models()` **not** filtered by hidden (admin view), each annotated `hidden = hidden_ids.contains(&id.to_lowercase())` and `favorite = favorites.contains(...)` — use `ProviderModel::from_model(&ModelObject, &HashSet<String>, &HashSet<String>)`. Connections = `list_connections()` filtered by `ProviderConnection::base_id_is("opencode_zen")` (Node's rule: `provider_id` or `id` matches exactly, or is prefixed `opencode_zen_` / `opencode_zen-`, from `providers.logic.ts:57-68`), then mapped to `ProviderConnectionView`. The detail entry uses the same constructor as the list; only its `connected_count` comes from the filtered result.

- [ ] **Step 4: Add `hidden_model_ids` to `catalog_flags.rs`** — `SELECT model_id FROM provider_model_overrides WHERE hidden = 1`, lowercased; a `None` `sqlite_pool()` → empty set, like `favorite_model_ids`.

- [ ] **Step 5: Run it, confirm it passes** — `cargo test --test providers`.

- [ ] **Step 6: Commit**

```bash
git add server/src/features/providers/management server/src/infrastructure/database/{providers.rs,catalog_flags.rs} server/tests/providers.rs
git commit -m "feat(server): add provider detail route with hidden and favorite flags"
```

---

### Task 3: Hidden models — `GET`, `POST`, `DELETE`

**Files:** Modify `server/src/features/providers/management/{routes.rs,mod.rs}`, `server/src/infrastructure/database/providers.rs`, `server/src/app.rs`; Test `server/tests/providers.rs`

**Interfaces:**

- Consumes: `providers::list_connections` (Task 1), `require_admin_session` (`server/src/app.rs:51`).
- Produces: `providers::hidden_models_for_provider(&AppDatabase, &str) -> Result<Vec<String>, APIError>` (stored form, as-is); `providers::hide_model(&AppDatabase, &str, &str) -> Result<(), APIError>`; `providers::restore_model(&AppDatabase, &str, &str) -> Result<bool, APIError>`; `management::routes::create_providers_management_router() -> Router<AppState>`.

- [ ] **Step 1: Write the failing test.** Add the admin session helper first (exactly `server/tests/api_keys.rs:29-35`):

```rust
fn admin_request(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    support::json_request_with_headers(method, uri, body, &[("cookie", cookie.as_str())])
}
```

```rust
#[tokio::test]
async fn hiding_a_model_lists_it_and_is_idempotent() {
    let database = TestDatabase::new().unwrap();
    let response = app(&database)
        .await
        .oneshot(admin_request(
            "POST",
            "/v1/providers/opencode_zen/hidden-models",
            serde_json::json!({ "model_id": "zen/big-pickle" }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), 201);
    assert_eq!(json_body(response).await["message"], "Model hidden");

    // The same POST again is still 201 (the row exists -> DO UPDATE SET hidden = 1)
    let again = app(&database)
        .await
        .oneshot(admin_request(
            "POST",
            "/v1/providers/opencode_zen/hidden-models",
            serde_json::json!({ "model_id": "zen/big-pickle" }),
        ))
        .await
        .unwrap();
    assert_eq!(again.status(), 201);

    let listed = json_body(
        app(&database)
            .await
            .oneshot(get_request("/v1/providers/opencode_zen/hidden-models"))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(listed["models"], serde_json::json!(["zen/big-pickle"]));
}

#[tokio::test]
async fn restoring_a_hidden_model_keeps_the_custom_flag_and_clears_the_row() {
    // seed the row (opencode_zen, zen/big-pickle, custom=1, hidden=1) via sqlx::query like Task 2
    // DELETE /v1/providers/opencode_zen/hidden-models/zen%2Fbig-pickle -> 200 + {"message":"Model restored"}
    // assert DB: the row STILL EXISTS with hidden=0 (because custom=1)
    // DELETE again -> 404; error.message uses the DECODED form "zen/big-pickle"
    //   (Axum already URL-decodes, matching decodeURIComponent in Node):
    //   "Hidden model 'zen/big-pickle' not found for 'opencode_zen'"
}

#[tokio::test]
async fn a_pure_hidden_row_is_deleted_on_restore() {
    // custom=0, hidden=1 -> after DELETE, SELECT COUNT(*) == 0
}

#[tokio::test]
async fn restore_accepts_a_literal_slash_in_the_model_id() {
    // DELETE /v1/providers/opencode_zen/hidden-models/zen/big-pickle (unencoded) -> 200
}

#[tokio::test]
async fn hidden_model_writes_require_an_admin_session() {
    // POST without the cookie -> 401 code "authentication_required"
    // GET /v1/providers/opencode_zen/hidden-models without the cookie -> 200 (API-key auth, anonymous loopback)
}
```

Write the shorthand tests above out in full, in the same style as the first block: seed via `sqlx::query(...).execute(pool.sqlite_pool().unwrap())`, DB assertions via `sqlx::query_scalar`.

- [ ] **Step 2: Run it, confirm it fails** — `cargo test --test providers hiding_a_model_lists_it_and_is_idempotent -- --exact` fails because the route does not exist.

- [ ] **Step 3: Implement the writes.** Management routes: `POST /providers/{providerId}/hidden-models` and `DELETE /providers/{providerId}/hidden-models/{*modelId}` — `{*modelId}` (greedy) is **required** so a literal `zen/big-pickle` also matches, equivalent to Node's `:modelId{.+}` (`routes/v1/providers.ts:62`); Axum already URL-decodes, so **do not** re-implement `decodeURIComponent` from `providers.controller.ts:144` (double-decode is a bug). `provider_id` is stored as `providerId.to_lowercase()`; **no provider-existence check** (Node does not check either, `providers.logic.ts:342-344`). POST body: `model_id` must be a non-empty string, else 400 `"Invalid model payload"`.

SQL: `INSERT INTO provider_model_overrides (provider_id, model_id, custom, hidden, created_at) VALUES (?, ?, 0, 1, ?) ON CONFLICT(provider_id, model_id) DO UPDATE SET hidden = 1`. This is a labeled deviation from Node's `INSERT OR IGNORE` (`packages/db/src/hiddenModels.ts:36-41`) and is required because v2 merged two tables into one: without `DO UPDATE`, hiding a custom model becomes a no-op. Restore: `UPDATE ... SET hidden = 0 WHERE provider_id = ? AND model_id = ? AND hidden = 1`; `changes == 0` → `Ok(false)` → handler 404; then `DELETE FROM provider_model_overrides WHERE provider_id = ? AND model_id = ? AND custom = 0 AND hidden = 0`.

- [ ] **Step 4: Mount the write router.** `create_providers_management_router()` (new, in `management/routes.rs`) returns a `Router<AppState>` holding the POST + DELETE routes above; mount it in `app.rs` behind the admin session guard, mirroring `keys_routes` (`app.rs:51-52`):

```rust
let providers_mgmt_routes = create_providers_management_router()
    .layer(from_fn_with_state(state.clone(), require_admin_session));
```

`.merge(providers_mgmt_routes)` into `v1_routes`. The `hidden-models` GET stays in Task 1's **read** router (API-key guard), so add its route there.

- [ ] **Step 5: Run it, confirm it passes** — `cargo test --test providers`.

- [ ] **Step 6: Commit**

```bash
git add server/src/features/providers/management server/src/infrastructure/database/providers.rs server/src/app.rs server/tests/providers.rs
git commit -m "feat(server): add provider hidden-model endpoints"
```

---

### Task 4: `PATCH /v1/providers/{providerId}/enabled`

**Files:** Modify `server/src/features/providers/management/routes.rs`, `server/src/infrastructure/database/providers.rs`; Test `server/tests/providers.rs`

**Interfaces:**

- Produces: `providers::provider_enabled(&AppDatabase, &str) -> Result<bool, APIError>` (a missing row or any value other than `"false"` → `true`, following `packages/db/src/settings.ts:54-56`), `providers::set_provider_enabled(&AppDatabase, &str, bool) -> Result<(), APIError>` (UPSERT into `settings`), `providers::provider_exists(&AppDatabase, &str) -> Result<bool, APIError>`.

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn disabling_a_provider_persists_a_settings_row_and_echoes_the_flag() {
    // PATCH /v1/providers/opencode_zen/enabled {enabled:false} -> 200
    // body["enabled"] == false, body["id"] == "opencode_zen"
    // assert DB: SELECT value FROM settings WHERE key = 'provider_enabled_opencode_zen' == "false"
    // GET /v1/providers -> data[0].enabled == false
}

#[tokio::test]
async fn enabling_a_provider_overwrites_the_stored_flag() { /* false then true -> "true" */ }

#[tokio::test]
async fn toggling_an_unknown_provider_is_rejected() {
    // PATCH /v1/providers/does-not-exist/enabled -> 400, message "Provider 'does-not-exist' not found"
}

#[tokio::test]
async fn enabled_requires_a_boolean_and_an_admin_session() { /* {enabled:"yes"} -> 400; no cookie -> 401 */ }
```

- [ ] **Step 2: Run it, confirm it fails** — `cargo test --test providers disabling_a_provider_persists`.

- [ ] **Step 3: Implement.** The settings key is **normalized to the base id** (`provider_enabled_opencode_zen`) on both write **and** read. This deliberately fixes Node's inconsistency, where the write uses the raw path param (`providers.logic.ts:381-387`) while boot reads `providerBaseId(...)` (`apps/api/src/services/registry.ts:105-106`), so a toggle made through an alias is lost after restart. `provider_exists` = the `id` (lowercase) equals `OPENCODE_ZEN_PROVIDER.id` **or** a connection row with the same base id exists (`providers.logic.ts:377-386`). Response = the full detail entry with `enabled` forced to the new value (following `{ ...Provider, enabled: Enabled }` at `providers.logic.ts:396`).

- [ ] **Step 4: Run it, confirm it passes** — `cargo test --test providers`.

- [ ] **Step 5: Commit**

```bash
git add server/src/features/providers/management/routes.rs server/src/infrastructure/database/providers.rs server/tests/providers.rs
git commit -m "feat(server): persist provider enabled state through a settings row"
```

---

### Task 5: `/v1/models` filters hidden models and disabled providers

**Files:** Modify `server/src/infrastructure/database/catalog_flags.rs`, `server/src/features/providers/registry.rs`, `server/src/features/gateway/models.rs`; Test `server/tests/models.rs`

**Interfaces:**

- Produces: `catalog_flags::disabled_provider_ids(&AppDatabase) -> Result<HashSet<String>, APIError>` (lowercased ids from `settings` where `key LIKE 'provider_enabled_%' AND value = 'false'`); `ProviderRegistry::disabled_keys(&HashSet<String>) -> HashSet<String>`.

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn hidden_models_are_absent_from_the_catalog() {
    // seed provider_model_overrides (opencode_zen, zen/big-pickle, hidden=1)
    // GET /v1/models -> data has no entry with id "zen/big-pickle", and length 6
    // GET /v1/models/zen%2Fbig-pickle -> 404 code "model_not_found"
}

#[tokio::test]
async fn disabling_a_provider_hides_its_alias_prefixed_models() {
    // INSERT settings ('provider_enabled_opencode_zen','false')
    // GET /v1/models -> empty (the registry only holds opencode_zen, ids prefixed "zen/")
    // after re-enabling ("true") -> the catalog holds 7 entries again
}
```

- [ ] **Step 2: Run it, confirm it fails** — `cargo test --test models hidden_models_are_absent_from_the_catalog`.

- [ ] **Step 3: Implement the alias closure.** `disabled_keys` normalizes: for each adapter, if any of `adapter.keys()` (lowercased) is in the disabled set → return **all** of its keys. This is required because catalog entries carry the alias prefix `zen` (`registry.rs:90-94`) while the settings row carries the base id `opencode_zen`.

- [ ] **Step 4: Implement the filter in `models.rs`.** Add `async fn catalog_exclusions(state: &AppState) -> Result<CatalogExclusions, APIError>` with `struct CatalogExclusions { hidden: HashSet<String>, disabled: HashSet<String> }`, filling both through `catalog_flags` (empty sets when `state.database` is `None`) and then closing disabled aliases through `state.providers.disabled_keys(...)`. Filter **before** `.map(CatalogModel::from_model)` in `list_models` (`models.rs:88-94`) and on the `find_model` result in `get_model` (`models.rs:124-140`), so a hidden model 404s on the single route too. Drop rule: the `id` prefix before `/`, or `owned_by` (lowercased), is in `exclusions.disabled`, **or** `id.to_lowercase()` is in `exclusions.hidden`. Filter before the API-key allowlist check as well, so `is_model_allowed` never runs on an already-dropped candidate.

Parity note: the hidden filter on `/v1/models` is **global** (`model_id` only, no `provider_id`) — same as Node (`models.logic.ts:21` uses `getAllHiddenModelsDB`). Keep that asymmetry; do not "fix" it here.

- [ ] **Step 5: Run every model + provider test** — `cargo test --test models && cargo test --test providers`. The existing `/v1/models` tests must stay green (empty overrides/settings tables → nothing is filtered).

- [ ] **Step 6: Commit**

```bash
git add server/src/infrastructure/database/catalog_flags.rs server/src/features/providers/registry.rs server/src/features/gateway/models.rs server/tests/models.rs
git commit -m "feat(server): drop hidden and disabled models from the catalog"
```

---

### Task 6: Contract sync + quality gates

- [ ] **Step 1:** Update `docs/api-v1-contract.md:77-90` for the Providers rows, recording (a) no `round-robin` in the Rust build, (b) `connections` carries no secret material, (c) `GET /v1/providers/:id` returns `hidden`/`favorite` flags instead of filtering, (d) `connected_count` is snake_case, (e) POST hide is idempotent and writes `hidden = 1` on the merged table.
- [ ] **Step 2:** `cd server && cargo test --test providers && cargo test --test models && cargo test --lib features::providers && cargo test --lib features::gateway`
- [ ] **Step 3:** `cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && git diff --check`
- [ ] **Step 4:** `cargo test --test schema` (the 10-table assertion must still pass — no new migration).
- [ ] **Step 5:** Update `.local/TASK.md` + `.local/NOTES.md` (with `YYYY-MM-DD --- HH-MM WIB` timestamps), then `pnpm exec prettier --write .local/TASK.md .local/NOTES.md`.
- [ ] **Step 6:** Commit: `git add docs/api-v1-contract.md && git commit -m "docs: record the provider catalog contract deviations"`.

---

## Review Focus

The input classes most likely to bite, each of which must be pinned by a test:

1. **Seed rows counted as connections.** A database Node has used contains ~16 `providers` rows tagged `meta.provider_specific_data.__seed__ = "true"`; unfiltered, `connected_count` becomes 1 and `/v1/providers` reports `state: "connected"` for a driver with no connection. Correct behavior: seed rows ignored, `connected_count: 0`, `connections: []` — and **no** 500 merely because `meta` is not valid JSON.
2. **A secret must not escape through any path.** `credentials` is not selected; the detail response (list, `models[]`, `connections[]`) must not contain a stored api key value. Task 2's test pins this by matching the whole JSON body.
3. `model_id` with a literal `/` (`.../hidden-models/zen/big-pickle`) **and** with `%2F` must both return 200: `{*modelId}` plus no second decode. Failing here means the web (which uses `encodeURIComponent`) or an SDK sending the literal path gets a 404.
4. **Non-boolean booleans** on `PATCH /enabled`, and an empty or non-string `model_id` on the hidden-model POST → 400, not a silent `"true"` / empty row.
5. **`state.database == None`** (a boot without persistence, and every existing `SecurityState::unconfigured()` test): reads still return 200 with the seed catalog + `enabled: true` + `models[].hidden == false`; writes → an explicit 500, not a fake `Ok`.
6. **Postgres backend**: a `None` `sqlite_pool()` → reads return empty sets, writes 500 with the `postgres_unsupported` message; `/v1/providers` must not be 501.
7. **A hidden model is absent from the catalog but present in the detail**, and restore brings back exactly one row without touching the `custom` flag.
8. **No per-model (N+1) queries**: one `SELECT` for hidden, one for connections, one for settings per request, shared across every entry.

## Verification

```bash
cd server
cargo test --test providers
cargo test --test models
cargo test --test schema
cargo test --lib features::providers
cargo test --lib features::gateway
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
git diff --check
```

Eyeball checks: `GET /v1/providers` → `data[0].status.connected_count`; `GET /v1/providers/catalog` → 4 categories; `GET /v1/providers/zen` → 404; POST hide → 201 `{"message":"Model hidden"}`; after hiding, `GET /v1/models` loses one entry while `GET /v1/providers/opencode_zen` still lists it with `hidden: true`; `GET /v1/v1/providers` → 404 (only the gateway is mounted on the alias). Dev servers and builds are forbidden (`AGENTS.md`), so verification stops at the test + `oneshot` level.

## Follow-up (do not start without being asked)

- `POST /v1/providers` + `DELETE /v1/providers/:id` + `POST /providers/verify` + `POST /providers/connections/verify`: needs credential storage in the `credentials` column, an SSRF URL guard (`infrastructure/upstream/ssrf.rs` is still called by nothing today, and `is_blocked_host` performs blocking DNS), and a `Policy::none()` redirect policy for probes.
- Dynamic registry: `ProviderAdapter` currently carries `&'static str`, and `OpenAIAdapter` sends no `Authorization` header at all (`features/providers/adapter.rs:143-170`), so a provider written to the database cannot be routed yet. This slice deliberately leaves that alone.
- `PATCH round-robin`, custom models (`POST/DELETE /providers/:id/models`), `GET/POST/DELETE /v1/favorites`, and the 16-provider seed catalog.
- Web: `apps/web/src/hooks/useCatalog.ts:27`, `apps/web/src/components/providers/provider.utils.ts:5`, and `apps/web/src/components/providers/topology.canvas.tsx:94` read `connectedCount`; `apps/web/src/routes/providers/$providerId.tsx:149` filters hidden client-side through `hiddenModelIdList` while the detail response now carries `hidden`. `@srouter/types` needs to move to the Rust shape.
