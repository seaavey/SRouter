# Overview E2E

Playwright suite for the gateway overview (`/`), run in the four UI modes the
product supports: `hp` (390×844), `tablet` (768×1024), `laptop` (1366×768),
`desktop` (1920×1080).

```bash
cd client
bun run e2e                 # all four modes, one worker
bun run e2e --project=hp    # one mode
bun run e2e --ui            # watch/debug
```

`bun run e2e` builds the SPA and the debug server binary, so the first run is
slower. Set `E2E_SKIP_BUILD=1` to reuse what is already built.

## What it talks to

`e2e/support/stack.ts` is started by Playwright's `webServer` and owns the whole
fixture:

- a throwaway SQLite file under `e2e/.tmp/` (never `~/.srouter/srouter.db`),
- a mock OpenAI-compatible upstream on `127.0.0.1:4100`,
- the real gateway on `127.0.0.1:3100`, serving the built SPA,
- six gateway requests through the production path, so the page renders
  telemetry that came out of the request log rather than a stubbed response,
- `e2e/.tmp/storage-state.json`, the admin session the specs reuse.

The gateway refuses a user-registered provider on a loopback address (the SSRF
guard), so the mock provider row is written straight into the temporary
database. Everything after that is real: the registry loads the row, the chat
requests travel the gateway pipeline, and the log rows are recorded by the
production handler.

Ports are overridable with `E2E_PORT` and `E2E_UPSTREAM_PORT`.

## Specs

| File | Covers |
| --- | --- |
| `overview.spec.ts` | KPI figures, token throughput and cache rate, all four ranges, the tokens/requests metric switch, plot summary, table sorting, active-model badge, live event stream, clean console |
| `responsive.spec.ts` | No horizontal overflow, drawer vs rail, stacked vs inline header, KPI columns, content padding, table scroll containment, every control reachable, a screenshot per mode |
| `states.spec.ts` | Analytics failure with Retry, and an empty window (both by intercepting only that endpoint) |
| `auth.spec.ts` | Anonymous redirect, master-password sign-in, HttpOnly session cookie, wrong password refused |

Figures are compared against `GET /v1/logs/analytics` read by the test, not
against hardcoded snapshots, so a spec fails when the screen disagrees with the
endpoint. The seeded totals from `support/data.ts` are asserted separately as a
fixture-integrity check.

Artifacts (screenshots, traces) land in `e2e/.tmp/results/`, which is ignored.

## Lightpanda

`bun run e2e:lightpanda` runs a functional smoke on
[Lightpanda](https://lightpanda.io) over CDP (`lightpanda serve --port 9222`,
stack already running). It signs in, reads the KPI card, switches the range, and
counts the table rows.

It does **not** replace the four-mode suite. Measured against this app with
Lightpanda 1.1.0:

- `newContext({ viewport })` sets `window.innerWidth` but not the layout width:
  `document.body` stays 1920px and `matchMedia` reports every breakpoint as
  false, even with external stylesheets enabled. Tailwind's responsive classes
  therefore never change.
- `page.route()` is accepted and silently not applied, so the error and empty
  states cannot be produced.
- Screenshots render the text layout, not pixels.

So Lightpanda answers "does the screen work", not "does the layout hold at this
size".
