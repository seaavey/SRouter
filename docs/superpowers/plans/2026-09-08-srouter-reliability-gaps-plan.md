# SRouter Reliability Gaps Hardening Implementation Plan

> For Hermes: use the subagent-driven-development workflow and execute one task at a time. Do not implement this plan in the planning phase.

Goal: Convert `docs/superpowers/specs/2026-09-08-srouter-reliability-gaps-design.md` into independently reviewable hardening work that makes request-attempt, streaming commitment, identity, startup, usage, auth typing, and documentation invariants executable.

Architecture: Preserve the existing route → controller → logic → services/packages flow. Start with contracts and regression fixtures, then make the smallest runtime changes needed by approved tests. Keep chat and image protocol handling separate unless a shared attempt runner has a narrow, proven callback contract. Do not change public wire formats or introduce a global abstraction for unproven future use cases.

Tech stack: Node.js 22+, TypeScript ESM, Hono, `node:test` via `tsx`, pnpm workspaces, native SQLite/PostgreSQL DB clients, existing provider/executor/translator packages.

---

## Scope and sequencing

The work is split into six independently reviewable PRs, matching the specification:

1. Tests and contracts only.
2. Retry policy and attempt accounting.
3. Chat fallback lifecycle extraction.
4. Image fallback alignment.
5. Startup sequencing and auth facade type hardening.
6. Documentation cleanup.

Do not combine retry policy, DB/startup changes, and dashboard work. Do not change behavior without a focused regression test and an explicit acceptance criterion.

Priority order inside the first PR:

1. Streaming commitment invariant.
2. Model/provider identity contract.
3. Usage and credit accounting fixtures plus product decision.
4. Upstream attempt counting.

Open product decisions must be recorded before implementation:

- Whether there is one request-level upstream-attempt budget, separate transport/fallback budgets, or intentionally no budget.
- Whether credit limits are soft, hard/atomic, or advisory.
- Whether a streamed response that emits output and then errors is billable.
- Whether startup admin bootstrap and tunnel autostart are required-before-serving or explicit best-effort background work.
- Whether image fallback uses a generic runner or remains a separate explicit path.

## Repository constraints

- Follow `$HOME/Obsidian/SRouter/RULES.md`, `CODING-STYLE.md`, and `DESIGN.md`.
- Never run root `pnpm test`, `pnpm build`, `pnpm lint`, or broad Turbo tasks.
- Build only touched packages/apps.
- Run only touched API test files with the API `tsx` runner; API tests use concurrency 1.
- Keep temporary scripts under `/tmp`.
- Do not change public API wire formats, provider catalog scope, database technology, or dashboard layout.
- Finish each PR with `git diff --check` and the relevant scoped Prettier check.

---

## PR 1 — Contracts and regression fixtures

### Task 1: Establish the test inventory and test seams

Objective: Identify the smallest existing seams for ChatLogic, ImagesLogic, ProviderRegistry, usage extraction, DB logging, and boot orchestration before adding fixtures.

Files to inspect:

- `apps/api/src/logic/chat.logic.ts`
- `apps/api/src/logic/images.logic.ts`
- `apps/api/src/logic/fallback.policy.ts`
- `apps/api/src/services/registry.ts`
- `apps/api/src/index.ts`
- `packages/providers/src/registry.ts`
- `packages/executors/src/retry.ts`
- `packages/translator/src/usage.ts`
- `apps/api/tests/setup.ts`
- Existing API tests, especially `apps/api/tests/images-route.test.ts`, `apps/api/tests/api-keys-credit-db.test.ts`, and `apps/api/tests/auth-providers.test.ts`
- `packages/providers/tests/registry.test.ts`
- Existing executor/translator tests under `packages/*/tests`

Implementation note: Prefer existing dependency injection, fake registry/provider objects, and DB test setup. Do not add a mocking library merely for these tests.

Validation:

```bash
cd apps/api && pnpm exec tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/images-route.test.ts
cd packages/providers && pnpm exec tsx --test tests/registry.test.ts
```

### Task 2: Add streaming commitment regression tests

Objective: Prove that fallback is allowed only before the first client-visible chunk and is forbidden after commitment.

Likely test file: create `apps/api/tests/chat-streaming-fallback.test.ts` if no suitable existing file exists.

Cover these cases with fake providers/executors and observable yielded chunks:

