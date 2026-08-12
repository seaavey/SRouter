# FreeBuff Native Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the behavior of `trefeon/freebuff-proxy` into a native, pure Node.js/TypeScript FreeBuff provider inside SRouter, with one FreeBuff token per persisted connection and no sidecar proxy.

**Architecture:** `FreebuffExecutor` implements the existing `AIProvider` contract and delegates to a shared `FreebuffCoordinator`. The coordinator owns one connection state machine per enabled token; each connection owns an upstream client, session manager, and agent-run manager. A shared model registry resolves model IDs to FreeBuff agent IDs and refreshes its state without fabricating live results.

**Tech Stack:** TypeScript ESM, Node.js built-ins (`fetch`, `http`, `https`, `AbortController`, `crypto`), `@srouter/types`, `@srouter/translator`, `@srouter/db`, `@srouter/providers`, Hono API, SQLite, `node:test`/existing package test conventions. No uTLS or JA3 spoofing dependency; browser-like headers/User-Agent are best-effort only.

## Global Constraints

- Full native integration; do not run or embed the Go `freebuff-proxy` binary.
- One FreeBuff token maps to one SRouter provider connection.
- Public IDs preserve nested upstream model IDs: `freebuff/deepseek/deepseek-v4-flash` -> upstream `deepseek/deepseek-v4-flash`.
- Upstream chat is forced to streaming; non-stream callers receive an accumulated OpenAI response.
- Never log, dump, return, or include FreeBuff tokens in error messages.
- `listModels()` uses live verified data; failures return no fabricated live list and preserve the previous valid registry state where applicable.
- No `any` or `unknown` in `@srouter/types`, `@srouter/providers`, `@srouter/db`, or `apps/api`.
- Do not use `rejectUnauthorized=false` as a TLS workaround.
- Every background timer uses `.unref()` and has an explicit shutdown path.
- Follow SRouter workspace build order: types -> db -> providers -> translator -> executors -> api.
- Do not commit or push automatically; the repository rule requires explicit user instruction.

---

## File Map

### New files

- `packages/executors/src/freebuff/types.ts` — concrete wire payloads, parsed upstream responses, connection snapshots, leases, and typed configuration.
- `packages/executors/src/freebuff/errors.ts` — typed errors and safe upstream error parsing.
- `packages/executors/src/freebuff/profiles.ts` — rotating User-Agent/browser-like request headers.
- `packages/executors/src/freebuff/convert.ts` — request normalization, schema normalization, SSE sanitization, and completion accumulator.
- `packages/executors/src/freebuff/upstream.ts` — Codebuff HTTP client, envelope injection, compression handling, proxy support, and endpoint calls.
- `packages/executors/src/freebuff/session.ts` — per-token session cache, single-flight refresh, queue polling, invalidation, and end.
- `packages/executors/src/freebuff/runs.ts` — per-token agent-run state, leases, rotation, finish drain, cooldown, and shutdown.
- `packages/executors/src/freebuff/registry.ts` — source fetch, TypeScript constant parsing, model-to-agent map, fallback/degraded state, and refresh timer.
- `packages/executors/src/freebuff/coordinator.ts` — multi-connection round-robin/failover and lifecycle orchestration.
- `packages/executors/src/freebuff/executor.ts` — `AIProvider` facade and model prefix handling.
- `packages/executors/src/freebuff/*.test.ts` — focused unit/mock tests, split by module as implementation stabilizes.

### Modified files

