# Codebase cleanup: dead surface, duplicated policy, and one hazard

Date: 2026-10-25
Status: proposed, awaiting owner approval
Scope: `server/` fully; `client/` only outside the frozen `arc/` and `ui/` folders

Revision note: this version corrects an earlier draft after a fact check. Counts
and duplication claims below were re-measured against the tree; claims that could
not be reproduced were dropped rather than softened, and the corrections are
listed at the end.

## Problem Statement

The gateway works, but it carries work nobody asked for and repeats work that
already has an owner.

- The build links a PostgreSQL driver for a backend that cannot be selected.
  `AppDatabase` has a `Postgres` variant no code path ever constructs, the boot
  sequence refuses `DATABASE_URL`, and 62 source call sites pass around `Option`s
  that exist only to serve that variant.
- The catalog refresh policy is copied, not shared. The same 5 minute TTL and 30
  second retry window are declared in eight catalog modules. The due check exists
  in two shapes: four modules test the model list first, two test the fetch
  timestamp first. Four drivers carry a byte identical coalesced fetch, a fifth
  differs only by a blank line. Two more restate the comparison inline. When the
  policy changes, eight places have to agree, and a reviewer cannot tell which
  copy is authoritative.
- The token refresh window is genuinely shared, which proves the point: it lives
  in one module, with a comment recording that four drivers used to carry their
  own copy. The catalog policy repeated that exact mistake after the lesson was
  written down.
- A few surfaces nothing reaches: one provider constant kept alive only by its own
  re-export line, and, inside the frozen component folders, two exported symbols,
  a React provider that is never mounted, and a vendored button component.
- One lock is unwrapped where the repository's own rule requires poison
  recovery, and the rule cites a line number that has since moved.
- The request-log call takes eight positional arguments at 17 call sites, which
  is why the two streaming interception loops read as near copies of each other.

The cost is paid on every change: four to eight edits for one policy change,
slower builds for an unreachable driver, and review attention spent on surfaces
that no caller can reach.

## Solution

Give each policy exactly one owner, delete the surface nothing reaches, and keep
every behavioural contract pinned by the tests that already exist.

Four independently mergeable phases, each a self contained diff, followed by one
documentation pass:

1. Request path and hazards: one caller-side record for the request log, one
   component for the secret reveal, one dead constant removed with its re-export,
   one lock recovered instead of unwrapped.
2. PostgreSQL removal: drop the feature flag, the variant, and the two tests that
   construct it.
3. Catalog refresh consolidation: one snapshot value type, one due check, one
   coalesced-fetch helper, per-driver credential gates untouched.
4. Documentation drift: the rules file stops citing line numbers that move.

Phases 1 to 3 touch disjoint files and can land in any order. Phase 4 must land
last, because it removes line citations that an earlier phase would otherwise
invalidate again.

## User Stories

1. As an SRouter operator, I want `cargo build` to stop compiling a database
   driver the binary can never use, so that a rebuild after a code change takes
   less time.
2. As an SRouter operator, I want the boot refusal to remain the only place a
   second backend is mentioned, so that a future contributor cannot half enable
   one.
3. As an SRouter operator, I want a change to the catalog TTL to be one edit, so
   that providers cannot drift apart and refresh at different rates.
4. As an SRouter operator, I want a newly added OAuth driver to inherit the
   refresh policy by default, so that a new provider cannot ship a subtly
   different retry window.
5. As a server maintainer, I want one authoritative implementation of "is this
   snapshot due", so that a bug reported against one provider is fixed for all of
   them by fixing one function.
6. As a server maintainer, I want the two existing due-check shapes reconciled,
   so that I know whether they differ on purpose or by accident.
7. As a server maintainer, I want the coalesced refresh (the mutex, the retry
   stamp, the background spawn) written once, so that adding a provider does not
   mean copying concurrency logic.
8. As a server maintainer, I want each driver to keep only what is genuinely
   provider specific (its credential gate and its fetch), so that reading a
   driver tells me what that provider does differently.
9. As a server maintainer, I want the request-log call to take a named record
   instead of eight positional arguments, so that a swapped model and
   resolved-model argument becomes impossible rather than merely reviewed.
10. As a server maintainer, I want that record converted into the store's
    existing input type rather than parallel to it, so that a log row has one
    vocabulary.
11. As a server maintainer, I want a lock poison to be recovered rather than to
    panic the provider registry, so that one panicking thread cannot take model
    resolution down for the process.
12. As a server maintainer, I want that recovery covered by a test that actually
    poisons the lock, so that the fix is not a comment that compiles.
13. As a reviewer, I want zero unreferenced constants and exports outside the
    frozen folders, so that I never have to decide whether dead looking code is
    load bearing.
14. As an operator using the admin dashboard, I want the full secret shown after
    creating a key and after creating a user to look and behave identically, so
    that I trust the one screen where a value is unrecoverable.
