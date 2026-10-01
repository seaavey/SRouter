# Token Saver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Token Saver effective where it matters: port the request-compression and system-prompt-enhancement pipeline into the live Rust gateway (`server/`), persist its settings through the contract's `/v1/settings` `settings` map, and expose controls in the admin UI. Today the feature exists only in the Node oracle (partially stubbed) and the gateway that serves production traffic applies nothing.

**Architecture:** One new module `server/src/features/token_saver/` with plain structs and functions (settings struct, compressors, prompt builder, apply helper — no traits, builders, or DI layers). One `settings` row: key `token_saver`, value = JSON string of the whole settings object, read via the existing `get_setting` (`server/src/infrastructure/database/settings.rs:56`) and written via `set_setting` (same file, `:74`) through the already-contractual `/v1/settings` mutation. Two hook points, applied exactly once per top-level request before the first upstream attempt: `gateway/chat.rs::create_completion` (`chat.rs:40`) and `gateway/messages.rs::create_message` (`messages.rs:44`) — the in-handler `current_depth` loops are the oracle's `depth > 0` recursion, so one application at handler entry reproduces `depth === 0` exactly. Settings read is fail-open: a corrupt or unreadable row falls back to defaults and a chat request never fails because of the saver. Web: a new "Token Saver" section on the settings page persisting one JSON-string key with the existing `api.patch("/v1/settings", { settings: … })` pattern.

**Tech Stack:** Rust edition 2024 (stable), axum 0.8, serde/serde_json, tokio 1, sqlx 0.9. One new crate proposed: `regex` (decision D5). Node side uses only existing pieces: the Zod schema in `packages/types`, `getSettingDB`/`setSettingDB` in `packages/db`. `apps/api` stays byte-identical (no changes at all).

**Spec (Node oracle evidence):**

- `apps/api/src/logic/chat.logic.ts:164-165` (non-stream) and `:265-266` (stream): `depth === 0 ? applyTokenSaver(body, await getTokenSaverSettingsDB()).request : body` — computed once before the attempt/fallback loop and reused across attempts.
- `apps/api/src/controllers/messages.controller.ts:108`: the Anthropic surface funnels through `ChatLogic.ProcessNonStreamingCompletion`, so `/v1/messages` is covered by the same hook, compressing the translated OpenAI-shaped messages.
- The behavior itself lives in `packages/translator/src/tokenSaver.ts`, tested by `packages/translator/tests/tokenSaver.test.ts` — see decision **D1** (provenance).
- Settings schema and defaults: `packages/types/src/tokenSaver.ts` (`TokenSaverSettingsSchema`, `DEFAULT_TOKEN_SAVER_SETTINGS`).
- Node persistence is stubbed: `packages/db/src/tokenSaver.ts` always returns defaults; the real key/value helpers exist (`packages/db/src/settings.ts:9,16,26`) and the settings controller already persists arbitrary string keys (`apps/api/src/controllers/settings.controller.ts:31-37`).
- Contract: `docs/api-v1-contract.md` rows 100-101 — GET returns `settings`, POST/PATCH accepts string-valued `settings`.
- Savings metrics are computed and discarded: nothing in `apps/api` reads `tokensSaved` / `originalInputTokens` / `percentageSaved` (repo-wide search 2026-10-01) — parity means discarding them too (D3).

## Audit — where the feature stands

| Piece                                                | Node oracle                                | Rust gateway (live)                               | Status                     |
| ---------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- | -------------------------- |
| Compressors (git diff/status/log, grep, lists, logs) | `packages/translator/src/tokenSaver.ts`    | —                                                 | missing in Rust            |
| System-prompt enhancements (terse, lazy senior dev)  | same file, `BuildSystemPromptEnhancements` | —                                                 | missing in Rust            |
| Apply at depth 0 (chat + messages surfaces)          | `chat.logic.ts:164-165,265-266`            | —                                                 | missing in Rust (no saver) |
| Settings schema + defaults                           | `packages/types/src/tokenSaver.ts`         | —                                                 | needs serde port           |
| Settings persistence                                 | stub (`packages/db/src/tokenSaver.ts`)     | `get_setting`/`set_setting` exist                 | missing on both sides      |
| `/v1/settings` settings map                          | yes (contract rows 100-101)                | no (`features/settings.rs` returns only the flag) | tracked in `TODO.md` §8    |
| Admin UI controls                                    | —                                          | —                                                 | missing                    |
| Savings metrics                                      | computed, discarded                        | —                                                 | parity = discard (D3)      |

## Decisions (resolve before coding)

