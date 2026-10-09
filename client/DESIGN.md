# Design System: SRouter

Adapted for this repository from the Oxide Computer design language on
<https://www.ui-skills.com/design-md/oxidecomputer>. The token architecture,
the single-accent rule, the tier-not-opacity rule, and the density stance are
kept. The palette, the typefaces, and the product vocabulary are SRouter's.

`src/index.css` is the implementation. This file is the reasoning: what each
token is for, which decisions are already made, and what is banned.

## 1. What this surface is

SRouter is a self-hosted gateway that sits between the operator's clients and
the upstream model providers. The person using this interface is the operator:
a developer running it on their own machine or VPS, usually while something is
already going wrong.

That single fact sets the tone. The interface is an instrument panel, not a
product tour. It should read the way `htop` or a router's admin page reads:
dense, factual, and quiet until a number demands attention. There is no
marketing surface in this application and no onboarding funnel.

Two consequences worth stating up front:

- **Numbers are the content.** Latency, status codes, token counts, spend,
  quota percentages, connection counts. The layout exists to make those
  scannable and comparable, so numerals get typographic weight that prose does
  not.
- **The failure path is the primary path.** A provider with zero connections, a
  quota about to run out, a request that returned 502. Those states are why the
  operator opened the page. They are designed first, not styled as an
  afterthought.

## 2. Atmosphere

| Dial     | Value                    | Why                                                                                                                        |
| -------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Density  | 8 (cockpit)              | Tables of request logs and model catalogs are the main content. Whitespace is spent to separate sections, not to pad rows. |
| Variance | 3 (predictable)          | An operator looking for a failing request must not re-learn the layout each visit. Consistency is the feature.             |
| Motion   | 2 (hover and state only) | Motion explains a state change (a stream appending, a value updating) and otherwise does not run. No ambient animation.    |

The theme follows the operating system: `ThemeProvider` is mounted without a
`defaultTheme` prop, so it resolves to `"system"` and the `.dark` class tracks
`prefers-color-scheme`. Both themes therefore carry equal weight and both are
verified below. Dark is not a default this design gets to choose; it is one of
two states that must both hold up. An operator watching a gateway for long
stretches will land on dark more often than not, which is why the dark values
are tuned rather than derived.

## 3. Color

Every color is authored in OKLCH, matching the values already in
`src/index.css`. OKLCH makes lightness predictable across hues, so the same
lightness step reads the same in every family.

### The rule that governs everything

**One accent, and it is not a paint.** The accent is cyan, and it appears in
exactly three places: the focus ring, the active navigation item, and the
"connected / live" state. Buttons, cards, and headers stay neutral. A
dashboard where every panel is tinted has no focal point left to point at the
thing that is broken.

**Hierarchy comes from tiers, not opacity.** Step through the muted tokens
(`--muted`, `--muted-foreground`, `--border`) instead of stacking `/50` on a
solid color. The tiers are tuned per theme; opacity is not.

### Tokens

Light theme, `:root`. Values are the OKLCH triplets to write into
`src/index.css`.