15. As an operator using the admin dashboard, I want a copyable secret block to
    announce the same label and copy affordance everywhere, so that I do not
    wonder whether one of the four screens lost a control.
16. As a frontend maintainer, I want the secret reveal defined once, so that a
    fix to the copy behaviour lands in all four dialogs at once.
17. As a frontend maintainer, I want the vendored component folders untouched, so
    that upgrading the upstream kit stays a clean operation.
18. As an agent working in this repository, I want the rules file to describe
    invariants instead of line numbers, so that a refactor does not make the
    documentation wrong.
19. As an agent working in this repository, I want the spec to name what is out
    of scope, so that I do not quietly expand a small diff into a migration.
20. As the project owner, I want each phase to merge on its own with the existing
    suites green, so that I can stop after any phase without leaving a half
    applied refactor.
21. As the project owner, I want behaviour to stay frozen, so that a cleanup
    change cannot alter a status code, an error body, a wire shape, or a
    generated binding.

## Implementation Decisions

### Approach chosen

Three shapes were on the table for the catalog duplication:

1. Leave it. Rejected: the token refresh module already proves the cost, and the
   copies are now drifting.
2. A macro that generates the refresh block per driver. Rejected: macro generated
   driver code hides the credential gate, which is the one part that genuinely
   differs, and it is unreadable in a trace.
3. A shared snapshot value type plus free functions, with the credential gate
   left inline in each driver.

Option 3 is the choice, and it deliberately avoids a sixth trait. The crate is
pinned at five traits; a value type with free functions delivers the same
deduplication without widening the trait vocabulary the rules file protects.

For the PostgreSQL variant, two shapes were considered: keep the enum and only
drop the feature flag, or drop the enum entry entirely. Keeping the enum but
removing the feature was rejected because it leaves a variant that cannot be
compiled and therefore cannot be maintained. The enum goes.

### Phase 1: request path and hazards

- Request logging takes a caller-side record. It carries provider id, requested
  model, resolved model, status, usage, and the error. The logging function
  converts it into the store's existing request-log input, so no second row shape
  appears. The `too_many_arguments` allowance disappears with the positional
  list, and the state and context arguments stay as they are.
- The client gets one secret reveal component with a label prop, a value prop,
  and a copy label prop. Four dialogs use it: create key, regenerate key, create
  user, show user token. The component owns the mono block, the copy control, and
  the done button. The dialogs keep their own titles, descriptions, and detents.
  All four files live under the key and user component folders, outside the frozen
  directories.
- Remove the provider origin constant kept alive only by its re-export line, and
  remove that re-export entry in the same diff.
- Recover the registry selection lock instead of unwrapping it, matching the
  pattern already used elsewhere in the repository. This phase adds an in-crate
  unit test that poisons the lock from a panicking thread and then resolves a
  model, because a poisoned lock is not reachable through the HTTP seam.

### Phase 2: PostgreSQL removal

Split into two diffs so the first stays reviewable:

- 2a, the variant and the feature. The `Postgres` variant, the `PgPool` import,
  and the `postgres` feature on the sqlx dependency are removed. The boot refusal
  for `DATABASE_URL` stays exactly as it is: this removes an unbuildable variant,
  not a user facing guard. Two integration tests construct the variant, so they
  are deleted in the same diff; they test a backend that no longer exists.
- 2b, the accessors, optional. `sqlite_handle` and `sqlite_pool` can become
  infallible, but that is 62 source call sites and 60 test call sites, so it is a
  separate decision rather than a rider on 2a. `sqlite_required` keeps its message
  and its callers either way; whether it survives 2b is the owner's call.

### Phase 3: catalog refresh

- One value type describes a catalog snapshot: the model list, the last fetch
  timestamp, and the last attempt timestamp.
- The TTL and retry constants move beside the shared token refresh window, which
  is already the module for "the window every OAuth driver follows".
- The due check becomes one free function over that value, tested once. The two
  current shapes differ on one predicate: whether "empty" means an empty model
  list or a zero fetch timestamp. The implementer decides which is intended and
  records it, because a catalog that fetched successfully with zero models is the
  case where the two disagree. Normalising both callers to one shape is preferred
  over preserving two.
- One free helper owns the coalesced refresh: take an async lock, re-check
  dueness, stamp the attempt, run the caller's fetch. The lock field and the
  clone-and-spawn behaviour move into it.
- Each driver keeps a `maybe_refresh` whose body is its credential gate plus one
  call into the helper. The gate stays provider specific: Cline and CodeBuddy
  read stored connections, Command Code treats a 401 as "disconnect and empty the
  snapshot", Claude and Custom gate on a configured provider.
- The duplicated per-catalog test pairs (unfilled snapshot honours the retry
  window, filled snapshot honours the TTL) collapse into tests against the shared
  function. The existing in-crate test modules are the seam; no new public
  surface is introduced for testing.

