# API migration: Node to Rust cutover guide

**Status:** Draft against the tree of 2026-10-08. Sections marked _pending_ have not been
performed yet; nothing in this document claims a measurement or a live comparison that was not
run. This file is `server/TODO.md` section 12's `docs/api-migration.md` deliverable.

**Node tree removed 2026-10-08.** By owner instruction the Node API (`apps/api`) and the
`docs/superpowers/` plans were deleted ahead of the cutover gate in section 8. That tree is
preserved at branch `backup/pre-apps-api-removal` (commit `5839f80`) and in git history, so every
`apps/api/**` path below cites the preserved tree rather than a directory in the working copy. Two
gate items in section 8 (the live A/B run and the Node column of the benchmarks) can now only be
executed by reinstating that tree.

## 1. Sources of truth

- Frozen contract: `docs/api-v1-contract.md` (route inventory, deviations, legacy baseline).
- Persistence contract: `docs/api-database-contract.md`, `docs/schemas-database.md`.
- Backlog and evidence map: `server/TODO.md`.
- Plan: `docs/superpowers/plans/2026-09-24-srouter-api-rust-migration.md`, read from the preserved
  tree (the `docs/superpowers/` folder was deleted on 2026-10-08); Task 15 defines the
  staging/cutover sequence this document operationalizes.
- Rust evidence: `server/tests/*.rs`, green at 873 passed / 0 failed (`cargo test --locked`,
  2026-10-08) plus `cargo fmt --check` and `cargo clippy --all-targets --all-features -- -D
warnings`.
- Node evidence: `apps/api/tests/*.test.ts`, read as black-box oracle files from the preserved tree;
  the representative baseline (contract section "Legacy baseline before Rust work") passed 15/15
  while that tree was still present.

## 2. Parity matrix

Verdicts are evidence-based and deliberately narrow:

- **Served** - the route exists in `server/` and is pinned by at least one Rust test; the Node
  oracle file for the same behavior is named.
- **Served (deviation)** - served with an owner-approved behavioral difference; the deviation and
  its ruling date live in `docs/api-v1-contract.md`.
- **Not served (deliberate)** - no Rust route (answers `404`); dropping it was ruled or was
  recorded as a scope decision.
- **Rust-only / Node-only** - surface that exists on exactly one side by design.

