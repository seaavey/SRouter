# SRouter Web Dashboard Mobbin UI Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely refactor the SRouter Web Dashboard (`apps/web`) to adhere to the Mobbin Design Language (`DESIGN-mobbin.md`): gallery-white monochrome palette, zero drop shadows, stadium-pill controls, 24px container geometry, Inter + JetBrains Mono typography, and electric blue accent.

**Architecture:** A staged page-by-page migration starting with design tokens in `styles.css` and base UI primitives, followed by the App Shell (`AppSidebar`, `Topbar`, `__root.tsx`), and then migrating individual pages (Dashboard, Providers, API Keys, Quota & Analytics, and remaining utility pages) in isolation. Zero changes to backend APIs or frontend data-fetching contracts.

**Tech Stack:** React 19, Vite, Tailwind CSS v4, Lucide React, TanStack Router, TanStack Query, Base UI primitives.

**Spec:** `docs/superpowers/specs/2026-09-10-mobbin-ui-refactor-design.md`

## Global Constraints
- Preserve all TanStack Query hooks, query keys, polling intervals, and SSE streaming untouched.
- Retain the #125 fix in dialogs: high-contrast overlay scrim (`bg-black/60 supports-backdrop-filter:backdrop-blur-xs`), no native `autoFocus` collision, `overflow-y-auto` container.
- All interactive buttons, badges, navigation indicators, and segmented controls must use `rounded-full` (stadium-pill).
- Cards and container dialogs must use `rounded-3xl` (24px) with 1px hairline borders and zero box-shadows.
- Headings and body text must use Inter with tight leading and declarative terminal periods; JetBrains Mono is strictly reserved for technical data (keys, telemetry, tokens, latency, routes).
- Electric blue (`#0066ff`, dark `#3385ff`) is reserved exclusively for decisive/commercial signals.
- Finish one page before next: each task must pass `pnpm --filter web lint` and `pnpm --filter web build` with zero errors.

---

### Task 1: Setup Mobbin Design Tokens, Typography & Base CSS

**Files:**
- Modify: `apps/web/index.html`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Google Fonts / system variable stack for Inter and JetBrains Mono.
- Produces: CSS variables `--canvas`, `--canvas-soft`, `--field`, `--hairline`, `--hairline-soft`, `--ink`, `--ink-soft`, `--text-muted`, `--text-faint`, `--accent`.

- [ ] **Step 1: Update `apps/web/index.html` to load Inter variable font**

Link Google Fonts preconnect and Inter variable font (`wght@300..700`) in `head` so Inter is immediately accessible across the dashboard alongside JetBrains Mono.

- [ ] **Step 2: Rewrite `apps/web/src/styles.css` with Mobbin theme variables and zero box-shadows**

Update `@theme` to configure:
- `--font-sans`: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- `--font-mono`: `"JetBrains Mono", monospace`
- Set base body and heading styles to Inter with tight line-heights.
- Configure `:root` with gallery-white palette: `--canvas: #ffffff`, `--canvas-soft: #f3f3f3`, `--field: #f0f0f0`, `--hairline-soft: #f0f0f0`, `--hairline: #e0e0e0`, `--ink: #141414`, `--accent: #0066ff`.
- Configure `.dark` with inverted monochrome palette: `--canvas: #141414`, `--canvas-soft: #1e1e1e`, `--field: #262626`, `--hairline-soft: #262626`, `--hairline: #333333`, `--ink: #ffffff`, `--accent: #3385ff`.
- Strip box-shadow defaults.

- [ ] **Step 3: Run web typecheck and build**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit Task 1**

```bash
git add apps/web/index.html apps/web/src/styles.css
git commit -m "style(web): configure Mobbin design tokens, typography and zero-shadow palette"
```

---

### Task 2: Refactor Core UI Primitives to Stadium-Pill & Zero-Shadow

**Files:**
- Modify: `apps/web/src/components/ui/button.tsx`
- Modify: `apps/web/src/components/ui/input.tsx`
- Modify: `apps/web/src/components/ui/textarea.tsx`
- Modify: `apps/web/src/components/ui/card.tsx`
- Modify: `apps/web/src/components/ui/badge.tsx`
- Modify: `apps/web/src/components/ui/dialog.tsx`
- Modify: `apps/web/src/components/ui/table.tsx`
- Modify: `apps/web/src/components/ui/switch.tsx`

