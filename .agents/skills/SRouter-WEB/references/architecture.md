# Architecture

## Directory Layout

```text
apps/web/src/
├── routes/
├── components/
├── hooks/
├── lib/
├── styles.css
└── main.tsx
```

## Route Responsibilities

`routes/*` should:

- compose pages
- read route params/search state
- connect hooks to UI
- avoid embedding API orchestration logic

Common routes:

- `playground.tsx` → streaming playground/chat UX
- `providers/*` → provider management + OAuth flows
- `keys.tsx` → virtual key CRUD + spend/throughput metrics
- `combo.tsx` → 3-tier cascade/fallback resilience configurations
- `settings.tsx` → gateway/system configuration & security
- `logs.tsx` → request/audit trace visualization
- `quota.tsx` → rate limit & token budget tracking

## Component Structure & Co-location Law

```text
components/
├── ui/          # Generic headless UI primitives only (button, dialog, input, card, etc.)
├── layout/      # Global shell components (Topbar, AppSidebar)
├── auth/        # Authentication gates and guards
├── combo/       # Combo feature (combo.dialog, combo.form, combo.list, combo.header, etc.)
├── keys/        # Keys feature (keys.dialogs, keys.table, keys.section)
├── playground/  # Chat viewport, message composer, thinking trace, markdown renderer
├── providers/   # ConnectionForm, Catalog, ProviderCard, ConnectOAuthModal
├── dashboard/   # Gateway topology map, model usage overview, network status
├── settings/    # Security, appearance, gateway, and logging settings panels
├── skeletons/   # Loading skeletons per domain
└── tokenSaver/  # Prompt optimizer and tool compression cards
```

Guidelines:

- **Co-location Law**: All components specific to a domain must live together in `components/<feature>/` (e.g. dialogs, tables, forms, and cards for Keys belong in `components/keys/`).
- `components/ui/*` is reserved exclusively for pure, headless/styled building blocks without domain logic.
- Avoid generic category bucket folders (e.g. do NOT create `components/dialogs/` or `components/tables/` that mix multiple unrelated domains).
- Layout components should remain globally reusable.
- Avoid cross-domain imports between unrelated component trees.

## Hooks Strategy

Hooks own:

- query orchestration
- mutations
- invalidation
- optimistic updates
- API response normalization

Prefer:

```ts
useQuery()
useMutation()
queryClient.invalidateQueries()
```

Avoid manual `useEffect + fetch` state machines.

## API Layer

`lib/api.ts` owns:

- base URL normalization
- fetch wrappers
- auth headers
- response normalization
- shared error handling

Components should never manually construct `/v1/...` URLs repeatedly.
