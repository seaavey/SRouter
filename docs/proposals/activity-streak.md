# Activity Streak

Status: Proposal only — no implementation is included in this pull request.

## Summary

Add a Duolingo-style activity streak to the SRouter dashboard. The streak answers a simple question: has the operator actively used SRouter today, and did they use it yesterday?

The first version should measure authenticated dashboard activity, not background gateway traffic. A dashboard visit while the admin session is authenticated counts as activity once per local calendar day. This keeps the feature aligned with the operator experience and avoids a noisy streak caused by automated API clients.

## Goals

- Show whether the authenticated operator was active today.
- Show whether the operator was active yesterday.
- Show the current consecutive-day streak.
- Show the longest streak.
- Show a compact recent activity history so the state is understandable.
- Persist activity in the existing database and protect it with the existing admin session.
- Make day boundaries explicit and consistent with the server timezone.

## Non-goals

- No gamification points, badges, leaderboards, reminders, notifications, or freeze tokens.
- No per-user account system; SRouter currently has one local admin session.
- No counting arbitrary provider/API traffic as dashboard activity.
- No historical backfill from request logs in the first release.
- No separate dashboard route; the first release belongs on the main dashboard.

## Proposed behavior

### Activity definition

- A successful authenticated request to the dashboard activity endpoint records activity for the current calendar day.
- Repeated requests on the same day are idempotent and do not create duplicate daily records.
- The frontend calls the endpoint after the existing admin session gate confirms authentication.
- The endpoint must require the existing admin session; unauthenticated access must not reveal streak data.

### Day and timezone rules

- Store a canonical `activity_date` as `YYYY-MM-DD` rather than deriving streaks from timestamps at read time.
- Resolve the current date using the timezone configured on the SRouter server at runtime.
- Do not use the browser timezone for streak calculations.
- Return the resolved server timezone in the API response so the dashboard can explain the day boundary.
- A calendar day changes at 00:00 in the server timezone.
- Resolve one server `now` value and one local date at the start of each request. Use that same snapshot for insertion, today/yesterday status, the 7-day window, and the response.
- A request that crosses midnight is assigned to the date resolved when the operation starts.
- Invalid timezone configuration must produce an explicit server error; it must not silently fall back to the browser timezone.
- A dashboard that remains open across midnight updates on its next load or refetch. The first release does not add a dedicated midnight timer.

### Streak calculation

- `is_active_today` is true when today's activity record exists.
- `is_active_yesterday` is true when yesterday's activity record exists.
- `current_streak` counts consecutive active dates ending today when active today; otherwise it counts consecutive dates ending yesterday, so a user who has not opened the dashboard today still sees the streak preserved until the current day is missed.
- `longest_streak` is the maximum consecutive run in all stored activity dates.
- With no activity, all booleans are false and both streak counts are zero.
- Missing days break a streak. Duplicate activity for one date must not extend it.

### Streak states

The frontend derives the display state from the two activity booleans and the streak count:

- `new`: both streak counts are zero and there is no activity history.
- `active`: `is_active_today` is true.
- `at_risk`: today is inactive and yesterday is active.
- `inactive`: today and yesterday are both inactive after a previous streak.

The frontend may use these labels for presentation, but the server remains the source of truth for dates and counts. Status must be communicated with text and structure, not color alone.

## API contract

Add authenticated endpoints under `/v1`:

`GET /v1/activity/streak` reads the current state without recording activity.

`POST /v1/activity/streak` records today's activity and returns the same compact state.

The POST request has an empty JSON body. Both endpoints return the same compact state:

```json
{
    "object": "activity_streak",
    "timezone": "Asia/Jakarta",
    "today": "YYYY-MM-DD",
    "is_active_today": true,
    "is_active_yesterday": false,
    "current_streak": 1,
    "longest_streak": 4,
    "active_dates": ["YYYY-MM-DD"]
}
```

`active_dates` contains the active dates within the latest 7 calendar days, ordered oldest first. It may contain fewer than 7 entries. The frontend uses `today` and the server timezone to render the seven-day strip; it must not use the browser's current date for streak calculations.

The POST operation is authenticated and idempotent. Repeated or concurrent requests for the same server-local date create at most one row. Response validation must use the existing runtime schema conventions. Error behavior must follow the existing API envelope and authentication conventions. Authenticated streak responses must not be shared across sessions by caching.

## Persistence

Add a table through the existing declarative database initialization:

- `activity_date TEXT PRIMARY KEY`
- `created_at INTEGER NOT NULL`

Use a unique primary key on `activity_date`. Insert with conflict-ignore semantics so concurrent dashboard loads cannot create duplicates or inflate the streak. Keep this schema compatible with SQLite and PostgreSQL query conventions used by the repository.

The single-admin model is intentional for this release, so no `user_id` is required. Store `created_at` using the existing database timestamp convention. Insert and read operations must return a consistent state under concurrent requests without allowing a duplicate date to inflate either streak.

No destructive migration or data rewrite is needed. Document any non-automatic schema change according to the repository database rules if the implementation requires one.

## Dashboard UX

Add one compact activity streak panel to the existing dashboard overview, following current card, typography, theme token, and loading/error patterns.

