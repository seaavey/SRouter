# Token Saver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** this revision replaces the parity-first draft written earlier the same day. The feature is designed as a native gateway capability: nothing reads or matches `packages/translator`, no Node-side work is planned, and `apps/api` stays byte-identical as the rollback path.

**Goal:** the live Rust gateway compresses noisy tool output before it reaches a provider, and can append one terse-output directive to the system prompt. The saving lands on the operator's token bill for `/v1/chat/completions` (and the `/v1/v1/*` alias) and `/v1/messages`. One settings row (`settings` table, key `token_saver`) drives everything, and the admin UI controls it.

## Scope

**In:**

- Four text transforms and one optional prompt directive, applied once per top-level request.
- The `settings` map on `/v1/settings`: GET returns every row, POST/PATCH writes string values. Contract rows 100-101 already specify it, `server/TODO.md` section 8 tracks it, and the web client already patches it (`apps/web/src/hooks/useSettings.ts:80,111`).
- An admin UI section on the settings page.

**Out, deliberately:**

- No changes to `apps/api`, `packages/*`, the database schema, or the dependency list.
- No per-family switches, prompt modes, free-text instruction fields, savings metrics, request-log columns, settings cache, `count_tokens` compression, or the `requireApiKey` alias.

## Why this is not a port

The legacy behavior lives in `packages/translator/src/tokenSaver.ts`, which the ground rules in `server/TODO.md` forbid reading. The old draft turned that into a blocking authorization question (D1). A native design removes the question instead of answering it.

The legacy surface also carries weight this gateway does not need: five per-family switches, two prompt modes, free-text custom instructions, and rewrites such as `@@ L45 @@` hunk headers or reformatted `git log` blocks. A model has strong priors on real unified-diff output and none on invented header formats, so those rewrites trade comprehension for a handful of tokens. This plan keeps the deletions that are provably noise and drops the rest.

## Settings

One row in the existing `settings` table.

| key           | value                                               |
| ------------- | --------------------------------------------------- |
| `token_saver` | JSON object, camelCase fields, unknown keys ignored |

```json
{ "enabled": false, "minChars": 200, "terseOutput": false }
```

| field         | default | meaning                                                              |
| ------------- | ------- | -------------------------------------------------------------------- |
| `enabled`     | `false` | Master switch. Off means the gateway leaves every request untouched. |
| `minChars`    | `200`   | Contents shorter than this (bytes) are never rewritten.              |
| `terseOutput` | `false` | Append the fixed terse directive to the system prompt.               |

Loading rules, all fail-open to `enabled: false`:

- Row absent, or no database in state: disabled.
- Malformed JSON or a field with the wrong type: disabled. The object is rejected as a whole, with no partial repair.
- Missing fields: struct defaults.
- Read errors: disabled, and the request proceeds. The read is one primary-key lookup beside a multi-second upstream call, so there is no cache and no invalidation surface.

## Transforms

The pipeline runs on eligible content in this order:

1. **Strip ANSI.** CSI sequences (`ESC [ ... final`), OSC sequences (`ESC ] ... BEL|ST`), and two-byte escapes. Color codes and hyperlink wrappers carry no text.
2. **Normalize whitespace.** Trim trailing spaces per line, collapse runs of three or more newlines into one blank line, trim the ends of the text. Indentation stays.
3. **Drop diff metadata**, only when some line starts with `diff --git `. Removed prefixes: `index `, `old mode `, `new mode `, `new file mode `, `deleted file mode `, `similarity index `, `dissimilarity index `. Everything else stays, including `diff --git`, `---`, `+++`, `@@`, content lines, `\ No newline at end of file`, and `Binary files ... differ`.
4. **Collapse repeated lines**, only when the text is not a diff. Consecutive identical lines of eight or more characters become `line (xN)`. The guard leaves short structural repeats alone, so code fragments and ASCII separators survive.

Diff detection is one predicate: some line begins with `diff --git `. Diffs skip step 4 because repeated content lines inside a diff are real content. Hunk headers stay in their standard `@@ -a,b +c,d @@` form.

