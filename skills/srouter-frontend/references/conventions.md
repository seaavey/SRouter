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
- `onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}`.
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
