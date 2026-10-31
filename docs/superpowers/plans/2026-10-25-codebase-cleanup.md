# Codebase cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unreachable PostgreSQL backend, the duplicated catalog refresh policy, the dead constant, the unwrapped lock, and the four copies of the secret reveal block.

**Architecture:** Each task removes a duplication by giving one owner to code that is currently copied. Nothing here changes behaviour, a wire shape, a status code, or a generated file. Server tasks run under `cargo test`, client tasks under `bun run typecheck && bun run lint && bun run build` plus a browser pass.

**Tech Stack:** Rust (axum 0.8, tokio, sqlx + SQLite), TypeScript (React 19, Bun, TanStack, Tailwind v4).

**Spec:** `docs/superpowers/specs/2026-10-25-codebase-cleanup-design.md`

## Global Constraints

- No `unwrap()` on a production path; propagate with `?` into `APIError`. Lock poison is recovered with `.unwrap_or_else(|e| e.into_inner())`.
- One error type: `APIError` with builders.
- Every client-visible string comes from `server/src/constants.rs`.
- No wire type change, no `#[serde(rename_all)]`, no regenerated bindings.
- Nothing inside `client/src/components/arc/` or `client/src/components/ui/` is edited.
- Per task: `cargo fmt --check`, `clippy -D warnings`, full `cargo test` green.
- No commits unless the owner asks.

## Review Focus

- A catalog that fetched successfully but returned zero models: the two due-check shapes disagree. The unified check must keep the retry window for it, never mark it fresh forever.
- A request-log call that passes a stream failure rather than an `APIError`: the record must still carry the recovered upstream status.
- A provider catalog whose fetch fails: the snapshot must keep its previous models, and only `attempted_at_ms` moves.
- The secret reveal after a successful create: the value is unrecoverable, so the copy affordance must not regress in the extract.
- A poisoned selection lock: resolution must continue on the recovered guard instead of panicking the request.

---

### Task 1: PostgreSQL backend removal

**Files:**
- Modify: `server/Cargo.toml:23`
- Modify: `server/src/infrastructure/database/mod.rs:25-95`
- Delete test: `server/tests/logs.rs` (`postgres_request_log_repository_fails_explicitly`)
- Delete test: `server/tests/providers.rs` (`a_postgres_backend_reads_empty_and_refuses_provider_writes`)

**Interfaces:**
- Consumes: nothing.
- Produces: `AppDatabase` becomes a struct wrapping `Arc<SqliteHandle>`. `sqlite_handle() -> Option<&Arc<SqliteHandle>>`, `sqlite_pool() -> Option<SqlitePool>`, `sqlite_path() -> Option<&Path>`, `sqlite_required(&self, message: &str) -> Result<SqlitePool, APIError>`. Signatures are deliberately unchanged so the 62 existing call sites and 60 test call sites compile untouched.

- [ ] **Step 1: Confirm the failure mode first.** Run `cargo test --manifest-path server/Cargo.toml --test providers --test logs --locked` and record the two passing Postgres tests. They are the only evidence that today's variant works; they disappear with it.
- [ ] **Step 2: Replace the enum with a struct** holding the SQLite handle. Keep all four accessor signatures identical, returning `Some`/`Ok` unconditionally. Delete the `PgPool` import and the `Postgres` arm.
- [ ] **Step 3: Drop `"postgres"` from the sqlx feature list** in `server/Cargo.toml`.
- [ ] **Step 4: Delete the two tests** named above, and any import they alone used (`PgPoolOptions`, `sqlx::postgres`).
- [ ] **Step 5: Run** `cargo test --manifest-path server/Cargo.toml --locked`, then `cargo fmt --check` and `clippy --all-targets --all-features -- -D warnings`. Expected: green, and `cargo build` no longer compiles a PostgreSQL driver.

### Task 2: Dead provider origin constant

**Files:**
- Modify: `server/src/features/providers/commandcode/types.rs:12`
- Modify: `server/src/features/providers/commandcode/mod.rs:23`

- [ ] **Step 1: Remove `COMMANDCODE_ORIGIN`** from `types.rs` and its entry in the `pub use` list in `mod.rs`, in one edit.
- [ ] **Step 2: Run** the commandcode test suite plus `cargo build`. Expected: green, no warning about an unused import.

### Task 3: Lock poison recovery in the registry

**Files:**
- Modify: `server/src/features/providers/registry.rs:262`
- Test: `server/src/features/providers/registry.rs` (in-crate `#[cfg(test)]` module)

**Interfaces:**
- Consumes: `ProviderRegistry::resolve(&self, model: &str) -> Option<ResolvedModel>` and the existing `TestExecutor` fixture in that module.
- Produces: nothing new; the lock is read through a recovered guard.

