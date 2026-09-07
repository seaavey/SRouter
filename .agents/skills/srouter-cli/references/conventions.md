# Conventions

## Commander Structure

`src/index.ts` should only:

- register commands
- define options
- attach handlers

Keep handlers thin:

```ts
.action(async (opts) => {
    await setupCommand(opts);
});
```

Business logic belongs in `commands/*`.

## Architecture

```text
index.ts
  ↓
commands/*
  ↓
adapters/* + lib/*
```

## TypeScript Rules

- strict typing only
- no `any`
- prefer explicit option interfaces
- PascalCase helpers/types

## UX Rules

Use `@clack/prompts` for:

- select
- confirm
- spinner
- text input

Prefer guided UX over raw stdin.

## YAGNI

- avoid speculative command flags
- avoid premature abstractions
- reuse shared helpers before adding new utilities
