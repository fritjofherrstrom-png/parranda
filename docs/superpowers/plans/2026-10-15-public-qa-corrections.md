# Public QA corrections — local implementation plan

Goal: correct verified presentation and restored-position lifecycle failures on main `592ce857a8e66cfd5702269888976f8053595b39`, without changing source trust or the public deployment.

Owner: Codex. Branch: `codex/public-qa-corrections-20261015`.
Spec: user-provided REPORT.md, public QA archive, Claude follow-up; their recommendations are review input, not release authorization.
Architecture: retain the existing source-time and commitment contracts. Correct evidence conversion at its originating adapter, then use one venue-local timing function in both Live views. Reuse snapshot ledgers and fresh geolocation consent for position days. No new persistence or reuse of precise GPS as a position fix; existing saved route geometry remains a snapshot.
Tech: existing Node/React/Astro, native Chromium and actual HTTP handlers with controlled external transports.

## Constraints and review focus

- No new provider loops, paid APIs, model reader, city rules, dependency changes, push, merge or deploy.
- Never infer all-day from midnight globally, ongoing from date-only/unknown-zone data, or event genres from taxonomy children.
- Preserve source occurrence identities, route eligibility, source failures and manual period/sort choices.
- Restore commitments only for matching anchor, absolute date and relevant context; reject changed position/date and late responses.
- Saved snapshots keep their provenance; geolocation consent remains explicit and fresh position consent remains memory-only; existing saved route geometry is not a reusable position fix.

## Task 1: source time/category facts (Codex)

Files: event-wire-profiles.js, mapped-event-source-provider.js, localized-events-api-provider.js and focused provider replay tests.
- [ ] Replay captured source records to establish midnight/all-day and nested-category semantics.
- [ ] Write failing assertions for source precision and parent-only category labels; retain actual midnight events in other profiles and explicit time ranges.
- [ ] Make minimal adapter fixes, retaining identity/fact/eligibility boundaries; run targeted source/collector regressions.
- [ ] Commit source corrections separately.

## Task 2: Live timing (Codex)

Files: pulse-view.mjs, live-navigation.mjs/types, LiveCard.tsx, LiveSheet.tsx, EventOccurrences.tsx, a small shared clock hook and focused mounted/native tests.
- [ ] RED: exact and listed-occurrence status before/start/end, timezone/midnight, all-day display, frozen UI with no parent rerender.
- [ ] GREEN: venue-local occurrence timing with explicit bounds, all-day label only for explicit all-day evidence, periodic/visibility clock update with cleanup.
- [ ] Render both sort modes and occurrence disclosures through the same timing rules; preserve all stated dates and status caveats.
- [ ] Run timing/navigation/source-health/native browser regressions and commit.

## Task 3: position lifecycle (bounded internal worker; Codex integrates)

Files: AnywherePlanner.tsx, URL-entry/snapshot helpers, BlitzCard/StopLine and focused mounted regression tests.
- [ ] RED: regrant same location after reload, different location/day negatives, restored Keep badge/Maps labels, missing-position Blitz message/action, visible start/return legs.
- [ ] GREEN: restore context-matching ledger using existing privacy-safe anchor identity; preserve explicit consent, pin/exclude and late-response protections.
- [ ] Verify actual mounted component behavior; report test scope and commit independently after root review.

## Task 4: combined verification (Codex)

- [ ] Review complete diff and boundary interactions; run relevant backend/frontend regressions, full suites with functioning Chromium, typecheck, fresh frontend build and dist drift check.
- [ ] Reproduce the corrected timing and position journeys through built browser UI/real HTTP where relevant, controlling only external source boundaries.
- [ ] Record exact final head/base, source replay vs controlled browser vs older public evidence, skips and remaining limits. Leave a local candidate for separate publication/release decision.