- `packages/executors/src/index.ts` — export `FreebuffExecutor` and public types if needed.
- `packages/executors/package.json` — only add a dependency if Node built-ins cannot cover the wire behavior; default is zero new runtime dependencies.
- `packages/providers/src/registry.ts` — add `freebuff` catalog definition and status/model metadata.
- `apps/api/src/services/registry.ts` — specific `freebuff` executor case before generic OpenAI fallback; share one coordinator across FreeBuff connections.
- `apps/api/src/logic/providers.logic.ts` — validate/add FreeBuff token connections and provider-specific defaults.
- `apps/api/src/controllers/providers.controller.ts` — ensure delete/disable unregisters runtime state before/with DB deletion.
- `apps/api/src/routes/v1/providers.ts` — add only a route if the existing generic provider payload cannot configure a FreeBuff token.
- `apps/api/src/logic/auth.logic.ts` / `apps/api/src/controllers/auth.controller.ts` / `apps/api/src/routes/v1/auth.ts` — add token import only if existing provider configuration route cannot persist/register one FreeBuff token; no OAuth flow.
- `packages/db/src/providers.ts` — modify only if runtime metadata or enabled-update support is missing; update every row mapper and persistence query consistently.
- `packages/types/src/provider.ts` — add a typed provider-specific config field only if existing fields are insufficient; avoid `any`/`unknown`.

---

## Task 1: Define typed FreeBuff domain and error contracts

**Files:**
- Create: `packages/executors/src/freebuff/types.ts`
- Create: `packages/executors/src/freebuff/errors.ts`
- Test: `packages/executors/src/freebuff/errors.test.ts`

**Interfaces:**
- `FreebuffExecutor` and coordinator tasks consume `FreebuffConfig`, `FreebuffConnectionConfig`, `FreebuffModelRegistryState`, `FreebuffLease`, and `FreebuffError` types.
- `parseUpstreamError(status, body, headers): FreebuffError` returns a token-safe typed error.

- [ ] **Step 1: Write failing tests** for 401 auth rejection, 429 reset/retry parsing, banned 403, waiting-room 503, session-invalid, run-invalid, unknown upstream error truncation, and credential redaction.
- [ ] **Step 2: Run the focused test** with the package's existing test command; confirm missing types/functions fail.
- [ ] **Step 3: Implement concrete interfaces and error classes** with `Error.cause`, `unwrap`-equivalent predicates, bounded body text, and no token fields in messages.
- [ ] **Step 4: Run focused tests** and confirm all error cases pass.
- [ ] **Step 5: Verify no `any`/`unknown`** in the new files with a targeted search.

## Task 2: Port pure request/SSE conversion first

**Files:**
- Create: `packages/executors/src/freebuff/convert.ts`
- Create: `packages/executors/src/freebuff/convert.test.ts`
- Read/reference: `/tmp/freebuff-proxy/internal/convert/convert.go`

**Interfaces:**
- `normalizeRequest(req): FreebuffUpstreamChatRequest`.
- `sanitizeSseLine(line): ChatCompletionChunk | null`.
- `createAccumulator(): FreebuffAccumulator`.
- `accumulateChunk(accumulator, chunk): void`.
- `finishAccumulator(accumulator, model): ChatCompletionResponse`.

- [ ] **Step 1: Write failing tests** for allowlisted fields, dropped unknown fields, `developer` role conversion, nested `$ref`/nullable schema normalization, malformed SSE dropping, reasoning preservation, `[DONE]`, tool-call fragment stitching, usage, and finish reason.
- [ ] **Step 2: Run the focused tests** and confirm they fail before implementation.
- [ ] **Step 3: Port the Go behavior** without copying untyped JSON maps; define recursive JSON value/schema types that satisfy SRouter's no-`any`/no-`unknown` rule.
- [ ] **Step 4: Add model prefix helpers** that remove exactly `freebuff/` and retain all remaining slash-separated segments.
- [ ] **Step 5: Run focused tests** and inspect serialized request/chunk fixtures.

## Task 3: Implement upstream HTTP wire client

**Files:**
- Create: `packages/executors/src/freebuff/upstream.ts`
- Create: `packages/executors/src/freebuff/profiles.ts`
- Create: `packages/executors/src/freebuff/upstream.test.ts`
- Read/reference: `/tmp/freebuff-proxy/internal/upstream/client.go`, `internal/stealth/headers.go`, `internal/stealth/profiles.go`

