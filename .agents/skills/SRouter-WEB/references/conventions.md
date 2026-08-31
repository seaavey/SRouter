# Conventions

## TypeScript & Schemas

- use strict typing
- avoid `any`
- prefer inferred types from `@srouter/types` and TanStack Query hooks
- **API Payloads & Contracts**: Consume and send API data contracts strictly using canonical `snake_case` fields (`base_url`, `api_key`, `rate_limit`, `usage_tokens`, `require_api_key`) matching backend schemas.
- keep helper and component names PascalCase
- keep utility functions pure where possible

## React

Prefer:

- composable components
- guard clauses
- derived state over duplicated state
- TanStack Query for server state

Avoid:

- deeply nested component state
- duplicated mutation logic
- route-level business orchestration
- giant all-in-one page components

## Styling

Use:

- Tailwind CSS v4
- OKLCH tokens from `styles.css`
- existing spacing/layout conventions

Before adding styles:

1. check existing `ui/*` primitives
2. reuse layout utilities
3. verify dark mode compatibility
4. verify mobile responsiveness

## UX Rules

- loading states must be explicit
- mutation failures must surface actionable errors
- streaming UIs must tolerate partial chunks
- optimistic updates must rollback safely
- destructive actions should require confirmation

## Query Patterns

Mutations should:

1. perform request
2. invalidate affected queries
3. show toast feedback
4. preserve consistent cache state

Avoid hidden implicit refresh behavior.
