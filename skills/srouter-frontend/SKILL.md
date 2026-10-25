---
name: srouter-frontend
description: Use when editing `client/` — the SRouter admin dashboard (React 19, Vite, TanStack Router/Query, Tailwind v4, shadcn on Base UI). Covers new routes, the `/v1` fetch layer, the admin session gate, wire types generated from Rust, and client verification. Trigger on changes under `client/src`, on login/session behavior, or when a task mentions the dashboard, theme, or shadcn component work.
version: 1.0.0
author: Muhammad Adriansyah (Seaavey)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [srouter, react, dashboard, tanstack, vite, tailwind, shadcn]
    related_skills: [shadcn, tanstack-router, tanstack-query, antfu-design]
---

# SRouter Frontend

Work inside `client/`. The dashboard is the operator UI for the SRouter gateway; the Rust server in `server/` owns every wire shape, status code, and cookie.

**Process is not optional.** Every change runs through the superpowers workflow (`AGENTS.md` → `## Workflow: Superpowers Skills (Mandatory)`): `brainstorming` before design, `writing-plans` before multi-step work, `test-driven-development` before product code (the client has no unit-test runner: substitute `bun run typecheck && bun run lint && bun run build` plus a browser pass, and say so; the Playwright suite is `bun run e2e`), `systematic-debugging` before any fix, `verification-before-completion` before claiming done, `requesting-code-review` before merge. Any `*.tsx` file also loads `vercel-react-best-practices` before the first edit: filename trigger, no exception. TanStack work loads its library skill: `tanstack-query` for `src/api/**` and every `queryOptions`/`useQuery`/`useMutation`/`QueryClient` call, `tanstack-router` for `src/routes/**`, `routeTree.gen.ts`, `createFileRoute`, `validateSearch`, and route loaders.

**Current state:** every route is wired to the API. `/login` (first-run setup, password sign-in, access-token sign-in), `/portal` (customer console: own account, keys, and logs behind the user session), and under `_authenticated/`: `/` (overview: `analyticsQuery` from `@/api/logs` plus live SSE via `useLogEvents`), `providers` + `providers/$providerId` (`providersListQuery`, `providerDetailQuery`, the provider mutations, and the Command Code sign-in), `keys` (`keyListQuery`, `usersQuery`, create/rotate/delete, model allowlist), `logs` (`logsQuery`, live prepend, `LogDetailSheet`), `usage` (`analyticsQuery`, `usageStatsQuery`, `keyListQuery`), `users` (customer accounts and their one-time tokens), and `settings` (`settingsQuery`, `systemQuery`, password change, database export/import). Do not assume a screen is wired because a type exists: check for an `@/api` import. The operator session is shared through `components/admin-auth-provider.tsx` (`useAdminAuth()`).

## When to Use

- Editing anything under `client/src`, `client/vite.config.ts`, or `client/package.json`.
- Adding a route, a query, a mutation, or a component.
- Anything touching the admin session, the `/v1` proxy, or generated wire types.
- Not for server changes: routes, guards, and error envelopes live in `server/src` (see `AGENTS.md`).

## Non-negotiables

