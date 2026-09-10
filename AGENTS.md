# SRouter Agent Guide

## Before Editing

- Read `$HOME/Obsidian/SRouter/RULES.md`, `CODING-STYLE.md`, and `DESIGN.md`; these are repository-specific instructions for verification, TypeScript/API conventions, and dashboard UI work.
- This is a pnpm workspace (`apps/*`, `packages/*`) orchestrated by Turborepo. Use Node.js 22+ and the pinned pnpm version from the root `package.json`.
- Do not run root `pnpm build`, `pnpm test`, or broad lint commands on the development machine. Resource limits require focused commands for touched apps/packages; CI is the exception and intentionally runs the root build/test.

## Commands

```bash
pnpm install
pnpm dev                                      # API :3000, web :5173, OAuth :1455
pnpm --filter <app-or-package> build
pnpm --filter web lint                        # web TypeScript check
pnpm exec prettier --check <changed-files>
git diff --check
```

- Run one test file with its package's configured setup loader, not from the repository root:
  `cd apps/api && pnpm exec tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/<file>.test.ts`
  `cd apps/cli && pnpm exec tsx --test --import ./tests/setup.ts tests/<file>.test.ts`
  For packages with tests, run `cd packages/<name> && pnpm exec tsx --test tests/<file>.test.ts`.
- API and CLI test setup redirect `DATABASE_PATH` to an isolated temporary database and remove `DATABASE_URL`; use those setup imports for database-touching tests to avoid the production database.
- For API changes, smoke-test the mounted route against a running instance, for example `curl http://localhost:3000/health` or the relevant `/v1/...` path.

## Boundaries

- `apps/api` is the Hono gateway. `src/routes/v1` declares routes, validation, and auth; `controllers` adapt HTTP to domain calls; `logic` owns business decisions; `services` own side effects. Keep those responsibilities separate.
- API routes mount under `/v1`; `/health` and `/v1` are the only root-level exceptions. Route-local auth guards must stay inside the feature router.
- `apps/web` is the React 19/Vite dashboard. File-based routes live in `src/routes`; use the centralized `src/lib/api.ts` client and TanStack Query for server state. Do not hand-edit `src/routeTree.gen.ts`; the TanStack Router Vite plugin generates it.
- `apps/cli` is the Commander/Clack CLI. Configuration-writing commands must preserve the existing backup/rollback behavior; use `--dry-run` where available when testing mutations.
- Shared packages own reusable contracts and runtime behavior: `types` (Zod schemas), `constants` (versions/provider catalogs), `db` (persistence), `executors` (upstream drivers/SSE), `translator` (pure protocol mapping), `providers` (registry/OAuth/quota), and `pricing` (cost calculation). Packages must not import apps.

## Runtime Gotchas

- The database defaults to SQLite at `~/.srouter/srouter.db` with WAL mode. Set `DATABASE_PATH` for an alternate SQLite file; set `DATABASE_URL` to use PostgreSQL. Queries use `?` placeholders and the PostgreSQL client translates them.
- Schema initialization is declarative in `packages/db/src/db.ts`; document non-automatic schema changes in `DB-MIGRATION.md`.
- The API serves `apps/web/dist` when it exists, otherwise it runs API-only. Build the web app before checking production dashboard serving.
- `SROUTER_PUBLIC_URL` moves OAuth callbacks onto the main `PORT`; without it, the secondary OAuth listener uses `OAUTH_PORT` (default `1455`).
- Root formatting is Prettier with 4-space indentation, double quotes, no trailing commas, and a 100-column width.

## Verification

- Build/typecheck only the touched package after changes. Run the focused test file before claiming a behavior fix; add or update a regression test in the touched app/package when applicable.
- Do not claim full build, lint, or test coverage unless that exact command was run. Check `git diff --check` and focused Prettier output before finishing.
