# `@srouter/providers` (retired)

The Node provider registry and its coordination layer: the registry that resolved a model id to a
driver, the OAuth and device-flow clients, per-provider quota readers, and the circuit breaker that
parked a connection after repeated failures. Version 0.1.8, dependencies `@srouter/constants`,
`@srouter/types`, 21 files and 3520 lines across `src/` and `tests/`.

Preserved at branch `backup/pre-packages-removal` (commit `3e29aaf`).

## Modules

`registry.ts`, `oauth.ts` and the `oauth/` subtree (`openai.ts`, `cline.ts`, `qoder.ts`,
`codebuddy.ts`, `antigravity.ts`, `claude.ts`), the `quota/` subtree (`base.ts`, `openai-codex.ts`,
`codebuddy.ts`, `antigravity.ts`, `index.ts`), and `circuitBreaker.ts`.

## Who imported it

Nobody outside `packages/`. The Node API used it to resolve models and to drive provider
connections; `executors` supplied the drivers it coordinated.

## Why it is gone

The Rust crate owns provider coordination. `server/src/features/providers/registry.rs` registers the
adapters and resolves ids, the OAuth and device flows live in `server/src/features/provider_auth/`,
quota reads live in `server/src/features/providers/quota.rs`, and connection rotation plus the
`429` cooldown live in `server/src/features/providers/rotation.rs`. With the Node API deleted, the
TypeScript registry had no caller.

## Replacement

| Used to get | Now |
| --- | --- |
| Provider registry and model resolution | `server/src/features/providers/registry.rs` |
| OAuth, device flow, token import | `server/src/features/provider_auth/` |
| Quota reads | `server/src/features/providers/quota.rs` |
| Connection rotation and cooldown | `server/src/features/providers/rotation.rs` |

## Recovery

```bash
git show backup/pre-packages-removal:packages/providers/src/registry.ts
```
