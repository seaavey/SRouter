# Spec: SRouter Web Dashboard UI Refactoring (Mobbin Design System)

- **Author**: Synthever & Hermes
- **Date**: 2026-09-10
- **Status**: Proposed
- **Target App**: `apps/web` (SRouter React 19 + Vite dashboard)
- **Design Source**: `DESIGN-mobbin.md`

---

## 1. Overview & Purpose

This specification outlines the complete redesign and refactoring of the SRouter Web Dashboard (`apps/web`) adhering strictly to the **Mobbin Design Language** (`DESIGN-mobbin.md`).

The Mobbin interface system is characterized by:
- **Gallery-white monochrome palette**: near-black ink (`#141414`) on pure white canvas (`#ffffff`), with dark mode inverted to near-black canvas (`#141414`) and crisp light ink (`#ffffff`).
- **Shadow-free elevation**: elevation and depth are communicated strictly through a neutral tint ladder (`canvas-soft`, `field`, `hairline`) and 1px hairlines. Box shadows are eliminated.
- **Stadium-pill controls**: all interactive buttons, badges, navigation indicators, segmented toggles, and filters use `rounded-full` (`9999px`).
- **Container geometry**: cards, dialogs, and major containers sit at `24px` (`rounded-3xl` / `rounded-md`), inputs and compact cards at `16px` (`rounded-2xl` / `rounded-sm`), and provider logos use 30% squircles.
- **Typographic hierarchy**: **Inter** variable font for display, headings, subtitles, and body text with distinct weight contrast (650 headings with tight `1.0`-`1.15` leading, 450 body, 300 hero subtitles), paired with **JetBrains Mono** strictly reserved for technical data (API keys, tokens, latency, status codes, routes).
- **Single electric blue accent**: `#0066ff` (dark mode `#3385ff`) reserved exclusively for decisive signals (active connections, popular plans, critical quota thresholds), never used decoratively or for generic primary buttons.

---

## 2. Design Tokens & CSS Architecture

### 2.1 Color Palette & Theme Tokens (`apps/web/src/styles.css`)

All colors are declared via CSS variables in `@theme` and mapped into light/dark roots:

```css
:root {
    /* Canvas & Surfaces */
    --canvas: #ffffff;
    --canvas-soft: #f3f3f3;
    --field: #f0f0f0;

    /* Hairline Outlines */
    --hairline-soft: #f0f0f0;
    --hairline: #e0e0e0;

    /* Typography & Ink */
    --ink: #141414;
    --ink-soft: #262626;
    --text-muted: #707070;
    --text-faint: #adadad;

    /* Decisive Accent */
    --accent: #0066ff;
    --accent-foreground: #ffffff;

    /* Functional Mappings */
    --background: var(--canvas);
    --foreground: var(--ink);
    --card: var(--canvas);
    --card-foreground: var(--ink);
    --popover: var(--canvas);
    --popover-foreground: var(--ink);
    --primary: var(--ink);
    --primary-foreground: #ffffff;
    --secondary: var(--canvas-soft);
    --secondary-foreground: var(--ink);
    --muted: var(--canvas-soft);
    --muted-foreground: var(--text-muted);
    --border: var(--hairline-soft);
    --input: var(--field);
    --ring: var(--ink);
    --radius: 1.5rem; /* 24px */
}

.dark {
    /* Inverted Monochrome Mobbin */
    --canvas: #141414;
    --canvas-soft: #1e1e1e;
    --field: #262626;

    --hairline-soft: #262626;
    --hairline: #333333;

    --ink: #ffffff;
    --ink-soft: #e5e5e5;
    --text-muted: #8a8a8a;
    --text-faint: #5a5a5a;

    --accent: #3385ff;
    --accent-foreground: #ffffff;

    --background: var(--canvas);
    --foreground: var(--ink);
    --card: var(--canvas);
    --card-foreground: var(--ink);
    --popover: var(--canvas);
    --popover-foreground: var(--ink);
    --primary: var(--ink);
    --primary-foreground: #141414;
    --secondary: var(--canvas-soft);
    --secondary-foreground: var(--ink);
    --muted: var(--canvas-soft);
    --muted-foreground: var(--text-muted);
    --border: var(--hairline-soft);
    --input: var(--field);
    --ring: var(--ink);
}
```

### 2.2 Typography Hierarchy