**Interfaces:**
- Consumes: Design tokens from `styles.css`.
- Produces: Standardized Mobbin primitives across all pages.

- [ ] **Step 1: Update `button.tsx`**

Configure `cva` button variants:
- `default`: `bg-primary text-primary-foreground rounded-full px-5 h-10 font-semibold hover:opacity-90 transition-all shadow-none`
- `outline`: `bg-canvas text-ink border border-hairline rounded-full px-5 h-10 font-semibold hover:bg-canvas-soft transition-all shadow-none`
- `secondary` / `pill-soft`: `bg-canvas-soft text-ink rounded-full px-4 h-9 font-medium hover:bg-field transition-all shadow-none`
- `ghost`: `text-ink rounded-full hover:bg-canvas-soft transition-all`
- `icon`: `rounded-full w-10 h-10 p-0 flex items-center justify-center`

- [ ] **Step 2: Update `input.tsx` and `textarea.tsx`**

Set styling to Mobbin field:
- `bg-field text-ink placeholder:text-text-faint border-0 rounded-2xl px-4 py-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-0 focus-visible:outline-none shadow-none`

- [ ] **Step 3: Update `card.tsx`**

Set Card container to `rounded-3xl border border-hairline-soft bg-canvas text-card-foreground shadow-none`.
Ensure Header, Content, and Footer use consistent padding (`p-6`).

- [ ] **Step 4: Update `badge.tsx`**

Set Badge variants:
- `default`: `bg-canvas-soft text-ink rounded-full px-3 py-1 text-xs font-semibold border-0 shadow-none`
- `outline`: `bg-transparent border border-hairline text-ink rounded-full px-3 py-1 text-xs font-medium shadow-none`
- `accent`: `bg-accent text-white rounded-full px-3 py-1 text-xs font-semibold shadow-none`
- `destructive`: `bg-red-500/10 text-red-600 dark:text-red-400 rounded-full px-3 py-1 text-xs font-semibold shadow-none`

- [ ] **Step 5: Verify `dialog.tsx` preserves issue #125 fix with Mobbin geometry**

Ensure `DialogOverlay` maintains `bg-black/60 supports-backdrop-filter:backdrop-blur-xs` and `DialogContent` uses `bg-canvas border border-hairline-soft rounded-3xl p-6 md:p-8 overflow-y-auto max-h-[calc(100dvh-2rem)] shadow-none`.

- [ ] **Step 6: Update `table.tsx` and `switch.tsx`**

- `table.tsx`: `TableHeader` with `bg-canvas-soft text-text-muted text-xs font-mono uppercase tracking-wider`, `TableRow` with `border-b border-hairline-soft hover:bg-canvas-soft/50`.
- `switch.tsx`: Stadium pill track with smooth monochrome thumb.

- [ ] **Step 7: Run web typecheck and build**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: PASS with 0 errors.

- [ ] **Step 8: Commit Task 2**

```bash
git add apps/web/src/components/ui/
git commit -m "refactor(ui): update core primitives to Mobbin stadium-pill and zero-shadow geometry"
```

---

### Task 3: Refactor App Shell & Layout Navigation

**Files:**
- Modify: `apps/web/src/components/layout/AppSidebar.tsx`
- Modify: `apps/web/src/components/layout/Topbar.tsx`
- Modify: `apps/web/src/routes/__root.tsx`

**Interfaces:**
- Consumes: `AppSidebar`, `Topbar`, and primitives from Task 2.
- Produces: Persistent dashboard shell adhering to `ex-app-shell-row`.

- [ ] **Step 1: Refactor `AppSidebar.tsx` to Mobbin `ex-app-shell-row` pattern**

- Set sidebar container to `bg-canvas border-r border-hairline-soft w-64`.
- Header: SRouter wordmark in Inter 650 with declarative period ("SRouter.") and version chip (`rounded-full bg-canvas-soft text-xs font-mono`).
- Nav list: Stadium pill items (`rounded-full px-4 py-2.5 text-sm font-medium transition-colors`).
- Active link: `bg-ink text-canvas font-semibold shadow-none`.
- Inactive link: `text-text-muted hover:text-ink hover:bg-canvas-soft`.
- Footer: Gateway connection dot indicator and status text.