- Async iterator creation throws: next candidate is attempted.
- Stream throws before any client-visible chunk: next candidate is attempted.
- Stream yields a client-visible chunk, then throws: original error is terminal; fallback is not attempted.
- Tool-call chunks are buffered internally, then the stream fails before any client-visible output: fallback remains allowed.
- Tool-call buffering flushes client-visible output, then fails: fallback is forbidden.

Assert both the returned/yielded behavior and provider invocation order. Keep the test at the ChatLogic boundary rather than testing implementation-local flags.

Run the single file through the API runner and confirm the new tests fail against any incorrect commitment behavior before changing runtime code.

### Task 3: Write the model/provider identity contract

Objective: Make every identity transformation explicit before changing routing or logging code.

Likely documentation file: add `docs/superpowers/contracts/model-provider-identity.md` or place the contract beside the existing specification if repository convention requires it.

The contract must define a table for:

- External `alias/model-name` input.
- Bare provider model passed to executors.
- Provider account ID.
- Canonical/base provider ID stored in request logs.
- Custom UUID provider plus alias.
- Legacy aliases.
- Seed provider rows.
- Token-refresh lookup identity.
- Unknown and intentionally double-prefixed input.

For each row specify input, normalization function/location, expected output, and whether the case is supported or rejected. Explicitly preserve the existing invariant that external model IDs are prefixed while executor model IDs are bare.

No runtime behavior change in this task.

### Task 4: Add table-driven identity tests

Objective: Turn the identity contract into executable routing and normalization coverage.

Likely test target: extend `packages/providers/tests/registry.test.ts` and add an API test only where request-log normalization cannot be tested at package level.

Cover:

- Built-in prefixed models.
- Bare models.
- Account-suffixed provider IDs.
- Custom UUID provider with alias.
- Legacy aliases.
- Intentional double-prefix compatibility.
- Unknown models.
- Request-log provider normalization for an alias/account combination.

Use exact expected values from the contract. Do not “fix” malformed identifiers in tests unless the contract explicitly says they are accepted.

### Task 5: Add usage/accounting fixtures and document the decision

Objective: Make usage extraction and billing semantics testable before changing accounting behavior.

Likely targets:

- Extend the existing API-key credit DB tests.
- Add a focused usage/logging test under `apps/api/tests/`.
- Reuse `packages/translator/src/usage.ts` fixtures where possible.

Cover:

- OpenAI usage shape.
- Anthropic usage shape.
- Cached, cache-creation, and reasoning tokens.
- Usage in a final streaming frame.
- Missing usage.
- Error after partial streamed output.
- Concurrent requests against a credit-limited key, with the expected soft/hard/advisory behavior explicitly encoded.

If hard limits are selected, the test must fail until the DB operation provides atomic reservation or equivalent transactional enforcement. If soft limits are selected, assert the documented overshoot behavior rather than pretending the pre-flight check is atomic.

### Task 6: Add upstream attempt-count instrumentation fixtures

Objective: Count transport retries, registry/provider attempts, and ChatLogic fallback attempts independently without changing policy yet.

Likely targets:

- `packages/executors/tests/retry.test.ts` (create if absent).
- `packages/providers/tests/registry.test.ts`.
- `apps/api/tests/chat-attempt-count.test.ts` (create if absent).

Use counters around fake fetch/provider executors. Assert that telemetry distinguishes:

- transport retry number;
- provider/model fallback number;
- total upstream calls.

Do not silently reduce the current default of three `fetchWithRetry` attempts in this PR.

### PR 1 gate

Run only touched tests and packages. Confirm the new tests describe the current behavior or expose a concrete bug. No broad suite.

---

## PR 2 — Retry policy and request-level attempt accounting

### Task 7: Approve and encode the retry policy

Objective: Convert the product decision into a small typed policy contract.

Likely targets:

- `packages/executors/src/retry.ts`
- `apps/api/src/logic/chat.logic.ts`
- `apps/api/src/logic/images.logic.ts`
- `apps/api/src/services/registry.ts`
- Provider-specific executors only when the shared contract requires it.

Define whether the budget is:

- one total upstream-attempt limit;
- separate transport retry and model fallback limits;
- elapsed-time plus attempt limits;
- or intentionally unbounded, with telemetry and documentation.

Permanent invalid-request/authentication failures must not consume transient retry attempts. Preserve retry hints and existing transient classification unless a test requires a precise change.