| Token                  | OKLCH             | Hex       | Role                                                               |
| ---------------------- | ----------------- | --------- | ------------------------------------------------------------------ |
| `--background`         | `0.985 0.003 250` | `#F9FAFC` | Page canvas. A hair off white, so cards can lift without a shadow. |
| `--foreground`         | `0.215 0.015 250` | `#141A20` | Body text and headings. 16.8:1 on the canvas.                      |
| `--card`               | `1 0 0`           | `#FFFFFF` | Raised panels, table surfaces, popovers.                           |
| `--muted`              | `0.955 0.005 250` | `#EEF0F3` | Inset fills, hover rows, code blocks, disabled fields.             |
| `--muted-foreground`   | `0.50 0.012 250`  | `#5E646A` | Labels, units, timestamps, secondary text. 5.7:1 on the canvas.    |
| `--border`             | `0.90 0.006 250`  | `#DBDEE2` | Hairlines, table rules, input strokes.                             |
| `--primary`            | `0.215 0.015 250` | `#141A20` | The strong action. Neutral, not colored.                           |
| `--primary-foreground` | `0.99 0.003 250`  | `#FBFCFD` | Text on `--primary`.                                               |
| `--brand`              | `0.52 0.115 205`  | `#007B88` | The accent. Focus ring, active nav, connected state only.          |
| `--destructive`        | `0.55 0.19 27`    | `#C9302D` | Failed requests, delete, revoked keys.                             |
| `--success`            | `0.55 0.135 152`  | `#1A8748` | Connected, healthy quota, 2xx.                                     |
| `--warning`            | `0.62 0.135 70`   | `#B97500` | Quota warning, degraded, 4xx.                                      |
| `--info`               | `0.52 0.14 258`   | `#3067B8` | Neutral informational state, streamed responses.                   |
| `--ring`               | `0.52 0.115 205`  | `#007B88` | Focus ring. Same value as `--brand`.                               |

Dark theme, `.dark`.

| Token                | OKLCH             | Hex       | Note                                                                                      |
| -------------------- | ----------------- | --------- | ----------------------------------------------------------------------------------------- |
| `--background`       | `0.175 0.008 255` | `#0E1114` | Near-black with a cold cast, never `#000`.                                                |
| `--foreground`       | `0.965 0.003 250` | `#F2F4F5` | 17.2:1 on the canvas.                                                                     |
| `--card`             | `0.225 0.010 255` | `#191C20` | Raised one step toward the viewer.                                                        |
| `--muted`            | `0.27 0.010 255`  | `#23272B` | Inset fill.                                                                               |
| `--muted-foreground` | `0.72 0.012 250`  | `#9FA5AC` | 7.6:1 on the canvas.                                                                      |
| `--border`           | `0.32 0.010 255`  | `#2F3338` | Hairline.                                                                                 |
| `--primary`          | `0.965 0.003 250` | `#F2F4F5` | Inverted, matching the existing scheme.                                                   |
| `--brand`            | `0.76 0.115 200`  | `#3CC7CE` | Lighter and less saturated than light mode; a dark accent at light-mode saturation glows. |
| `--destructive`      | `0.70 0.165 25`   | `#F46F68` |                                                                                           |
| `--success`          | `0.78 0.145 152`  | `#66D288` |                                                                                           |
| `--warning`          | `0.83 0.135 80`   | `#F5BD56` |                                                                                           |
| `--info`             | `0.74 0.12 255`   | `#75AEF5` |                                                                                           |

### Charts

The five `--chart-*` slots are a **single-hue ramp**, not five unrelated
colors. A usage chart is one dataset sliced by provider or model; a
categorical rainbow would imply the slices are different kinds of thing.

| Slot        | Light (hue 205, C 0.10) | Dark (hue 200, C 0.10) |
| ----------- | ----------------------- | ---------------------- |
| `--chart-1` | `0.42 0.10 205`         | `0.86 0.10 200`        |
| `--chart-2` | `0.50 0.10 205`         | `0.78 0.10 200`        |
| `--chart-3` | `0.58 0.10 205`         | `0.70 0.10 200`        |
| `--chart-4` | `0.66 0.10 205`         | `0.62 0.10 200`        |
| `--chart-5` | `0.74 0.10 205`         | `0.54 0.10 200`        |

Adjacent steps sit at 1.3 to 1.7 contrast against each other, which reads as
clearly distinct without any two slices looking like a mistake.

Color in a chart encodes a **sourced state**, never decoration. A series is
colored because the reader must tell it apart from a neighbor, or because the
data itself has a status. Do not color a bar green because it is good news.

### Contrast

Every pairing above was measured, not estimated. The lowest values in the
system are `--warning` on the light canvas at 3.6:1 and `--border` on the
canvas at 1.3:1. Body and secondary text clear 4.5:1 in both themes; every
status color clears 3:1 against both the canvas and a card in both themes.
Re-measure before adding a token.

## 4. Typography