1. **NEVER edit a generated file.** `client/src/generated/**`, `client/src/routeTree.gen.ts`, and their server twin `server/bindings.ts` are build output. See [Never hand-edit generated files](#never-hand-edit-generated-files) — no exception, not even to make a check pass.
2. **Stay same-origin.** No API base URL, no cross-origin dev server, never strip `Origin` in the proxy. The session is an HttpOnly `SameSite=Lax` cookie and the server CSRF-checks the `Origin` header.
3. **`credentials: "include"` on every request** — without it the session silently does not persist.
4. **Wire types come from Rust — requests included.** Need a new shape? Add it in `server/src` with `specta::Type`, run `cargo run --manifest-path server/Cargo.toml --bin export_ts`, commit both files. A request body type (`AdminSetupInput`, `CreateAPIKeyInput`) is declared the same way; a hand-written request shape or an inline `body: { ... }` literal in `client/src` is a defect.
5. **One network layer.** All requests go through `request<T>()` in `client/src/api/client.ts`. Components never call `fetch` directly.
6. **Derive types, never duplicate them.** A client shape is a view of a generated wire type — `Pick`/`Omit`/`Partial`/`Exclude` over one, not a re-declared field list. Key lookup tables by their union (`Record<FontFamily, string>`), not by `string`. No `enum` — `erasableSyntaxOnly` bans it; use a literal union plus a const object with `satisfies Record<Union, V>`. See [Type discipline](references/conventions.md#type-discipline).
7. **No `any`, and no `unknown`.** `any` switches the checker off; `unknown` merely defers every decision to a later `instanceof`. Use the narrowest true type — `Error | null` for a TanStack Query error, `object` for a JSON body, the generated wire type for a response — and guard at the boundary. `never` is exempt: it is the exhaustiveness tool, not an escape hatch. See [Type discipline](references/conventions.md#type-discipline).
8. **A button that runs an action MUST use Arc's `ActionButton`.** When a button executes an action (sync or async), use `ActionButton` from `@/components/arc/action-button/action-button` (default export) — never a raw `ui/Button` with a hand-rolled `useState` pending flag. Reserve `ui/Button` strictly for controls with no action to report (navigation links, toggles, dialog triggers).
9. **Copy operations MUST use `useClipboard`.** Any copy action or clipboard access is required to use `useClipboard` from `@/hooks/useClipboard` (`client/src/hooks/useClipboard.ts`) — never call raw `navigator.clipboard` directly. (For a standalone copy trigger, `CopyButton` from `@/components/arc/copy-button/copy-button` is available and delegates to this copy feedback flow).
10. **Acronym and identifier casing: `API` and `ID` must be uppercase.** In all code identifiers (types, hooks, functions, variables, props), always write `API` (never `Api`) and `ID` (never `Id` or camelCase `id`). Examples: `useAPIKey` (not `useApiKey`), `providerID` (not `providerId`), `keyID` (not `keyId`), `userID` (not `userId`), `APIError` (not `ApiError`). The only exception is server wire fields which are frozen lowercase `snake_case` (e.g. `provider_id`).
11. **New `.tsx` files use PascalCase filenames with no hyphens.**
12. **A file that exports one function uses `export default` alone** — no named export beside it — and a file with several exports uses named exports only. Applies to new hooks, utilities, and components; existing named exports stay as they are. Applies everywhere under `client/src`, except the frozen vendor folders `components/ui/` and `components/arc/`; never rename files in those folders. Keep existing files and TanStack route filenames unchanged unless a separate task explicitly requests a rename. Examples: `AddCustomProviderDialog.tsx`, not `add-custom-provider-dialog.tsx`.

## Never hand-edit generated files

**`client/src/generated/` is off-limits entirely** — the whole directory is build output, not just the one file in it today. Same for `client/src/routeTree.gen.ts` and its server twin `server/bindings.ts`.

| Path                                             | Generated by                                | Regenerate with                                                          |
| ------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------ |
| `client/src/routeTree.gen.ts`                    | TanStack Router — the Vite plugin, or `tsr` | `bun run generate-routes` (or any script that runs `tsr generate` first) |
| `client/src/generated/**` (currently `typed.ts`) | specta, from the Rust wire types            | `cargo run --manifest-path server/Cargo.toml --bin export_ts`            |
| `server/bindings.ts`                             | the same export                             | the same command                                                         |

Every edit to these files is thrown away by the next generation. Both are **committed on purpose**: `routeTree.gen.ts` so a fresh clone typechecks before any generation, `typed.ts` so the dashboard builds without a Rust toolchain. `.gitignore` ignores `client/.tanstack/` (the plugin's scratch directory), not these files.

**The fix is never in the generated file:**

| Symptom                                           | Wrong move                        | Right move                                                                                            |
| ------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `routeTree.gen.ts` has no entry for a new screen  | Add the entry by hand             | The route file's `createFileRoute("<id>")` id does not match its path — fix the file, then regenerate |
| `typed.ts` is missing a shape                     | Declare the type in TypeScript    | Add it in `server/src` with `#[derive(Serialize, specta::Type)]`, then `export_ts`                    |
| A field is `string \| null` and you want `string` | Edit `typed.ts`                   | Change the Rust type; also pair `#[serde(skip_serializing_if)]` with `#[specta(optional)]`            |
| A generated file looks buggy                      | Patch it                          | Fix what feeds it — the route tree, or the specta render                                              |
| `server/tests/bindings.rs` fails on drift         | Update the committed copy by hand | `export_ts` writes both copies; commit them                                                           |

If a generated file must be touched at all, generate it, then `git diff` it to confirm the change came from the generator and not from you.

## Workflow

1. Read `references/architecture.md` (relative to this skill directory) for where the piece belongs before writing a file.
2. Check whether the endpoint already exists in `references/api.md`; if the response shape is missing there, read it out of `client/src/generated/typed.ts`.
3. Implement, following `references/conventions.md`.
4. Verify with `references/verification.md` — at minimum `bun run typecheck`, and a real browser check for anything visual.

## Working rules

- **Routes are thin.** A route file declares `createFileRoute`, validates search params, and renders a component. Data orchestration belongs in `client/src/api/`, not in the route body.
- **Protected screens go under `client/src/routes/_authenticated/`**, never at the routes root — that is where the session gate lives.
- **Server state is TanStack Query only.** Declare a `queryOptions()` factory next to its endpoint in `client/src/api/<domain>.ts`; local UI state is `useState`. No `useEffect` + `fetch`.
- **Errors are toasted through the in-house stack.** `toast.error(...)`/`toast.success(...)` from `@/components/arc/toast-stack/toast-stack` — the provider and the stack itself are mounted once in `routes/__root.tsx`. No third-party toast library is installed; never add one. Branch on `APIError.status`/`.code`, never on message text.
- **Reuse before adding** — see [Component sourcing](#component-sourcing): `arc/` first, `ui/` second, install from the `@uiarc`/shadcn registries when something is missing, and ask the user before writing a bespoke component or adding a dependency.
- **Buttons with actions use `ActionButton`.** Every button performing an action must use `@/components/arc/action-button/action-button` rather than a standard `ui/Button` with custom pending state.
- **Copy operations require `useClipboard`.** All copy interactions must use `useClipboard` from `@/hooks/useClipboard` (`hooks/useClipboard.ts`) rather than direct `navigator.clipboard`.
- **Naming casing:** Format acronyms and IDs in uppercase: `API` (not `Api`) and `ID` (not `Id`/`id`, e.g. `providerID`, `keyID`, `useAPIKey`).
- **`{arc, ui}` under `components/` are off-limits: never edit, rename, or move anything in them.** Those two folders are library/vendor code — `ui/` is shadcn generated, `arc/` is UIARC — so their file names, directory names, and exported identifiers are frozen. Do not rename a file, a folder, or an identifier there, and do not "tidy" their contents while making an unrelated change. Work inside them only when the task is explicitly about that component, and even then keep every existing name.
- **Everywhere else under `components/`, naming is PascalCase for exported identifiers.** For `layout/`, `providers/`, and the root files (`theme-provider.tsx`, `admin-auth-provider.tsx`), a component, hook, context, or type is PascalCase (`AppShell`, `SectionHeader`, `ProviderLogo`, `APIKeyPanel`, `OAuthPanel`, `ConnectAccountModal`, `useAdminAuth`). This is the rule for new code and the direction existing code is moving; do not rename an existing identifier to apply it unless the task asks for that rename.
- **Forms and submission:** No external form libraries (like TanStack Form). For simple forms use controlled `useState`; for grouped fields and submit status (pending, error), use React 19's built-in `useActionState` — zero new dependencies, safe against repo rules.
- **Export shape, all files:** a file that exports one function uses `export default` alone — hooks, utilities, and components alike (owner's rule, 2026-10-18). A file that exports more than one thing uses named exports only, and no `export default`. Callers follow suit: `import useClipboard from "@/hooks/useClipboard"`, `import { useA, useB } from "@/hooks/useAB"`, `import ResponsiveDialog from "@/components/seavx/ResponsiveDialog"`. Vendor files under `components/{arc,ui}/` keep whatever they ship. Existing named exports are not renamed to comply.
- **Serial, not clever.** The formatter is prettier with the Tailwind plugin: no semicolons, double quotes, 80 columns. Do not reformat unrelated code.

## Component sourcing

Two component libraries are installed and registered. The order is fixed:

1. **`components/arc/` — UIARC (primary vocabulary).** Copy-paste components with CSS modules and
   semantic tokens (`foundation.css`, installed once; `data-theme="light|dark"` on `<html>`). Docs:
   the library index is <https://uiarc.dev/llms.txt>; every component has its own markdown page
   (when to use / when not to, props, keyboard, accessibility, motion, responsive). Read that page
   before using a component, and use only documented props.
2. **`components/ui/` — shadcn/ui on Base UI.** Docs: <https://ui.shadcn.com/docs> (full component
   directory; machine-readable index at <https://ui.shadcn.com/llms.txt>). Compose with Base UI's
   `render` prop, never Radix `asChild`.

**When a needed component does not exist in either folder:**

- First try to compose it from what is there — that is what the Arc blocks are for.
- Otherwise **install it from the registry, do not hand-roll it**: `bunx shadcn@latest add @uiarc/<name>`
  (the `@uiarc` registry is already declared in `client/components.json`) or `bunx shadcn@latest add <name>`
  for shadcn/ui. Arc free items install the same way; Arc **Pro** items are licensed — never reconstruct
  their source, offer the free alternative instead.
- If neither registry carries it either, **stop and tell the user** which component is missing and what
  you propose to add. Do not invent a bespoke component or add a dependency without that answer.

Arc house rules (from the library's agent rules): semantic tokens only (`--surface`, `--foreground`,
`--text-secondary`, `--border`, `--accent`, `--success/warning/danger`), motion through the presets in
`components/arc/lib/motion-tokens.ts` with a reduced-motion branch, sentence-case copy, regular/medium
weights only, no decorative gradients or glows, no focus rings on pointer focus.

## Verification

```bash
cd client
bun run typecheck   # tsr generate && tsc --noEmit — always run
bun run lint        # eslint .
bun run build       # production bundle; run when the change affects routing or the shell
```

A green typecheck is not proof. For any UI change, load the app in a browser and exercise the changed path — the session gate, the proxy, and the cookie behaviour only fail at runtime.

## References

| File                                                       | Read it for                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| [`references/architecture.md`](references/architecture.md) | Route tree, provider nesting, data flow, where files belong           |
| [`references/api.md`](references/api.md)                   | The fetch layer, error contract, endpoint table, wire types, SSE      |
| [`references/conventions.md`](references/conventions.md)   | TypeScript, React, styling, forms, state, and naming rules            |
| [`references/verification.md`](references/verification.md) | Commands, dev proxy, serving the built dashboard, manual smoke checks |
