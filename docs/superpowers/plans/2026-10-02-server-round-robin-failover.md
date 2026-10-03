# Server Round-Robin and Rate-Limit Failover Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** design plan only, no code written. Scope is `server/` only; `apps/api` stays byte-identical as the rollback path, and `packages/*` stays untouchable per the ground rules in `server/TODO.md`.

**Goal:** every provider that has more than one enabled connection rotates across them automatically, system-on with no configuration, and a request whose upstream answers `429` fails over to the next account inside the same request instead of surfacing the rate-limit error.

## Scope

**In:**

- Rotation across a provider's enabled `providers` rows at credential-load time, default on, no setup.
- In-request failover on `429`, only before any response bytes reach the client.
- `PATCH /v1/providers/{provider_id}/round-robin` (contract row 86) and a `roundRobin` field in the provider detail and catalog payloads, so the existing web toggle stops calling a missing endpoint.
- The providers that load stored credentials today: `qoder`, `cline`, `grok-web`.

**Out, deliberately:**

- Changes to `apps/api`, `packages/*`, the database schema, or the dependency list.
- Mid-stream failover (after the first byte reached the client), `Retry-After` parsing, active health probes, cooldown persistence across restarts, per-account weighting, and failover on statuses other than `429`.
- Custom or API-key providers: the Rust registry has no connection loader for them until `POST /v1/providers` lands (`server/TODO.md` section 7).

## Why this is not a port

Node's rotation index and circuit breaker live in `packages/providers`, which the ground rules forbid reading when porting; only `apps/api` is cited, and there it only fixes the endpoint contract: `routes/v1/providers.ts` registers `PATCH /providers/:providerId/round-robin` behind `RequireAdmin`, `ProvidersController.ToggleRoundRobin` parses `{enabled}` and returns the provider definition, and `apps/api/tests/round-robin-endpoint.test.ts` proves the admin guard rejects an unauthenticated call with `401`. The selection policy itself is native: `server/TODO.md:180` already lists "Round-robin/selection policy in the registry itself" as an open Rust-side decision.

One deliberate behavioral deviation from Node: a missing settings row reads as **on**. Node defaults the flag off; the product requirement for this slice is system-on for every provider with more than one account, so the flag only exists as an escape hatch, not as a setup step.

## Decisions

- **D1 (system-on default).** A missing `round_robin_<base_id>` settings row means rotation is enabled. Operators can turn it off per provider through the endpoint, never on by hand. With one connection the rotation is a no-op, so single-account providers see no behavior change.
- **D2 (selection point).** Rotation happens where credentials are loaded, inside each executor's `credentials()` path, because that is the only per-request spot that knows the account list. The gateway and the `ProviderAdapter` API do not change. Consequence: qoder catalog refreshes also pick a rotating account, which is acceptable since any valid account answers them.
- **D3 (in-request failover).** Each executor wraps its upstream attempt in a small explicit `for` loop bounded by the candidate count: on `429`, mark that connection cooling and continue with the next candidate; any other outcome returns unchanged. No generic retry framework and no new trait: three honest loops, one per executor, because their request plumbing differs. For streaming paths the loop covers only the phase before the stream is handed back, so a `429` at HTTP status time still fails over while an error mid-stream still surfaces to the client. `/v1/messages` is covered automatically because it calls the same executors.
- **D4 (cooldown).** Cooldown state is in-memory inside one plain `AccountRotator` struct (a `Mutex<HashMap>` of per-provider rotation index and per-connection `until` timestamps), injected as an `Arc` from `ProviderRegistry` into the three executors. Fixed 60-second duration, keyed by connection row id. When every candidate is cooling, pick anyway (availability over fairness). A restart resets the state, which is acceptable because the failure mode is "retry an account that may still be limited", not data loss.
- **D5 (flag semantics).** The flag lives in the existing `settings` table under `round_robin_<base_id>` and gates rotation only: off means "always the newest non-cooling candidate". Cooldown skipping stays active regardless of the flag, because recovering from a `429` is availability, not a preference. The flag is read through the existing `get_setting` helper; no cache (one primary-key lookup beside a multi-second upstream call, the same argument the Token Saver plan accepted).
- **D6 (endpoint and payload).** Serve `PATCH /v1/providers/{provider_id}/round-robin` from the existing management router, which `app.rs` already wraps in `require_admin_session`, so the guard comes for free. Body `{enabled: bool}`, `400` for a malformed body or an unknown provider, response is the provider detail payload with `roundRobin` set, matching `ProvidersLogic.SetRoundRobin` in `apps/api`. The `roundRobin` field (camelCase, matching what `apps/web` reads) is added to both the detail and catalog payloads.
- **D7 (coverage).** Only `qoder`, `cline`, and `grok-web` wire the rotator in this slice; they are the providers with stored accounts. `opencode_zen` requires no key and has no account rows, so there is nothing to rotate.

