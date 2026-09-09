# Spec: List Pricing Page (`/pricing`)

## 1. Overview

The SRouter Web Dashboard page at `/pricing` displays the model pricing catalog sourced from `packages/pricing/pricing.jsonc` through `loadModelsDevData()` from `@srouter/pricing`.

Each model may expose:

- Display identity: model ID, name, description, provider, and family.
- Prices: input, output, cache read, cache write, reasoning, input audio, and output audio.
- Limits: context window and maximum output tokens.
- Modalities: text, image, video, audio, and PDF/document input or output.
- Capabilities: reasoning, tool calling, attachments, open weights, and structured output.

Prices are expressed in USD per 1 million tokens (or the equivalent audio unit used by the source dataset). A numeric `0` means the source explicitly marks the price as free. A missing price is unknown and must not be displayed or counted as free.

Models without a `cost` object remain visible in the catalog, but their unavailable prices are rendered as `-` and excluded from free-tier counts and price metrics.

## 2. Technical Decisions & Architecture

- **Source of truth**: `loadModelsDevData()` from `@srouter/pricing` reads `pricing.jsonc`.
- **Backend route**: `GET /v1/pricing/models` is mounted under the Hono `/v1` router and protected by `ApiKeyAuth`.
- **Response contract**: the endpoint returns `{ object: "list", total, updated_at, data }`, with the response validated by the shared pricing Zod schemas.

### Server caching

- `PricingLogic` uses module-level memoization for one hour (`CACHE_TTL_MS = 60 minutes`).
- Within the TTL, requests return the same in-memory response object without reparsing JSONC.
- After the TTL, the next request reloads the dataset automatically.
- `?refresh=true` bypasses the in-memory TTL and reloads immediately.
- The response sets `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`.

### Client caching

- TanStack Query key: `["pricing", "models"]`.
- `staleTime`: `1000 * 60 * 60` (1 hour).
- `gcTime`: `1000 * 60 * 60 * 24` (24 hours).
- `refetchOnWindowFocus`, `refetchOnReconnect`, and `refetchOnMount` are `false`.
- The toolbar Refresh action requests `/v1/pricing/models?refresh=true`, updates the existing pricing query cache, preserves search/filter state, and shows success or failure feedback.

### Frontend UI and styling

- Follow `DESIGN.md`: Developer Terminal / Industrial Clean, JetBrains Mono, semantic theme tokens, dark-mode support, responsive layout, and badge diet.
- Add the page to the Workspace sidebar group with the `Coins` icon.
- Provide loading skeleton, error state with retry, and empty filtered-result state.
- Render the catalog in a horizontally scrollable table on narrow screens.
- Search matches model ID, name, or description.
- Provide separate Provider and Family filters. Provider is derived from the catalog key prefix; Family is derived from the model `family` field. Missing family values are grouped under `Other`.
- Provide modality filters for Text, Image, Video, Audio, and PDF/Document. A model matches when the selected modality exists in either input or output modalities.
- Provide capability filters for Reasoning, Tool Calling, Open Weights, and Free Tier. Free Tier matches only models whose input and output prices are both explicitly numeric zero.

## 3. Modality and Capability Icons

Use `lucide-react` icons:

- Text: `FileText`
- Image: `Image`
- Video: `Video`
- Audio input: `Mic`
- Audio output: `Volume2`
- PDF/document: `FileSpreadsheet`
- Reasoning: `Brain`
- Tool calling: `Wrench`
- Structured output: `Code`
- Open weights: `LockOpen`
- Attachment: `Paperclip`

Each icon is wrapped in `components/ui/tooltip.tsx` using the existing Base UI / Radix tooltip primitive. Tooltips must expose a contextual label and remain usable with keyboard focus.

The table must display input, output, cache read, and reasoning prices when available. Cache write and audio prices may be shown in the model detail presentation if the table needs to remain compact; they must not be silently converted into input or output prices.

## 4. Acceptance Criteria

- `/pricing` is reachable from the Workspace sidebar and renders the catalog.
- `GET /v1/pricing/models` requires the normal API-key authentication behavior and returns a non-empty list when the bundled dataset is present.
- Missing price data renders as `-`; explicit zero prices render as `Free`.
- Metrics exclude models with unknown prices from free-tier and median price calculations. For an even number of known prices, median is the average of the two middle sorted values.
- Refresh reloads server data with `?refresh=true`, updates the current query cache, and does not reset active filters.
- Loading, error, empty-result, dark-mode, keyboard-tooltip, and responsive-table states are covered by the implementation.

## 5. Verification Plan

- API unit test: `cd apps/api && pnpm exec tsx --test tests/pricing-route.test.ts`.
- Frontend build check: `cd apps/web && pnpm run build`.
- API smoke check with a valid key: `curl -H "Authorization: Bearer $SROUTER_API_KEY" http://localhost:3000/v1/pricing/models`.
- If API-key enforcement is disabled for local loopback, the same smoke check may omit the header; record which mode was used.