- **Primary Sans**: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
  - Display (80px, weight 650, line-height 1.0)
  - Heading-1 (56px, weight 650, line-height 1.0)
  - Heading-2 (44px, weight 650, line-height 1.13)
  - Heading-3 (32px, weight 650, line-height 1.13)
  - Heading-4 (24px, weight 650, line-height 1.25)
  - Title (20px, weight 600, line-height 1.3)
  - Body-lg / Subtitle (20px, weight 300, line-height 1.38)
  - Body (16px, weight 450, line-height 1.38)
  - Body-sm (14px, weight 450, line-height 1.43)
  - Label / Badge (12px, weight 600, line-height 1.33)
  - Caption (12px, weight 450, line-height 1.33)
- **Code & Telemetry**: `JetBrains Mono, monospace` (applied to keys, token quantities, latency metrics, HTTP status badges, and code blocks).

### 2.3 Geometry & Radii

- `rounded-full` (`9999px`): buttons, badges, nav rows, segmented tabs, search inputs.
- `rounded-3xl` (`24px`): container cards, dialog content, topology canvas card, tables container.
- `rounded-2xl` (`16px`): form fields, compact items, accordions, toast notifications.
- `app-icon-squircle` (`30%` border-radius): provider badges and model provider icons.

---

## 3. Base UI Primitives Specification (`apps/web/src/components/ui/`)

1. **Button (`button.tsx`)**:
   - `variant="default"` (Primary): `bg-ink text-canvas rounded-full px-5 h-10 font-semibold hover:opacity-90 transition-all`.
   - `variant="outline"`: `bg-canvas text-ink border border-hairline rounded-full px-5 h-10 font-semibold hover:bg-canvas-soft transition-all`.
   - `variant="ghost"` / `pill-soft`: `bg-canvas-soft text-ink rounded-full px-4 h-9 font-medium hover:bg-field transition-all`.
   - `size="icon"`: `rounded-full w-10 h-10 flex items-center justify-center`.
   - Complete removal of `shadow-*` and box-shadow classes.

2. **Input (`input.tsx`) & Textarea (`textarea.tsx`)**:
   - Background `bg-field`, borderless (`border-0`), text `text-ink`, placeholder `text-text-faint`, shape `rounded-2xl px-4 py-2.5`.
   - Focus: `focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-0 focus-visible:outline-none`.

3. **Card (`card.tsx`)**:
   - Default: `bg-canvas border border-hairline-soft rounded-3xl p-6 transition-colors`. No shadows.
   - Featured / Muted: `bg-canvas-soft border-0 rounded-3xl p-6`.

4. **Badge (`badge.tsx`)**:
   - `default`: `bg-canvas-soft text-ink rounded-full px-3 py-1 text-xs font-semibold`.
   - `accent`: `bg-accent text-white rounded-full px-3 py-1 text-xs font-semibold`.
   - `outline`: `bg-transparent border border-hairline text-ink rounded-full px-3 py-1 text-xs font-medium`.

5. **Dialog & Modals (`dialog.tsx`)**:
   - Overlay: Scrim `bg-black/60 backdrop-blur-xs` preserving fix `#125` (zero compositor stall).
   - Content: `bg-canvas border border-hairline-soft rounded-3xl p-6 md:p-8 overflow-y-auto max-h-[calc(100dvh-2rem)]`.

6. **Segmented Control / Tabs (`tabs.tsx`)**:
   - List: `bg-canvas-soft rounded-full p-1 border-0 inline-flex items-center`.
   - Trigger: `rounded-full px-4 py-1.5 text-xs font-semibold text-text-muted transition-all data-[state=active]:bg-canvas data-[state=active]:text-ink data-[state=active]:shadow-none`.

---

## 4. App Shell & Layout Architecture (`apps/web/src/components/layout/`)

### 4.1 Sidebar (`AppSidebar.tsx`)
- Container: `bg-canvas border-r border-hairline-soft w-64 h-full flex flex-col p-4`.
- Header: SRouter wordmark in Inter 650 with version indicator pill.
- Navigation Rows (`ex-app-shell-row` pattern):
  - Items are stadium-pill rows (`rounded-full px-4 py-2.5 text-sm font-medium`).
  - Active: `bg-ink text-canvas font-semibold` (or `bg-canvas-soft text-ink font-semibold`).
  - Inactive: `text-text-muted hover:text-ink hover:bg-canvas-soft transition-colors`.