Two families, both self-hosted through `@fontsource` so the app has no
network dependency at runtime.

| Role                 | Family            | Replaces         |
| -------------------- | ----------------- | ---------------- |
| UI and prose         | **IBM Plex Sans** | `Inter Variable` |
| Data and identifiers | **IBM Plex Mono** | (none installed) |

```bash
bun add @fontsource-variable/ibm-plex-sans @fontsource/ibm-plex-mono
```

Why Plex rather than the Inter already installed: Inter is the shadcn starter's
default, so it is the font this interface has _by accident_. Plex was drawn for
technical and enterprise interfaces, its mono is a real workhorse at 11 to 13px,
and the pairing gives SRouter an identity that is not every other shadcn
dashboard. Inter is not a bad font; it is a decision nobody made. If you would
rather not churn, keeping Inter is defensible, but then record that choice here
instead of leaving it implied by the starter template.

### Rules

- **Mono is for data, never for aesthetics.** Use Plex Mono for: request IDs,
  API key prefixes, model IDs (`claude-fable-5`, `zen/big-pickle`), provider
  slugs, file paths, status codes, timestamps, and any column of figures that
  must align vertically. Do not set a whole table, a sentence, or a heading in
  mono.
- **Tabular numerals everywhere numbers are compared.** Set
  `font-variant-numeric: tabular-nums` on every numeric column, KPI, and
  duration. Without it, a latency column jitters as values update.
- **Headings are sentence case and state a fact.** "Requests, last 24 hours",
  not "Overview" and not "ANALYTICS". A heading that names its genre has said
  nothing.
- **Prose caps at 68 characters.** Rewrite before shrinking. Never use small
  gray text to make a dense layout fit.
- **Weights: 400 for body, 500 for labels and headings, 600 for the single page
  title.** No 700 in a dashboard; it shouts.

## 5. The screens, and the decision each one serves

A dashboard is not a template. Each surface below is built around the decision
the operator actually makes there. If a section does not serve that decision,
it does not belong on the screen.

| Screen            | The decision                                                | The primary object                                           |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| Usage / analytics | "Is anything wrong right now, and what is this costing me?" | The error rate over time, with spend as the secondary read   |
| Providers         | "Which provider is broken, and what do I do about it?"      | The list, sorted with disconnected and errored entries first |
| Request logs      | "Find the request that failed and see why."                 | The log row, expandable to its full detail                   |
| Quota             | "What is about to run out?"                                 | The gauge, sorted by how close to exhausted                  |
| API keys          | "Who has access, and what have they spent?"                 | The key row with its usage                                   |
| Catalog / pricing | "What can I call, and what does it cost?"                   | The model table with cost per million tokens                 |
| Settings          | "Is this instance configured safely?"                       | The security-relevant toggles first                          |

### What follows from that

- **Do not open on four equal stat cards.** `UsageRequestTotals` and
  `UsageCostTotals` are not peers. Success and failure counts belong with the
  error-rate chart that gives them meaning, and cost belongs beside the model
  breakdown that explains it. A row of equal cards is a hierarchy failure
  dressed as a summary.
- **Tables are the main content, not a fallback.** Give them the full width of
  their section. Never strand a table beside a heading or an empty rail to fill
  a grid.
- **Columns come from the decision.** In request logs the deciding fields are
  status, latency, model, and time. Put them early and let the operator sort on
  them. Do not ship a three-dot menu on every row if the actions in it are
  aspirational.
- **A provider with `state: "no_connections"` is the loudest thing on the
  providers screen**, not a neutral row with a gray dot.

## 6. Status vocabulary

The wire types already define the states. Map them to tokens once, here, and
never invent a local color.

