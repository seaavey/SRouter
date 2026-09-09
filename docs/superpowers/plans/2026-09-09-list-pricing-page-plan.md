# List Pricing Page Implementation Plan

> **For Hermes:** Implement this plan task-by-task. Do not run whole-monorepo build, lint, or test suites.

**Goal:** Deliver the `/pricing` dashboard page and `/v1/pricing/models` API contract from the pricing-page spec, including correct unknown-price semantics, caching, filtering, metrics, responsive UI, and targeted verification.

**Architecture:** Reuse the existing `@srouter/pricing` dataset and add a thin API route/controller over a cached logic mapper. Expose the typed response through `@srouter/types`, then consume it with a TanStack Query hook and presentation-focused pricing components in `apps/web`.

**Tech Stack:** Hono, Zod, native TypeScript, React 19, TanStack Query, TanStack Router, Tailwind CSS v4, Lucide React, Base UI tooltip, Node test runner, tsx.

---

## Current context

- The feature branch already contains an initial implementation of the page and API.
- The spec was clarified in `docs/superpowers/specs/2026-09-09-list-pricing-page-spec.md`.
- The implementation must be checked against the clarified contract rather than adding speculative abstractions.
- `packages/pricing/pricing.jsonc` contains models without a `cost` object. Missing prices must remain unknown; explicit numeric zero means free.
- The repository requires targeted verification only:
  - `cd apps/api && pnpm exec tsx --test tests/pricing-route.test.ts`
  - `cd apps/web && pnpm run build`
- Keep route and API paths under `/v1`; do not introduce root-level API paths.

## Implementation tasks

### Task 1: Align the shared pricing schema with unknown prices

**Objective:** Allow missing input/output prices in the wire contract without conflating them with zero.

**Files:**
- Modify: `packages/types/src/schemas/pricing.ts`
- Test/update consumers: `apps/api/tests/pricing-route.test.ts`

**Steps:**
1. Change `ModelPricingCostSchema.input` and `.output` to optional numeric fields.
2. Keep optional cache, reasoning, and audio pricing fields numeric when present.
3. Preserve the existing response envelope and exported inferred types.
4. Add assertions proving that a response can contain a model with missing price fields and that explicit zero remains numeric zero.

**Verification:** Run the pricing API test from `apps/api` and confirm the schema/build consumers typecheck.

### Task 2: Map the dataset without inventing prices

**Objective:** Make the API mapper preserve the source dataset semantics.

**Files:**
- Modify: `apps/api/src/logic/pricing.logic.ts`
- Test: `apps/api/tests/pricing-route.test.ts`

**Steps:**
1. Keep `loadModelsDevData()` as the only dataset source.
2. Map provider from the catalog key prefix and preserve model family, metadata, limits, modalities, and capabilities.
3. Map missing `model.cost`, `cost.input`, and `cost.output` as `undefined`; never default them to zero.
4. Keep one-hour module-level memoization, automatic reload after TTL, and immediate reload for `forceRefresh`.
5. Keep deterministic provider/name sorting and the `{ object, total, updated_at, data }` envelope.
6. Add a regression assertion using the bundled dataset: at least one model has unknown pricing, and at least one explicit free model remains zero-priced if present.

**Verification:** Run `cd apps/api && pnpm exec tsx --test tests/pricing-route.test.ts`.

### Task 3: Keep the API route, auth, headers, and refresh behavior aligned

**Objective:** Verify the endpoint contract and server cache controls.

**Files:**
- Review/modify if needed: `apps/api/src/controllers/pricing.controller.ts`
- Review/modify if needed: `apps/api/src/routes/v1/pricing.ts`
- Review: `apps/api/src/index.ts`
- Test: `apps/api/tests/pricing-route.test.ts`

**Steps:**
1. Confirm `GET /v1/pricing/models` is mounted through `PricingRouter`.
2. Keep `ApiKeyAuth` attached to the feature route.
3. Preserve `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.
4. Confirm `refresh=true` and `Cache-Control: no-cache/no-store` bypass the in-memory cache.
5. Add route-level assertions for the cache header and response shape without bypassing the normal router behavior.

**Verification:** Run the targeted API test. If a server is available, smoke test with `curl -H "Authorization: Bearer $SROUTER_API_KEY" http://localhost:3000/v1/pricing/models` and record whether loopback bypass was active.

### Task 4: Normalize the client query contract and manual refresh

**Objective:** Use the exact query key and preserve UI state during refresh.

**Files:**
- Modify: `apps/web/src/hooks/usePricing.ts`
- Modify: `apps/web/src/routes/pricing.tsx`

**Steps:**
1. Use exactly `['pricing', 'models']` as the query key.
2. Keep the one-hour `staleTime`, 24-hour `gcTime`, and all three refetch flags disabled per spec.
3. Fetch the normal endpoint from the hook.
4. Make the toolbar Refresh action request `/v1/pricing/models?refresh=true` directly, write the result into the same query key, and preserve search/provider/family/modality/capability state.
5. Keep success and error toast feedback and disable the button while refreshing.