**Interfaces:**
- `FreebuffUpstreamClient` exposes `createSession`, `getSession`, `endSession`, `startRun`, `finishRun`, and `chatCompletions`.
- `buildChatEnvelope(req, options): FreebuffUpstreamChatRequest` is pure and testable.
- `createFreebuffTransport(config): FreebuffTransport` uses standard Node fetch/dispatcher capabilities only.

- [ ] **Step 1: Write mock-server tests** asserting exact endpoint paths, Bearer auth, `x-freebuff-model`, optional instance header, envelope metadata, forced stream, provider deny, stop sentinel, content type, and model nested-ID preservation.
- [ ] **Step 2: Add response-body decompression tests** for gzip/deflate/br only if supported by the selected Node API; otherwise document reliance on Node fetch decompression and test the actual runtime behavior.
- [ ] **Step 3: Implement endpoint methods** with `AbortSignal`, per-call timeout, bounded error reads, status classification, redirect policy, and safe logging.
- [ ] **Step 4: Implement HTTP/SOCKS proxy configuration** using a typed adapter; reject malformed proxy URLs and preserve TLS verification.
- [ ] **Step 5: Implement rotating User-Agent/browser-like headers** with no JA3 claim.
- [ ] **Step 6: Run the mock upstream test** and verify all request captures and response classifications.

## Task 4: Implement per-token session manager

**Files:**
- Create: `packages/executors/src/freebuff/session.ts`
- Create: `packages/executors/src/freebuff/session.test.ts`
- Consume: `FreebuffUpstreamClient`, Task 1 types/errors

**Interfaces:**
- `FreebuffSessionManager.ensureSession(signal): Promise<FreebuffSessionLease>`.
- `invalidate(): void`.
- `end(signal): Promise<void>`.
- `snapshot(): FreebuffSessionSnapshot`.

- [ ] **Step 1: Write failing tests** for active cache reuse, expiry-margin refresh, concurrent single-flight, queued retry timing, ended/superseded recreation, invalidation, disabled sessions, and end cleanup.
- [ ] **Step 2: Implement state machine** with mutex/single-flight promise ownership and bounded refresh iterations.
- [ ] **Step 3: Preserve queue position/depth/retry metadata** for coordinator error selection.
- [ ] **Step 4: Run focused tests plus a race-like concurrent stress test** with many simultaneous ensure calls.

## Task 5: Implement per-token agent-run manager

**Files:**
- Create: `packages/executors/src/freebuff/runs.ts`
- Create: `packages/executors/src/freebuff/runs.test.ts`
- Read/reference: `/tmp/freebuff-proxy/internal/runs/runs.go`

**Interfaces:**
- `acquireRun(agentId, signal): Promise<FreebuffRunLease>`.
- `releaseRun(lease): void`.
- `invalidateRun(agentId): void`.
- `maintain(signal): Promise<void>`.
- `prewarm(agentIds, signal): Promise<void>`.
- `shutdown(signal): Promise<void>`.
- cooldown methods and `snapshot(): FreebuffRunSnapshot`.

- [ ] **Step 1: Write failing tests** for lazy START, concurrent START convergence, inflight accounting, interval rotation, draining FINISH, retry after FINISH failure, auth/rate-limit/ban cooldown, invalidate, prewarm, and shutdown deadline.
- [ ] **Step 2: Implement mutex-protected active/draining maps** without holding locks across upstream calls.
- [ ] **Step 3: Add an unref'd maintain scheduler** only at coordinator level; keep manager methods deterministic for tests.
- [ ] **Step 4: Run focused tests and inspect that no lease remains inflight after release/shutdown.**

## Task 6: Implement live model registry

**Files:**
- Create: `packages/executors/src/freebuff/registry.ts`
- Create: `packages/executors/src/freebuff/registry.test.ts`
- Read/reference: `/tmp/freebuff-proxy/internal/registry/registry.go`, `internal/registry/parse.go`, `internal/registry/testdata/registry-fixture.ts`