| Domain state                             | Token                | Paired cue                                                     |
| ---------------------------------------- | -------------------- | -------------------------------------------------------------- |
| `ProviderStatus.state: "connected"`      | `--brand`            | The word "Connected" and the connection count                  |
| `ProviderStatus.state: "no_connections"` | `--warning`          | The word "No connections"                                      |
| `LiveModelQuotaItem.status: "ok"`        | `--success`          | The percentage                                                 |
| `LiveModelQuotaItem.status: "warning"`   | `--warning`          | The percentage and the reset time                              |
| `LiveModelQuotaItem.status: "exhausted"` | `--destructive`      | The percentage and the reset time                              |
| `status_code` 2xx                        | `--success`          | The code itself                                                |
| `status_code` 4xx                        | `--warning`          | The code itself                                                |
| `status_code` 5xx                        | `--destructive`      | The code itself                                                |
| `UsageCostTotals.estimated: true`        | `--muted-foreground` | The `label` field beside it, which says what the figure covers |

**Color is never the only carrier.** Every state above also has a word, a
number, or a glyph. An operator with a color vision deficiency, or a monitor in
daylight, must still read the state correctly. This is not optional.

## 7. Components

The existing `src/components/ui/button.tsx` variants are the base and are
already correct in spirit: small radii, a flat fill, `active:translate-y-px`
for tactile feedback, `focus-visible:ring-2` in the ring color. Keep them.

- **Buttons.** `default` for the one primary action on a screen. `outline` for
  everything else. `destructive` only for actions that destroy data, and it
  always asks for confirmation. No icons on buttons unless the icon replaces a
  word the operator already knows.
- **Cards.** Only when elevation communicates real hierarchy, which in this app
  is: a panel that floats above the page (dialog, popover, dropdown). A page
  section is separated by spacing and a hairline, not by a card. Never nest a
  card in a card.
- **Tables.** Semantic `<table>` with `<caption>`, `<thead>`, `<tbody>`. Right
  align numeric columns and their headers. Use `--muted-foreground` for the
  header row. Rows use `--border` for the rule and `--muted` for hover. Long
  values truncate with a title attribute; they never wrap a row to two lines.
- **Inputs.** Label above, error below. Focus ring in `--ring`. Never a
  floating label. Never a placeholder standing in for a label.
- **Gauges.** `src/components/gauge` is the quota primitive. Feed it
  `LiveModelQuotaItem.percentage_value` with the domain `0` to `100`, and give
  it zones drawn from the status vocabulary above. The gauge is the one place a
  saturated color is allowed to fill an area, because it is encoding a value.
- **Loading.** A skeleton that matches the shape of the content being loaded,
  sized to the real row height. Never a centered spinner on a blank page.
- **Streaming.** `LiveEvent` over SSE appends rows. An appended row must not
  re-animate the list or move the scroll position under the operator's cursor.

## 8. Empty, loading, and error states

These are three different screens and they read differently. "No data" is not
an acceptable rendering of any of them.

| State                   | What it says                                        | What it offers                                     |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------- |
| First run, no providers | "No providers connected yet."                       | The one action that changes it: connect a provider |
| Filtered to nothing     | "No requests match this filter."                    | A way to clear the filter                          |
| Empty quota             | "Quota is only reported for OAuth providers."       | Nothing; it is a fact, not a failure               |
| Request failed to load  | "Could not load requests. The server returned 500." | Retry                                              |
| Stream disconnected     | "Live updates paused. Reconnecting."                | Nothing; it recovers on its own                    |

The pattern: name the cause, then name the next action. If there is no action,
say why there is none.

## 9. Motion

Motion dial is 2. It exists to explain a state change, and it stops when the
change is done.

- Transitions on interactive elements: 120 to 180ms, easing `ease-out`.
- A value that updates in place (a live latency, a quota percentage) may
  cross-fade or count. It must not bounce, pulse, or loop.
- SSE appends do not animate the list. The new row appears; nothing else moves.
- **No perpetual animation.** No pulsing "live" dots, no shimmer on static
  content, no floating anything. A dot that indicates a live stream is
  permitted, but it does not glow and it does not pulse on a loop.
- Honor `prefers-reduced-motion` by removing all of the above. The interface is
  complete without any of it.
- Animate `transform` and `opacity` only. Never `top`, `left`, `width`, or
  `height`.

