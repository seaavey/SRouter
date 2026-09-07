# Architecture

## Layering

```text
routes/v1 → controllers → logic → services/packages
```

Rules:

- Routes define endpoints, middleware, and validation.
- Controllers adapt HTTP ↔ domain logic.
- Logic owns orchestration and business decisions.
- Services/packages own side effects.
- `packages/*` never import from `apps/*`.

## Important Paths

```text
apps/api/src/
├── controllers/
├── logic/
├── middleware/
├── routes/v1/
├── services/
└── index.ts
```

Packages:

```text
packages/
├── constants/
├── db/
├── executors/
├── translator/
└── types/
```

## API Lifecycle

Startup sequence:

1. database init/migrations
2. token refresh sweeper
3. registry/model warming
4. tunnel startup

Ports:

- `3000` → API/dashboard
- `1455` → OAuth callbacks

## Hono Patterns

- Mount APIs under `/v1`
- Prefer route-local middleware
- Use `HTTPException`
- Keep response envelope consistent

Example:

```ts
SettingsRouter.patch(
    "/settings",
    RequireAdmin,
    SettingsController.UpdateSettings
);
```