**Interfaces:**
- `FreebuffModelRegistry.refresh(signal): Promise<void>`.
- `models(): ModelObject[]`.
- `agentForModel(modelId): string | null`.
- `agentIds(): string[]`.
- `start(signal): void` and `stop(): void`.

- [ ] **Step 1: Write fixture tests** for direct agent maps, free-mode model blocks, constants/aliases, duplicate model precedence, sorting, malformed sources, HTTP failure retention, and empty-result rejection.
- [ ] **Step 2: Port the parser** using concrete token/AST-like types; do not use a permissive regex that silently maps arbitrary strings.
- [ ] **Step 3: Implement parallel source fetch with timeout and atomic state replacement.**
- [ ] **Step 4: Implement fallback/degraded boot state and unref'd refresh timer.**
- [ ] **Step 5: Run fixture and failure-retention tests; verify no fabricated model output after failed refresh.**

## Task 7: Implement multi-connection coordinator

**Files:**
- Create: `packages/executors/src/freebuff/coordinator.ts`
- Create: `packages/executors/src/freebuff/coordinator.test.ts`
- Consume: Tasks 1, 3, 4, 5, and 6

**Interfaces:**
- `FreebuffCoordinator.register(config): void`.
- `unregister(connectionId, signal): Promise<void>`.
- `update(config): Promise<void>`.
- `listModels(): Promise<ModelObject[]>`.
- `chatCompletion(req): Promise<ChatCompletionResponse>`.
- `chatCompletionStream(req): AsyncGenerator<ChatCompletionChunk, void, void>`.
- `start(signal): Promise<void>` and `shutdown(signal): Promise<void>`.
- `snapshot(): FreebuffCoordinatorSnapshot`.

- [ ] **Step 1: Write failing tests** for one/two-token round-robin, disabled connection filtering, auth failover, all-token cooldown, waiting-room best-position selection, retry-once session/run invalidation, and unregister drain.
- [ ] **Step 2: Implement connection registration and lifecycle** with a shared registry and no stale deleted providers.
- [ ] **Step 3: Implement chat lease flow**: resolve model→agent, acquire run/session, call upstream, retry once on invalid state, release lease in `finally`.
- [ ] **Step 4: Map typed FreeBuff errors to SRouter-compatible errors/status metadata** without leaking credentials.
- [ ] **Step 5: Run coordinator tests under concurrent requests** and verify token distribution/failover.

## Task 8: Add the `FreebuffExecutor` facade and exports

**Files:**
- Create: `packages/executors/src/freebuff/executor.ts`
- Modify: `packages/executors/src/index.ts`
- Modify: `packages/executors/package.json` only if required
- Create: `packages/executors/src/freebuff/executor.test.ts`

**Interfaces:**
- `new FreebuffExecutor(options)` implements `AIProvider`.
- `listModels()` delegates to coordinator and returns public `freebuff/<nested-id>` IDs.
- `chatCompletion(req)` and `chatCompletionStream(req)` delegate while preserving request model and stream semantics.
- `updateToken`/`shutdown` are exposed for SRouter lifecycle integration.

- [ ] **Step 1: Write facade tests** for model prefixing, nested model stripping, streaming delegation, non-stream delegation, and token update.
- [ ] **Step 2: Implement the facade and exports.**
- [ ] **Step 3: Build `@srouter/executors` only after translator/types dependencies are available.**
- [ ] **Step 4: Run all executor tests.**

## Task 9: Wire catalog, DB configuration, registry, and runtime deletion

**Files:**
- Modify: `packages/providers/src/registry.ts`
- Modify: `apps/api/src/services/registry.ts`
- Modify: `apps/api/src/logic/providers.logic.ts`
- Modify: `apps/api/src/controllers/providers.controller.ts`
- Modify: `apps/api/src/routes/v1/providers.ts` only if needed
- Modify: `apps/api/src/logic/auth.logic.ts` / auth controller/routes only if generic token import cannot support FreeBuff
- Modify: `packages/db/src/providers.ts` / `packages/types/src/provider.ts` only if a concrete metadata gap is found
- Tests: corresponding `apps/api` and providers/db tests

