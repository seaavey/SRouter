# Design Specification: Analytics Page (Traffic & Model Usage)

- **Author**: Seaavey & Hermes
- **Date**: 2026-09-01
- **Status**: Draft — awaiting approval

---

## 1. Overview & Goals

Add a dedicated **Analytics** page to the web dashboard that answers operational questions the current dashboard cannot: _how much traffic is the gateway handling right now, which models are actually being used, and how healthy is the traffic over time_.

### Key Capabilities

1. **Requests-per-second view**: live RPS estimate for the last 60 seconds plus a time-bucketed throughput chart (req/min and req/hour) over a selectable window.
2. **Top models leaderboard**: models ranked by request count within the selected window (share %, tokens, estimated cost).
3. **Traffic health over time**: stacked success/error request buckets and latency trend (avg + p95) per bucket.
4. **Provider split**: request distribution across `provider_id` for the window.
5. **Window selector**: `1h` / `24h` / `7d` / `30d`, default `24h`.

### Charting Library

- **Recharts** (`recharts@^3`, React 19 compatible) is added as the charting library for `apps/web`. It brings tooltips, axes, legends, and responsive containers out of the box, which hand-rolled SVG would otherwise re-implement poorly. This is the one approved new dependency for this feature.

### Non-Goals (YAGNI)

- No per-API-key analytics, no CSV export, no real-time WebSocket push (poll via TanStack Query `refetchInterval` instead).
- No changes to the existing `/v1/logs/stats` endpoint or the home dashboard — analytics is purely additive.

---

## 2. Architecture & Data Flow

```
apps/web/src/routes/analytics.tsx
  → components/analytics/*
  → hooks/useAnalytics.ts
  → lib/api.ts (getAnalytics)
  → GET /v1/logs/analytics?window=24h
      routes/v1/logs.ts → LogsController.GetAnalytics → LogsLogic.getAnalytics()
      → packages/db getAnalyticsDB(window)   (single source for all SQL)
```

Follows the standard layering: routes declare path + auth, controllers adapt HTTP ↔ domain, logic owns decisions, `@srouter/db` owns every query.

### 2.1 Database Layer (`packages/db/src/logs.ts`)

New function `getAnalyticsDB(window: AnalyticsWindow)` running three parameterized queries against the existing `request_logs` table (no schema change, no migration):

```sql
-- A. Time buckets (bucket granularity chosen per window in logic layer)
SELECT
  (created_at / :bucketMs) * :bucketMs AS bucket,
  COUNT(*)                                            AS totalRequests,
  SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS successRequests,
  SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errorRequests,
  AVG(latency_ms)                                     AS avgLatencyMs,
  SUM(total_tokens)                                   AS totalTokens
FROM request_logs
WHERE created_at >= :since
GROUP BY bucket ORDER BY bucket ASC;

-- B. Top models (limit 10)
SELECT model, COUNT(*) AS totalRequests, SUM(total_tokens) AS totalTokens,
       SUM(estimated_cost) AS estCost
FROM request_logs WHERE created_at >= :since
GROUP BY model ORDER BY totalRequests DESC LIMIT 10;

-- C. Provider split
SELECT provider_id AS providerId, COUNT(*) AS totalRequests
FROM request_logs WHERE created_at >= :since
GROUP BY providerId ORDER BY totalRequests DESC;
```

p95 latency: computed in `LogsLogic` from the per-bucket `avgLatencyMs` series plus a single ordered `latency_ms` fetch capped at the window (`PERCENTILE` is not available in `node:sqlite`); keep it simple — one extra query `SELECT latency_ms FROM request_logs WHERE created_at >= :since ORDER BY latency_ms` and index-pick the 95th percentile in JS. Window row counts are small enough (logs table is bounded by `LOG_RETENTION_DAYS` setting).

RPS (last 60s): `SELECT COUNT(*) FROM request_logs WHERE created_at >= :nowMinus60s` → `count / 60`.

### 2.2 Shared Types (`packages/types/src/logs.ts`)

```ts
export type AnalyticsWindow = "1h" | "24h" | "7d" | "30d";

export interface AnalyticsBucket {
    bucketStart: number; // epoch ms, aligned to bucket size
    totalRequests: number;
    successRequests: number;
    errorRequests: number;
    avgLatencyMs: number;
    totalTokens: number;
}

export interface AnalyticsTopModel {
    model: string;
    totalRequests: number;
    totalTokens: number;
    estCost: number;
}

export interface AnalyticsProviderSlice {
    providerId: string;
    totalRequests: number;
}

export interface AnalyticsReport {
    object: "analytics";
    window: AnalyticsWindow;
    bucketSizeMs: number;
    generatedAt: number;
    requestsPerSecond: number; // rolling 60s average
    totalRequests: number;
    errorRate: number; // 0..1 over the window
    p95LatencyMs: number;
    buckets: AnalyticsBucket[];
    topModels: AnalyticsTopModel[];
    providers: AnalyticsProviderSlice[];
}
```

Zod: `AnalyticsQuerySchema = z.object({ window: z.enum(["1h","24h","7d","30d"]).default("24h") })` validated at the route with `@hono/zod-validator`.

### 2.3 API Layer (`apps/api`)