<!-- prettier-ignore -->
| Area | Rust status | Rust evidence | Node oracle evidence |
| --- | --- | --- | --- |
| HTTP runtime shell: health, `GET /`, `GET /v1`, static assets, SPA fallback, 25 MiB body limit, error envelopes, `X-Version` | Served | `http_runtime.rs`, `static_files.rs`, `startup.rs`, `configuration.rs` | `startup.test.ts`, `web-dist.test.ts`, `request-limits.test.ts`, `malformed-json.test.ts` |
| Telemetry: file + stdout logs, per-request failure log, access log | Served; access log is Rust-only | `telemetry.rs` | Failure-log parity read from `apps/api/src/index.ts` (no Node test) |
| Admin auth: status, setup, login, logout, change-password, env bootstrap | Served | `admin_auth.rs`, `startup.rs` | `admin-auth-route.test.ts`, `admin-auth-service.test.ts`, `admin-auth-store.test.ts`, `admin-auth-middleware.test.ts` |
| API keys: CRUD, credit, disabled/quota/credit rejections, reserved `max_tokens` budget, usage write-back | Served | `api_keys.rs`, `api_key_auth.rs` | `api-keys.test.ts`, `api-keys-credit-db.test.ts`, `api-keys-credit-route.test.ts`, `api-keys-quota-credit.test.ts`, `api-keys-usage-deduction.test.ts` |
| Request authorization: key requirement, rate limit, model allowlist | Served; catalog is not rate limited (deviation, 2026-10-02) | `rate_limit.rs`, `model_access.rs`, `api_key_auth.rs` | `rate-limit.test.ts`, `api-keys-allowed-models.test.ts` |
| Chat gateway: `/v1/chat/completions`, `/chat/completion`, streaming, tools, usage | Served | `chat_completions.rs`, `reasoning_stream.rs`, `client_cancellation.rs` | `opencode-compat.test.ts`, `tool-interceptor.test.ts`, `messages.test.ts` |
| Messages gateway: `/v1/messages`, `count_tokens`, Anthropic SSE | Served | `messages.rs`, `client_cancellation.rs` | `messages.test.ts`, `opencode-compat.test.ts` |
| Images: `/v1/images/generations` | Served; the images fallback branch is gone with fallbacks | `images.rs` | `images-route.test.ts`, `images-fallback.test.ts` |
| Model catalog reads: `GET /v1/models`, `/v1/models/:model`, cache and revalidation rules | Served | `models.rs` | `models-endpoint.test.ts` |
| Model writes: `POST`/`PUT`/`PATCH`/`DELETE /v1/models{/*}` | Rust-only surface replacing ten Node routes (deviation, 2026-10-02) | `models.rs`, `wire.rs` | None; Node has no `/v1/models` writes |
| Pricing: `GET /v1/models/pricing` | Served (deviation); Node serves `GET /v1/pricing/models` (owner ruling 2026-10-07) | `pricing.rs` | `pricing-route.test.ts` (against the Node path) |
| Quota: `GET /v1/quota` and the `/v1/qouta` alias | Served | `quota.rs` | `quota-oauth-filter.test.ts` |
| Logs: list, detail, stats, analytics, SSE events | Served (snake_case casing deviation) | `logs.rs` | `logs-pagination.test.ts`, `analytics.test.ts` |
| Settings: `GET`/`POST`/`PATCH /v1/settings` | Served (deviation); response is `{require_api_key}` only (2026-10-02) | `settings.rs` | `settings-auth.test.ts` |
| Fallbacks: `/v1/settings/fallbacks*` | Not served (owner ruling 2026-10-04) | None; gateway keeps `fallback_occurred = false` | `fallbacks-endpoint.test.ts`, `fallbacks-db.test.ts`, `fallback-policy.test.ts`, `fallbacks-cascade.test.ts` |
| Provider management: list, catalog, detail, `PATCH /v1/providers/{id}` | Served (deviation); one write route replaces `enabled`, hidden-models, favorites (2026-10-02) | `providers.rs` | `round-robin-endpoint.test.ts` |
| Custom providers: `POST`/`DELETE /v1/providers`, both verify routes | Served (2026-10-08) | `custom_providers.rs` | `custom-provider-uuid.test.ts`, `verify-connection.test.ts` |
| Round-robin: `PATCH /v1/providers/{id}/round-robin` | Served (deviation); missing settings row reads as on | `providers.rs`, `qoder_provider.rs`, `cline_provider.rs` | `round-robin-endpoint.test.ts` |
| Provider auth: OAuth start/callback/token, device flows, PKCE lifecycle | Served for openai, claude, antigravity, qoder, codebuddy (+cn), cline device | `provider_auth.rs`, `claude_auth.rs`, `antigravity_auth.rs`, `codebuddy_auth.rs` | `auth-providers.test.ts`, `token-refresh.test.ts` |
| Per-provider token imports (`commandcode`/`anthropic`/`atria`/`tokenrouter`, qoder `/token`, cline `/token`) | Not served; replaced by the generic custom-provider surface (2026-10-06) | `custom_providers.rs` | `auth-providers.test.ts`, `tokenrouter-provider.test.ts` |
| Provider executors: opencode_zen, qoder, cline, grok-web, openai_codex, codebuddy (+cn), antigravity, claude | Served (nine seeded drivers, documented scope) | `qoder_provider.rs`, `cline_provider.rs`, `codex_provider.rs`, `antigravity_provider.rs`, `claude_provider.rs`, `codebuddy_provider.rs`, `grok_web_provider.rs`, `opencode_live.rs`, `qoder_live.rs` | `qoder-provider.test.ts`, `codebuddy-provider.test.ts`, `antigravity-provider.test.ts` |
| Providers built only into Node (kiro, bai, neosantara, experientiallabs, tokenrouter, commandcode, atria, minimax; catalog `packages/constants/src/providers/`) | Not served; register an equivalent custom provider row instead | `custom_providers.rs` | `kiro-provider.test.ts`, `bai-provider.test.ts`, `neosantara-provider.test.ts`, `experientiallabs-provider.test.ts`, `tokenrouter-provider.test.ts` |
| Database transfer: export, import | Served (four documented deviations) | `database_transfer.rs` | `database-route.test.ts` (8/8 baseline) |
| Shared security: CORS allowlist, CSRF origin guard, headers | Served | `cors.rs`, `csrf.rs`, `http_runtime.rs` | `cors-allowlist.test.ts`, `csrf-origin-guard.test.ts` |
| Compat aliases `/v1/v1/*` | Served for the gateway subset only; absent for auth/keys/logs/settings/providers | `csrf.rs`, `models.rs`, `images.rs`, `providers.rs` | `opencode-compat.test.ts` |
| Persistence: SQLite schema v4, migrations, PostgreSQL boot refusal | Served (SQLite-only, 2026-10-05) | `schema.rs`, `database.rs`, `wire.rs` | Schema contract: `docs/schemas-database.md` |
| Cloudflare Tunnel (`/v1/tunnel/*`, autostart) | Not served; feature removed (owner ruling 2026-10-08), see section 4 | `schema.rs` (`tunnel_settings_rows_are_deleted_*`) | `tunnel-auth.test.ts` (Node-only until `apps/` is deleted) |
| TypeScript wire bindings (`server/bindings.ts`) | Rust-only; replaced the OpenAPI export (2026-10-07) | `bindings.rs`, `wire.rs` | `apps/web/src/generated/api.ts` is frozen (issue #150) |

**What this matrix is not.** It compares static evidence: each side's own test suite plus the
frozen contracts. The live A/B run from plan Task 15 - two servers, separate temporary
databases, fake upstreams, byte-comparing status codes, required headers, JSON/error bodies,
state changes, and SSE event sequences - is **pending** (section 8). Rows whose verdict rests on
one side only say so in the evidence column.

## 3. Owner-approved deviations at cutover

Each item is recorded in `docs/api-v1-contract.md`; dates are the ruling dates.

- Settings responses carry `{require_api_key}` only; no `requireApiKey`/`settings` echo
  (2026-10-02).
- Provider management: one `PATCH /v1/providers/{id}` write route replaces `enabled`,
  hidden-models, favorites, and per-model writes; custom models moved to `/v1/models`
  (2026-10-02, refined 2026-10-06).
- Round-robin default: a missing settings row reads as on (Node defaults off).
- Logs, stats, and analytics serialize snake_case where Node emits camelCase.
- `GET /v1/models/pricing` replaces `GET /v1/pricing/models` (2026-10-07). `apps/web` still
  calls the Node path until the web refactor (issue #150).
- Fallbacks: no routes, no cascade; `fallback_rules` is kept as data only (2026-10-04).
- Storage: SQLite only; a `DATABASE_URL` boot is refused at startup (2026-10-05), and
  PostgreSQL support was struck from the backlog entirely (2026-10-08), so the refusal is
  permanent. Node keeps PostgreSQL until cutover.
- Single listener: no `:1455` OAuth listener, no `OAUTH_PORT`/`OAUTH_HOST` (2026-10-03);
  provider callbacks live on the main listener under `/v1/auth/...`.
- Version: the Rust build reports `server/Cargo.toml` (`0.2.0`), not `API_VERSION` (2026-10-02).
- Disabled API key always answers `401 api_key_disabled`, matching the contract text rather
  than Node's `getAPIKeyByKeyDB` branch (2026-10-02).
- `GET /v1/models` is not rate limited (2026-10-02).
- Client disconnect cancels the upstream request (Rust requirement; Node keeps draining).
- Unmatched `/v1/*` paths answer JSON `404` instead of falling back to the SPA shell.
- Cloudflare Tunnel removed outright (2026-10-08), section 4.
- Compat alias `/v1/v1` covers the gateway only, matching Node's alias scope.

## 4. Cloudflare Tunnel removal (owner ruling 2026-10-08)

The feature is deleted, not merely excluded. What it consisted of and where each part stands:

| Part                                                                                                                       | Where it lived                                                                         | State                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Seven routes (`GET                                                                                                         | POST /v1/tunnel/status,events,install,start,stop,config`)                              | `apps/api/src/routes/v1/tunnel.ts`, `controllers/tunnel.controller.ts`                                          | Deleted with `apps/api` on 2026-10-08 |
| cloudflared process manager, installer, autostart                                                                          | `apps/api/src/services/cloudflareTunnel.ts`, wired into `boot()` via `RunStartupTasks` | Deleted with `apps/api` on 2026-10-08                                                                           |
| Dashboard hook                                                                                                             | `apps/web/src/hooks/useTunnel.ts` (no importer)                                        | Still present; dead code                                                                                        |
| Settings schema                                                                                                            | `packages/types/src/schemas/admin.ts` (`TunnelConfigSchema`)                           | Still present                                                                                                   |
| Stored settings (`cloudflare_tunnel_token`, `cloudflare_tunnel_domain`, `cloudflare_tunnel_autostart`, `cloudflared_path`) | `system_settings` / `settings` rows                                                    | **Deleted** by `server/migrations/0004_remove_tunnel_settings.sql` on the next connect; schema version is now 4 |
| Rust routes                                                                                                                | Never existed                                                                          | `/v1/tunnel/*` answers `404`, as before                                                                         |

Contract change: the tunnel routes are permanently unavailable. They answered `404` on the Rust
build from the start and disappeared with the Node build on 2026-10-08, so no deployment serves
them any more; the settings keys are already gone from any database the Rust build has opened.

Evidence: `server/tests/schema.rs`
(`tunnel_settings_rows_are_deleted_when_a_v3_file_reaches_v4`,
`tunnel_settings_rows_are_deleted_across_the_v1_transform`), commits `4d6e2d9` (code) and
`7c8b167` (docs). The Node-side deletion left `server/TODO.md` sections 10 and 13 on 2026-10-08,
when the owner ordered the tree removed.

## 5. Staging rollout steps (pending)

Adapted from plan Task 15 to the current shape: single listener, SQLite only, no tunnel.

1. Take a backup of the staging database (section 6) and record its sha256.
2. Build the candidate: `docker build --target runner -t srouter:rust .` (Node-free runtime,
   health check via `wget`).
3. Deploy on the staging port with a disposable volume first, then on the staging data
   directory; confirm `logs/srouter-server.log` is written.
4. Verify on staging: `/health`; `/` serves the SPA shell; an asset carries the immutable cache
   header; `/v1` reports `0.2.0`; admin setup/login/logout; a chat request streams SSE end to
   end; `GET /v1/models` respects the allowlist; `GET /v1/logs/events` delivers `connected`
   plus 25 s heartbeats; database export and a re-import of that export both succeed; an OAuth
   callback route is reachable from outside loopback.
5. Rehearse the rollback (section 6) on a copy: restore the backup over the candidate database and
   confirm the service comes up healthy against the restored file. The Node service no longer
   exists (`apps/api` deleted), so this rehearsal is backup-and-binary only.
6. Only then deploy the `runner` image to production. `runner` is the only service in
   `docker-compose.yml` now, so there is no compose target left to switch.
7. Monitor for at least 24 hours: critical route probes (health, chat, models, logs), error
   rate in `logs/srouter-server.log`, and data-integrity spot checks (key usage counters, log
   row growth).

Nothing in this section has been executed yet.

## 6. Backup and rollback

**Backup.** Before any deploy that could migrate the file, stop writes and copy the SQLite file
as a unit:

```bash
sqlite3 "$DATABASE_PATH" 'PRAGMA wal_checkpoint(TRUNCATE);'
sha256sum "$DATABASE_PATH" > "$DATABASE_PATH.sha256"
cp -p "$DATABASE_PATH" "backup/srouter-$(date -u +%Y%m%dT%H%M%SZ).db"
```

The import route also keeps its own `import-backup.db` (verified in
`server/tests/database_transfer.rs`), but that backup only exists after an import.

**Rollback Rust -> Node: no longer available.** The Node build was deleted (`apps/api`,
2026-10-08) and stage 4 of the Dockerfile went with it, so "roll back to the previous runtime" now
means reinstating that tree from branch `backup/pre-apps-api-removal` and rebuilding it. If someone
does that, two caveats still apply, both to be rehearsed rather than assumed:

- **Schema ownership.** Once the Rust build opens a legacy file it renames `admin_account` ->
  `admin_accounts` and `system_settings` -> `settings`, and rewrites `api_keys.key` (plaintext)
  into `api_keys.key_hash` + `key_prefix` (`server/src/infrastructure/database/migrations.rs`).
  Node boot recreates its own tables with `CREATE TABLE IF NOT EXISTS` when they are missing
  (`packages/db/src/db.ts`), which yields an empty `admin_account` and empty `system_settings`,
  and `getAPIKeyByKeyDB` queries `WHERE key = ?` (`packages/db/src/apiKeys.ts:40`), a column
  that no longer exists. A fully correct rollback therefore restores the pre-migration backup
  file; rolling back in place risks an empty admin bootstrap, default settings, and failing key
  auth. This must be proven in the rollback rehearsal (step 5) before cutover.
- **Web bundle coupling.** Favorites, hidden models, custom models, and the provider `enabled`
  flag are written through Rust-only surfaces, while `/v1/settings/fallbacks`, both verify
  routes, and `/v1/tunnel/*` are Node-only. Rolling the API back must roll the web bundle back to
  the same commit (`server/TODO.md` section 13).

Since the Node tree is gone, the practical rollback is **backup + Rust binary**: restore the
pre-migration database file and deploy the previous Rust image (`runner`).

**Rollback Node -> Rust.** Free, except that the Node build may have written state the Rust
build has not seen (for example new tunnel settings keys, which the next Rust connect deletes
again).

**Rust binary rollback.** A database already at version 4 is refused by any pre-v4 Rust binary
("newer than this server supports"), so roll the binary back together with the file backup.

## 7. Benchmarks (pending - no numbers yet)

Protocol: run both builds under identical CPU/memory limits, the same database fixture (a copy
of one staging snapshot), the same fake upstream fixtures, and the same request mix (short
non-stream, long stream, models list, logs page). Record raw numbers before any comparison;
this document must not claim an improvement that has not been measured. The Node column needs the
preserved tree (branch `backup/pre-apps-api-removal`) reinstated and rebuilt first; the Rust column
can be measured at any time.

<!-- prettier-ignore -->
| Metric | Node | Rust | Notes |
| --- | --- | --- | --- |
| Startup time to first healthy `/health` | not measured | not measured | Cold start of the container/process |
| Idle RSS after boot | not measured | not measured | 5 minutes idle, no requests |
| RSS under load | not measured | not measured | Concurrency fixed for both sides |
| Throughput (requests/s) | not measured | not measured | Same request mix, same upstream fixture |
| CPU under the same load | not measured | not measured | Same limits as the throughput run |
| Production image size | not measured | not measured | `docker images` for `runner`; the `node-runner` stage is gone |

## 8. Cutover gate

Owner instruction 2026-10-08: the Node tree was deleted ahead of this gate (see the header), so the
items below record both what the deletion settled and what is still open.

- [ ] Live A/B parity run (plan Task 15, step 1): status codes, required headers, JSON/error
      bodies, state changes, SSE sequences, separate temporary databases, fake upstreams. Needs the
      preserved Node tree reinstated first (branch `backup/pre-apps-api-removal`).
- [ ] Tunnel removal write-up accepted (section 4) - drafted here; owner sign-off pending.
- [ ] Benchmarks measured under identical limits (section 7). The Rust column is measurable now;
      the Node column needs the preserved tree.
- [ ] Staging deployment and verification run (section 5).
- [ ] Rollback rehearsed against a real backup, including the schema-ownership caveat
      (section 6).
- [x] `apps/` scope for the Node tunnel code: `apps/api` (routes, controller, service, test) was
      deleted with the tree on 2026-10-08. `apps/web/src/hooks/useTunnel.ts` and the
      `packages/types` `TunnelConfigSchema` remain as dead code until the web refactor (#150).
- [ ] 24-hour production monitoring window closed with no parity or data-integrity regression.
- [ ] `server/TODO.md` section 13 retirement checklist executed (only after every section above
      is checked), except the Node tree deletion itself, which is already done.
