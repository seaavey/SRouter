# Testing

42 integration suites in `server/tests/*.rs`, one cargo test binary each, plus ~67 in-crate `#[cfg(test)]` modules for provider translation, middleware, protocol, and store units. `tower` (`util`, for `oneshot`) is the only dev-dependency.

## Harness (`server/tests/support/mod.rs`, ~3.1k lines)

| Helper                                                                                                                                        | Purpose                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TestDatabase::new()`                                                                                                                         | unique temp directory (pid + counter + nanos) with a SQLite path; `config()` builds an `APIConfig` pointing `HOME`/`DATABASE_PATH` at it and deliberately omitting `DATABASE_URL`; `connect()` returns an `AppDatabase`; `Drop` deletes the directory |
| `FakeUpstream` (and `FakeQoder`, `FakeCodeBuddy`, `FakeCline`, `FakeGrok`, `FakeAntigravity`, `FakeClaude`, `FakeCodexUpstream`)              | in-process upstreams bound to `127.0.0.1:0`, recording requests in `Arc<Mutex<..>>`, aborted on `Drop`                                                                                                                                                |
| `GuardedStream`                                                                                                                               | records whether a stream was cancelled or finished — used by the client-cancellation suite                                                                                                                                                            |
| `connect_<vendor>` / `<vendor>_registry` / `<vendor>_state`                                                                                   | seed a connection row and build a registry/state wired to a specific fake                                                                                                                                                                             |
| `test_config` / `production_config` / `test_secure_config` / `NO_DASHBOARD_WEB_DIST`                                                          | config variants; the sentinel keeps the API-only router without a dashboard dist                                                                                                                                                                      |
| `security_state(...)`, `sqlx_security_state`, `sqlx_admin_security_state`, `api_key_record`, `FixtureAPIKeyStore`, `FixtureAdminSessionStore` | fixture-backed or real-SQLx security dependencies                                                                                                                                                                                                     |
| `with_loopback_client` / `with_remote_client` / `json_request` / `json_request_with_headers`                                                  | build a `Request` with an injected `ConnectInfo` peer and a JSON body                                                                                                                                                                                 |

Typical suite shape:

```rust
mod support;

fn app(state: AppState) -> Router { create_router(state) }

#[tokio::test]
async fn something() {
    let db = TestDatabase::new().unwrap();
    let response = app(state).oneshot(with_loopback_client(json_request("POST", "/v1/chat", body))).await;
    assert_eq!(response.status(), 200);
}
```

Two suites bind a real socket (`127.0.0.1:0` + `reqwest`) because they exercise SSE or a streaming client: `logs.rs` and `pricing.rs`.

## Isolation rules

1. **Never open `~/.srouter/srouter.db`.** Every suite builds its own temp database through `TestDatabase`; `HOME` always points at the temp directory. `server/tests/database.rs` pins that the developer database is untouched.
2. **Never reach a real provider.** Fakes bind loopback and abort on `Drop`. Real upstreams are reachable only through the two `#[ignore]` suites.
3. **Do not add globals.** The only global lock is `EVENT_TEST_LOCK` in `logs.rs`, because log events publish through a process-global broadcast channel. Prefer injecting a scoped dependency.
4. **No `sleep`-based settling.** Poll with a bounded loop (10 s budget) instead; the existing sleeps are deliberate — forcing `created_at` ordering, or simulating a slow/fragmented upstream — not waiting for state to settle.
5. **Scope a tracing subscriber** with `tracing::subscriber::with_default` and a local current-thread runtime; never install a process-global subscriber from a test.
6. Prefer `#[tokio::test(flavor = "multi_thread")]` only where real concurrency is the point (e.g. the thundering-herd test).

## Which suite pins what

| Suite                                       | Pinned contract                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.rs`                                 | `user_version == 4`, the exact table and index sets, the v1→v2 legacy transform, the v4 tunnel-key cleanup, refusal of a newer file                |
| `database.rs`                               | SQLite opens and data survives a reconnect; `DATABASE_URL` is refused (500) before any file exists                                                 |
| `bindings.rs`                               | both committed TypeScript copies match a fresh render                                                                                              |
| `http_runtime.rs`                           | the six frozen response headers, including `X-Version`, and the root body                                                                          |
| `chat_completions.rs`                       | the gateway: streaming, aggregation, tool calls, validation, body limits, the `/v1/v1` alias, request-log writes, search interception              |
| `api_key_auth.rs`                           | the auth matrix — loopback vs remote, `x-api-key` vs `Bearer`, disabled/unknown keys, credit and quota rejections, session cookie, spoofed headers |
| `csrf.rs` / `cors.rs`                       | origin/referer guarding of cookie mutations; the CORS allowlist and loopback origins                                                               |
| `client_cancellation.rs`                    | a client disconnect cancels the upstream call instead of buffering the stream                                                                      |
| `logs.rs`                                   | request-log list/detail/stats/analytics, the SSE stream, and Postgres request-log failure                                                          |
| `database_transfer.rs`                      | multipart import/export, candidate validation, v1 migration, temp cleanup, backup retention                                                        |
| `<vendor>_provider.rs` / `<vendor>_auth.rs` | per-driver catalog gating, envelope handling, SSE/NDJSON reframing, token refresh, rotation                                                        |
| `providers.rs`, `models.rs`                 | catalog listing, seed ordering, allowlist propagation                                                                                              |
| `telemetry.rs`                              | what the subscriber writes at each level                                                                                                           |

## Verification

```bash
cargo test --manifest-path server/Cargo.toml --locked                  # everything
cargo test --manifest-path server/Cargo.toml --test chat_completions    # one suite
cargo test --manifest-path server/Cargo.toml --test opencode_live -- --ignored --nocapture
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features --locked -- -D warnings
```

The two `#[ignore]` suites are the only network tests; `qoder_live` additionally needs `DATABASE_PATH` pointing at a copy of a live database. Never enable them in an ordinary run.

Behaviour changes also need a real run: `cargo run --manifest-path server/Cargo.toml` from `server/` (so `dotenvy` finds `.env`) and then exercise the endpoint, or the client suite for a UI-visible change. There is no CI and no coverage measurement — the full suite is a manual pre-push obligation, and a green run is not proof that the changed path works.