## Eligibility and hook points

Rewritten: `ChatContent::Text` on `user`, `tool`, and `function` messages whose length reaches `minChars`. Never touched: `system` (policy) and `assistant` (prior model output) messages, `Parts` arrays, and `null` content.

Applied once per top-level request, before model resolution and before the stream branch:

| Surface          | Handler                                        | Point                                                                                      |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Chat completions | `features/gateway/chat.rs::create_completion`  | after parsing and developer-to-system normalization (`chat.rs:64-81`), before `chat.rs:83` |
| Messages         | `features/gateway/messages.rs::create_message` | after `anthropic_to_openai_request` (`messages.rs:110`), before `messages.rs:112`          |

Line numbers are verified against commit `35875e7`. Stream and non-stream requests share the same struct below the branch, and the interceptor loop appends its own tool results after the hook, so nothing is compressed twice and gateway-generated content is never rewritten.

## Terse directive

When `terseOutput` is on, the gateway appends one constant paragraph to the first system message, or prepends a system message when none exists:

> Terse mode: answer directly, skip pleasantries and restating the request, and prefer short sentences and code over explanation.

No idempotence marker: the directive never leaves the gateway, so clients cannot echo it back through normal use.

## Files

Rust:

- new `server/src/features/gateway/token_saver.rs`: settings struct with `load`, the transform pipeline, the directive constant, unit tests.
- `server/src/features/gateway/mod.rs`: register the module.
- `server/src/features/gateway/chat.rs`, `server/src/features/gateway/messages.rs`: two lines each (`load`, `apply`).
- `server/src/features/settings.rs`: `settings` map on GET, POST, and PATCH.
- `server/src/infrastructure/database/settings.rs`: `get_all_settings`.
- Tests: `server/tests/settings.rs`, `server/tests/chat_completions.rs`, `server/tests/messages.rs`, plus chat-body capture on `FakeUpstream` in `server/tests/support/mod.rs`.

Web:

- new `apps/web/src/components/settings/settings.token-saver.tsx`, one export line in `components/settings/index.ts`, one `SECTIONS` entry and one render line in `routes/settings.tsx`.

Tracker:

- `server/TODO.md` section 6 bullet, and section 8's two `/v1/settings` bullets once Step 2 lands.

## Step 1: core module and unit tests

- [ ] `TokenSaverSettings { enabled, min_chars, terse_output }` with `Default` (off, 200, off), `#[serde(rename_all = "camelCase")]`, and `#[serde(default)]`.
- [ ] `TokenSaverSettings::load(database: Option<&AppDatabase>) -> TokenSaverSettings`: `get_setting(db, "token_saver")`, parse, or defaults on any failure. Never returns an error.
- [ ] `apply_to_request(&mut ChatCompletionRequest, &TokenSaverSettings)`: returns immediately when disabled, walks messages with the eligibility rules, and replaces content only when a transform changed it.
- [ ] Unit tests, table-driven: ANSI variants (CSI, OSC with BEL and ST, no escape byte), whitespace runs, diff detection true and false, metadata drop with and without `diff --git`, collapse guard on short lines, unchanged input returned untouched, role and threshold gating, system prompt append and prepend, malformed JSON disables.
- [ ] Gate: `cargo test --manifest-path server/Cargo.toml --lib`, `cargo fmt --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`.

## Step 2: `/v1/settings` map

- [ ] `get_all_settings(database) -> BTreeMap<String, String>`, sorted keys for a stable response.
- [ ] GET returns `{ "require_api_key": bool, "settings": { ... } }`.
- [ ] POST/PATCH accepts `settings` as an object of strings, writes each pair through `set_setting`, ignores non-string values, rejects a non-object `settings` with the existing 400 payload error, and echoes the updated map.
- [ ] Auth layering unchanged: GET is API-key, writes are admin session plus CSRF.
- [ ] Update the whole-body assertions in `server/tests/settings.rs` to include `settings: {}`.
- [ ] New tests: PATCH `{"settings":{"token_saver":"..."}}` then GET shows the row and the raw table matches, non-string value ignored, `settings` as an array returns 400.
- [ ] Note: the web client's existing localStorage migration patches nine flat keys through this map. After this step those writes persist; nothing reads them yet.
- [ ] Tick the two section 8 bullets in `server/TODO.md`; the `requireApiKey` alias stays tracked.
- [ ] Gate: `cargo test --manifest-path server/Cargo.toml --test settings`, `cargo fmt --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`.

