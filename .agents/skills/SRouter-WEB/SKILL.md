---
name: srouter-web
description: |
    Comprehensive development skill for the SRouter React 19 Web Dashboard (`apps/web`). Use whenever working on, modifying, debugging, or reviewing: TanStack Router page routes (`routes/keys.tsx`, `routes/combo.tsx`, `routes/providers/`, `routes/playground.tsx`, `routes/settings.tsx`, `routes/logs.tsx`), feature-based components (`components/keys/`, `components/combo/`, `components/providers/`, `components/playground/`, `components/ui/`), TanStack Query hooks (`useKeys`, `useProvider`, `useFallbacks`, `useFavorites`), Tailwind v4 OKLCH theme styling, Base UI primitives, streaming chat/playground UX, optimistic updates & query invalidations, or `/v1` API client integrations (`lib/api.ts`).
---

# ⚡ SRouter — Web Dashboard Skill

Development workflow for the SRouter React dashboard (`apps/web`).

## When To Read References

| Reference | Use When |
| --- | --- |
| `references/architecture.md` | Navigating routes/components/hooks structure |
| `references/conventions.md` | Editing React/TanStack/Tailwind patterns |
| `references/playground.md` | Working on streaming chat & playground UX |
| `references/verification.md` | Running build/test/debug workflows |

Load the relevant reference before modifying that subsystem.

## Stack

- React 19
- TypeScript ESM
- TanStack Router
- TanStack Query v5
- Tailwind CSS v4
- Motion
- Lucide React
- Sonner
- Vite

## Core Architecture

```text
routes/*
  ↓
components/*
  ↓
hooks/*
  ↓
lib/api.ts
  ↓
/v1 API
```

The dashboard is a thin orchestration layer over the `/v1` API.

## Core Rules

- routes own page composition only
- hooks own server-state orchestration
- components stay presentation-focused
- centralize API calls in `lib/api.ts`
- prefer TanStack Query over manual fetch state
- preserve `/v1` endpoint normalization
- import versions from `@srouter/constants`
- avoid duplicated endpoint strings
- use OKLCH theme tokens from `styles.css`
- avoid `any`
- use strict inferred types from schemas/hooks

## Development Workflow

When implementing frontend changes:

1. trace route ownership from `src/routes`
2. inspect shared hooks before adding state
3. reuse existing UI primitives from `components/ui`
4. keep API normalization inside `lib/api.ts`
5. validate loading/error states
6. verify responsive + dark mode behavior
7. run targeted build verification

## Common Commands

```bash
cd apps/web && pnpm dev
cd apps/web && pnpm run build
cd apps/web && pnpm run lint
```

## Important Constraints

- route files should stay thin
- avoid colocated fetch logic in pages when hooks exist
- streaming UI must tolerate partial/incremental responses
- mutations must invalidate affected queries explicitly
- never hardcode provider/model/version metadata
- avoid introducing global state unless query state is insufficient
