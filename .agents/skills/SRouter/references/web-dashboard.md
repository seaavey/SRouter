# Web Dashboard Reference — apps/web

## Table of Contents
1. [Architecture](#architecture)
2. [Routes & Pages](#routes--pages)
3. [Component Organization](#component-organization)
4. [State Management](#state-management)
5. [API Integration](#api-integration)
6. [Styling System](#styling-system)
7. [Key Features Per Page](#key-features-per-page)
8. [Adding a New Page](#adding-a-new-page)

---

## Architecture

The dashboard is a React 19 SPA built with Vite, TanStack Router, and Tailwind CSS v4.

```
apps/web/src/
├── main.tsx              # App entry point
├── styles.css            # Tailwind v4 @theme tokens (OKLCH colors)
├── routeTree.gen.ts      # Auto-generated route tree (TanStack Router)
├── routes/               # File-based routing
│   ├── __root.tsx         # App shell (Sidebar, Topbar, Auth Gate)
│   ├── index.tsx          # Dashboard
│   ├── playground.tsx     # Chat studio
│   ├── keys.tsx           # API keys management
│   ├── providers.tsx      # Providers layout (outlet)
│   ├── providers/
│   │   ├── index.tsx      # Provider catalog
│   │   └── $providerId.tsx # Provider detail
│   ├── combo.tsx          # Model combo/failover
│   ├── token-saver.tsx    # Token saver settings
│   ├── quota.tsx          # Quotas & limits
│   ├── logs.tsx           # Audit logs
│   └── settings.tsx       # System settings
├── components/            # Domain-organized components
├── hooks/                 # Custom React hooks
├── lib/                   # Utilities (API client, PKCE, utils)
├── context/               # React context (Theme)
└── utils/                 # Helpers (catalog, code snippets, models)
```

### Key Dependencies
- React 19 + `@types/react` ^19.1
- TanStack Router ^1.114 (file-based routing, auto code-splitting)
- TanStack React Query ^5.76 (server state)
- TanStack Table ^8.21 (data tables)
- Base UI React ^1.7 (accessible primitives)
- Tailwind CSS v4 (OKLCH color system)
- Motion ^13 (animations)
- Lucide React (icons)
- JetBrains Mono font
- Sonner (toast notifications)

### Dev Server
Vite dev server runs on port 5173 with proxy:
- `/v1` → `http://localhost:3000`
- `/health` → `http://localhost:3000`

---

## Routes & Pages

| Path | Page | Description |
|------|------|-------------|
| `/` | Dashboard | KPI stats, token usage, network status |
| `/playground` | Playground | Chat studio with streaming & reasoning |
| `/keys` | API Keys | Virtual key management |
| `/providers` | Providers Layout | Outlet container |
| `/providers/` | Provider Catalog | Grid/list view of all providers |
| `/providers/$providerId` | Provider Detail | Keys, OAuth, model catalog |
| `/combo` | Model Combo | Failover chains & resilience |
| `/token-saver` | Token Saver | Prompt compression settings |
| `/quota` | Quotas | Rate limits & usage tracking |
| `/logs` | Audit Logs | Request log inspection |
| `/settings` | Settings | Security, gateway, appearance |

---

## Component Organization

### Layout
- `AppSidebar.tsx` — Machined cockpit sidebar, collapsible, nav groups
- `Topbar.tsx` — Dynamic breadcrumbs, provider name resolution, theme toggle

### Auth
- `AdminAuthGate.tsx` — Password setup, sign-in, loopback detection

### Feature Modules
Each page has its own component directory:
- `dashboard/` — KPI cards, model usage, network status
- `providers/` — Catalog, cards, connection forms, model tables
- `playground/` — Chat viewport, message composer, thinking traces, code export
- `keys/` — Key tables, create/delete dialogs, metrics
- `combo/` — Failover architecture, combo forms, model picker
- `tokenSaver/` — Tool compression, prompt optimizer
- `logs/` — Log table, detail sheet
- `settings/` — Security, gateway, appearance, logging, data, system

### UI Primitives
`components/ui/` — Base UI powered accessible components:
button, card, dialog, sheet, sidebar, table, switch, checkbox, badge, breadcrumb, tooltip, skeleton, sonner, ConnectOAuthModal

### Skeletons
`components/skeletons/` — Loading states for every major page

---

## State Management

### Server State (TanStack Query)
- Global `staleTime: 30_000ms`
- Query invalidation on mutations
- Polling queries for real-time telemetry:
  - `/v1/logs/stats` every 30s
  - `/v1/quota` every 15s

### Client State
- **LocalStorage + hooks**: Playground sessions, favorites, settings
- **URL params**: TanStack Router search params for deep linking
- **React Context**: Theme (dark/light mode)

### Cross-tab sync
- `useFavorites` uses `storage` event + `CustomEvent` for cross-tab favorite model pinning

---

## API Integration

### HTTP Client (`lib/api.ts`)
```typescript
// Typed wrapper around native fetch
api.get<T>(path: string): Promise<T>
api.post<T>(path: string, body: unknown): Promise<T>
api.put<T>(path: string, body: unknown): Promise<T>
api.patch<T>(path: string, body: unknown): Promise<T>
api.delete<T>(path: string): Promise<T>
```

- Credentials: `credentials: "include"` (cookie-based session auth)
- Custom `ApiError` class with structured error messages
- `getGatewayBaseUrl()` auto-detects dev/prod/custom base URL

### SSE Streaming (`hooks/usePlayground.ts`)
- Uses `ReadableStreamDefaultReader` + `TextDecoder`
- Parses OpenAI SSE format (`data: {...}`, `[DONE]`)
- Extracts reasoning deltas (`reasoning_content`, `thought`, `thinking`)
- Token usage metrics (cached tokens, prompt details)

### OAuth PKCE (`lib/pkce.ts`)
- `codeVerifier` + `codeChallenge` (SHA-256 base64url) + `state`
- Popup window auth with `postMessage` listener (`SROUTER_OAUTH_SUCCESS`)
- Polling fallback for closed popups

---

## Styling System

### Tailwind CSS v4 with OKLCH
Colors defined in `styles.css` as `@theme` tokens using OKLCH color space:
- Semantic tokens: `--canvas`, `--field`, `--line`, `--ink`, `--surface`, `--accent`
- Both light and dark theme variants

### Typography
- **Font**: JetBrains Mono (monospace)
- **Character spacing**: `-0.015em`
- **Header tracking**: `0.14em` uppercase
- **Grid pattern**: `bg-grid-pattern`

### Theme Transitions
`useTheme.ts` uses native `document.startViewTransition` API with circular ripple `clipPath` animation from click coordinates.

### Animations
- Shimmer text effects (`animate-shimmer-text`)
- Pop-in transitions
- Dark/light cockpit-styled Sonner toasts

---

## Key Features Per Page

### Dashboard (`/`)
- 4 KPI stat cards: Total Requests, Total Tokens (in/out), Estimated Cost, Models Routed
- Interactive model usage progress bars
- Network status tile with gateway base URL and mesh access info

### Providers (`/providers`)
- Grid/list catalog view with category filters (OAuth, API Key, Free Tier, Custom)
- Provider detail with live connection status
- Multi-key connection manager (multiple API keys + OAuth PKCE)
- Round-robin load balancing toggle
- Model manager: table/grid views, search, favorites, hide/delete with undo

### Playground (`/playground`)
- Multi-session chat with auto-naming, history, create/delete
- Real-time streaming with latency counter & token breakdown
- Reasoning/thinking trace disclosure
- AI-generated follow-up prompt chips
- Multi-language code export (cURL, TypeScript, Python, Fetch)
- Parameter drawer (system prompt, temperature, max tokens, reasoning effort)

### API Keys (`/keys`)
- Virtual key creation with rate limits (RPM) and quota limits
- One-time secret disclosure modal
- Revocation/deletion confirmation
- Key telemetry metrics

### Model Combo (`/combo`)
- 3-tier resilience architecture visualization
- Multi-tier failover cascades
- Trigger status code configuration
- Preset templates + drag-and-drop priority

### Quotas (`/quota`)
- Real-time rate limit progress bars with status indicators
- Reset countdown timers
- Per-provider model usage telemetry

### Audit Logs (`/logs`)
- Last 100 requests with real-time stream
- Quick filters by ID/Model/Provider and status
- Slide-out detail sheet (headers, params, response, latency)

### Token Saver (`/token-saver`)
- Tool compression: Git, Grep, Tree, Logs, ANSI strip
- Prompt optimizer: Lazy Senior Dev mode + Caveman mode
- Live system prompt preview with token savings estimate

### Settings (`/settings`)
- Security: API key enforcement toggle
- Gateway: timeout, retries, token refresh lead
- Appearance: theme, density
- Logging: level, retention
- Data: backup/export JSON, import, storage diagnostics
- System: GitHub version checker, diagnostics

---

## Adding a New Page

1. Create route file in `apps/web/src/routes/<page-name>.tsx`
2. TanStack Router auto-generates the route tree
3. Add navigation entry in `components/layout/AppSidebar.tsx`
4. Create page-specific components in `components/<page-name>/`
5. Create data hooks in `hooks/use<PageName>.ts` using TanStack Query
6. Add skeleton loader in `components/skeletons/<PageName>Skeleton.tsx`
7. Update breadcrumb mapping in `components/layout/Topbar.tsx`