### Task 8: Implement the minimum budget propagation

Objective: Ensure one client request carries one explicit attempt context through fallback and retry layers.

Use a typed options/context object rather than positional arguments. Keep the context internal; do not add public API fields. Ensure recursive tool interception either shares or intentionally resets the budget according to the approved policy, and test that choice.

Add telemetry fields or structured log metadata only where the existing logging path can carry them without changing public response envelopes.

### Task 9: Verify retry multiplication and permanent-error behavior

Objective: Prove deterministic attempt bounds and correct non-retry behavior.

Tests must assert:

- total upstream calls for a request with multiple fallback candidates;
- transport retries versus model fallback counts;
- permanent 400/401-style failures do not retry;
- retryable failures stop at the selected request budget;
- final error remains attributable to the correct candidate.

Run targeted executor, provider, and API test files only, then build the touched packages.

---

## PR 3 — Chat fallback lifecycle extraction

### Task 10: Capture non-streaming and streaming behavior before refactoring

Objective: Freeze candidate order, token refresh, fallback trigger gating, logging, tool interception, and error semantics with focused tests.

Likely test targets:

- New/extended `apps/api/tests/chat-fallback.test.ts`.
- Existing streaming tests, if present.

Cover:

- primary success;
- eligible fallback;
- skipped fallback due to trigger rules;
- all-candidates failure;
- fallback metadata and first-error reason;
- token refresh per candidate;
- non-streaming tool interception recursion;
- streaming tool interception and commitment behavior.

### Task 11: Extract a narrow shared attempt lifecycle

Objective: Remove duplicated candidate lifecycle logic without making the runner protocol-aware.

Likely target: `apps/api/src/logic/chat.logic.ts`; create a small adjacent helper only if the callback contract is clearer outside the class.

The shared runner may own candidate iteration, rule gating, token refresh, attempt tracking, fallback path, and error state. It must not know about chunks, tool calls, usage payloads, stream buffering, or DB logging details.

Keep `ProcessStreamingCompletion` and `ProcessNonStreamingCompletion` signatures unchanged. Preserve the distinction that non-streaming commits on response return, while streaming commits only after a client-visible chunk.

### Task 12: Run focused regression tests and compare errors

Objective: Verify behavior preservation and type safety after extraction.

Run the touched API test files, API build, `git diff --check`, and scoped formatting. Compare TypeScript errors with the pre-refactor baseline; do not reclassify unrelated pre-existing errors as regressions.

---

## PR 4 — Image fallback alignment

### Task 13: Add image fallback behavior tests

Objective: Make image behavior independently executable before deciding whether to share code.

Likely target: create `apps/api/tests/images-fallback.test.ts`; reuse `apps/api/tests/images-route.test.ts` only if its boundary is sufficient.

Cover:

- primary success;
- eligible fallback;
- skipped fallback;
- all-candidates failure;
- fallback path and reason semantics matching chat;
- capability validation before provider execution;
- usage/key accounting behavior for image requests.

### Task 14: Choose and implement the smallest alignment approach

Objective: Apply the approved policy without forcing an abstraction that cannot represent image behavior cleanly.

Options:

- Reuse the chat runner only if its callbacks support image attempts without protocol conditionals.
- Otherwise retain a separate image loop and align candidate gating, token refresh, tracking, and logging explicitly.

Do not change image public request/response formats. Verify that model capability validation still happens before any provider call.

### Task 15: Verify image-specific regression coverage

Run the focused API image tests and any touched pricing/executor tests. Build only touched packages/apps.

---

## PR 5 — Startup sequencing and auth facade hardening

### Task 16: Classify startup tasks

Objective: Decide which tasks must complete before `serve()` and which are safe background work.

Likely target: `apps/api/src/index.ts`.

Current sequencing to review:

- PostgreSQL `initDatabase()` is awaited.
- `bootstrapAdminAccountFromEnv()` is fire-and-forget.
- `autostartTunnelIfEnabled()` is fire-and-forget.
- `startProviderRegistry()` is awaited.

For each task, document required-before-serving, optional background, or best-effort semantics. Required tasks must be awaited. Optional tasks must attach explicit rejection handling and must not produce unhandled rejections.

### Task 17: Add PostgreSQL boot sequencing coverage

