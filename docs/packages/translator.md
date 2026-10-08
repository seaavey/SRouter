# `@srouter/translator` (retired)

Translation between the OpenAI and Anthropic dialects, plus the usage accounting that both sides
needed. Version 0.1.8, dependencies `@srouter/constants`, `@srouter/pricing`, `@srouter/types`,
12 files and 4645 lines across `src/` and `tests/`.

Preserved at branch `backup/pre-packages-removal` (commit `3e29aaf`).

## Modules

`adapter.ts`, `anthropic.ts`, `antigravity.ts`, `commandcode.ts`, `responses.ts`, `usage.ts`,
`tokenSaver.ts`, `index.ts`.

The package covered both directions (`responses.ts` for the OpenAI response shape, `anthropic.ts`
for the Anthropic one), the provider dialects that needed their own translation (`antigravity.ts`,
`commandcode.ts`), token accounting (`usage.ts`), and the Token Saver prompt rewriting
(`tokenSaver.ts`).

## Who imported it

`packages/executors` only, which is how the Node API reached it. Its own import of `@srouter/pricing`
is the edge that made `pricing` unremovable while `translator` existed.

## Why it is gone

The Rust crate translates in `server/src/features/gateway/translation/`, which is where the gateway
already held the Anthropic and OpenAI request and response types. Token Saver is a planned native
gateway feature (`server/TODO.md`), not a port of the TypeScript module, and the two provider
dialects only the Node build translated (`antigravity`, `commandcode`) are not part of the Rust
driver set.

## Replacement

| Used to get | Now |
| --- | --- |
| OpenAI to Anthropic translation | `server/src/features/gateway/translation/` |
| Usage accounting | `server/src/features/gateway/` usage accumulation and `logs.rs` |
| Token Saver | Planned as a native gateway feature (`server/TODO.md`) |

## Recovery

```bash
git show backup/pre-packages-removal:packages/translator/src/anthropic.ts
```
