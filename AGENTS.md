# AGENTS.md - SRouter

Monorepo: `pnpm@11.23.0` workspaces (`apps/*`, `packages/*`) + Turborepo. Requires Node `>=22` (native `node:sqlite`). Use `corepack enable pnpm`.

## Rules

- FORBIDDEN: `pnpm dev`, `pnpm start`, `pnpm start:dev`, `pnpm build`, `turbo run dev|start|build`, `tsx watch`, `vite`, `vite build`, `astro dev|build|preview`. No dev servers, no builds, no previews.
- ALLOWED: focused test (single file), lint/typecheck (`apps/web` `pnpm run lint`, `apps/docs` `pnpm run check`), `prettier --check` on changed files, `git diff --check`.
- Verify only touched apps/packages. Never run root `pnpm test` / `turbo test` on resource-constrained dev.
- Language: reply to user in Bahasa Indonesia; code, comments, identifiers, commit messages in English.

## Layout

- `apps/api`: Hono gateway, entry `src/index.ts`. Serves `apps/web/dist` in prod, API-only otherwise.
- `apps/web`: Vite + React 19 + TanStack Router + Tailwind v4 + shadcn. Dev `:5173`, proxies `/v1`, `/health` to `:3000`.
- `apps/cli`: `@srouter/cli`, bin `srouter`. `apps/docs`: Astro landing (excluded from root `dev`/`build` filters).
- `packages/`: `constants`, `db` (SQLite `node:sqlite` WAL repo + `pg` for prod), `executors` (upstream drivers), `pricing`, `providers` (registry/coordinator), `translator` (OpenAI <-> Anthropic), `types` (shared Zod).

## Commands (reference, most are FORBIDDEN per Rules above)

```bash
pnpm install                  # setup only; frozen-lockfile in CI
# FORBIDDEN: pnpm dev / pnpm build (turbo dev/build --filter=!docs)
```

Verify only touched apps/packages (per `CONTRIBUTING.md`, minus build):

```bash
cd apps/api
pnpm exec tsx --test --test-concurrency=1 --import ./tests/setup.ts tests/<focused-file>.test.ts
pnpm exec prettier --check src/<changed>.ts tests/<changed>.test.ts
git diff --check
```

- `apps/web` verify: `pnpm run lint` (`tsc --noEmit`) only. No `vite build`.
- `apps/cli` test: `NODE_ENV=test tsx --test --import ./tests/setup.ts tests/**/*.test.ts` (single file preferred).
- Format: Prettier `tabWidth: 4, printWidth: 100, double quotes, trailingComma: none`. No ESLint.

## DB / env safety

- Default DB `~/.srouter/srouter.db`. Override via `DATABASE_PATH`. Docker uses `/app/data/srouter.db`. Never hardcode paths.
- Tests MUST go through `tests/setup.ts`: redirects `DATABASE_PATH` to per-pid tmp file, deletes `DATABASE_URL`. A past run wiped prod API keys by sharing the prod file. Never import `@srouter/db` in setup before the redirect.
- Key env: `PORT` (3000), `OAUTH_PORT` (1455), `DATABASE_PATH`, `WEB_DIST_PATH`, `SROUTER_ADMIN_PASSWORD` (bootstrap only), `SROUTER_CORS_ORIGINS`, `SROUTER_PUBLIC_URL` (when set, `:1455` listener is skipped).
- CI (`.github/workflows/ci.yml`): Node 22.x/24.x, `pnpm/action-setup` reads `packageManager`, do not pin `version:`.

## Quirks agents miss

- API has two Hono apps: main `:3000` and OAuth `:1455` (`/auth/*` callbacks + `/v1` proxy). `boot()` awaits `RunStartupTasks` (PG schema, admin bootstrap, tunnel autostart) before `serve()`.
- Compat routes: `/v1/v1/*` exists for SDKs appending `/v1` to a baseURL containing `/v1`. Keep them.
- Web `vite.config.ts` aliases `@srouter/types` and `@srouter/constants` to `packages/*/src/index.ts` (not `dist`). `src/routeTree.gen.ts` is generated, prettier-ignored.
- Web build emits `sr-[hash].js` with `preserveModules`; API `tsup` targets `node20`, ESM only, minified.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `perf:`, `chore:`).

## Local agent memory (`.local/`, git-ignored)

- `AGENTS.md` is the committed source of truth. `.local/` is per-machine agent scratch, never committed (`*.local`, `.local/` in `.gitignore`).
- Read at session start: `.local/CONTEXT.md`, `.local/ARCHITECTURE.md`, `.local/REQUIREMENTS.md`, `.local/CONVENTIONS.md`, `.local/DECISIONS.md`, `.local/TASK.md`, `.local/NOTES.md`.
- Keep `TASK.md` (one active focus) and `NOTES.md` (findings, warnings) updated during work.
- Each edit in `.local/CONTEXT.md` MUST be logged with its own timestamp
  `YYYY-MM-DD --- HH-MM TZ` (e.g. `2026-09-24 --- 19-18 WIB`). Do NOT use
  a single overwritten `Last updated` line. Append a new entry per change and
  keep history, e.g. `- [2026-09-24 --- 19-18 WIB] ...` for bullet logs.

<!-- antislop:start -->

## antislop

Mode: DURING. For UI, copy, people, mobile layout, or code comments work, read `antislop.md` (core) and then the skill for the task:

Install (if skills missing): `npx skills add miqdadbadjuber/anti-slop`

- UI / visual: `skills/antislop-ui/SKILL.md`
- Copy & text: `skills/antislop-copywriting/SKILL.md`
- People: `skills/antislop-human/SKILL.md`
- Mobile / responsive: `skills/antislop-layoutmobile/SKILL.md`
- Code comments: `skills/antislop-code/SKILL.md`
- Before starting UI work, apply antislop DURING the work (planning and execution), ending with the Delivery Gate PASS/FAIL report.

<!-- antislop:end -->

<!-- graphify:start -->

## graphify

When the user types `/graphify`, use the installed graphify skill before doing anything else.

Rules:

- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- Dirty `graphify-out/` files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current.

<!-- graphify:end -->
