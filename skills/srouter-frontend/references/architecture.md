# Architecture

## Stack

| Concern      | Choice                                            | Notes                                                                  |
| ------------ | ------------------------------------------------- | ---------------------------------------------------------------------- |
| Runtime      | Bun                                               | `client/bun.lock` is the only lockfile — never add npm/pnpm/yarn locks |
| Build        | Vite + `@vitejs/plugin-react`                     | `client/vite.config.ts`                                                |
| UI           | React 19.3, function components + `StrictMode`    | no class components                                                    |
| Routing      | `@tanstack/react-router` (file-based)             | `routeTree.gen.ts` is generated and committed                          |
| Server state | `@tanstack/react-query` v5                        | one `queryClient` singleton                                            |
| Styling      | Tailwind CSS v4 via `@tailwindcss/vite`           | config-less; tokens are CSS variables in `src/index.css`               |
| Components   | shadcn, style `base-mira`, on `@base-ui/react`    | **not** Radix; config in `client/components.json`                      |
| Icons        | `@hugeicons/react` + `@hugeicons/core-free-icons` | the declared `iconLibrary`                                             |
| Font         | Inter Variable, `@fontsource-variable/inter`      | mapped to `--font-sans` and `--font-heading`                           |

`components.json` also aliases `@/hooks`, but **no `src/hooks/` directory exists** — that alias is a shadcn target, not an existing folder.

## Directory map

```text
client/src/
├── main.tsx                 entry: createRouter + providers
├── routeTree.gen.ts         GENERATED — do not edit
├── routes/
│   ├── __root.tsx           root layout; owns the queryClient singleton
│   ├── _authenticated.tsx   pathless session guard (beforeLoad)
│   ├── _authenticated/
│   │   └── index.tsx        "/" — placeholder dashboard
│   └── login.tsx            "/login" — setup + sign-in
├── api/
│   ├── client.ts            request<T>() and APIError — the only fetch wrapper
│   ├── admin.ts             adminStatusQuery (queryOptions factory)
│   └── types.ts             re-export shim for the generated wire types
├── components/
│   ├── ui/                  shadcn primitives (currently just button.tsx)
│   ├── gauge/               self-contained SVG gauge kit (currently unreferenced)
│   └── theme-provider.tsx   dark/light/system context
├── generated/               GENERATED (specta) — do not edit anything here
├── lib/utils.ts             re-exports `cn`
└── index.css                Tailwind entry + design tokens
```

## Boot and provider nesting

`main.tsx` builds the router with `context: { queryClient }` and `defaultPreload: "intent"`, then renders:

```text
StrictMode
└─ QueryClientProvider (queryClient)
   └─ RouterProvider
      └─ __root__: ThemeProvider → Outlet (+ devtools in dev)
```

`ThemeProvider` sits **inside** the router root, not above it: `index.css` defines the `.dark` palette, so without it the app is locked to light mode. It stores the choice under the `"theme"` localStorage key, applies `.dark` to `documentElement`, mirrors other tabs via the `storage` event, and toggles on the `d` key (ignored while an editable element has focus).

The `queryClient` is a module singleton created in `routes/__root.tsx` with `retry: false` and `refetchOnWindowFocus: false`. That is deliberate: every request targets a server the operator runs themselves, so a failure is information, not a blip.

## Routing

File-based routes: the file path _is_ the URL. `_authenticated` is a pathless layout, so everything under `routes/_authenticated/` inherits the guard without gaining a URL segment.

**The session gate** (`routes/_authenticated.tsx`) runs in `beforeLoad` — before the route renders, so no protected screen flashes its content:

```ts
const status = await context.queryClient.ensureQueryData(adminStatusQuery)
if (status.setup_required)
  throw redirect({ to: "/login", search: { redirect: location.href } })
if (!status.authenticated)
  throw redirect({ to: "/login", search: { redirect: location.href } })
```

`ensureQueryData` (not a cache read) matters on a cold load: assuming `authenticated: false` would bounce a signed-in operator on every refresh.

**Adding a protected screen:** create `client/src/routes/_authenticated/<name>.tsx`, register it with `createFileRoute("/_authenticated/<name>")`, and let the Vite plugin (or `bun run generate-routes`) regenerate `routeTree.gen.ts`. New types are only complete after `tsr generate` has run — that is why `typecheck` and `build` both run it first.

## Data flow

```text
component → useQuery(queryOptions factory in src/api/)
          → request<T>() in src/api/client.ts
          → fetch(path, { credentials: "include" })
          → Vite proxy /v1 → 127.0.0.1:3000   (dev)
          → the server's own static serving    (prod)
```

Nothing is cached across sessions, and there is no token in JS: the entire credential is the HttpOnly cookie the server sets on login/setup.

## Layer boundaries

| Layer             | Owns                                                    | Must not                                 |
| ----------------- | ------------------------------------------------------- | ---------------------------------------- |
| `routes/*`        | URL + search-param validation, screen composition       | embed request logic or query definitions |
| `api/*`           | `request<T>()` calls, `queryOptions`/mutation factories | render anything                          |
| `components/*`    | presentation, props in / events out                     | fetch, or read the router                |
| `components/ui/*` | shadcn primitives and their variants                    | carry domain knowledge                   |

The only exception today is the login screen, which holds its two mutations inline because it is the seam between the gate and the API — if a screen grows a third mutation, move them into `src/api/`.