The panel should show:

- A clear state label derived from the returned activity booleans.
- Current streak with a restrained flame/activity icon.
- A small comparison line: `Yesterday: active` or `Yesterday: not active`.
- A 7-day activity strip using plain day cells. Each cell must expose its date and active/inactive status to assistive technology.
- A simple new-user message when no activity history exists, while keeping the same 7-day strip geometry.
- A recovery-oriented message for `at_risk` and a neutral explanation for `inactive`, without shame or fake urgency.

Use the existing SRouter dashboard components from `apps/web/src/components/ui` and existing dashboard composition patterns. These local components are the project's shadcn/ui source and must be reused before adding anything new. Reuse the existing spacing scale, typography, semantic colors, theme tokens, icon set, radius, focus styles, and animation patterns. Do not introduce a separate visual language, custom breakpoint, new icon family, gradient, glow, or decorative badge treatment.

The flame/activity icon is informational and must not be the only state indicator. Any success animation runs only after a newly recorded activity day, uses transform and/or opacity, lasts less than 300 ms, does not loop or replay on ordinary refetch, and is reduced or disabled for `prefers-reduced-motion`. Do not add particles, confetti, or continuous animation.

The first release has no milestone celebration. Current and longest streak numbers are sufficient feedback; milestone UI, badges, points, leaderboards, reminders, notifications, and freeze tokens require a separate product decision.

## Frontend data flow

- Add a typed API method and response type using the existing centralized API client.
- Add a TanStack Query hook with a stable key such as `["activity-streak"]`.
- Read the state after admin authentication is established, then record today's activity through the idempotent POST operation.
- Store the response in the activity query and update it after a successful POST.
- Refetch only through the existing dashboard lifecycle. Window-focus refetch must use GET and must not record activity.
- Render a dedicated skeleton matching the panel geometry and an actionable error state.
- Auth/session failures must remain distinct from an ordinary inactive streak. A failed request must not be rendered as `inactive`.
- Do not hand-edit `routeTree.gen.ts`.

### Accessibility and responsive behavior

- The panel is usable without interaction if it is read-only; use semantic text rather than fake buttons or links.
- Decorative icons use `aria-hidden="true"`.
- Each day cell has an accessible name containing its date and activity status.
- Active/inactive state, streak counts, and at-risk status are understandable without color or the flame icon.
- Focus-visible styles and contrast must follow the existing SRouter rules. Respect `prefers-reduced-motion` and preserve usability at 200% browser zoom.
- Define behavior from base through `sm`, `md`, `lg`, `xl`, and `2xl`. On narrow screens, the metric and strip may stack, but the page must not horizontally overflow and touch targets must remain at least 44px.
- Verify light and dark themes at the existing SRouter viewport targets: 375, 390, 414, 640, 768, 1024, 1280, and 1536px widths.

## Acceptance criteria

- [ ] An authenticated dashboard load records at most one activity row for the configured local date.
- [ ] An unauthenticated request cannot read or write streak data.
- [ ] Today/yesterday status is correct around midnight in the server timezone.
- [ ] One server-time snapshot determines the inserted date, today/yesterday status, 7-day window, and response, including a request crossing midnight.
- [ ] Current streak handles active-today, at-risk, inactive-today, missed-day, duplicate-day, new-user, and empty-history cases.
- [ ] Longest streak remains correct after a new activity day and after a gap.
- [ ] Concurrent/retried activity requests remain idempotent.
- [ ] The response contains only the current summary fields and active dates from the latest 7-day window.
- [ ] Invalid timezone configuration fails explicitly without using the browser timezone.
- [ ] SQLite tests cover schema creation, duplicate insertion, date boundaries, and streak calculation.
- [ ] API tests cover authentication and the endpoint response envelope.
- [ ] Web tests or focused type/build verification cover loading, success, new-user, active, at-risk, inactive, auth/session error, and ordinary error states.
- [ ] Icon animation is one-shot, subtle, under 300 ms, and reduced or disabled for `prefers-reduced-motion`.
- [ ] Day cells and state labels are understandable to screen readers without relying on color.
- [ ] The panel is responsive across base, `sm`, `md`, `lg`, `xl`, and `2xl`, theme-safe, usable at 200% zoom, and follows existing dashboard design patterns.
- [ ] Focused package tests/builds pass; `git diff --check` and focused Prettier checks pass.

## Implementation slices

1. Database and pure streak calculation
    - Add the daily activity table, idempotent insert/read helpers, timezone date resolver, and focused unit tests.
2. Authenticated API endpoint
    - Add the route/controller/logic path, typed response contract, auth coverage, and endpoint tests.
3. Dashboard integration
    - Add the hook, mutation/query flow, panel, skeleton, and responsive/error states.
4. Verification and documentation
    - Run focused tests/builds, review the diff, and update any required database migration documentation.

## Product decisions

- Use the SRouter server timezone as the single source of truth. Do not add a separate Settings control in the first release.
- Record activity on every successful authenticated dashboard load. The daily primary key makes repeated loads safe and matches the simple Duolingo-style behavior.
- Show a 7-day activity strip to keep the first dashboard panel compact and immediately understandable.