- [ ] **Step 2: Refactor `Topbar.tsx`**

- Container: `bg-canvas/80 backdrop-blur-md border-b border-hairline-soft h-16 px-6 flex items-center justify-between`.
- Title: Dynamic route name in Inter 650 sentence case with period (e.g., "Gateway Overview.").
- Right controls: Search pill (`bg-field text-ink rounded-full px-4 py-1.5 text-sm flex items-center gap-2`), Theme toggle pill button, and GitHub/Docs link pill.

- [ ] **Step 3: Update `__root.tsx` layout wrapping**

Ensure the outer viewport uses `bg-canvas text-ink min-h-screen flex` without conflicting legacy background classes or borders.

- [ ] **Step 4: Run web typecheck and build**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/web/src/components/layout/ apps/web/src/routes/__root.tsx
git commit -m "refactor(layout): reskin AppSidebar and Topbar to Mobbin app-shell pattern"
```

---

### Task 4: Refactor Dashboard Page (`/`)

**Files:**
- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/components/dashboard/dashboard.usage-by-model-table.tsx`
- Modify: `apps/web/src/components/dashboard/dashboard.model-usage-overview.tsx`
- Modify: `apps/web/src/components/dashboard/dashboard.network-status.tsx`
- Modify: `apps/web/src/components/dashboard/dashboard.tunnel-modal.tsx`

**Interfaces:**
- Consumes: Usage stats query and network status API.
- Produces: Polished Mobbin dashboard homepage with zero logic regressions.

- [ ] **Step 1: Refactor Hero & KPI Cards in `src/routes/index.tsx`**

- Headline: "Gateway is active." in Inter 650 with `text-3xl md:text-4xl`.
- 4 KPI Cards: `rounded-3xl border border-hairline-soft bg-canvas p-6`, numbers rendered prominently with tabular figures, metric labels in `text-xs text-text-muted font-medium`.

- [ ] **Step 2: Refactor Gateway Topology & Recent Requests Container**

- Wrap topology map in `rounded-3xl border border-hairline-soft bg-canvas-soft overflow-hidden`.
- Style recent requests card on `bg-canvas rounded-3xl border border-hairline-soft p-6`:
  - Request row: status dot (green 2xx, red 4xx/5xx), model name, prompt/completion tokens in `font-mono`, elapsed time in `text-xs text-text-faint`.

- [ ] **Step 3: Refactor Model Usage Overview & Table**

- Update `dashboard.usage-by-model-table.tsx` to follow `ex-data-table-cell`:
  - Header row in `bg-canvas-soft font-mono text-xs uppercase text-text-muted`.
  - Body cells in `font-sans text-sm text-ink`, numeric counts and costs in `font-mono text-xs`.
  - Dividers: 1px `border-hairline-soft`.

- [ ] **Step 4: Run web typecheck and build**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/web/src/routes/index.tsx apps/web/src/components/dashboard/
git commit -m "feat(dashboard): refactor dashboard overview to Mobbin design system"
```

---

### Task 5: Refactor Provider Management Pages (`/providers` & `/providers/$providerId`)

**Files:**
- Modify: `apps/web/src/routes/providers.tsx`
- Modify: `apps/web/src/routes/providers/index.tsx`
- Modify: `apps/web/src/routes/providers/$providerId.tsx`
- Modify: `apps/web/src/components/providers/ProviderCard.tsx` (or equivalent connection cards)
- Modify: `apps/web/src/components/providers/ConnectOAuthModal.tsx`

**Interfaces:**
- Consumes: Provider hooks and OAuth mutations.
- Produces: Clean provider grid with 30% squircle icons and robust connection modals.

- [ ] **Step 1: Refactor Provider Grid & Cards in `src/routes/providers/index.tsx`**

- Container cards: `rounded-3xl border border-hairline-soft bg-canvas p-6 hover:border-hairline transition-colors`.
- Provider icon: 30% squircle shape (`rounded-[30%] w-12 h-12 flex items-center justify-center bg-canvas-soft`).
- Badges: `rounded-full` pills for provider type and active status.
- Primary CTA: Stadium-pill `button-primary` ("Connect" or "Manage").

- [ ] **Step 2: Verify and style Connection & OAuth Modals**

- Apply Mobbin modal chrome (`rounded-3xl bg-canvas border border-hairline-soft p-6 md:p-8`).
- Maintain isolated primitive dependencies in `useEffect` (preserving fix #125).
- Input fields for API keys / OAuth credentials: `bg-field rounded-2xl border-0 text-ink focus:ring-2 focus:ring-ink`.

- [ ] **Step 3: Refactor Provider Detail View (`$providerId.tsx`)**

- Header lockup with provider squircle icon, provider name, and status badge pill.
- Model list table in `ex-data-table-cell` styling with search input pill.
- Add Model dialog styled as Mobbin modal.

- [ ] **Step 4: Run web typecheck and build**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/web/src/routes/providers/ apps/web/src/components/providers/
git commit -m "feat(providers): refactor provider cards, modals and detail view to Mobbin design"
```