## 10. Banned

These are the patterns that make a self-hosted admin tool look generated. Each
one is banned for a stated reason, not by taste.

- **A row of four equal stat cards with invented deltas.** Show real figures
  wired to real data, or show none. A "+12% this week" with no series behind it
  is a fabrication.
- **Filler identities.** No `John Doe`, no `johndoe@example.com`, no
  `sk-srouter-test-key` in shipped UI. Real data, an honest placeholder
  (`Your API key name`), or an empty cell.
- **Fake activity feeds.** Events come from the database or they do not exist.
- **Charts without a question.** Write the question first and put it in the
  title: "Failed requests per hour, last 24 hours". If a sentence answers it
  better, write the sentence.
- **Decorative gradients, glows, blurred orbs, and glass.** A gradient is
  allowed only as a labeled continuous data scale.
- **Background grids and blueprint textures.** Texture is not identity.
- **Emoji in the interface.** Not in headings, labels, buttons, or empty
  states.
- **A pill badge above a heading that repeats the heading.**
- **Colored left stripes on rows and cards** unless the color marks a real
  state, in which case it is a status, not a stripe.
- **Pulsing status dots, marquees, typewriter effects, parallax.**
- **Pure black and pure white as a canvas.** `--background` is `#F9FAFC` and
  `#0E1114`; only `--card` reaches `#FFFFFF`.
- **`h-screen`.** `App.tsx` already uses `min-h-svh`, which is correct; keep it
  that way. `h-screen` jumps on mobile Safari.
- **Interactive targets under 44px on touch, or under 24px on pointer.**
  The existing button sizes go down to `h-5`; that is acceptable only inside a
  dense desktop-only table toolbar, never as a primary control.
- **Horizontal overflow at any breakpoint.**

## 11. Wiring this into `src/index.css`

The variable names above match what is already there, so this is a value swap
plus three additions. Two things to be careful about:

1. **`@theme inline` must map every new token.** Adding `--success` to
   `:root` does nothing until `--color-success: var(--success);` exists inside
   the `@theme inline` block, or `text-success` is not a class.
2. **`--radius` is `0.625rem` today** and drives `--radius-sm` through
   `--radius-4xl` through the multipliers in `@theme inline`. For a cockpit
   density, set `--radius: 0.375rem`. The button's `rounded-md` then lands at
   roughly 4.8px, matching the crisp edges this language calls for. Change the
   one base value; do not hand-edit the derived ones.
3. **Name the brand accent `--brand`, not `--accent`.** `--accent` and
   `--accent-foreground` are already declared in `:root`, `.dark`, and the
   `@theme inline` block: they are part of shadcn's token contract and exist to
   serve component hover and selection surfaces. The `base-mira` components in
   this project currently use `--muted` for those states, but the registry
   templates are fetched when a component is added, so a future `shadcn add`
   can start consuming `--accent` at any time. Repurposing it for a saturated
   brand color would tint those states the moment it does. Add
   `--color-brand: var(--brand);` and leave `--accent` as the subtle surface it
   already is.

`components.json` keeps `"baseColor": "neutral"`, which is correct: the
neutral scale is the base and the cyan is the single accent layered on top.

## 12. Checklist

Run this before calling a screen done.

- [ ] Does the screen serve the decision in the table in section 5, or is it a
      sidebar plus stat row plus chart plus table because that is the shape?
- [ ] Is every number real, or visibly labeled as a placeholder?
- [ ] Does every status carry a word or number beside its color?
- [ ] Is the accent confined to focus, active nav, and connected state?
- [ ] Are numerals tabular and numeric columns right-aligned?
- [ ] Does the first-run state say what to do, not just that there is nothing?
- [ ] Does the error state name the cause and offer the next action?
- [ ] Is there any perpetual animation left?
- [ ] Does it work with keyboard only, with a visible focus ring throughout?
- [ ] Does it hold at 360px, and in both themes?
- [ ] Is any text below 4.5:1, or any status color below 3:1?
