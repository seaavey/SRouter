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
- Make day boundaries explicit and consistent for the configured SRouter timezone.

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
- Resolve the current date using an explicit SRouter timezone setting, defaulting to `Asia/Jakarta` for this feature.
- Do not use the browser timezone for streak calculations.
- If timezone configuration is later generalized, all streak reads and writes must use the same resolver.
- A calendar day changes at 00:00 in the configured timezone.

### Streak calculation

- `is_active_today` is true when today's activity record exists.
- `is_active_yesterday` is true when yesterday's activity record exists.
- `current_streak` counts consecutive active dates ending today when active today; otherwise it counts consecutive dates ending yesterday, so a user who has not opened the dashboard today still sees the streak preserved until the current day is missed.
- `longest_streak` is the maximum consecutive run in all stored activity dates.
- With no activity, all booleans are false and both streak counts are zero.
- Missing days break a streak. Duplicate activity for one date must not extend it.

## API contract

Add an authenticated endpoint under `/v1`:

`POST /v1/activity/streak`

The request has an empty JSON body. The endpoint records today's activity and returns the complete current state:

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

`active_dates` should contain only the recent window needed by the dashboard (recommended: the latest 30 calendar days), ordered newest first. The server remains the source of truth for streak counts.

Error behavior must follow the existing API envelope and authentication conventions. The operation must be safe to retry.

## Persistence

Add a table through the existing declarative database initialization:

- `activity_date TEXT PRIMARY KEY`
- `created_at INTEGER NOT NULL`

Use a unique primary key on `activity_date`. Insert with conflict-ignore semantics so concurrent dashboard loads cannot create duplicates or inflate the streak. Keep this schema compatible with SQLite and PostgreSQL query conventions used by the repository.

No destructive migration or data rewrite is needed. Document any non-automatic schema change according to the repository database rules if the implementation requires one.

## Dashboard UX

Add one compact activity streak panel to the existing dashboard overview, following current card, typography, theme token, and loading/error patterns.

The panel should show:

- A clear state label: `Active today` or `Not active today`.
- Current streak with a restrained flame/activity icon.
- A small comparison line: `Yesterday: active` or `Yesterday: not active`.
- A 7-day or 30-day activity strip using plain day cells and an accessible legend.
- A recovery-oriented message when today is inactive, without shame or fake urgency.

Avoid adding a new navigation item, notification permission, heavy animation, gradient, or badge collection. The panel must work in both themes and remain readable on small screens.

## Frontend data flow

- Add a typed API method and response type using the existing centralized API client.
- Add a TanStack Query hook with a stable key such as `["activity-streak"]`.
- Call the mutation/query only after admin authentication is established.
- Invalidate or refetch the streak query after a successful record operation.
- Render a dedicated skeleton matching the panel geometry and an actionable error state.
- Do not hand-edit `routeTree.gen.ts`.

## Acceptance criteria

- [ ] An authenticated dashboard load records at most one activity row for the configured local date.
- [ ] An unauthenticated request cannot read or write streak data.
- [ ] Today/yesterday status is correct around midnight in `Asia/Jakarta`.
- [ ] Current streak handles active-today, inactive-today, missed-day, duplicate-day, and empty-history cases.
- [ ] Longest streak remains correct after a new activity day and after a gap.
- [ ] Concurrent/retried activity requests remain idempotent.
- [ ] SQLite tests cover schema creation, duplicate insertion, date boundaries, and streak calculation.
- [ ] API tests cover authentication and the endpoint response envelope.
- [ ] Web tests or focused type/build verification cover loading, success, empty, and error states.
- [ ] The panel is responsive, theme-safe, keyboard/accessibility friendly, and follows existing dashboard design patterns.
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

## Open decisions before implementation

- Should the default timezone remain `Asia/Jakarta`, or should it be configurable in Settings before launch?
- Should activity be recorded on every authenticated dashboard load, or only after a meaningful action such as viewing a page or refreshing data?
- Should the recent activity strip show 7 days for compactness or 30 days for better streak context?
