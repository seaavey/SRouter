# Token Saver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every top-level gateway request strips provably noisy bytes from tool output before it reaches a provider, and always carries one terse-output directive in its system prompt. The saving lands on the operator's token bill for `/v1/chat/completions` (and the `/v1/v1/*` alias) and `/v1/messages`.

Native and always-on: no settings row, no switch, no threshold, no Node-side work. Only `server/` changes; `apps/api`, `packages/*`, `apps/web`, the database, and the dependency list stay untouched. `apps/api` is read-only reference for the hook point — its saver runs only at the top-level entry of the two completion methods (`depth === 0`) — so the pipeline runs once per top-level request, never inside the intercept loop. The legacy Node implementation is not ported.

## Transforms

Applied to eligible content, always, in order:

1. **Strip ANSI.** CSI (`ESC [ ... final`), OSC (`ESC ] ... BEL|ST`), and two-byte escapes.
2. **Normalize whitespace.** Trim trailing spaces per line, collapse three or more newlines into one blank line, trim the ends. Indentation stays.
3. **Drop diff metadata**, only when a line starts with `diff --git `. Remove prefixes `index `, `old mode `, `new mode `, `new file mode `, `deleted file mode `, `similarity index `, `dissimilarity index `. Keep everything else, including `diff --git`, `---`, `+++`, `@@`, content lines, `\ No newline at end of file`, and `Binary files ... differ`.
4. **Collapse repeated lines**, only when the text is not a diff: consecutive identical lines of eight or more characters become `line (xN)`; short structural repeats survive.

Diff detection is the single predicate "some line starts with `diff --git `". Diffs skip step 4 because repeated content lines are real content; hunk headers stay in standard `@@ -a,b +c,d @@` form. There is no length threshold.

## Eligibility and hook points

Rewritten: `ChatContent::Text` on `user`, `tool`, and `function` messages. Never touched: `system` (policy), `assistant` (prior model output), `Parts` arrays, and `null` content.

Applied once per top-level request, before model resolution and before the stream branch:

| Surface          | Handler                                        | Point                                                                                        |
| ---------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Chat completions | `features/gateway/chat.rs::create_completion`  | after the developer-to-system normalization loop, before the `if chat_request.stream` branch |
| Messages         | `features/gateway/messages.rs::create_message` | after `anthropic_to_openai_request`, before the `if stream` branch                           |

The interceptor loop appends its own tool results after the hook, so nothing is compressed twice and gateway-generated content is never rewritten.

## Terse directive

Append one constant paragraph to the first system message, or prepend a system message when none exists:

> Terse mode: answer directly, skip pleasantries and restating the request, and prefer short sentences and code over explanation.

Applied on both surfaces, once per top-level request. The directive never leaves the gateway, so no idempotence marker is needed.

## Files

- new `server/src/features/gateway/token_saver.rs`: the pipeline, the directive constant, `apply_to_request`, unit tests.
- `server/src/features/gateway/mod.rs`: register the module.
- `server/src/features/gateway/chat.rs`, `server/src/features/gateway/messages.rs`: one `apply_to_request` call each.
- Tests: `server/tests/chat_completions.rs`, `server/tests/messages.rs`, plus chat-body capture on `FakeUpstream` in `server/tests/support/mod.rs`.
- Tracker: `server/TODO.md` section 6 bullet.

## Step 1: core module and unit tests

- [x] `apply_to_request(&mut ChatCompletionRequest)`: walks messages with the eligibility rules and replaces content only when a transform changed it. No settings, no database, no threshold.
- [x] Directive constant plus `apply_directive(&mut ChatCompletionRequest)` that appends to the first system message or prepends one.
- [x] Table-driven tests: ANSI variants (CSI, OSC with BEL and ST, no escape byte), whitespace runs, diff detection true and false, metadata drop with and without `diff --git`, collapse guard on short lines, unchanged input returned untouched, role gating, directive append and prepend, assistant and system content left alone.
- [x] Gate: `cargo test --manifest-path server/Cargo.toml --lib`, `cargo fmt --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`.

## Step 2: wiring and end-to-end proof

- [x] Hook `chat.rs` and `messages.rs` at the points above.
- [x] `FakeUpstream` records `last_chat_body: Value` through shared state, mirroring the existing `FakeClineState` pattern.
- [x] Tests: a noisy diff body is compressed and the directive appears (chat); a clean body reaches upstream byte-identical; the directive is prepended when no system message exists; the messages surface compresses the translated request (Anthropic in, OpenAI-shaped body captured upstream).
- [x] Gate: `cargo test --manifest-path server/Cargo.toml --test chat_completions`, `--test messages`, `cargo fmt --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`.

## Acceptance criteria

1. Every top-level chat and messages request, stream and non-stream, passes through the pipeline exactly once; clean input reaches upstream byte-identical.
2. Noisy eligible content is transformed and ineligible content is not; the captured upstream body proves it.
3. The directive is appended or prepended on both surfaces.
4. No settings row, no database read, and no new crate on the request path.
5. `cargo fmt --check` and clippy pass; `apps/api` and `packages/*` show no diff.
6. Repeated lines never collapse inside a diff; hunk headers keep their standard form.

## Deliberately rejected

Always-on beats a settings row: a switch adds a read, a cache question, and a per-family mode surface for no savings. Also out: the `regex` crate (four small scanners, about 80 lines with tests); per-family toggles and a `minChars` threshold; `@@ L45 @@` hunk-header rewrites; `git log`, grep, and `ls -l` column surgery; assistant-message compression; savings metrics in `request_logs`; and `count_tokens` compression. Each either invents a format models have no priors on, loses real content, or adds surface with no consumer.

## Open items

- Directive wording is a one-line change; tune it after real traffic.
- A one-line note in `docs/api-v1-contract.md` for the always-on behavior is optional.
