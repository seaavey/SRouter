# AGENTS.md — Engineering Guide

> **MANDATORY**: For any task in SRouter, always check and follow notes in `$HOME/Obsidian/SRouter` (`RULES.md`, `CODING-STYLE.md`, and `DESIGN.md`). Never run whole-monorepo build, lint, or broad test suites. Only test/build specifically edited packages/files.

How to write, change, and review code in this repository. Applies to every coding task — feature, fix, refactor, or upgrade — by any contributor, human or AI agent. Deeper per-area workflows live in `.agents/skills/` (API, App, CLI).

## Stack

| Area      | Choice                                               |
| --------- | ---------------------------------------------------- |
| Runtime   | Node.js ≥ 22, ESM only                               |
| Monorepo  | pnpm workspaces + Turborepo (`apps/*`, `packages/*`) |
| API       | **Hono 4** on `@hono/node-server`, Zod validation    |
| Dashboard | React 19, TanStack Router + Query, Tailwind v4, Vite |
| CLI       | Commander.js + `@clack/prompts`                      |
| Data      | Native `node:sqlite` (WAL mode), no external DB      |
| Tests     | `node:test` via tsx, run per app                     |

## Architecture law

Dependency flow points one way, never backward:

```
routes/v1 → controllers → logic → services / packages/{db,executors,providers,translator}
```

- **Routes** declare paths, method, validation, and auth — nothing else.
- **Controllers** adapt HTTP ↔ domain calls; no business branching.
- **Logic** owns decisions: cascade/failover, interception, orchestration.
- **Services** own side effects: filesystem, tunnels, schedulers.
- **Packages** are reusable libraries; `apps/*` may import them, packages never import apps.
- New business behavior lands in `logic/`; new IO lands in `services/` or a package. When a layer grows past its job, split by domain (chat, providers, keys…), not by technique.

## Hono practice

- All gateway endpoints mount under `/v1` in `apps/api/src/index.ts`. Root-level API paths do not exist; `/health` and `/v1` discovery are the only exceptions.
- Attach auth guards inside the feature router (`TunnelRouter.use(...)`) so protection travels with the route — mounting `app.use(...)` after the fact invites gaps.
- Reads use `apiKeyAuth`, mutations use `adminAuth`. Loopback bypass only applies when `require_api_key` is off.
- Validate request bodies with Zod (`@hono/zod-validator`) at the route; infer types with `z.infer`, never hand-write mirrored interfaces.
- Raise errors as `HTTPException`; the global `onError` renders the `{ error: { message, type } }` envelope. Stream handlers return SSE through the shared frame utilities in `packages/executors`.
- Shared response headers/middleware stay in `index.ts`; feature routers stay portable.

## Package boundaries

- **db**: every query lives here, fully parameterized (`?` placeholders). Schema changes ship with a migration note in `DB-MIGRATION.md`.
- **translator**: pure functions only — payload/stream mapping between API dialects, no fetch/fs/clock. Pure code is testable code.
- **executors**: one class per provider extending the shared base; register new drivers in `executors/src/index.ts`.
- **constants**: single home for versions (`GLOBAL_VERSION`, `APP_VERSION`, `API_VERSION`, `CLI_VERSION`) and provider catalogs. Import them; a hardcoded version or model string anywhere else is a bug.
- **types**: Zod schemas are the contract; derive TypeScript types from them.

## Frontend practice

- Server state flows through TanStack Query hooks — no manual `useEffect` + `fetch` state machines.
- File-based routes in `apps/web/src/routes/`; pages compose domain components from `components/`.
- The API client (`lib/api.ts`) normalizes the `/v1` base URL; components never build endpoint strings themselves.
- Styling uses the OKLCH theme tokens in `styles.css`; versions come from `@srouter/constants`.

## CLI practice

- Any command that writes tool config snapshots the original into `~/.srouter/backups/` first.
- Interactive prompts go through `@clack/prompts`; flags exist for non-interactive linking.

## YAGNI

Build what the requirement names, nothing ahead of it.

- No speculative options, config flags, or "for later" parameters. A knob exists when something needs to turn it.
- Extract an abstraction at the second concrete consumer, not the first. Two similar blocks may stay duplicated until the shared shape is proven.
- Prefer deleting code over maintaining dead branches. Removing a feature includes removing its schema columns, settings, and tests.
- Reach for stdlib and `workspace:*` packages first; a new npm dependency needs a justification the standard library cannot satisfy.

## Clean code bar

- Names say what things do; a function named `handleX` that also validates, persists, and notifies is misnamed — split it.
- Guard clauses over nested conditionals; streams especially stay flat with early returns per event type.
- Errors are thrown, typed, and handled at one boundary — swallowing an error converts a bug into mystery.
- Async paths propagate failures; floating promises are rejected in review.
- `any` around JSON boundaries is replaced by a Zod schema at the edge, then real types inward.

## Debt control

- A `TODO` must carry a reason and an owner or issue — bare TODOs rot into sediment.
- Behavior fixes come with a regression test in the touched app's suite.
- Refactors preserve public behavior; wire format changes (routes, envelopes, schema) are called out explicitly in the commit body.
- Releases bump `packages/constants/src/version.ts` and affected `package.json` files in one `chore(release)` commit.

## Verification gate (finish work only after these pass)

This server has limited resources — never run whole-monorepo builds or test suites.

1. Typecheck/build only the touched packages: `cd <pkg-or-app> && pnpm run build`
2. Run one test file through its app's tsx runner, e.g. `cd apps/api && pnpm exec tsx --test tests/<name>.test.ts`; a whole-app suite is `pnpm test` inside that app only (`tsx --test`, concurrency 1 for API). Never invoke tests from the repo root — turbo fans out to every package.
3. For API changes, smoke-test the mounted path against a running instance (`curl http://localhost:<port>/v1/...`) before claiming success.