## Step 3: wiring and end-to-end proof

- [ ] Hook `chat.rs` and `messages.rs` at the points in the table above.
- [ ] `FakeUpstream` records `last_chat_body: Value` through shared state, mirroring the existing `FakeClineState` pattern.
- [ ] Tests: an enabled row compresses a diff body and appends the directive (chat), an absent or disabled row leaves the body identical (chat), and the messages surface compresses the translated request (Anthropic in, OpenAI-shaped body captured upstream).
- [ ] Gate: `cargo test --manifest-path server/Cargo.toml --test chat_completions`, `--test messages`, `cargo fmt --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`.

## Step 4: admin UI

- [ ] `TokenSaverSettings` section component, self-contained like `SystemSettings`: reads the cached `server_settings` query, parses `settings.token_saver` with a defaults helper that never throws, saves with `api.patch("/v1/settings", { settings: { token_saver: JSON.stringify(value) } })`, invalidates `server_settings`, toasts on failure.
- [ ] Controls: `Switch` for enabled, numeric `Input` for `minChars` (clamped, disabled while the master switch is off), `Switch` for terse output. Reuse `SettingsSection` and `SettingsRow`; icon from lucide (`Coins`).
- [ ] Add the section to `SECTIONS` and render it in `routes/settings.tsx`.
- [ ] Run the antislop UI skill during this work, ending with its Delivery Gate.
- [ ] Gate: `cd apps/web && pnpm run lint`, `pnpm exec prettier --check` on changed files. No `vite build`.

## Acceptance criteria

1. With no row, `/v1/chat/completions` and `/v1/messages` reach upstream byte-identical on stream and non-stream, and responses are unaffected.
2. With an enabled row, eligible content is transformed and ineligible content is not; the captured upstream body proves it.
3. A malformed, wrong-typed, or unreadable row behaves exactly like no row, and the request succeeds.
4. `PATCH /v1/settings` with `{"settings":{"token_saver":"..."}}` round-trips through GET.
5. `cargo fmt --check` and clippy pass; no new crates; `apps/api` and `packages/*` show no diff.
6. The web section loads defaults when the key is missing or invalid, and a save survives a reload.

## Rejected alternatives

| Alternative                                 | Why not                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Port `packages/translator` behavior         | Ground rules forbid reading `packages/*`, and the legacy surface has no consumer here.         |
| `regex` crate for the scanners              | Four small transforms do not justify a dependency; the scanners are about 80 lines with tests. |
| Per-family toggles                          | One switch is easier to reason about; each transform is individually tested.                   |
| Hunk-header rewrite (`@@ L45 @@`)           | Invents a format models have no priors on.                                                     |
| `git log`, grep, and `ls -l` column surgery | Loses dates, authors, sizes, or line numbers for marginal savings.                             |
| Compressing assistant messages              | Rewrites conversation history between turns.                                                   |
| Savings metrics in `request_logs`           | Persistence-contract change with no consumer; the legacy code computed and discarded them.     |
| Settings cache                              | Invalidation state for a primary-key read next to an LLM call.                                 |
| `requireApiKey` alias                       | No consumer; the web reads either name. Stays in section 8 if a Node-era client appears.       |
| `count_tokens` compression                  | The client uses it to account for what it sends.                                               |

## Open items

- Directive wording and the `minChars` default are one-line changes; tune them after real traffic.
- A one-line note in `docs/api-v1-contract.md` for the Rust-only token saver behavior is optional; the settings map itself is already contract text.
