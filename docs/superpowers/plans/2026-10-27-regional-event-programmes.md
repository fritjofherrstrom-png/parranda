# Regional Event Programmes Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Track RED/GREEN and review evidence.

**Goal:** Discover structured regional programmes and retain their context alongside distinct nearby activities.
**Architecture:** Extend the existing official-program adapter with a closed day/area/clock-row grammar. Preserve programme metadata through normalisation and Live; reuse ordinary probation, venue lookup and geography gates. Permit bounded complementary request-time discovery for a thin local source mix.
**Tech Stack:** Node >=22, CommonJS, existing parse5, React/TypeScript; no new dependencies.
**Spec:** ../specs/2026-10-27-regional-event-programmes.md

## Global Constraints

- No new paid APIs, model-reader calls, named-place rules, widened trust or geography gates.
- Explicit programme year/date and row clock/name; prose deadlines cannot override headings.
- New sources remain probationary/Pulse-only; no invented venue coordinates or opening hours.
- `programme = { title, source_url, starts_on, ends_on }` describes observed source programme dates.
- Main cf18a576 is the baseline. Existing unrelated worktrees/runtime/volumes remain untouched.

## Review Focus

- Ambiguous numeric dates and weekday disagreement must fail rather than shift to another day.
- Programme disclaimers, archive links, navigation and booking dates cannot become occurrences.
- Different venues at the same time on one programme URL must remain distinct.
- A complementary discovery failure must not erase a working approved calendar.
- Programme metadata must not survive incoherent source/date values or become location evidence.

### Task 1: Closed date/area programme grammar

Files: new focused reader under server/pulse-sources/, official-program-article-{rows,normalizer}.js as needed; new tests/regional-event-programme.test.js and reduced factual HTML fixture.
Consumes raw public HTML. Produces existing programme row collection plus optional `programme` metadata on provider events; stable source_occurrence_id includes venue/area.
- [ ] Write/run failing real parser tests from reduced observed structure and unrelated English programme.
- [ ] Implement strict grammar without weakening the existing article grammar. Reject missing year, invalid/ambiguous day scope and deadline overrides; retain separate day/area/row contexts.
- [ ] Verify originals offline and parser/provider/scout tests. Record precise accepted scope and unparsed rows.

### Task 2: Complementary bounded discovery

Files: server/place-candidates/agnostic-event-supply.js; tests/request-time-event-discovery.test.js.
Consumes existing localSourceMixNeedsDiscovery result and ordinary requestTimeDiscovery. Produces new probationary supply alongside independently retained approved feeds.
- [ ] Write/run failing test: one approved local publisher can receive an independent discovered programme; a diverse source mix avoids redundant discovery.
- [ ] Reuse the existing complementary criterion for discoverNow, preserving opt-out/cache/budgets and independent source health.
- [ ] Verify a discovery failure retains the approved source and its events, and all existing request-time tests pass with updated intentional expectation.
- [ ] Reproduce an old persisted result bypassing discovery; move only the final pool to v19 while retaining prior files and lower raw/descriptor caches.
- [ ] Prove with a one-lookup real-collector fixture that an exact trusted-locality programme area receives the existing lookup before earlier other areas, after active-period priority; no geometry or trust is derived from that match.

### Task 3: Programme context through Live and integration

Files: time-sensitive-event.js, event-fusion.js if required, agnostic-event-supply.js, LiveEventSource.tsx/types.ts, focused backend/frontend integration tests.
Consumes Task 1 programme metadata. Produces validated `programme` in Live views and programme title/date context in both shared Live source surfaces.
- [ ] Write/run failing normalization/fusion/Live tests with explicit literal dates and two different venues on one source URL.
- [ ] Preserve bounded coherent metadata and original source URL. Render escaped text as programme context without a new location or route affordance.
- [ ] Verify offline scout→probation→collection→Live, source replay, focused backend/frontend tests, frontend check/build/dist and diff checks.
- [ ] Obtain independent whole-diff review; resolve material findings. Publish a main-targeted reviewable PR with exact evidence and remaining runtime limitations.
