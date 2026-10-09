# Verification

## Commands

Run from `client/`. Bun is the package manager.

```bash
bun install         # only if node_modules is missing
bun run typecheck   # tsr generate && tsc --noEmit   — lowest bar, always run
bun run lint        # eslint .  (flat config: js + typescript-eslint + react-hooks + react-refresh)
bun run format      # prettier --write "**/*.{ts,tsx}" — sorts Tailwind classes
bun run build       # tsr generate && tsc -b && vite build — run for routing/shell changes
bun run dev         # Vite dev server, proxies /v1 to the API
bun run generate-routes   # tsr generate, when routeTree.gen.ts must refresh without a full build
```

There is **no test runner** in the client: no vitest, jest, or testing-library, and no `test` script. Your verification is typecheck + lint + a real browser.

`bun run typecheck` regenerates the route tree first, so it also catches a route file whose `createFileRoute` id does not match its path.

Before committing, confirm you did not hand-edit generated output:

```bash
git status --short -- client/src/routeTree.gen.ts client/src/generated server/bindings.ts
```

A modified generated file is fine **only** when a generator wrote it (a new route regenerated the tree, or `export_ts` re-rendered the bindings). If those paths show up without a regeneration step in the same change, revert them and fix what feeds them — see the skill's "Never hand-edit generated files" table.

## Server side (only when the change touches the wire)

```bash
cargo run --manifest-path server/Cargo.toml           # API on :3000
cargo run --manifest-path server/Cargo.toml --bin export_ts   # after any wire-type change
cargo test --manifest-path server/Cargo.toml --locked          # when server code changed too
```

`dotenvy` reads `.env` from the current working directory, so run the server with cwd `server/` (or export the variables) for `server/.env` to apply. Tests must never touch `~/.srouter/srouter.db`.

## Development and the proxy

`bun run dev` serves on Vite's default port and forwards `/v1` to `process.env.SROUTER_API_URL ?? "http://127.0.0.1:3000"` with `changeOrigin: false`.

That `false` is not a detail to tidy up:

- The admin session is an HttpOnly cookie with `SameSite=Lax`. A browser treats `localhost:5173` and `127.0.0.1:3000` as different _sites_, so a cross-origin dev setup silently drops the cookie: login returns 200 and the next request is still unauthenticated.
- Same-origin means no CORS preflight, and the `Origin` header reaches the server's CSRF guard intact. Rewriting or stripping it breaks every cookie-authenticated mutation.

Point the proxy at another backend with `SROUTER_API_URL=http://127.0.0.1:4000 bun run dev`. There are no `VITE_*` variables anywhere in this project.

## Serving the built dashboard

In production the Rust server serves the built SPA; there is no separate web host.

```bash
cd client && bun run build                                  # → client/dist
WEB_DIST_PATH=client/dist cargo run --manifest-path server/Cargo.toml
```

`WEB_DIST_PATH` is usually required: `resolve_web_dist` searches `WEB_DIST_PATH` first, then candidates like `<repo>/apps/web/dist`, `../web/dist`, and `dist` relative to the cwd — **`client/dist` is not one of them**. Without a dist, `GET /` answers with the API info object instead of the SPA, and unmatched routes answer JSON 404 rather than the app shell (the `/v1` nests deliberately never fall through to the SPA).

Fingerprinted assets under `client/dist/assets/` are served `immutable`; `index.html` is not, which is why a rebuild is visible without a hard refresh.

## Manual smoke checks

Typecheck proves nothing about runtime. After a change, exercise the real path:

1. **Cold load, unauthenticated** — `/` must land on `/login` without flashing dashboard content; the redirect target must round-trip in `?redirect=`.
2. **First run** — with a fresh database, `/login` shows the setup form; after submitting, the guard must let `/` through _without a manual refresh_ (that is the `invalidateQueries` + navigate sequence doing its job).
3. **Reload while signed in** — a hard refresh on `/` must stay on `/`; bouncing to login means the guard is reading cache instead of awaiting `ensureQueryData`.
4. **Cookie survives the proxy** — check DevTools that the `Set-Cookie` from login is present on the following `/v1/admin/status` request. A missing cookie is almost always a proxy or `credentials` regression.
5. **Errors render inline** — submit a wrong password and confirm the message appears in the form, or the throttle sentence after several attempts.
6. **Both themes** — press `d` and confirm the screen is legible in the other palette, then check `prefers-color-scheme` with the theme set to `system`.
7. **Console clean** — React 19 + `StrictMode` surfaces effect and hydration mistakes that typecheck cannot.

For a UI-affecting change, a screenshot or a described observation of the actual rendered screen is the proof. Report what you ran; do not claim coverage you did not exercise.
