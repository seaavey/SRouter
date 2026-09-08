# SRouter reliability gaps and hardening specification

- **Author**: Seaavey & Hermes
- **Date**: 2026-09-08
- **Status**: Proposed

---

## 1. Purpose

This specification records the reliability gaps found during the SRouter codebase review. It is a planning document, not an implementation PR.

The aim is to make the risks concrete enough to prioritize follow-up work. Each finding is classified as one of:

- **Confirmed gap**: visible in the current source or repository state.
- **Behavior risk**: the design can produce incorrect behavior, but needs a focused regression test to prove the case.
- **Documentation drift**: the repository documentation describes behavior that no longer matches the current project state.

The first implementation PR should address one finding at a time or one tightly related group. Do not combine retry policy changes, database changes, and dashboard work in one PR.

## 2. Scope

In scope:

- Chat and image fallback behavior.
- Retry layering and upstream attempt count.
- Streaming failure semantics.
- Model and provider identity handling.
- Database startup ordering.
- Usage and cost accounting.
- OAuth provider facade typing.
- Targeted tests and operational documentation.

Out of scope for the first hardening batch:

- Adding new providers.
- Changing public API wire formats.
- Replacing Hono, SQLite, PostgreSQL, or TanStack Query.
- Redesigning the dashboard.
- Adding a global queue or distributed rate limiter.
- Changing fallback behavior without a regression test and explicit acceptance criteria.

## 3. Executive summary

SRouter has a solid provider abstraction and a useful gateway pipeline, but reliability is now limited by complexity at a few central points:

1. Retry and fallback can multiply upstream calls without a request-level budget.
2. Chat and image fallback loops duplicate lifecycle logic.
3. Streaming and non-streaming paths have different commitment rules that are easy to break.
4. Provider/model identity is transformed in several layers and needs a formal contract.
5. PostgreSQL startup is guarded in `boot()`, but some startup operations are intentionally fire-and-forget.
6. Authentication facade methods still rely on type assertions.
7. README and contributor instructions have already drifted from current version and local verification rules.

The highest-value first work is not a broad refactor. It is a small set of regression tests that make these invariants executable.

## 4. Findings ledger

### F-01: Retry multiplication has no request-level budget

- **Classification**: Confirmed gap and behavior risk
- **Severity**: High
- **Locations**:
    - `apps/api/src/logic/chat.logic.ts`
    - `apps/api/src/logic/images.logic.ts`
    - `apps/api/src/services/registry.ts`
    - `packages/executors/src/retry.ts`
    - provider-specific executors

#### Current behavior

A request can pass through several retry layers:

```text
ChatLogic fallback candidates
  → ProviderRegistry candidate retry
    → executor fetchWithRetry
      → provider-specific model or credit fallback
```

`fetchWithRetry` defaults to three upstream attempts. Chat and image logic can then move to another candidate after the executor fails. The registry may also try another registered provider for the same model family.

#### Risk

One client request can generate many upstream requests before returning an error. This can increase latency, consume provider quota, amplify rate limits, and make the final error difficult to attribute to the original attempt.

#### Required decision

Define whether the product wants:

- a maximum upstream attempt count per client request;
- separate budgets for transport retry and model fallback;
- a maximum elapsed time;
- or explicit no-budget behavior with improved telemetry.

Do not implement a budget by silently changing retry counts. The policy must be documented and tested.

#### Acceptance criteria

- A test can count every executor/upstream attempt for one request.
- The chosen policy has a deterministic upper bound or an explicit documented exception.
- Permanent errors such as invalid request or invalid credentials do not consume transient retry attempts.
- Logs expose enough information to distinguish fallback attempts from transport retries.

### F-02: Chat fallback lifecycle is duplicated

- **Classification**: Confirmed gap
- **Severity**: Medium to High
- **Location**: `apps/api/src/logic/chat.logic.ts`

#### Current behavior

The non-streaming and streaming methods each implement candidate iteration, token refresh, rule gating, fallback metadata, error tracking, and final failure handling.

The duplication is not only cosmetic. The two paths have already diverged in important ways:

- non-streaming commits a candidate after a response returns;
- streaming commits a candidate only after the first chunk is yielded;
- non-streaming logs completion through an awaited path;
- streaming calls completion logging without awaiting it.

#### Risk

A future fix can update one path and miss the other. Fallback metadata, error status, and token usage can then differ by `stream` mode.

#### Required approach

Extract only the common attempt lifecycle after regression tests exist. Keep protocol-specific response processing in `ChatLogic`.

A shared runner must not know about tool calls, chunks, usage payloads, or database logging.

#### Acceptance criteria

- Existing public method signatures remain unchanged.
- Candidate order and fallback trigger behavior remain unchanged.
- Streaming fallback remains possible before the first externally visible chunk only.
- Tool interception behavior remains unchanged.
- Targeted streaming and non-streaming tests pass.

### F-03: Streaming output commitment is a hard invariant

- **Classification**: Behavior risk
- **Severity**: High
- **Location**: `apps/api/src/logic/chat.logic.ts`