- Footer: Connection status indicator with monochrome dot + latency.

### 4.2 Topbar (`Topbar.tsx`)
- Detached, border-b `border-hairline-soft`, background `bg-canvas/80 backdrop-blur-md`.
- Page title rendered in clean sentence case ending in a period (e.g., `Gateway Overview.`, `Provider Connections.`).
- Quick actions: Search pill (`bg-field rounded-full px-4 py-1.5 text-sm`), theme toggle pill, docs link.

---

## 5. Execution Roadmap: Page-by-Page Migration

In accordance with repository and project governance (*finish one page before next*), work proceeds in bounded sequential phases:

### Phase 1: Foundation (Tokens, Base UI, App Shell)
- Configure `styles.css` with Mobbin tokens, `@theme` font families (Inter + JetBrains Mono), and zero drop-shadow definitions.
- Update UI primitives: `button.tsx`, `input.tsx`, `card.tsx`, `badge.tsx`, `dialog.tsx`, `tabs.tsx`, `table.tsx`.
- Update `AppSidebar.tsx`, `Topbar.tsx`, and `__root.tsx`.
- **Verification Gate**: `pnpm --filter web lint`, `pnpm --filter web build`.

### Phase 2: Dashboard Overview (`/` — `src/routes/index.tsx`)
- Hero section: Greeting and headline in Inter 650 with declarative period.
- 4 KPI Stat Cards: `rounded-3xl` cards on `bg-canvas` with `border-hairline-soft`, prominent numbers, and `text-text-muted` subtext.
- Gateway Topology Map & Recent Requests Feed:
  - Topology canvas wrapped in `rounded-3xl bg-canvas-soft` container.
  - Recent requests feed on `bg-canvas` with status dots, token in/out in JetBrains Mono.
- Model Usage Overview table: `ex-data-table-cell` styling with hairline dividers.
- **Verification Gate**: `pnpm --filter web lint`, `pnpm --filter web build`.

### Phase 3: Provider Management (`/providers` & `/providers/$providerId`)
- Provider Cards: 30% squircle icons, `rounded-3xl` cards, status badges in pill style, primary action pills.
- Add Connection & OAuth Modals: Full Mobbin dialog compliance, maintaining async OAuth callback parsing and un-nested dialog stability.
- Provider Detail View: Model list table, credentials form on `bg-field` inputs, testing drawer.
- **Verification Gate**: `pnpm --filter web lint`, `pnpm --filter web build`.

### Phase 4: API Keys (`/keys`)
- Key Telemetry KPI cards.
- API Key Table: masked secret in `font-mono`, status pills, action dropdowns.
- Create & Edit Dialogs: Form controls with 16px radius, `bg-field`, focused ink ring.
- **Verification Gate**: `pnpm --filter web lint`, `pnpm --filter web build`.

### Phase 5: Quota Tracker & Analytics (`/quota` & `/analytics`)
- Quota: 2-column responsive grid, collapsible cards with `rounded-3xl`, clean progress bars with `#0066ff` accent indicator.
- Analytics: Traffic & latency charts styled with neutral theme-safe curves, clean tooltips, and tab filters as segmented pill controls.
- **Verification Gate**: `pnpm --filter web lint`, `pnpm --filter web build`.

### Phase 6: Pricing, Logs, Combo & Settings (`/pricing`, `/logs`, `/combo`, `/settings`)
- Pricing: Mobbin `pricing-card` and `compare-table` styling.
- Logs: High-density audit viewer with JetBrains Mono, filter pills.
- Combo: Clean visual pipeline connectors.
- Settings: Vertical tab pills, structured card sections with field inputs.
- **Verification Gate**: Full web lint, prettier check, production build.

---

## 6. Anti-Regression & Verification Checklist

1. **No Logic Changes**: Preserve all TanStack Query keys, mutations, cache TTLs, SSE parsers, and API contracts.
2. **Dialog & Modal Stability**: Retain the `#125` fix (high-contrast overlay scrim, no native `autoFocus` collisions, `overflow-y-auto` container).
3. **Accessibility**: All text colors must pass WCAG AA contrast against their respective canvas and field surfaces.
4. **Command Checks**:
   - `pnpm --filter web lint` (0 errors)
   - `pnpm exec prettier --check <touched-files>`
   - `pnpm --filter web build` (successful compilation)
