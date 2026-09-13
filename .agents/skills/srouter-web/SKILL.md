---
name: srouter-web
description: Use when changing the SRouter React dashboard.
version: 1.1.0
author: Muhammad Adriansyah (Seaavey), Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
    hermes:
        tags: [srouter, react, dashboard, tanstack, responsive-ui]
        related_skills: [srouter-task-workflow]
---

# SRouter Web Skill

Use this skill for `apps/web`: React routes, dashboard components, provider UI, TanStack Query, streaming UX, layouts, themes, and `/v1` integration.

## When to Use

- File-based routes, hooks, components, API client calls, mutations, or query invalidation.
- Provider configuration, playground/chat streaming, loading/error/empty states, responsive layouts, or accessibility.

## Repository Rules

- Read `RULES.md`, `CODING-STYLE.md`, and `DESIGN.md` in `/home/seaavey/Obsidian/SRouter/` before editing.
- Routes compose pages; hooks own server-state orchestration; components remain presentation-focused.
- Use `src/lib/api.ts` and TanStack Query. Do not hand-edit `src/routeTree.gen.ts`.
- Use shared contracts from `@srouter/types` and preserve `snake_case` at the API boundary. Local UI state may use camelCase.
- Import version/provider metadata from `@srouter/constants`; do not duplicate endpoint strings or catalogs.
- Use semantic controls, visible `focus-visible` states, `aria-label` for icon-only buttons, and minimum 44px touch targets.
- Use semantic CSS variables from `styles.css`; no decorative gradients, glows, or unnecessary nested cards.
- Design responsive behavior explicitly for base, `sm`, `md`, `lg`, `xl`, and `2xl`. Prevent identifier clipping and horizontal overflow.
- Realtime dashboard data uses typed SSE contracts when available; do not add high-frequency polling as a shortcut.

## Procedure

1. Inspect `git status`, route ownership, relevant hooks/components, shared types, and all usages before editing.
2. Load the relevant reference under `references/` before changing the subsystem.
3. Trace request payloads to the backend validator or shared schema before changing a mutation.
4. Preserve loaded, loading, empty, and error geometry; update skeletons when layout changes.
5. Test the changed interaction, including dark mode, responsive behavior, keyboard focus, and mutation feedback where applicable.
6. Update `/home/seaavey/Obsidian/SRouter/PROGRESS.md` with scope and verification evidence.

## Verification

Use focused checks and avoid resource-heavy root commands.

```text
cd apps/web && pnpm run lint
pnpm exec prettier --check <changed-files>
git diff --check
```

Run `cd apps/web && pnpm run build` only when the touched change requires production bundle verification and resources allow it. For dashboard serving, verify hashed assets use immutable caching while `index.html` remains revalidated. Report exact checks run.