## Design

### AccountRotator

New module `server/src/features/providers/rotation.rs`, plain struct, no trait:

```rust
pub struct AccountRotator {
    state: Mutex<HashMap<String, ProviderRotation>>, // key: base provider id
}

struct ProviderRotation {
    next: usize,
    cooldowns: HashMap<String, Instant>, // key: providers row id
}

impl AccountRotator {
    /// Newest-first candidates in, chosen candidate out. Skips cooling rows;
    /// falls back to the round-robin pick when every row is cooling.
    pub fn choose<T>(&self, provider_id: &str, enabled: bool, rows: &[(String, T)]) -> usize;
    /// Marks one row cooling for COOLDOWN. Never held across .await.
    pub fn cool(&self, provider_id: &str, connection_id: &str);
}
```

`enabled: false` short-circuits to the newest non-cooling candidate. Index arithmetic is modulo the candidate count, so a row disappearing between requests cannot panic.

### Credential selection

Each `load_*_credentials` stops using `LIMIT 1` and instead collects every parseable, enabled row newest-first, then asks the rotator for one. The ordering column (`created_at DESC`) and the per-provider `WHERE` clauses stay as they are.

- `QoderCredentials` gains an `id: String` field filled from the row, the same way `ClineCredentials.id` and `GrokWebCredentials.id` already work. Qoder candidates whose token is expired are filtered out before the rotator sees them, so a valid second account is preferred over a `401 TOKEN_EXPIRED`; when no candidate survives, the existing error is returned unchanged.
- Cline and grok-web need no filtering: cline refreshes the chosen token lazily, grok-web cookies have no local expiry.

### Failover shape

```rust
let rows = load_candidates(database).await?; // parseable, newest-first
let mut last = None;
for _ in 0..rows.len().max(1) {
    let index = rotator.choose(PROVIDER_ID, round_robin_enabled, &rows);
    match attempt(&rows[index]).await {
        Err(error) if error.status() == 429 => {
            rotator.cool(PROVIDER_ID, &rows[index].id);
            last = Some(error);
            continue;
        }
        outcome => return outcome,
    }
}
Err(last.expect("a bounded loop over non-empty rows ran at least once"))
```

Attempt bodies stay executor-specific: qoder sends its COSY request, cline sends and lazily refreshes, grok-web runs `establish` (page probe plus WebSocket handshake). A `429` surfaces from `upstream_status_error` in the adapters and from the existing probe and handshake mappings in `grok_web/executor.rs`, all of which already preserve the status code, so the match arm sees them without new plumbing.

### Flag, endpoint, payload

| piece                                           | shape                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| settings row (existing table)                   | key `round_robin_<base_id>`, value `"true"` / `"false"`, absent = on  |
| `PATCH /v1/providers/{provider_id}/round-robin` | `{enabled: bool}` in, provider detail out, `400` unknown or malformed |
| provider detail and catalog payloads            | new `roundRobin: bool` field                                          |

`get_setting` runs once per provider request through a tiny `round_robin_enabled(database, base_id) -> bool` helper that returns `true` on a missing row or a missing database.

## Files

- `server/src/features/providers/rotation.rs` (new): `AccountRotator` plus unit tests.
- `server/src/features/providers/mod.rs`: register and export the rotator.
- `server/src/features/providers/registry.rs`: own an `Arc<AccountRotator>`, hand it to the three adapters.
- `server/src/infrastructure/database/providers.rs`: candidate-listing loaders, `QoderCredentials.id`, drop `LIMIT 1` from the three loaders.
- `server/src/features/providers/{qoder,cline,grok_web}/executor.rs`: take the rotator, candidate loop around the upstream attempt.
- `server/src/features/providers/management/{model.rs,routes.rs}`: `roundRobin` field, PATCH route and handler, `round_robin_enabled` helper.
- `server/tests/providers.rs`: endpoint tests.
- `server/tests/support/mod.rs`: a rate-limit trigger for the fake upstream (the `upstream-fail` trigger is the precedent) and a two-row connection fixture.
- `docs/api-v1-contract.md`, `server/TODO.md`: sync (see Task 6).