- **D1 — provenance (blocks Phase 2).** The ground rules (`server/TODO.md`, "Ground rules") forbid building a port from `packages/*` and direct the agent to STOP when parity needs data without independent provenance. The entire behavior spec of Token Saver lives only in `packages/translator/src/tokenSaver.ts` plus its test file. Needed: explicit authorization to treat those two files as the behavioral oracle for this slice (read as a specification; the Rust code is written independently, nothing copied), or a fallback independent reimplementation that cannot be parity-checked. **Recommendation: authorize both files for this slice.**
- **D2 — Node settings stub.** Replace `getTokenSaverSettingsDB()` with a real read of the `token_saver` row (JSON + Zod validation + defaults), so the oracle rollback path actually persists configuration. Touches `packages/db` only; `apps/api` stays byte-identical. Needed because it changes oracle runtime behavior. **Recommendation: yes** — Phases 2 and 3 then read the same row in the same shape.
- **D3 — savings metrics.** The oracle computes `tokensSaved` and throws it away; surfacing it means new `request_logs` columns (persistence-contract change). **Recommendation: keep parity (discard); defer metrics to a follow-up spec.**
- **D4 — settings storage shape (proposed, not blocking).** One row, key `token_saver`, value = JSON of the whole object. Matches the Zod object 1:1, one read per request, one write per save; the web's flat-key convention (`SERVER_SETTING_KEYS`) would need a 9-field mapping across two languages. Overturn before Phase 1 fixtures freeze the key if flat keys are preferred.
- **D5 — `regex` crate.** `server/Cargo.toml` has no regex dependency; the compressor rules are six anchored patterns (ANSI escapes, `@@ -n … @@` hunks, `file:line:` grep rows, `ls -l` rows, tree branches, timestamp prefixes). **Recommendation: add `regex = "1"`** — hand-rolled scanners are more code and drift-prone; flagged explicitly because prior plans documented every new crate.

### Settings payload (shared shape, camelCase on both sides)

```json
{
    "compressToolOutput": {
        "compressGit": true,
        "compressGrep": true,
        "compressFileLists": true,
        "compressLogs": true,
        "stripAnsiAndWhitespace": true,
        "minCharacterThreshold": 50
    },
    "lazySeniorDev": { "mode": "balanced", "customInstructions": "" },
    "compressLlmOutput": { "mode": "terse", "stripPleasantries": true, "customPrompt": "" }
}
```

Rust structs use `#[serde(rename_all = "camelCase")]` with `#[serde(default)]` on the structs and optional fields, so a partial or empty row parses to defaults instead of failing.

## Phase 1 — `/v1/settings` settings map (prerequisite, already tracked)

Node evidence: `settings.controller.ts:12-18` (GET returns `require_api_key` + `requireApiKey` + `settings`) and `:31-37` (POST/PATCH persists string values only; non-string values are silently ignored). Rust target: `features/settings.rs`.

- [ ] GET gains the compat field `requireApiKey` and `settings: Record<string, string>` containing every row of the `settings` table.
- [ ] POST/PATCH accepts the `settings` map: persist each string value through `set_setting`, ignore non-string values exactly like the oracle, echo the updated map back.
- [ ] Auth layering unchanged (read = API-key, write = admin session + CSRF; `TODO.md:320-321`).
- [ ] Tests in `server/tests/settings.rs`: round-trip (write `token_saver` → GET shows it), non-string value ignored, GET shape has all three fields.
- [ ] Cross off `TODO.md:313-319`.

## Phase 2 — Rust token saver core (gated on D1 and D5)

- [ ] `server/src/features/token_saver/mod.rs`: plain settings structs with `#[serde(rename_all = "camelCase")]` + `#[serde(default)]` mirroring `DEFAULT_TOKEN_SAVER_SETTINGS` (five compress flags `true`, threshold `50`, `lazy_senior_dev.mode = balanced`, `compress_llm_output.mode = terse`, `strip_pleasantries = true`, optional custom texts).
- [ ] Settings load: `get_setting(database, "token_saver")` → `serde_json::from_str` → per-field defaults for missing/invalid fields; DB error or malformed JSON → defaults plus a log line, never an error response (fail-open; D2 keeps the oracle identical).
- [ ] Compressors ported behavior-for-behavior: `strip_ansi`, `clean_whitespace`, `compress_git_diff`, `compress_git_status_or_log`, `compress_grep_output`, `compress_file_listings`, `compress_generic_logs`, and the `compress_single_tool_output` dispatcher.
- [ ] Parity checklist for the dispatcher (derived from the oracle):
    - string contents only; content shorter than `min_character_threshold` passes through untouched;
    - roles: `tool` and `user` always eligible, `assistant` only when the content contains a code fence, `system` never compressed;
    - dispatch is an if/else-if chain in this order, each arm gated by its own flag: git diff (`diff --git`, or both `--- ` and `+++ `) → git status/log (`commit `, `Changes not staged for commit:`, `On branch `) → grep (at least two `file:line:` rows) → file listings (`drwx`, `-rw-`, `├──`, `└──`) → generic logs (fallback when `compress_logs` is on);
    - ANSI stripping and whitespace cleanup only when `strip_ansi_and_whitespace` is on.
