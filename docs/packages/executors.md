# `@srouter/executors` (retired)

The Node upstream drivers: one module per provider that speaks the provider's own protocol, plus the
shared SSE and retry plumbing. Version 0.1.8, dependencies `@srouter/constants`, `@srouter/translator`,
`@srouter/types`, 31 files and 5633 lines across `src/` and `tests/`.

Preserved at branch `backup/pre-packages-removal` (commit `3e29aaf`).

## Modules

`base.ts`, `openai.ts`, `anthropic.ts`, `opencode.ts`, `cline.ts`, `codebuddy.ts`, `codex.ts`,
`qoder.ts`, `antigravity.ts`, `atria.ts`, `bai.ts`, `commandcode.ts`, `kiro.ts`, `tokenrouter.ts`,
`retry.ts`, `search.ts`, `sse.ts`, `stream-utils.ts`, `index.ts`.

This was the largest provider surface in the Node build, and it carried drivers for providers the
Rust crate does not implement (`atria`, `bai`, `commandcode`, `kiro`, `tokenrouter`), because the
Node API was the only consumer and it was deleted before the packages were.

## Who imported it

Nobody outside `packages/`. Its only consumer was the Node API (`apps/api`), which imported it
through the provider registry in `packages/providers`. Its own imports ran downwards into
`@srouter/translator`, `@srouter/constants`, and `@srouter/types`.

## Why it is gone

The Rust crate carries its own drivers in `server/src/features/providers/<provider>/`, one per
registered provider, with the wire behavior and constants sourced independently of `packages/*` and
the provenance recorded in each driver's `types.rs`. With the Node API deleted there was nothing
left to execute this code, and the providers it alone supported are not part of the Rust build
(`server/TODO.md` §4 records the registry).

## Replacement

| Used to get | Now |
| --- | --- |
| Provider drivers | `server/src/features/providers/` (8 registered adapters) |
| SSE parsing and stream plumbing | `server/src/features/gateway/` translation and streaming code |
| Retry and connection rotation | `server/src/features/providers/rotation.rs` and the credential-loading executors |

## Recovery

```bash
git show backup/pre-packages-removal:packages/executors/src/qoder.ts
```
