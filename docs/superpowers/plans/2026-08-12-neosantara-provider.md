# Neosantara Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add Neosantara as a first-class API-key OpenAI-compatible provider with live models, Chat Completions, SSE streaming, and tools.

**Architecture:** Reuse the existing `OpenAIExecutor`. Add catalog metadata and aliasing in `packages/providers`, then add explicit environment and SQLite loader wiring in `apps/api`. Use deterministic fetch mocks for URL, auth-header presence, model routing, JSON chat, SSE, tools, and errors.

**Tech Stack:** TypeScript, pnpm workspace, Node `node:test` with existing `tsx`, Hono registry, OpenAI-compatible JSON/SSE.

## Global constraints

- Provider ID: `neosantara`.
- Default URL: `https://api.neosantara.xyz/v1`.
- Authentication is a runtime Bearer credential; never print, log, commit, or return credentials.
- Scope: Models, Chat Completions, SSE streaming, and OpenAI-compatible tools only.
- Exclude Responses API, Coding Plan, OAuth/JWT, embeddings, media endpoints, and a duplicate executor.
- Failed model discovery returns an empty list; do not fabricate stale fallback models.
- Remove only the first `neosantara/` prefix and preserve all internal model slashes.
- Use pnpm and dependency-order builds. Do not commit generated or unrelated files.

---

### Task 1: Add catalog metadata and alias

**Files:**
- Modify: `packages/providers/src/registry.ts`
- Test: `packages/providers/tests/registry.test.ts`

**Produces:** The alias resolver recognizes `neosantara` and suffixed saved IDs. The catalog entry has ID/name `neosantara`/`Neosantara`, API-key category, OpenAI protocol, official default URL, required-credential flag enabled, custom URL support enabled, disconnected status, and an empty model array.

- [ ] **Step 1: Write failing tests.** Extend the existing registry tests to assert every contract in the Produces paragraph. Also assert that resolving `neosantara_123` returns the `neosantara` alias.
- [ ] **Step 2: Run the red test.** Run `pnpm --filter @srouter/providers test`. Expected: the new assertions fail because the alias and catalog entry are absent.
- [ ] **Step 3: Implement the catalog.** Add the alias and catalog entry described above. Do not add static models.
- [ ] **Step 4: Run the green test.** Run `pnpm --filter @srouter/providers test` and require zero failures.
- [ ] **Step 5: Commit.**

```bash
git add packages/providers/src/registry.ts packages/providers/tests/registry.test.ts
git commit -m "feat(neosantara): add provider catalog metadata"
```

---

### Task 2: Wire environment and saved connections

**Files:**
- Modify: `apps/api/src/services/registry.ts`
- Test: `apps/api/tests/neosantara-provider.test.ts`

**Produces:** An environment-configured Neosantara executor is registered at startup when its configured credential exists. Saved connections with provider ID `neosantara` or a `neosantara`-prefixed connection ID use the saved URL, otherwise the configured override, otherwise the official URL. This branch must precede generic OpenAI fallback handling.

- [ ] **Step 1: Add a deterministic loader test.** Use an in-memory database or existing API fixture, a local-only fixture credential, and mocked `fetch`. Invoke the loader, call `listModels()`, and assert the request URL is `https://api.neosantara.xyz/v1/models` and that the Authorization header starts with `Bearer `. Assert values only in memory; never print the fixture.
- [ ] **Step 2: Run the red test.** Run `pnpm --filter api test`. Expected: the new loader assertion fails before explicit Neosantara wiring exists.
- [ ] **Step 3: Add environment registration.** Register `OpenAIExecutor` with ID `neosantara`, name `Neosantara`, the runtime environment credential, and the configured base URL with official URL fallback.
- [ ] **Step 4: Add the saved-provider branch.** Before generic OpenAI handling, match the provider ID/prefix, construct `OpenAIExecutor` with the saved ID/name/credential, and apply URL precedence: saved URL, configured override, official default.
- [ ] **Step 5: Run loader verification.**