Objective: Prove that no DB-dependent request or startup operation runs before schema initialization.

Likely target: create `apps/api/tests/boot-sequencing.test.ts` using controlled init/bootstrap/tunnel/provider dependencies if the module structure permits. If direct import makes this impractical, extract only a minimal internal boot orchestration function with dependency parameters.

Cover:

- PostgreSQL schema init completes before provider registry startup.
- Required startup tasks complete before serving.
- Optional failures are handled explicitly.
- SQLite path remains unchanged.

Do not run a live PostgreSQL server unless the repository already provides a scoped fixture; a deterministic orchestration test is preferred.

### Task 18: Replace auth facade assertions with narrowed capabilities

Objective: Remove unsafe contract-boundary assertions from the auth provider facade.

Likely target: `apps/api/src/logic/auth.logic.ts`; inspect `apps/api/src/services/authHandlers.ts` and relevant types in `packages/types`.

Model OAuth-capable and import-capable entries as narrowed types. Guard capability presence before invocation. Preserve legacy named adapters and device-flow behavior.

Acceptance checks:

- No `as Promise<...>` remains in the auth facade.
- OAuth-only, import-only, and device-flow providers retain behavior.
- `id_token`/`idToken` handling follows the existing canonical wire contract and project type rules.

### Task 19: Run auth and startup verification

Run `apps/api/tests/auth-providers.test.ts` plus new focused tests through the API runner. Build `apps/api`. Check the changed auth and boot files for unsafe assertions and unhandled promises.

---

## PR 6 — Documentation cleanup

### Task 20: Synchronize version and workflow documentation

Objective: Remove confirmed documentation drift without documenting unverified results.

Likely targets:

- `README.md`
- `CONTRIBUTING.md`
- `AGENTS.md` only if repository-local instructions themselves need correction
- The reliability specification, if links/status/ownership need updating.

Changes:

- Make the README badge use the project’s actual version source (`0.1.6` currently observed) rather than a stale literal.
- Replace whole-monorepo verification commands in contributor guidance with touched-package commands consistent with `AGENTS.md` and `$HOME/Obsidian/SRouter/RULES.md`.
- Check provider and endpoint lists against current routes and catalog code before editing.
- Do not claim tests/builds passed unless those exact commands were run.

### Task 21: Verify documentation consistency

Run repository-local markdown/format checks only if available and scoped. Use `git diff --check`. Confirm every command in contributor docs is safe under the resource rules and every version/provider/endpoint statement has a current source of truth.

---

## Final verification gate

For each PR:

1. Inspect `git status` and the diff before testing.
2. Run only the focused test files touched by the PR:
   `cd apps/api && pnpm exec tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/<focused-file>.test.ts`
3. Build only touched packages/apps, for example:
   `cd apps/api && pnpm run build`
   `cd packages/providers && pnpm run build`
   `cd packages/executors && pnpm run build`
4. Run `git diff --check`.
5. Run the relevant scoped Prettier check; do not run root formatting that rewrites the entire tree.
6. For any API route behavior change, start the API using the project’s existing local method and smoke-test the mounted `/v1` endpoint with `curl`.
7. Record exact command results in the PR description; never infer success from a plan or from unrelated tests.

## Definition of done

The hardening effort is complete only when every finding F-01 through F-09 has:

- a classification confirmed;
- an explicit user-visible behavior decision;
- a focused regression or contract test;
- an owning PR/task;
- an explicit non-goal;
- scoped verification evidence.

The implementation is not complete merely because the duplicated code was refactored. The attempt budget, stream commitment, identity, usage, startup, auth typing, and documentation contracts must all be executable or explicitly documented as intentionally unchanged.

## Risks and rollback

- Retry budget changes can alter latency, quota usage, and fallback success rates. Roll back policy changes independently from instrumentation.
- Chat runner extraction can corrupt streaming if commitment is marked too early. Keep commitment tests in the same PR and retain protocol-specific stream handling.
- Identity normalization changes can fix logs while breaking routing, or vice versa. Land contract tests before mapping changes.
- Hard credit enforcement may require DB transaction work beyond this batch. If not approved, document soft-limit semantics rather than adding partial locking.
- Awaiting tunnel/admin startup may increase boot time. Keep optional work explicitly non-blocking if product semantics allow it.
- Documentation cleanup must not silently alter current behavior; it should describe observed source and verified commands only.