---

### Task 6: Refactor API Keys Page (`/keys`)

**Files:**
- Modify: `apps/web/src/routes/keys.tsx`
- Modify: `apps/web/src/components/keys/keys.table.tsx`
- Modify: `apps/web/src/components/keys/keys.dialog-create.tsx`
- Modify: `apps/web/src/components/keys/keys.dialog-edit.tsx`
- Modify: `apps/web/src/components/keys/keys.modal-secret.tsx`
- Modify: `apps/web/src/components/keys/keys.telemetry-card.tsx`

**Interfaces:**
- Consumes: Keys query and create/edit mutations.
- Produces: Streamlined API Key management with typography contrast.

- [ ] **Step 1: Refactor Keys Telemetry Cards & Action Bar in `keys.tsx`**

- KPI cards: 24px rounded, hairline borders, bold numbers, clear labels.
- "Create API Key" CTA: `button-primary` stadium pill.

- [ ] **Step 2: Refactor API Keys Table (`keys.table.tsx`)**

- Column headers: `font-mono text-xs uppercase text-text-muted bg-canvas-soft`.
- Key name: `font-sans font-medium text-ink`.
- Masked secret / Key prefix: `font-mono text-xs text-text-muted bg-field px-2.5 py-1 rounded-full`.
- Quota / Credit progress indicator: 1px hairline meter with accent electric blue fill.
- Action dropdown buttons: stadium-pill icon trigger.

- [ ] **Step 3: Refactor Key Creation & Edit Dialogs**

- Modal surface: `rounded-3xl bg-canvas border border-hairline-soft p-6 md:p-8`.
- Form inputs: `bg-field rounded-2xl border-0 text-ink focus:ring-2 focus:ring-ink`.
- Form actions: "Cancel" outline pill + "Generate Key" primary ink pill.

- [ ] **Step 4: Run web typecheck and build**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit Task 6**

```bash
git add apps/web/src/routes/keys.tsx apps/web/src/components/keys/
git commit -m "feat(keys): refactor API keys management to Mobbin design system"
```

---

### Task 7: Refactor Quota Tracker & Analytics Pages (`/quota` & `/analytics`)

**Files:**
- Modify: `apps/web/src/routes/quota.tsx`
- Modify: `apps/web/src/routes/analytics.tsx`
- Modify: `apps/web/src/components/analytics/analytics.stat-cards.tsx`
- Modify: `apps/web/src/components/analytics/analytics.traffic-chart.tsx`
- Modify: `apps/web/src/components/analytics/analytics.latency-chart.tsx`
- Modify: `apps/web/src/components/analytics/analytics.top-models-card.tsx`

**Interfaces:**
- Consumes: Quota live query and usage telemetry analytics query.
- Produces: Clean telemetry dashboards with electric blue decisive accents.

- [ ] **Step 1: Refactor Quota Tracker Cards (`src/routes/quota.tsx`)**

- Responsive 2-column grid (`grid-cols-1 lg:grid-cols-2 gap-6`).
- Account cards: `rounded-3xl border border-hairline-soft bg-canvas p-6`.
- Progress bars: monochrome track (`bg-canvas-soft`) with electric blue (`bg-accent`) for available quota.
- Countdown & reset timestamps: `font-mono text-xs text-text-muted`.

- [ ] **Step 2: Refactor Analytics Stat Cards & Timeframe Segmented Control**