**Interfaces:**
- Provider ID is `freebuff`; saved connection IDs are unique `freebuff_<timestamp>` or existing explicit IDs.
- `loadSavedProvidersFromDB()` routes FreeBuff before generic OpenAI.
- Add/enable registers the connection with the shared coordinator immediately.
- Delete/disable unregisters and drains runtime state before returning success.

- [ ] **Step 1: Add failing wiring tests** for catalog presence, generic OpenAI non-capture, DB reload, one-token-per-connection persistence, and delete/unregister.
- [ ] **Step 2: Add the catalog definition** without hardcoded live models; use coordinator live models for connected state.
- [ ] **Step 3: Add the specific registry case** before `p.protocol === "openai"`.
- [ ] **Step 4: Extend provider add/config flow** with FreeBuff defaults and token validation, preserving the existing generic provider path.
- [ ] **Step 5: Add runtime unregister/update support** and wire deletion/disable to it; verify deleted providers disappear from `/v1/models` and cannot receive traffic.
- [ ] **Step 6: Run API/provider/db focused tests and targeted type checks.**

## Task 10: Add end-to-end mock smoke coverage and operational docs

**Files:**
- Create: `packages/executors/src/freebuff/smoke-test.mjs` or use the repository's existing test location
- Modify: `README.md` or provider docs only with verified setup instructions
- Tests: API route smoke fixture if existing test harness supports it

- [ ] **Step 1: Start an ephemeral mock Codebuff server** with session, agent-run, models-source, and SSE endpoints; assert captured envelope and lifecycle ordering.
- [ ] **Step 2: Register two FreeBuff connections in an isolated test registry** and exercise `/v1/models`, non-stream chat, stream chat, waiting room, auth failover, delete, and shutdown.
- [ ] **Step 3: Verify model IDs retain nested slashes end-to-end.**
- [ ] **Step 4: Document only behavior actually verified; explicitly note pure-Node TLS limitation and secure token configuration.**
- [ ] **Step 5: Remove temporary smoke artifacts if they are not part of the permanent test suite.**

## Task 11: Full verification and review gate

**Files:**
- No new implementation files; inspect all changed files.

- [ ] **Step 1: Run the required workspace build order:**

```bash
pnpm --filter @srouter/types build
pnpm --filter @srouter/db build
pnpm --filter @srouter/providers build
pnpm --filter @srouter/translator build
pnpm --filter @srouter/executors build
pnpm --filter api exec tsc --noEmit
```

- [ ] **Step 2: Run focused tests for converter, upstream, session, runs, registry, coordinator, facade, DB, and API wiring.**
- [ ] **Step 3: Run `git diff --check` and targeted searches for `any`, `unknown`, credential logging, `rejectUnauthorized: false`, and unref'd timers in changed protected areas.**
- [ ] **Step 4: Inspect `git diff --stat` and `git status --short`; confirm no tokens, dumps, generated `dist`, or unrelated files are included.**
- [ ] **Step 5: Perform a whole-branch review against the approved spec before asking for user review/merge.**

---

## Implementation Notes

- Use `/tmp/freebuff-proxy` as the behavior reference, not as a runtime dependency. Re-check relevant Go tests/fixtures while porting each module.
- Keep the implementation modular, but do not create a new package until executor-local boundaries become a proven dependency problem.
- Preserve existing SRouter provider behavior; the FreeBuff-specific registry case must precede generic protocol fallbacks.
- No real-token live verification belongs in CI. Perform it manually only when Seaavey supplies a token through a secure environment mechanism.
- This plan deliberately leaves commits/pushes to explicit user instruction because `.agents/AGENTS.md` forbids automatic git side effects.

---

## Plan Acceptance

Plan derived from `docs/superpowers/specs/2026-08-12-freebuff-native-design.md`. Implementation has not started in this planning document.