**Verification:** Run the web build and inspect the generated route typecheck for query-key/type errors.

### Task 5: Implement correct metrics and filter semantics

**Objective:** Make metrics and filters match the clarified acceptance criteria.

**Files:**
- Modify: `apps/web/src/routes/pricing.tsx`
- Optional extraction only if a second consumer exists: keep helpers local otherwise.

**Steps:**
1. Derive separate provider and family option lists.
2. Group missing family values under `Other`.
3. Support modality filters for text, image, video, audio, and PDF/document; match either input or output modality.
4. Keep capability filters for reasoning, tool calling, open weights, and free tier.
5. Define free tier as both input and output explicitly equal to numeric zero.
6. Exclude models with unknown input/output prices from free-tier and median metrics.
7. Calculate median correctly for odd and even counts; for even counts average the two middle sorted values.
8. Keep search matching ID, name, and description.

**Verification:** Run the web build. During review, manually verify unknown-price models show no free classification and the even-count median formula is present.

### Task 6: Complete the pricing table and icon accessibility

**Objective:** Render all required catalog information without misleading fallbacks.

**Files:**
- Modify: `apps/web/src/components/pricing/pricing.table.tsx`
- Modify: `apps/web/src/components/pricing/pricing.icons.tsx`
- Review: `apps/web/src/components/skeletons/skeletons.pricing.tsx`
- Review: `apps/web/src/components/skeletons/index.ts`

**Steps:**
1. Render missing prices as `-` and explicit zero as `Free`.
2. Display input, output, cache-read, and reasoning prices when available. Do not fold cache-write or audio prices into another price.
3. Render context and output limits using defined-value checks so zero is not treated as missing.
4. Keep the table horizontally scrollable on narrow screens.
5. Use the specified Lucide mappings for modalities and capabilities.
6. Ensure tooltip triggers are keyboard-focusable and labels distinguish input from output modalities.
7. Keep loading skeleton, empty result state, and error/retry state consistent with existing dashboard patterns.

**Verification:** Run the web build and manually inspect light/dark, narrow-width, keyboard focus, and empty-result behavior if a local dashboard is available.

### Task 7: Finish route registration and navigation wiring

**Objective:** Make `/pricing` reachable through the dashboard navigation and generated route tree.

**Files:**
- Modify/review: `apps/web/src/routes/pricing.tsx`
- Modify/review: `apps/web/src/components/layout/AppSidebar.tsx`
- Regenerate/update: `apps/web/src/routeTree.gen.ts`

**Steps:**
1. Keep the route file-based at `/pricing` with the existing page title metadata.
2. Keep the `Coins` navigation item in the Workspace group.
3. Ensure the generated route tree contains `/pricing` and matches the route file.
4. Avoid hand-editing generated output if the repository route generator is available; otherwise make the minimal generated change and verify it through the web build.

**Verification:** Run `cd apps/web && pnpm run build` and confirm the build emits the pricing route chunk.

### Task 8: Run targeted verification and prepare the PR update

**Objective:** Prove the implementation satisfies the spec before publishing changes.

**Files:**
- No new files unless a focused regression test needs to be added.

**Steps:**
1. Run `git diff --check`.
2. Run `cd apps/api && pnpm exec tsx --test tests/pricing-route.test.ts`.
3. Run `cd apps/web && pnpm run build`.
4. If the API is running, execute the authenticated pricing smoke check from the spec.
5. Review the final diff for secrets, unrelated edits, generated artifacts, and spec mismatches.
6. Commit only the implementation/test files with a conventional commit message, then push to the existing PR branch after explicit user approval.

**Expected result:** Targeted API tests pass, the web build passes, the working tree contains only intended pricing-page changes, and the PR branch contains the verified implementation.

## Risks and tradeoffs

- The pricing dataset is external/source-generated and may contain incomplete prices. Treating missing data as unknown avoids falsely claiming a free model but requires optional fields throughout the response and UI.
- Server and browser caches have separate lifetimes. `refresh=true` must bypass server memoization while the client must update the existing query key to avoid stale or duplicated cache entries.
- The catalog is large enough for a client-side filtered table, but no pagination or virtualization should be added unless measured performance requires it.
- The spec allows cache-write and audio prices in a detail presentation; do not add a new detail panel unless the existing page needs it. The minimum table should show the explicitly required prices.

## Open questions resolved by this plan

- Unknown price is represented by an omitted optional numeric field and rendered as `-`.
- Explicit numeric zero is the only free-tier signal.
- Provider and Family are separate filters.
- Missing family values use the `Other` option.
- PDF/document is a supported modality filter and uses `FileSpreadsheet`.
- Refresh preserves all local filter/search state and writes into the canonical query key.
