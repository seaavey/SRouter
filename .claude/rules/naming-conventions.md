# Frontend Naming and Placement Rules

These rules apply to new files under `apps/web/src` and to existing frontend files being changed.

- A standalone React hook whose public name is `use<Name>` belongs in `apps/web/src/hooks/use<Name>.ts`. Use `.tsx` only when the hook file contains JSX.
- `<Name>` must be a single word — file name matches the hook name exactly.
- Examples: `useTheme` → `apps/web/src/hooks/useTheme.ts`; `useCopy` → `apps/web/src/hooks/useCopy.ts`.
- Any React context, context value, or provider belongs in `apps/web/src/context/<Name>.tsx`, using PascalCase for `<Name>`. Examples: `ThemeContext`/`ThemeProvider` → `apps/web/src/context/Theme.tsx`; `AuthContext`/`AuthProvider` → `apps/web/src/context/Auth.tsx`.
- A hook that only reads a context and is intentionally part of that context module may remain exported from the context file; do not create a duplicate standalone hook. If the hook is independent of a context, use the `hooks/<Name>.ts` rule instead.
- Feature components belong in `apps/web/src/components/<feature>/` and shared UI primitives belong in `apps/web/src/components/ui/`.
- Do not rename existing files solely to satisfy these conventions unless the task explicitly includes a migration and all imports are updated.
