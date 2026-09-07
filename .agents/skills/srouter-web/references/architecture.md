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
- `keys.tsx` → virtual key CRUD + metrics
- `settings.tsx` → gateway/system configuration
- `logs.tsx` → request/audit visualization

## Component Structure

```text
components/
├── ui/
├── layout/
├── playground/
├── providers/
├── dashboard/
└── settings/
```

Guidelines:

- `ui/*` contains reusable primitives
- domain folders contain orchestration-specific UI
- layout components should remain globally reusable
- avoid cross-domain imports between unrelated component trees

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
