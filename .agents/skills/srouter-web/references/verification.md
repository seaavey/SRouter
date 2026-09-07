# Verification

## Development

```bash
cd apps/web && pnpm dev
```

Vite default dev server:

- `http://localhost:5173`

## Build Verification

```bash
cd apps/web && pnpm run build
```

Always run targeted build verification after modifying:

- routes
- hooks
- shared components
- type-heavy query logic
- streaming UI

## Lint

```bash
cd apps/web && pnpm run lint
```

## API Integration Checks

When changing API interactions:

1. verify `/v1` endpoint correctness
2. verify query invalidation behavior
3. verify loading/error handling
4. verify auth/session behavior
5. verify optimistic updates

## UI Verification

Before finishing changes:

- verify dark mode
- verify mobile layout
- verify empty states
- verify loading skeletons
- verify toast/error behavior
- verify no layout shift during streams