- **Route** (`routes/v1/logs.ts`): `LogsRouter.get("/logs/analytics", ApiKeyAuth, LogsController.GetAnalytics)` — read endpoint, so `apiKeyAuth` per convention.
- **Controller** (`LogsController.GetAnalytics`): parse `window` query via Zod, return `Ok(c, LogsLogic.getAnalytics(window))`.
- **Logic** (`LogsLogic.getAnalytics`): map window → `since` + `bucketSizeMs`:

| window | bucket size | buckets |
| ------ | ----------- | ------- |
| 1h     | 1 min       | 60      |
| 24h    | 1 hour      | 24      |
| 7d     | 6 hours     | 28      |
| 30d    | 1 day       | 30      |

Zero-fill missing buckets in JS so the chart axis is always continuous.

### 2.4 Web Dashboard (`apps/web`)

**Route** — `routes/analytics.tsx` (`createFileRoute("/analytics")`), thin: renders `<AnalyticsPage />`.

**Sidebar** — add `{ to: "/analytics", label: "Analytics", icon: ChartColumn }` to `routingNavItems` in `components/layout/AppSidebar.tsx` (placed before _Quotas & Limits_).

**Hook** — `hooks/useAnalytics.ts`:

```ts
useQuery({
    queryKey: ["analytics", window],
    queryFn: () => Api.getAnalytics(window),
    refetchInterval: window === "1h" ? 10_000 : 60_000
});
```

**API client** — `Api.getAnalytics(window)` in `lib/api.ts` hitting `/v1/logs/analytics`; no endpoint strings in components.

**Components** (`components/analytics/`, co-location law):

| Component                | Content                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AnalyticsHeader.tsx`    | Window selector chips (`1h/24h/7d/30d`) + last-updated label.                                                                                                                                                                  |
| `AnalyticsStatCards.tsx` | 4 KPI cards: RPS (60s), total requests, error rate %, p95 latency. Reuses card primitives from `components/ui`.                                                                                                                |
| `TrafficChart.tsx`       | Recharts `<BarChart>` of buckets inside `<ResponsiveContainer>`; stacked `<Bar>` success (`--primary`) + error (`--destructive`); shared `<Tooltip>` shows bucket time + counts; `<XAxis>` time labels per window granularity. |
| `LatencyChart.tsx`       | Recharts `<AreaChart>` of `avgLatencyMs` per bucket with gradient fill from theme tokens.                                                                                                                                      |
| `TopModelsCard.tsx`      | Ranked list: model name (via `parseModelIdentifier` pattern + `ProviderIcon`), request count, share bar, tokens, cost label.                                                                                                   |
| `ProviderSplitCard.tsx`  | Recharts horizontal `<BarChart layout="vertical">` proportional bars per provider.                                                                                                                                             |

Recharts colors are read from the OKLCH theme tokens in `styles.css` (via CSS variables on the chart series), so dark mode inherits automatically. Loading state uses skeletons from `components/skeletons` convention; empty window (no traffic) renders an explicit "No requests in this window" state.

---

## 3. Wire Format

`GET /v1/logs/analytics?window=24h` → `200`:

```json
{
    "object": "analytics",
    "window": "24h",
    "bucketSizeMs": 3600000,
    "generatedAt": 1756723200000,
    "requestsPerSecond": 0.42,
    "totalRequests": 3612,
    "errorRate": 0.021,
    "p95LatencyMs": 4120,
    "buckets": [
        {
            "bucketStart": 1756720000000,
            "totalRequests": 150,
            "successRequests": 147,
            "errorRequests": 3,
            "avgLatencyMs": 980,
            "totalTokens": 412000
        }
    ],
    "topModels": [
        {
            "model": "openai/gpt-4o-mini",
            "totalRequests": 1200,
            "totalTokens": 980000,
            "estCost": 0.42
        }
    ],
    "providers": [{ "providerId": "openai", "totalRequests": 2100 }]
}
```

Error envelope unchanged (`{ error: { message, type } }` via global `onError`). Invalid `window` → 400 from Zod validator.

---

## 4. Testing & Verification Plan

1. **API tests** (`apps/api/tests/analytics.test.ts`, `node:test` via tsx):
    - Seed `request_logs` rows across two buckets; assert `GET /v1/logs/analytics?window=1h` returns zero-filled buckets, correct `totalRequests`, `errorRate`, and top-model ordering.
    - Assert invalid `window=bad` → 400.
    - Assert route requires auth like sibling `/logs` endpoints.
2. **DB unit check**: `getAnalyticsDB` bucket math on a temp SQLite file.
3. **Build gate** (per AGENTS.md, targeted only): `pnpm run build` in `packages/types`, `apps/api`, `apps/web`.
4. **Smoke test**: run API locally, `curl "http://localhost:<port>/v1/logs/analytics?window=24h"` with API key, then load `/analytics` in the dashboard and confirm charts render with seeded traffic.

---

## 5. Implementation Checklist (for the follow-up PR)

- [ ] `packages/types/src/logs.ts` — analytics interfaces + Zod query schema
- [ ] `packages/db/src/logs.ts` — `getAnalyticsDB(window)`
- [ ] `apps/api` — route + controller + logic wiring
- [ ] `apps/api/tests/analytics.test.ts`
- [ ] `apps/web/package.json` — add `recharts` dependency (`pnpm add recharts` in `apps/web`)
- [ ] `apps/web` — `lib/api.ts` client fn, `hooks/useAnalytics.ts`, `routes/analytics.tsx`, `components/analytics/*` (Recharts), sidebar entry
- [ ] Builds green: types → api → web; smoke curl passes