- Timeframe filter: Mobbin segmented-control stadium pill (`bg-canvas-soft rounded-full p-1` with `bg-canvas` active pill).
- KPI cards: `rounded-3xl bg-canvas border border-hairline-soft p-6`.

- [ ] **Step 3: Refactor Analytics Charts (`traffic-chart.tsx`, `latency-chart.tsx`)**

- Recharts containers wrapped in `rounded-3xl border border-hairline-soft bg-canvas p-6`.
- Remove dark/glowing gradients; use crisp solid strokes (`#141414` / `#0066ff` / `#707070`).
- Custom tooltip: `bg-canvas border border-hairline-soft rounded-2xl p-3 shadow-none text-xs font-mono`.

- [ ] **Step 4: Run web typecheck and build**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit Task 7**

```bash
git add apps/web/src/routes/quota.tsx apps/web/src/routes/analytics.tsx apps/web/src/components/analytics/
git commit -m "feat(analytics): refactor quota tracker and telemetry charts to Mobbin design"
```

---

### Task 8: Refactor Remaining Pages: Pricing, Logs, Combo & Settings

**Files:**
- Modify: `apps/web/src/routes/pricing.tsx`
- Modify: `apps/web/src/routes/logs.tsx`
- Modify: `apps/web/src/routes/combo.tsx`
- Modify: `apps/web/src/routes/settings.tsx`
- Modify: `apps/web/src/components/settings/*`

**Interfaces:**
- Consumes: Pricing, Logs, Fallback rules, and Settings queries.
- Produces: Complete consistency across all remaining dashboard routes.

- [ ] **Step 1: Refactor Pricing Catalog (`pricing.tsx`)**

- Filter bar: stadium-pill filters (`rounded-full`).
- Pricing table: `compare-table` styling with `rounded-3xl` container, hairline dividers, and pricing values in `font-mono`.

- [ ] **Step 2: Refactor Request Logs (`logs.tsx`)**

- Search & filter bar: `bg-field rounded-full px-4 py-2 text-sm`.
- Log audit rows: high-density table with HTTP status badge pills, model name, token metrics, and latency in `font-mono`.

- [ ] **Step 3: Refactor Combo / Fallback Rules (`combo.tsx`)**

- Rule cards: `rounded-3xl border border-hairline-soft bg-canvas p-6`.
- Routing chain visual: clean directional arrows and model squircle chips.

- [ ] **Step 4: Refactor Settings (`settings.tsx` & subcomponents)**

- Vertical tabs: stadium-pill tab list (`rounded-full px-4 py-2 text-sm`).
- Setting groups: `rounded-3xl border border-hairline-soft bg-canvas p-6`.
- Form inputs: `bg-field rounded-2xl border-0 text-ink`.

- [ ] **Step 5: Run web typecheck and build**

Run: `pnpm --filter web lint && pnpm --filter web build`
Expected: PASS with 0 errors.

- [ ] **Step 6: Commit Task 8**

```bash
git add apps/web/src/routes/pricing.tsx apps/web/src/routes/logs.tsx apps/web/src/routes/combo.tsx apps/web/src/routes/settings.tsx apps/web/src/components/settings/
git commit -m "feat(settings): refactor pricing, logs, combo and settings to Mobbin design"
```

---

### Task 9: Full Production Verification & Prettier Linting

**Files:**
- Repository root / `apps/web`

**Interfaces:**
- Consumes: All updated files from Tasks 1-8.
- Produces: Verified, production-ready dashboard build with zero errors.

- [ ] **Step 1: Run TypeScript typecheck across web**

Run: `pnpm --filter web lint`
Expected: PASS with 0 errors.

- [ ] **Step 2: Run Prettier check across modified files**

Run: `pnpm exec prettier --check "apps/web/src/**/*.{ts,tsx,css,html}"`
Expected: All files properly formatted. If any differ, run `pnpm exec prettier --write "apps/web/src/**/*.{ts,tsx,css,html}"`.

- [ ] **Step 3: Run production build**

Run: `pnpm --filter web build`
Expected: Successful build generating `apps/web/dist`.

- [ ] **Step 4: Verify working tree clean**

Run: `git status`
Expected: Working tree clean, everything committed.
