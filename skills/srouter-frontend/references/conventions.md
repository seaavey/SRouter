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
- Path alias `@/*` → `client/src/*`. Use it for cross-area imports; keep relative imports inside a folder (as `components/gauge/` does with `./math`).

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
| `Omit<T, K>`                      | a wire type with one field overridden (`Omit<SVGProps<SVGSVGElement>, "viewBox">` in `gauge.tsx`) |
| `Partial<T>`                      | every field optional on this path, but the names must stay the server's                           |
| `Exclude<U, X>` / `Extract<U, X>` | narrowing a union (`Record<Exclude<GaugeTooltipSide, "auto">, Point>` in `tooltip.tsx`)           |
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
- `src/components/gauge/` is a self-contained SVG kit (arcs, ticks, needle, tooltip, spring animation) with a barrel export at `components/gauge/index.ts`. It has zero imports today — reuse it for dials and meters instead of adding a chart library.

## Forms

No form library is installed. The pattern is the login screen's:

- `useState` per field, controlled inputs.
- `onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}` — auth mutations come from `useAdminAuth()`; navigation rides in as a per-call `{ onSuccess }` callback.
- Validation inline and derived (`const mismatch = confirmation !== password`), with the submit button `disabled` while invalid or pending.
- The submit button carries the pending label (`"Working…"`) rather than a separate spinner.

## Errors and states

- No toast library and no error boundary. Render errors inline, next to the action, as `text-destructive text-xs`.
- Map errors to a sentence with a local `describe(error)` helper that branches on `instanceof APIError`, then `status` (e.g. `429`), then falls back to `error.message`.
- Handle `isPending` and `isError` explicitly — never render `undefined` from `data` and call it a state.
- Primitive-level failures throw (`throw new Error("useTheme must be used within a ThemeProvider")`); recoverable ones return UI.

## Naming

| Thing           | Convention                 | Example                                       |
| --------------- | -------------------------- | --------------------------------------------- |
| Files           | kebab-case                 | `theme-provider.tsx`, `use-animated-value.ts` |
| Components      | PascalCase, named export   | `GaugeTooltip`, `Button`                      |
| Hooks           | `use-` file, `useX` export | `use-animated-value.ts` → `useAnimatedValue`  |
| Query factories | `xQuery`                   | `adminStatusQuery`                            |
| Types           | PascalCase                 | `LoginSearch`, `GaugeFit`                     |
| Route IDs       | the file path              | `createFileRoute("/_authenticated/keys")`     |
| Local helpers   | verb phrase, lowercase     | `describe`, `afterAuth`, `isEditableTarget`   |

## Comments

Comments explain **why**, not what — the existing code is dense with rationale (why the proxy cannot strip `Origin`, why retries are off, why the guard awaits instead of reading cache). Match that. A comment restating the next line is noise; a comment recording the trap that motivated the line is the house style. No tick-box comments, no `TODO` stubs left behind.
