# Testing & Verification

## Build

```bash
cd apps/api && pnpm run build
```

## Tests

Prefer targeted execution:

```bash
cd apps/api && pnpm exec tsx --test tests/chat.test.ts
```

Full API app tests:

```bash
cd apps/api && pnpm test
```

Never run monorepo-wide tests.

## Smoke Testing

After route changes:

```bash
curl http://localhost:3000/v1/models
```

Check:

- auth behavior
- response envelope
- SSE framing
- error payload consistency

## Streaming Validation

Streaming endpoints should:

- preserve SSE framing
- stream incrementally
- avoid buffering full responses
- propagate upstream failures correctly

Avoid mixing Anthropic/OpenAI stream chunk formats.