- [ ] Prompt enhancements: always emitted (both modes produce text in the oracle — there is no "off" mode), appended to the first `system` message, or a new system message prepended when none exists; applied exactly once per request.
- [ ] Hook points: `gateway/chat.rs::create_completion` right after the body is read, and `gateway/messages.rs::create_message` after the Anthropic→internal conversion, both before model resolution / the first upstream attempt; stream and non-stream inherit the hook because they branch after entry. Verify the messages conversion point against `messages.controller.ts:108` while implementing — adjust if Rust converts deeper.
- [ ] Unit tests: table-driven cases per compressor, using the Node test file as black-box expectations (pending D1), run with `cargo test --manifest-path server/Cargo.toml --lib`.
- [ ] Integration: one case in `server/tests/chat_completions.rs` and one in `server/tests/messages.rs` sending a tool/user message containing a `git diff` and asserting the fake upstream received the compressed form, plus a settings-driven case proving a saved `token_saver` row with all flags false reaches upstream unmodified.

## Phase 3 — Node settings persistence (gated on D2)

- [ ] `packages/db/src/tokenSaver.ts`: read `getSettingDB("token_saver")` → guarded `JSON.parse` → `TokenSaverSettingsSchema.safeParse` → merge over `DEFAULT_TOKEN_SAVER_SETTINGS`; any failure returns defaults (same fail-open rule as Rust).
- [ ] New `packages/db/tests/tokenSaver.test.ts` in the style of the existing `packages/db/tests/*.test.ts`: missing key → defaults, valid JSON → parsed, invalid JSON → defaults. Run the focused file with `DATABASE_PATH` pointed at a disposable temp file (DB safety rule — never the default `~/.srouter/srouter.db`).
- [ ] No `apps/api` changes; the settings controller already persists arbitrary string keys.

## Phase 4 — Admin UI

- [ ] `apps/web/src/components/settings/settings.token-saver.tsx` exporting `TokenSaverSettings`, built from `SettingsSection` / `SettingsRow` / `SegmentedControl` (`components/settings/settings.ui.ts`), exported from `components/settings/index.ts`, rendered in `routes/settings.tsx` with a new `SECTIONS` entry.
- [ ] Data flow: the page already fetches `/v1/settings` (`routes/settings.tsx:66-70`); parse `settings.token_saver` JSON with defaults, save via `api.patch("/v1/settings", { settings: { token_saver: JSON.stringify(value) } })` then invalidate the `server_settings` query.
- [ ] Controls: five toggles, threshold number input, lazy-senior-dev segmented (`balanced`/`strict` + custom instructions), output-mode segmented (`terse`/`ultra_terse` + custom prompt). The oracle schema has no off switch for the prompt enhancements — adding one is a schema/behavior change, out of scope here.
- [ ] Verify: `cd apps/web && pnpm run lint` plus `pnpm exec prettier --check` on changed files. No `vite build`.

## Phase 5 — backlog and gates

- [ ] Add the Token Saver parity item to `server/TODO.md` §6 (Gateway), pointing at this plan; the `/v1/settings` map items already live in §8.
- [ ] Gate each slice: focused `cargo test --manifest-path server/Cargo.toml --test <file>`, `cargo fmt --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`, the matching Node test read as black-box evidence, `pnpm exec prettier --check` on changed TS files, `git diff --check`. No `pnpm build` / `vite build` / dev servers (repo rules).

## Out of scope / follow-ups

- Surfacing savings metrics anywhere (D3) — defer to a follow-up spec.
- Per-provider or per-model saver rules, adaptive thresholds.
- An "off" mode for the prompt enhancements (schema change; oracle parity currently forbids it).
- `/v1/count_tokens` and other non-gateway surfaces — the oracle does not compress them either.

## Open questions

- D1, D2, D3 approvals (D1 blocks Phase 2, D2 blocks Phase 3).
- Confirm D4 key name `token_saver` before Phase 1 test fixtures freeze it.
- Exact messages-side conversion point in Rust (`messages.rs`), to be pinned during Phase 2 against the oracle.