- [ ] **Step 1: Write the failing test.** Register two adapters that both advertise one model, poison the selection mutex by panicking a thread while it holds the lock, then call `resolve` for that model and assert it still returns `Some`. Name: `a_poisoned_selection_lock_still_resolves`.
- [ ] **Step 2: Run it** and confirm it panics at the unwrap rather than returning `Some`.
- [ ] **Step 3: Replace `.lock().unwrap()`** with `.lock().unwrap_or_else(|poisoned| poisoned.into_inner())`.
- [ ] **Step 4: Re-run** the test and the providers suite.

### Task 4: One record for the request log

**Files:**
- Modify: `server/src/features/gateway/interception/logging.rs:20-31`
- Modify: the 17 call sites across `gateway/chat.rs`, `gateway/messages.rs`, `gateway/images.rs`, `interception/buffered.rs`, `logging.rs` (`log_stream_success`)

**Interfaces:**
- Consumes: `LogError<'a>`, `UsageBreakdown`, `RequestLogContext`.
- Produces: `pub(crate) struct RequestLogRow<'a> { pub provider_id: &'a str, pub model: &'a str, pub resolved_model: Option<&'a str>, pub status_code: u16, pub usage: &'a UsageBreakdown, pub error: Option<&'a LogError<'a>> }` and `log_request(state: &AppState, context: &RequestLogContext, row: RequestLogRow<'_>)`.

- [ ] **Step 1: Run the log suites first** (`--test logs --test chat_completions --test images`) to record the green baseline; this is a behaviour-preserving refactor, so the existing assertions are the test.
- [ ] **Step 2: Add the record type and change the signature**, converting the record into the existing `RequestLogInput` inside the function. The `too_many_arguments` allowance goes.
- [ ] **Step 3: Update every call site**, letting the compiler enumerate them.
- [ ] **Step 4: Re-run** the same suites plus the full suite.

### Task 5: Catalog refresh consolidation

**Files:**
- Create: `server/src/features/providers/catalog.rs`
- Modify: the eight `*/catalog.rs` modules and the five `*/refresh.rs` or executor bodies that duplicate the coalesced fetch, plus `providers/mod.rs`
- Test: the new module's `#[cfg(test)]` block; delete the duplicated per-catalog due-check tests

**Interfaces:**
- Consumes: `APIError`, `crate::clock::now_ms`.
- Produces: `pub struct CatalogSnapshot { pub models: Vec<String>, pub fetched_at_ms: i64, pub attempted_at_ms: i64 }` with `empty()`, `is_empty()`, `refresh_is_due(&self, force: bool, now: i64) -> bool`, `mark_attempt(&mut self, now: i64)`; `pub const CATALOG_TTL_MS: i64`; `pub const CATALOG_RETRY_MS: i64`; `pub async fn coalesced_refresh<F, Fut>(lock: &tokio::sync::Mutex<()>, snapshot: &SharedCatalog, force: bool, fetch: F) -> Result<(), APIError>`.

- [ ] **Step 1: Write the failing test** for the unified due check, in the new module: force wins; an unfilled snapshot inside the retry window is not due; a snapshot that fetched successfully with zero models obeys the retry window rather than the TTL; a filled snapshot is due at the TTL.
- [ ] **Step 2: Implement the value type and the two constants**, plus the coalesced helper.
- [ ] **Step 3: Point each provider catalog at the shared value**, keeping each provider's own parse functions.
- [ ] **Step 4: Delete the duplicated due-check tests** and the duplicated constants.
- [ ] **Step 5: Run** the provider suites and the full suite.

### Task 6: One secret reveal component

**Files:**
- Create: `client/src/components/keys/SecretReveal.tsx`
- Modify: `client/src/components/keys/CreateKeyDialog.tsx:127`, `client/src/components/keys/RegenerateKeyDialog.tsx:84`, `client/src/components/users/CreateUserDialog.tsx:129`, `client/src/components/users/TokenDialog.tsx:100`

**Interfaces:**
- Produces: `SecretReveal({ label, value, copyLabel }: { label: string; value: string; copyLabel: string })`, rendering the mono block, the existing `CopyButton`, and a done button that closes the enclosing dialog.

- [ ] **Step 1: Extract the block verbatim** into the new component, with the same classes and copy behaviour.
- [ ] **Step 2: Replace the four inline blocks**, passing each dialog's own label and copy label.
- [ ] **Step 3: Run** `bun run typecheck`, `bun run lint`, `bun run build`.
- [ ] **Step 4: Browser pass** over the four dialogs, recording each: create key, regenerate key, create user, show user token.

### Task 7: Documentation drift

**Files:**
- Modify: `AGENTS.md:8` (unwrap rule citation), `AGENTS.md:43` and `:180` (component layer vocabulary)

- [ ] **Step 1: Replace the line-number citation** with the invariant and the recover-with pattern.
- [ ] **Step 2: Correct the component-layer description** to say the primary kit is `arc/` and the shadcn over Base UI folder is secondary with two live consumers.
- [ ] **Step 3: Re-run** `rg -n 'registry\.rs:[0-9]+' AGENTS.md` and confirm no line citation survives.