```bash
pnpm --filter api test
pnpm --filter api exec tsc --noEmit
```

- [ ] **Step 6: Commit.**

```bash
git add apps/api/src/services/registry.ts apps/api/tests/neosantara-provider.test.ts
git commit -m "feat(neosantara): wire environment and saved connections"
```

---

### Task 3: Test OpenAI executor behavior

**Files:**
- Test: `packages/executors/tests/neosantara.test.ts`
- Inspect/modify only if required: `packages/executors/src/openai.ts`

**Produces:** Deterministic coverage for URL, Bearer-header presence, model discovery, JSON chat, nested model IDs, SSE, tools, and error propagation.

- [ ] **Step 1: Add mocked fetch tests.** Construct `OpenAIExecutor` with ID `neosantara`, official URL, and an in-memory fixture credential. Restore `globalThis.fetch` in `finally`. Cover:
  1. Model listing calls `/models`, sends a Bearer header, and returns IDs prefixed `neosantara/<upstream-id>`.
  2. Non-streaming chat calls `/chat/completions`, sends `stream: false`, and maps `neosantara/garda-core` to `garda-core`.
  3. `neosantara/provider/model-with-slash` maps to `provider/model-with-slash`, preserving the internal slash.
  4. Streaming sends `stream: true` and parses JSON SSE chunks plus `[DONE]`.
  5. Tool definitions survive request serialization and a streamed tool-call delta is yielded.
  6. Non-2xx responses include status/upstream text but not the fixture credential.
- [ ] **Step 2: Run focused tests.** Run `pnpm --filter @srouter/executors test`. Expected: existing tests pass and any missing behavior is exposed by the new tests.
- [ ] **Step 3: Fix only a demonstrated shared-executor issue.** If nested model IDs fail, replace single-index splitting with first-prefix removal: find the first slash and return everything after it; return the original model when no slash exists. Use it for JSON and streaming requests while preserving existing provider behavior.
- [ ] **Step 4: Run tests/build.**

```bash
pnpm --filter @srouter/executors test
pnpm --filter @srouter/executors build
```

- [ ] **Step 5: Commit.**

```bash
git add packages/executors/src/openai.ts packages/executors/tests/neosantara.test.ts
git commit -m "test(neosantara): verify OpenAI-compatible behavior"
```

If no executor source change is required, stage only the test file.

---

### Task 4: Full verification and final audit

**Files:** Inspect all files changed by Tasks 1–3. Modify only for a concrete verification failure.

- [ ] **Step 1: Install without lockfile churn.** Run `CI=true pnpm install --frozen-lockfile`.
- [ ] **Step 2: Build and typecheck.** Run, in order: `@srouter/types build`, `@srouter/db build`, `@srouter/providers build`, `@srouter/pricing build`, `@srouter/translator build`, `@srouter/executors build`, then `pnpm --filter api exec tsc --noEmit`.
- [ ] **Step 3: Run tests.** Run provider tests, executor tests, and API tests. Require zero failures; keep API tests serial if SQLite requires it.
- [ ] **Step 4: Build web and inspect scope.** Run `pnpm --filter web build`, `git diff --check`, `git status --short`, and `git diff --stat origin/main...HEAD`. No generated cache, credential, report, or unrelated file may be staged.
- [ ] **Step 5: Audit security and markers.** Review the diff for credential field names, runtime environment names, Bearer headers, fixture values, and conflict markers. Real secret values are forbidden.
- [ ] **Step 6: Commit only a concrete correction.** If verification finds a defect, stage only its specific files and use `git commit -m "fix(neosantara): address verification finding"`; do not create an empty commit.

## Completion checklist

- [ ] Catalog and alias pass.
- [ ] Environment and saved-provider loading pass.
- [ ] Models, chat, SSE, tools, nested model IDs, and errors pass with mocks.
- [ ] Full builds, API typecheck, relevant tests, web build, and diff check pass.
- [ ] No credential, generated artifact, or unrelated file is included.
