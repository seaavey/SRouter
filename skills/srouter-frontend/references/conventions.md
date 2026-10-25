# Conventions

## Formatting — non-negotiable

`client/.prettierrc`, enforced by `bun run format`:

| Option          | Value                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `semi`          | `false` — no semicolons                                                                                |
| `singleQuote`   | `false` — double quotes                                                                                |
| `printWidth`    | `80`                                                                                                   |
| `tabWidth`      | `2`                                                                                                    |
| `trailingComma` | `es5`                                                                                                  |
| `endOfLine`     | `lf`                                                                                                   |
| plugins         | `prettier-plugin-tailwindcss` with `tailwindStylesheet: src/index.css`, `tailwindFunctions: [cn, cva]` |

The Tailwind plugin sorts class strings, including those inside `cn(...)` and `cva(...)`. Write them in the order you think best and let the formatter settle it — but never hand-reorder an unrelated class string.

## TypeScript

- `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `erasableSyntaxOnly`, `verbatimModuleSyntax` — all on (`client/tsconfig.app.json`).
- `verbatimModuleSyntax` means **type-only imports must say so**: `import type { SVGProps } from "react"`, or `import { cva, type VariantProps } from "class-variance-authority"`.
- `erasableSyntaxOnly` bans TS syntax that needs emit — no `enum`, no parameter properties, no namespaces.
- Type aliases (`type X = { ... }`) for props and local shapes; `interface` only for declaration merging at the top level. No `any`; prefer inference from the generated wire types.
- Target `es2023`, `moduleResolution: bundler`, `jsx: react-jsx` — no `import React from "react"` needed.
- Path alias `@/*` → `client/src/*`. Use it for cross-area imports; keep relative imports inside a folder (as `components/arc/bottom-sheet/` does with `./bottom-sheet.module.css`).

### Type discipline

**No `any`, ever.** It is the one type that switches the checker off: every property
access, every call, every index is accepted, so a renamed wire field reaches runtime
without a word. `client/src` contains none today — keep it that way. The two legitimate
needs it is usually reached for have proper answers: an unvalidated value is narrowed by
a guard, and an intentionally open record is `Record<string, T>` with a named value
type.

```ts
// Wrong — the shape is unchecked from here on.
const parse = (input: any) => input.error.code;

// Right — the union narrows, and everything below it is checked.
function errorCode(input: ErrorEnvelope): ErrorCode | null {
  return input.error.code ?? null;
}
```

**No `unknown` either.** It is the disciplined version of the same hole — it stops the
crash but still defers every decision to a later `instanceof`. Reach instead for the
narrowest true type: `Error | null` for a TanStack Query error, `object` for a JSON
request body, and the generated wire type for a response. Where a value genuinely has no
type yet, give it the type it will have after validation and guard at the boundary.

```ts
// Wrong — pushes every decision to the caller.
function describe(error: unknown) { … }

// Right — TanStack Query already promises `Error | null`.
function describe(error: Error | null) { … }
```

A cast is the same failure wearing a different hat. `as SomeWireType` asserts a shape
instead of proving it, and the checker then trusts the lie. Narrow with a guard; if you
genuinely cannot prove the shape, the honest signature takes the narrowest true type and
returns a narrowed one.

**Derive, never duplicate.** The generated wire types are the source of truth, so a
client type is a _view_ of one — `Pick`, `Omit`, `Partial`, `Exclude`, `Record` — not
a second copy of the same fields. A re-declared shape is a defect: it drifts from the
server the moment a field is renamed and nothing fails to compile.

```ts
// A second copy of what `APIKeyResponse` already says — drifts silently.
type KeyRow = { id: string; name: string; enabled: boolean };

// A view. A field added or renamed in Rust shows up here for free.
type KeyRow = Pick<APIKeyResponse, "id" | "name" | "enabled">;
```

Reach for the built-in utility before writing an object type by hand:

| Utility                           | Use it when                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Pick<T, K>`                      | a screen shows part of a wire type                                                                |
| `Omit<T, K>`                      | a wire type with one field overridden (`Omit<ComponentPropsWithoutRef<typeof SelectPrimitive.Root>, "children">` in `arc/select/select.tsx`) |
| `Partial<T>`                      | every field optional on this path, but the names must stay the server's                           |
| `Exclude<U, X>` / `Extract<U, X>` | narrowing a union (`Extract<HTTPMethod, "GET" \| "POST" \| "PATCH" \| "DELETE">` in `api/client.ts`) |
| `Record<K, V>`                    | an exhaustive lookup table **keyed by a union** — see below                                       |
| `keyof typeof x`                  | the key union of a const object, instead of restating it                                          |
| `ReturnType<F>`, `Parameters<F>`  | typing against another function's signature without repeating it                                  |
| `NonNullable<T>`                  | dropping `null` after a guard                                                                     |

`Record<K, V>` gets the emphasis because it is where the discipline pays: keyed by the
union, the compiler rejects a missing or misspelled entry. `Record<string, V>` checks
nothing — it only names the value type.

```ts
// Adding a family without an entry fails to compile.
const fontClass: Record<FontFamily, string> = { … }

// `satisfies` keeps the literal keys visible to the caller and still checks them.
const sides = { top: 0, right: 1 } satisfies Record<Side, number>
```

**No `enum`** — `erasableSyntaxOnly` bans it, and it is not needed. A const object plus
a literal union is the replacement, and it is exactly what the generated `ErrorCode`
already is: `export type ErrorCode = …` beside `export const ErrorCode = { … } as const
satisfies Record<ErrorCode, ErrorCode>`. Do not hand-write an enum-shaped object with a
parallel union; derive one from the other or join them with `satisfies Record<Union, V>`
so the two cannot disagree.

**Exhaustiveness is enforced, not hoped for.** A `switch` over a union ends in a `never`
assignment, so a new variant is a compile error rather than a silent fallthrough:

```ts
type Zone = "idle" | "loading" | "failed";

function label(zone: Zone): string {
  switch (zone) {
    case "idle":
      return "Idle";
    case "loading":
      return "Loading…";
    case "failed":
      return "Unavailable";
  }
  const unreachable: never = zone;
  return unreachable;
}
```

Drop the `failed` case and the `never` line stops compiling, so a new variant cannot
ship unhandled. Against a 35-member union like the generated `ErrorCode` the switch has
to cover every member you do not want falling into the default branch — the compiler,
not a reviewer, is what catches the one left out.

**Annotate the exported surface.** Function parameters are always written out — they are
the contract. The return type needs writing only where the body does not say it plainly:
`request<AdminAuthResult>(…)` already reads as `Promise<AdminAuthResult>`, so annotating
that again is noise, while a widened or conditional return must be written because
inference would change it silently.

```ts
// Inference is fine: the call states the type.
export function loginAdmin(input: AdminLoginInput) {
  return request<AdminAuthResult>("/v1/admin/login", { method: "POST", body: input })
}

// Written out: the conditional and the union would otherwise widen.
export function describe(error: unknown): string { … }
```

## React

- Function components only; `StrictMode` is on, so effects run twice in dev — an effect that is not idempotent is a bug, not a dev-only quirk.
- Named exports for components (`export function ThemeProvider`, `export { Button, buttonVariants }`). Route files export a `Route` const, which is the one exception.
- **One function per file MUST use `export default` only.** A file that exports a single function — a hook in `hooks/*`, a utility, or a component — uses `export default` and no named export beside it (owner's rule, stated 2026-10-18; do not write `export function useX` alongside `export default useX`). Callers import it without braces (`import useClipboard from "@/hooks/useClipboard"`, `import ResponsiveDialog from "@/components/seavx/ResponsiveDialog"`). This governs new files: existing named exports are not renamed to comply.
- **Multiple-export hooks/modules MUST use named `export` only.** When a file exports more than one item (multiple hooks or functions), use named exports only (`export function useA`, `export function useB`), and do not use `export default`. Callers import them with braces (`import { useA, useB } from "@/hooks/use..."`).
- Props are a `type` above the component; spread-through components keep the primitive's props and add variants (`ButtonPrimitive.Props & VariantProps<typeof buttonVariants>`).
- Forward a `data-slot="<name>"` attribute on wrapped primitives, matching the shadcn output.
- Derived state beats duplicated state. Guard clauses over nested conditionals. No `useEffect` + `fetch` — that is what TanStack Query is for.
- `useCallback`/`useMemo` only where a value is a dependency of a provider or an effect, not reflexively.

## Server state

- Declare `queryOptions({ queryKey, queryFn, staleTime })` factories in `src/api/<domain>.ts`, exported as `xQuery`.
- `queryKey` is a `readonly` tuple with `as const`, namespaced by domain: `["admin", "status"]`.
- Always forward `signal` to `request` from `queryFn`.
- Mutations live with the component that triggers them when they are one-off; move them to `src/api/` once a second caller appears.
- After a mutation, invalidate the affected keys explicitly (`queryClient.invalidateQueries({ queryKey: xQuery.queryKey })`). No blanket `invalidateQueries()` and no implicit refresh behaviour.
- `retry: false` and `refetchOnWindowFocus: false` are set globally and deliberately. Do not re-enable retries per query to paper over a failing endpoint.

## Components and styling

- Tailwind utility strings inline. Conditional classes through `cn(...)` from `@/lib/utils` (which re-exports the `cn` package — **not** clsx + tailwind-merge, so do not import those).
- Variants go through `cva` with `defaultVariants`; sizes and variants are named, not ad-hoc class overrides.
- Colour, radius, and chart tokens come from `src/index.css`: `--background`, `--foreground`, `--muted-foreground`, `--primary`, `--destructive`, `--border`, `--input`, `--ring`, `--chart-1..5`, `--sidebar-*`. Use the semantic utility (`text-muted-foreground`, `bg-card`), never a raw colour, and never a hardcoded hex.
- **Both themes are required.** `:root` and `.dark` both define every token in OKLCH; a class that only reads correctly in one is incomplete.
- Density is deliberately tiny: `text-xs` for body copy, `h-7`/`size-7` for controls, `gap-1..3`. Match the surrounding screen rather than importing a looser default.
- shadcn components are generated over **Base UI**, so composition uses Base UI's `render` prop — not Radix's `asChild`.
- `src/components/arc/` (UIARC) is the primary visual vocabulary. Arc components use **CSS modules + CSS variables, not Tailwind classes**, and their tokens live in `components/arc/foundation.css` (`--surface`, `--surface-muted`, `--text-secondary`, `--radius-*`, `--space-*`; theme via `data-theme="light|dark"` on `<html>`, not the `.dark` class the Tailwind tokens use). Screens compose the two idioms — Arc for chrome and controls, Tailwind utilities for page layout — and each stays inside its own rules. Docs: <https://uiarc.dev/llms.txt>.
- **A button that runs an action MUST use `ActionButton`** from `@/components/arc/action-button/action-button` (default export) — never a `ui/Button` plus a hand-rolled `useState` pending flag. Hand it `label` + `onAction` (sync or `async`) and it owns the idle → pending → success → error state machine, the press spring, and the `aria-busy` / `role="status"` announcements; tune it with `successLabel`, `pendingLabel`, `resetAfterMs`, `onActionError`, `shortcut`. Reserve `ui/Button` strictly for controls with no action to report (navigation, toggles, dialog triggers).
- **Copy operations MUST use `useClipboard` (`hooks/useClipboard.ts`), never `navigator.clipboard` directly.** When you need clipboard or copy logic inside a flow, hook, or component, it is mandatory to take `useClipboard` from `@/hooks/useClipboard` (it wraps Arc's `useCopyFeedback` and adds paste — see `useOAuthFlow`); for a standalone copy control, `CopyButton` (`@/components/arc/copy-button/copy-button`) is the ready component. Either way `navigator.clipboard` is reached only inside `use-copy-feedback`, so the "Copied"/error window and permission handling stay single-owner.

## Forms

No external form library (like TanStack Form or React Hook Form) is installed. To avoid unnecessary dependencies and adhere to repository rules (zero new dependencies), forms use native React primitives:

- **Controlled inputs (`useState` per field)**: The simple pattern used on the login screen.
  - `onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}` — auth mutations come from `useAdminAuth()`; navigation rides in as a per-call `{ onSuccess }` callback.
  - Validation inline and derived (`const mismatch = confirmation !== password`), with the submit button `disabled` while invalid or pending.
  - The submit button carries the pending label (`"Working…"`) or uses `ActionButton`.

- **Grouped forms & submit status with `useActionState` (React 19 built-in)**:
  - For handling grouped form fields and form submit status (`pending`, `error`, result state) without any external library (hindari library eksternal seperti TanStack Form), use React 19's built-in `useActionState` from `"react"`.
  - `const [state, formAction, isPending] = useActionState(actionFn, initialState)` manages the entire submission lifecycle natively.
  - Zero new dependencies added — 100% compliant with the repository's dependency constraints.

## Errors and states

- No error boundary. Field validation errors render inline, next to the action, as `text-destructive text-xs`. Action-level feedback (mutation errors, confirmations) goes through the in-house `toast` from `@/components/arc/toast-stack/toast-stack`, mounted in `routes/__root.tsx`.
- Map errors to a sentence with a local `describe(error)` helper that branches on `instanceof APIError`, then `status` (e.g. `429`), then falls back to `error.message`.
- Handle `isPending` and `isError` explicitly — never render `undefined` from `data` and call it a state.
- Primitive-level failures throw (`throw new Error("useTheme must be used within a ThemeProvider")`); recoverable ones return UI.

## Naming

| Thing           | Convention                                                                           | Example                                           |
| --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `*.tsx` files   | PascalCase, no hyphens                                                               | `ThemeProvider.tsx`, `TokenFormPanel.tsx`         |
| Directories     | kebab-case                                                                           | `arc/floating-field/`, `arc/sortable-data-table/` |
| Components      | PascalCase; a one-component file is `export default`, vendor keeps its named exports | `ResponsiveDialog`                                |
| Hooks           | `useX.ts`, `useX` export                                                             | `useOAuthFlow.ts` → `useOAuthFlow`                |
| Query factories | `xQuery`                                                                             | `adminStatusQuery`                                |
| Types           | PascalCase                                                                           | `LoginSearch`, `ProviderLogoProps`                |
| Route IDs       | the file path                                                                        | `createFileRoute("/_authenticated/keys")`         |
| Local helpers   | verb phrase, lowercase                                                               | `describe`, `afterAuth`, `isEditableTarget`       |
| Acronyms / ID   | uppercase, never mixed case                                                          | `useAPIKey`, `providerID`, `keyID`                |

`*.tsx` filenames are PascalCase with no hyphens throughout `client/src`. This is a forward-looking rule: do not rename existing files, and keep TanStack route filenames unchanged unless a separate task explicitly requests a route rename. The only filename exception is the frozen vendor code under `components/ui/` and `components/arc/`; never rename files in those folders. Directories remain kebab-case except feature directories that intentionally use PascalCase, such as `modals/ConnectAccounts/`.

**`{arc, ui}` under `components/` are off-limits.** Never edit, rename, or move anything inside `components/arc/` or `components/ui/`. Both are library code (`ui/` is shadcn, `arc/` is UIARC), so their file names, directory names, and exported identifiers are frozen. Touch them only when the task is explicitly about that component, and keep every existing name even then.

**Everywhere else under `components/`, exported identifiers are PascalCase.** In `components/layout/`, `components/providers/`, and the root files (`theme-provider.tsx`, `admin-auth-provider.tsx`), a component, hook, context, or type is PascalCase: `AppShell`, `SectionHeader`, `Sidebar`, `Topbar`, `ProviderLogo`, `APIKeyPanel`, `OAuthPanel`, `TokenFormPanel`, `ConnectAccountModal`, `useAdminAuth`. Apply it to new code; do not rename an existing identifier just to comply unless the task asks for that rename.

**Hook export rules (`hooks/*`)**:

- **Single export:** Saat export-nya hanya satu, WAJIB menggunakan `export default` saja. Dilarang ada dua (dilarang ada named `export` dan `export default` sekaligus dalam satu file). Di-import tanpa kurung kurawal: `import useX from "@/hooks/useX"`.
- **Multiple exports:** Saat export-nya lebih dari satu, WAJIB menggunakan named `export` saja (`export function useA()`, `export function useB()`), dan dilarang menggunakan `export default`. Di-import dengan kurung kurawal: `import { useA, useB } from "@/hooks/..."`.

**Acronyms and ID casing: `API` and `ID` must be uppercase.**
Acronyms and identifiers must stay in uppercase across everything you write — hooks, variables, types, props, components:

- If it has "Api", it must be **`API`** (never `Api`): e.g. `useAPIKey`, `APIError`, `APIResponse`, `APIKeyStore`.
- If it has "id" / "Id", it must be **`ID`** (never `Id` or lowercase `id` in camelCase/PascalCase identifiers): e.g. `providerID` (never `providerId`), `keyID` (never `keyId`), `userID` (never `userId`), `modelID` (never `modelId`).

The exception is wire field names, which are frozen and lowercase exactly as the server sends them (`id`, `provider_id`, `key_prefix`); the local variable holding one still takes the caps form, so `const providerID = row.provider_id`.

## Comments

Comments explain **why**, not what — the existing code is dense with rationale (why the proxy cannot strip `Origin`, why retries are off, why the guard awaits instead of reading cache). Match that. A comment restating the next line is noise; a comment recording the trap that motivated the line is the house style. No tick-box comments, no `TODO` stubs left behind.