#### Current behavior

The streaming path may switch to a fallback only while `yieldedAny` is false. Once the first chunk has been yielded, an upstream error is terminal.

Tool-call chunks can be buffered, which means an upstream stream may have produced data internally without sending it to the client yet. The implementation must distinguish internal buffering from external commitment.

#### Risk

If a refactor marks a candidate successful when an iterator is created, or when an internal chunk is buffered, SRouter can either:

- fail to fallback when it is still safe; or
- switch after output was already sent and produce a corrupted mixed response.

#### Acceptance criteria

Tests cover all three states:

1. Iterator creation fails: fallback is allowed.
2. Stream fails before any client-visible chunk: fallback is allowed.
3. Stream fails after a client-visible chunk: fallback is forbidden and the original error is terminal.

The test must include a tool-call buffering case so internal buffering is not confused with client-visible output.

### F-04: Image fallback duplicates chat fallback policy

- **Classification**: Confirmed gap
- **Severity**: Medium
- **Location**: `apps/api/src/logic/images.logic.ts`

#### Current behavior

Image generation has a separate `ResolveCandidates` implementation and its own fallback state, token refresh, trigger checks, and logging path.

#### Risk

A fallback policy fix applied to chat can remain absent from image generation. Candidate deduplication, trigger matching, fallback path formatting, and terminal error logging can diverge between modalities.

#### Required decision

After the chat lifecycle is stabilized, decide whether the generic runner should support image attempts or whether image fallback should remain a separate explicit path. Do not force both into one abstraction before the callback contract is clear.

#### Acceptance criteria

Regardless of the decision:

- image tests cover primary success, eligible fallback, skipped fallback, and all-candidates failure;
- fallback metadata has the same documented semantics as chat;
- model capability validation remains before provider execution.

### F-05: Model and provider identity transformations need a formal contract

- **Classification**: Confirmed gap
- **Severity**: High
- **Locations**:
    - `packages/providers/src/registry.ts`
    - `apps/api/src/logic/chat.logic.ts`
    - `apps/api/src/logic/images.logic.ts`
    - `apps/api/src/logic/models.logic.ts`
    - `apps/api/src/services/tokenRefresh.ts`
    - `packages/db` request log mapping

#### Current behavior

The system uses several related identities:

- external model ID such as `alias/model-name`;
- bare provider model name;
- account-specific provider ID;
- canonical provider base ID;
- legacy aliases;
- custom model IDs;
- seed provider rows.

The chat path derives a provider ID from the prefix of the current model, while request logging separately normalizes provider identity.

#### Risk

A model can route correctly while being logged under the wrong provider, or a fallback can lose its prefix. Multi-account providers and custom models make these failures difficult to detect from the UI.

#### Required deliverable

Write a model identity contract before changing the mapping code. It must define:

- which form is accepted at every public route;
- which form the registry expects;
- which form executors receive;
- which form token refresh receives;
- which form request logs store;
- how account IDs collapse to base provider IDs;
- how custom models and legacy aliases behave.

#### Acceptance criteria

A table-driven test covers:

- built-in prefixed models;
- bare models;
- account-suffixed provider IDs;
- custom models;
- legacy aliases;
- double-prefix input where compatibility is intentional;
- unknown models.

### F-06: PostgreSQL startup sequencing is only partially awaited

- **Classification**: Confirmed gap
- **Severity**: High for PostgreSQL deployments
- **Location**: `apps/api/src/index.ts`

#### Current behavior

`boot()` awaits PostgreSQL database initialization before starting the provider registry. It then launches admin bootstrap and tunnel autostart with `void` instead of awaiting them:

```text
await initDatabase()
void bootstrapAdminAccountFromEnv(...)
void autostartTunnelIfEnabled()
await startProviderRegistry()
serve(...)
```

#### Risk

The server can begin serving requests while admin bootstrap or tunnel restoration is still running. Failures can become unhandled or appear only in logs. The state visible immediately after startup may depend on timing.

This is less severe than querying before schema initialization, which is already guarded, but it still makes startup state nondeterministic.

#### Required decision

Classify each startup task as one of:

- required before serving and therefore awaited;
- optional background work with explicit error handling;
- best-effort work that must not block startup.

#### Acceptance criteria

- PostgreSQL boot test proves no request reaches a DB-dependent route before schema init.
- Required startup tasks are awaited.
- Optional tasks attach explicit error handling and do not create unhandled rejections.
- SQLite startup behavior remains unchanged.

### F-07: Usage and cost accounting needs a concurrency contract

- **Classification**: Behavior risk
- **Severity**: High for quota and credit enforcement
- **Locations**:
    - `apps/api/src/logic/chat.logic.ts`
    - `packages/db/src/apiKeys.ts`
    - `packages/translator/src/usage.ts`
    - `packages/pricing`

#### Current behavior

Successful completions extract usage, estimate cost, log the request, and increment virtual API key usage. The request path can be streaming or non-streaming, and provider usage payloads differ.