## Tasks

- [ ] **Task 1: rotator core.** Create `rotation.rs` with `AccountRotator`, `COOLDOWN: Duration = Duration::from_secs(60)`, and unit tests: rotation order over three rows, cooling row skipped, all-cooling fallback, disabled flag pins the newest row, index safe when the row count shrinks. Gate: `cargo test --lib`, `cargo fmt --check`.
- [ ] **Task 2: candidate loaders.** Convert the three `load_*_credentials` functions to return every parseable enabled row newest-first, add `QoderCredentials.id`, filter expired qoder rows, and pick through the rotator with the flag defaulting on. Keep the single-row behavior of `NOT_CONNECTED` and `TOKEN_EXPIRED` unchanged. Gate: `cargo test --test qoder_provider --test cline_provider --test grok_web_provider`, `cargo fmt --check`.
- [ ] **Task 3: failover in qoder.** Thread `Arc<AccountRotator>` and the flag into the executor, wrap the non-stream and pre-open stream attempts in the candidate loop, cool on `429`. Gate: `cargo test --test qoder_provider`.
- [ ] **Task 4: failover in cline and grok-web.** Same loop for cline (refresh path keeps the chosen row's id) and for grok-web (`establish` re-runs against the next cookie). Gate: `cargo test --test cline_provider --test grok_web_provider`.
- [ ] **Task 5: flag, endpoint, payload.** `round_robin_enabled` helper, `roundRobin` in detail and catalog builders, `PATCH /v1/providers/{provider_id}/round-robin` handler (`400` unknown or malformed, detail payload out). Add endpoint tests to `tests/providers.rs`: unauthenticated `401` (black-box evidence from `apps/api/tests/round-robin-endpoint.test.ts`), unknown provider `400`, persist and echo `enabled: false`, `enabled: true` after an explicit off. Gate: `cargo test --test providers`.
- [ ] **Task 6: failover integration proof and sync.** Fake upstream trigger that answers `429` on the first attempt and succeeds on the second, two-row connection fixture; assert the request succeeds through the second account, the cooled row is skipped by the next request until the cooldown lapses, and an all-cooling provider still serves. Sync `docs/api-v1-contract.md` (row 86 now served, replace the "No round-robin" note in row 117) and tick `server/TODO.md` items 170 and 180. Gate: full focused suite (`providers`, `models`, `chat_completions`, `messages`, the three provider suites, `provider_auth`), `cargo clippy --all-targets --all-features --locked -- -D warnings`, `git diff --check`.

## Acceptance criteria

- Two enabled connections on one provider: consecutive requests reach different accounts when the flag is on; the same (newest) account every time when it is off.
- First attempt `429`: the same request succeeds through the second account; the client never sees the `429`; the cooled account is skipped for 60 seconds.
- Every account cooling: requests still reach upstream instead of failing locally.
- One connection or none: behavior identical to today, including all existing error messages.
- `PATCH /v1/providers/{id}/round-robin` passes the admin guard, persists the flag, and both provider payloads carry `roundRobin`; the existing web toggle works against the Rust backend without web changes.
- No schema change, no new dependency, no change under `apps/api` or `packages/*`.

## Rejected alternatives

- **Gateway-level retry or a shared retry trait:** the gateway does not know account lists, and a generic framework over three different request shapes is the over-engineering this plan refuses; the loops stay inside the executors that own the credentials.
- **Cooldowns in the database:** a schema change plus write traffic per failure to protect against a restart window whose cost is one retried request; in-memory wins.
- **`Retry-After` parsing and per-status policies:** a fixed 60-second cooldown covers the reported problem; honoring upstream hints is a later refinement, tracked under Open items.
- **Active health probes or per-account weighting:** probing adds background traffic and a second failure surface; round-robin plus cooldown is enough at three providers and a handful of accounts.
- **Rotating at connection-creation time or sticky per-session routing:** per-request rotation is the whole point of the feature and needs no session state.

## Open items

- Whether a `429` during a qoder catalog refresh should cool the account or be ignored: catalog reads are not user-facing requests, but the same account pool serves both. Decide during Task 3 on evidence from the fake.
- Whether `401` from a single revoked account should also cool and fail over. Out of scope for now, since `401` already maps to the existing `NOT_CONNECTED` and `TOKEN_EXPIRED` messages.
- Persisting cooldowns across restarts, only if a restart loop proves annoying in practice.
- Rotation for API-key and custom providers, blocked on `POST /v1/providers` (TODO section 7).
