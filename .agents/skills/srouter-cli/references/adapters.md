# Adapters

Current adapters:

- `claude.ts`
- `opencode.ts`

## Rules

Adapters own:

- tool-specific config paths
- env translation
- config serialization
- backup/restore handling

Shared logic belongs in:

```text
src/lib/
```

## Adapter Expectations

Every adapter should:

1. support backup creation
2. support restore flow
3. support dry-run mode
4. isolate filesystem quirks
5. keep shell-safe serialization

## Environment Injection

`env` and `run` flows must stay aligned.

When adding new environment variables:

1. update serializers
2. update tests
3. preserve shell quoting safety

## Safety

Never overwrite user configs without snapshotting first.

Backups belong in:

```text
~/.srouter/backups/
```