### Phase 4: documentation drift

- The rules file stops citing line numbers for the unwrap rule; it names the
  invariant and the pattern instead. The current citation points at a line that
  holds no unwrap.
- Any other line citation that a phase in this spec invalidates is corrected in
  the same pass.

### Wire and behaviour constraints

- No wire type changes. No change to generated bindings. Any phase that would
  alter a field, a status code, an error body, or a header name is out of scope
  and needs its own spec.
- Every phase keeps the frozen contracts green: generated bindings, schema
  version, the runtime response headers, and the `DATABASE_URL` refusal.

## Testing Decisions

What makes a good test here: it exercises behaviour through the seam a caller
uses, and it fails when the behaviour changes, not when the implementation is
rearranged. The existing suites already pin the behaviour of every phase, so the
job is to keep them green and, where a refactor merges copies, to delete the
duplicate tests instead of leaving near identical ones behind.

Seams, highest available first:

- Router level, over `oneshot` with a test peer and a per-suite temporary SQLite
  file. This is the seam for the request log record, because the row content is
  asserted through the log endpoints, not through the function.
- Provider executor level, with fake upstreams on loopback ports. This is the
  seam for Phase 3: the existing provider suites already drive refresh through
  the executor and assert the model list served afterwards.
- In-crate unit level for the due check and for the lock poison recovery. Neither
  is reachable through HTTP.
- Client: no unit runner exists. Verification is `bun run typecheck`, `bun run
  lint`, `bun run build`, plus a browser pass. The existing Playwright projects do
  not exercise any of the four secret reveal dialogs today, so the extraction
  needs either new end to end coverage or a recorded manual pass over all four
  dialogs. Compiling is not verification for this phase.

Prior art to copy:

- Request log assertions: the request log and analytics suites.
- Fake upstream and catalog behaviour: the per provider suites plus the in-crate
  catalog test modules.
- Database behaviour: the schema and migrations suites.

Phase gates: each phase lands with the full server suite, `cargo fmt --check`,
and `clippy -D warnings` green. Phase 1 additionally lands the three client
commands and the dialog pass.

## Out of Scope

- Every removal inside the frozen component folders. Found and measured, but each
  needs an owner decision because the frontend rules forbid editing those
  directories: the two exported symbols with zero importers, the React provider
  that is never mounted with its image hook, the duplicated morph width hook, and
  the three copies of the reveal motion variants.
- The vendored button component, which is not dead at all: the vendored dialog
  imports it, so only its public entry point has no consumer outside the folder.
- Gating the search mock behind the test cfg. Four integration suites call the
  mock constructor through the public API, so the gate would break them. Moving
  that seam into the test harness is a separate change with its own risk.
- Merging the two streaming interception loops. They share about 45 percent of
  their lines, but the shared parts are log call scaffolding, so the record in
  Phase 1 is the right fix first. Revisit after Phase 1 lands.
- Splitting the two oversized chart and table components. They are frozen kit code
  and carry no correctness defect.
- Icon library consolidation (Lucide in 41 files, Hugeicons in one). A bundle
  decision, not a cleanup.
- The trait pairs with a documented reason: the API key store versus repository
  split, and the empty store implementations. Both were examined and rejected as
  findings.
- Removing the image request `quality` and `style` fields. They are forwarded
  upstream through request serialization, so they are contract, not dead code.
- Any change to provider behaviour, including refresh timing. Phase 3 changes who
  owns the policy, never what the policy is.
- Publishing this spec to an issue tracker. The repository has no tracker
  configured for the workflow, so it lives with the code until the owner says
  otherwise.

## Further Notes

Measurements, re-run against the tree at revision time, useful as a baseline after
the phases land: 214 Rust source files and 51,234 lines under the server source
tree, 46 integration suites and 27,157 lines under the server test tree (48 files
once the support harness is counted), 144 TypeScript files and 24,245 lines under
the client source tree. The longest function outside test code is 172 lines,
measured by brace matching over every source file with string and comment state
tracked. There are zero dead code allowances and zero placeholder markers.

Verified non findings, recorded so a later scan does not re-report them: the
image request `quality` and `style` fields reach the upstream body through
request serialization; the image source `type` field is read by serde under its
renamed key; the provider usage `last_used_at` field is part of the generated
wire bindings.

Corrections made after review, for the record: the source call-site count is 62,
not 64; the request log has 17 call sites, not 18; the test tree holds 46 suites,
not 48; the due check has two shapes, not one; the vendored button is imported by
the vendored dialog; the dead constant still has one re-export reference, so
removal must take both lines; and the earlier phrase "five phases" counted a
client phase whose every target sits in a frozen folder, which is why it is now
out of scope.

Open question for the owner, the only one this spec does not settle: whether
Phase 2b's infallible accessors and the `sqlite_required` removal are worth a
122 call-site diff, or whether the accessors keep returning an option forever.
