# Testing & Verification

## Build

```bash
cd apps/cli && pnpm run build
```

## Tests

Full CLI tests:

```bash
cd apps/cli && pnpm test
```

Prefer targeted execution:

```bash
cd apps/cli && pnpm exec tsx --test tests/claudeAdapter.test.ts
```

## Regression Coverage

Prioritize tests for:

- adapter linking
- backup restore
- env serialization
- migrations
- filesystem writes

## Validation

Before finishing changes:

1. build CLI
2. run affected tests
3. verify dry-run behavior
4. verify backup creation
5. verify rollback flow
