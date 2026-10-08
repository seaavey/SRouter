# AGENTS.md - SRouter

Single crate repository: the Rust/Axum API gateway in `server/`. Requires a Rust stable toolchain
(matched by `server/rust-toolchain.toml`). Node `>=22` is needed only for the Prettier documentation
gate.

The TypeScript side is gone: `apps/api`, `apps/web`, `apps/cli`, `apps/docs`, `packages/*`, the pnpm
workspace file, and the Turbo pipeline were deleted on 2026-10-08 by owner instruction (the last four
by a second instruction the same day). Everything is preserved at branch
`backup/pre-packages-removal` (commit `3e29aaf`) and in git history, so a `server/` doc comment or a
document under `docs/` that cites one of those paths refers to that branch.

## Rules

- FORBIDDEN in this environment: dev servers, watchers, and heavy builds. `cargo run`,
  `cargo watch`, `cargo build --release`, `docker build`, and any Node dev server.
- ALLOWED: focused tests, the full `cargo test`, `cargo fmt -- --check`, `cargo clippy`,
  `prettier --check` on changed files, `git diff --check`.
- Verify only what changed while iterating; run the full suite before pushing. Never leave the tree
  in a state where `cargo test` cannot run.
- Language: reply to the user in Bahasa Indonesia; code, comments, identifiers, and commit messages
  in English.

## Layout

- `server/`: the API. `src/app.rs` mounts the routers, `src/features/*` own behavior,
  `src/http/` holds middleware and static files, `src/infrastructure/` owns persistence and
  migrations, `src/constants.rs` owns client-facing copy, and `server/bindings.ts` is the generated
  TypeScript view of the wire types.
- `docs/`: contract and migration records (`api-v1-contract.md`, `api-database-contract.md`,
  `api-migration.md`, `schemas-database.md`) plus `docs/packages/*.md`, which document the deleted
  workspace packages and what replaced each of them.
- `server/TODO.md`: the migration backlog. Section 13 records the Node API removal, section 11 the
  contract publication, section 12 CI, Docker, and cutover plumbing.
- `Dockerfile` (two stages, `runner` last) and `docker-compose.yml` build and run the server alone.

## Commands

```bash
cargo test --manifest-path server/Cargo.toml --test <focused-file>
cargo test --manifest-path server/Cargo.toml --locked          # full suite, what CI runs
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features --locked -- -D warnings
cargo run --manifest-path server/Cargo.toml --bin export_ts    # regenerate server/bindings.ts
pnpm exec prettier --check <changed files>
git diff --check
```

- Format: Prettier `tabWidth: 4, printWidth: 100, double quotes, trailingComma: none`, applied to
  Markdown and configuration files only. No ESLint, no TypeScript build.

## DB / env safety

- Default DB `~/.srouter/srouter.db`; override with `DATABASE_PATH`. The container uses
  `/app/data/srouter.db`. Never hardcode a path in code or tests.
- Tests MUST go through `server/tests/support`: it redirects to a per-pid temporary database and
  never opens the production file. A past run wiped production API keys by sharing it.
- Key env: `PORT` (3000, the only listener), `DATABASE_PATH`, `WEB_DIST_PATH` (optional dashboard
  dist), `SROUTER_ADMIN_PASSWORD`, `SROUTER_CORS_ORIGINS`, `SROUTER_PUBLIC_URL`.
  `DATABASE_URL` is refused on purpose: SQLite is the only backend.
- Schema: version 4, in `server/migrations/`, applied on connect. Legacy v1 files are transformed in
  one transaction; a newer reported version is refused.
- CI (`.github/workflows/ci.yml`): two jobs, `rust-lint` (`cargo fmt --check` + clippy with
  `-D warnings`) and `rust-test` (`cargo test --locked` + the `server/bindings.ts` drift check), on
  pull requests and pushes to `main`.

## Quirks agents miss

- One listener on `PORT` (default `3000`), OAuth callbacks under `/v1/auth/*` included. The Node
  build's secondary `:1455` listener no longer exists anywhere.
- Compat routes: `/v1/v1/*` exists for SDKs that append `/v1` to a baseURL already containing `/v1`.
  Keep them.
- `server/bindings.ts` is generated with `specta` and CI fails on drift. Change the Rust types, then
  regenerate with `export_ts`; never hand-edit the file.
- `GET /` serves the dashboard when a dist exists at `WEB_DIST_PATH`, and the API information object
  otherwise. The repo-relative `apps/web/dist` candidates in `src/http/static_files.rs` are vestigial
  after the deletion but harmless.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `perf:`, `chore:`).
  The API replacement was a breaking change, so the removal commits carry `!` where it fits.

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