#### Risk

Concurrent requests using the same key can pass the pre-flight balance check before either request writes usage. The final balance can exceed the configured credit limit. This may be acceptable for soft limits, but it must be an explicit product decision.

There is also a consistency question when a provider returns no usage data, returns usage only in a final stream frame, or fails after partial output.

#### Required decision

Define whether credit limits are:

- soft limits, enforced between requests;
- hard limits requiring an atomic reservation or transaction;
- or advisory telemetry only.

Define how missing usage is recorded and whether a streamed response that errors after output is billable.

#### Acceptance criteria

Tests cover:

- OpenAI usage shape;
- Anthropic usage shape;
- cached and reasoning token fields;
- stream usage in the final frame;
- missing usage;
- concurrent requests against a credit-limited key;
- error after partial streamed output.

### F-08: Auth provider facade still uses unsafe assertions

- **Classification**: Confirmed gap
- **Severity**: Medium
- **Location**: `apps/api/src/logic/auth.logic.ts`

#### Current behavior

The provider entry facade uses assertions such as:

```typescript
entry.initiate(params) as Promise<OAuthLoginResult>;
entry.importToken(params) as Promise<ProviderConfig>;
```

The project type-safety rules prohibit this style at contract boundaries.

#### Risk

The registry can return an entry whose capability does not match the requested operation, and the assertion hides that mismatch from TypeScript.

#### Required approach

Model OAuth-capable and import-capable entries as narrowed types. Check capability presence before calling. Keep legacy named adapters working.

#### Acceptance criteria

- No `as Promise<...>` assertions remain in the auth provider facade.
- OAuth-only, import-only, and device-flow providers retain their current behavior.
- Existing auth tests pass.

### F-09: Documentation has version and workflow drift

- **Classification**: Confirmed documentation drift
- **Severity**: Medium
- **Locations**:
    - `README.md`
    - `CONTRIBUTING.md`
    - `package.json`
    - `AGENTS.md`
    - `$HOME/Obsidian/SRouter/RULES.md`

#### Current behavior

The root package is version `0.1.6`, while the README badge still shows `v0.1.4`. Contributor instructions recommend whole-monorepo tests and builds, while repository engineering rules explicitly prohibit those commands because of resource limits.

#### Risk

Contributors receive conflicting instructions and can run expensive or unsafe commands. The README version badge also misrepresents the checked-out release state.

#### Acceptance criteria

- README badge matches the source of truth used by the project.
- Contributor verification commands are scoped to touched packages.
- Documentation does not claim a check passed unless the check was actually run.
- Provider and endpoint lists are checked against the current route and catalog implementation.

## 5. Prioritization

### P0: protect request correctness

1. F-03 streaming commitment tests.
2. F-05 model/provider identity contract and tests.
3. F-07 usage and credit concurrency decision.
4. F-01 retry attempt counting and policy decision.

### P1: reduce divergence

5. F-02 shared chat fallback lifecycle.
6. F-04 image fallback alignment.
7. F-06 startup task classification and PostgreSQL boot test.

### P2: maintenance

8. F-08 auth facade type cleanup.
9. F-09 documentation cleanup.

## 6. Proposed PR sequence

### PR 1: tests and contracts only

Add the model identity table, streaming commitment tests, upstream attempt-count instrumentation, and usage accounting fixtures. No runtime behavior change unless a test exposes an unambiguous bug.

### PR 2: retry policy

Implement the explicitly approved retry budget or document the chosen bounded behavior. Add telemetry for transport retry versus model fallback.

### PR 3: chat fallback lifecycle

Extract the duplicated chat attempt lifecycle while preserving streaming commitment rules and public signatures.

### PR 4: image fallback alignment

Reuse the approved lifecycle where it fits, or document why image generation keeps a separate path. Add modality-specific tests.

### PR 5: startup and auth hardening

Await required startup tasks, handle optional startup failures, and replace auth facade assertions with narrowed entry types.

### PR 6: documentation cleanup

Synchronize README and contributor verification commands with the actual repository rules.

Each PR should remain independently reviewable and revertible.

## 7. Verification gate

The work must follow the repository resource rules:

- Do not run root `pnpm test`, root `pnpm build`, root `pnpm lint`, or broad Turbo tasks.
- Build only touched packages.
- Run only the touched API test files through the API `tsx` runner.
- For API route behavior changes, smoke-test the mounted `/v1` route against a running instance.
- Compare TypeScript error sets when refactoring existing code. Pre-existing errors do not become regressions merely because the total count is nonzero.
- Run `git diff --check` and the relevant Prettier check before opening a PR.

## 8. Definition of done for this specification

This specification is complete when the team can answer, for every finding:

1. Is it a confirmed bug, a behavior risk, or documentation drift?
2. What exact behavior should users observe after the fix?
3. What test proves the behavior?
4. Which PR owns the change?
5. What is explicitly not being changed?

No implementation should begin from this document without selecting a finding and converting its acceptance criteria into a focused implementation plan.
