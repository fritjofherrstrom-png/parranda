# Live controls and navigation: first delivery

Base: `55a73693a7d56cc5828a4ae3da13e6cadd9e3ca5`. Local branch: `codex/live-controls-navigation-20261014`.

## Product scope

An existing woven Live route stop offers Keep this event, Try another event and Remove from day (Behåll eventet, Prova ett annat event, Ta bort från dagen). The existing commitment ledger, recomposition, stale-request cancellation, Undo and saved-day contracts own those actions. There is no new event-addition or drag-and-drop interface.

Live offers For you / By time (För dig / Efter tid). For you preserves supplied preference relevance, server ranking and the existing source-series/browse disclosures. By time exposes all explicitly supplied occurrences and browse rows under venue-local date headings and clock order. Source date ranges and missing date facts have their own groups: navigation does not invent daily occurrences from a range. Supplied category/keyword tags are shown as tags, not a normalized category taxonomy inferred from the title or preferences. Long source tags wrap on mobile.

Sort is a view preference; changing it does not recompose the day or replace a retained completion record. It survives completion/reopen, and saved snapshots store their sort. Period and geographic scope retain their existing independent controls and request-generation guards.

## Identity and bounded intent

The backend issues `live:YYYY-MM-DD:<32 hex>` from the source provider (or source URL), source event ID, actual venue-local date and normalized start instant. It requires an explicit-offset timestamp and a known venue timezone. Title and end-time updates preserve identity; another actual start or date is a different occurrence. The source event ID remains unchanged. Older saved stops lacking issued identity have no new controls until explicitly rebuilt.

`live_event_choices` carries only `{occurrence_id, action}`; actions are keep, remove or replace. Extra facts, malformed dates/actions, duplicate IDs and oversized ledgers fail HTTP validation. Place pin/exclude IDs remain a separate channel. Another day's choices are ignored; the frontend scopes them before sending.

- Remove suppresses automatic Live insertion for that selected day, including after cold completion or disappearance of the old source. Source rows remain visible in Live.
- Replace excludes the exact occurrence and permits another already eligible occurrence.
- Keep selects the exact already eligible source occurrence. Its explicit selection can override soft relevance order; it cannot override source eligibility, venue clock, selected day or walking validation. Missing/ineligible choices do not silently select another event. The response reports unhonored keeps from the actually published day.

Snapshot v3 preserves remove versus replace. v2 remains readable for existing place commitments; it cannot attest the new Live intent and its Live entries fail closed. Restoring a saved day shows its saved response and choices; fresh recomposition requires the existing explicit rebuild action.

## Evidence boundaries

Focused tests exercise real weave, route engine, HTTP endpoint validation, retained completion replay and mounted planner/LiveSheet components. Native Chrome tests use built CSS at 320/390 px. The local built-UI HTTP smoke uses real `buildApp` handlers/cache/engine with controlled external event collection, resolver, POI and weather boundaries. It is not external live-provider acceptance, Pi acceptance or deploy evidence. There is no exact arrival-time scheduling claim: existing evening and walking gates are retained. Adding events with time-aware replanning and drag-and-drop are later deliveries.

Exact candidate SHA, full-suite counts/skips, independent review and runtime evidence are recorded outside the repository in the local delivery report.

## Ordinary URL reload correction

A normal reload of the live `?place=…` URL composes fresh, but recovers the whole bounded commitment ledger when the previous entry and snapshot attest the same place, absolute date, preferences and rhythm. This is general URL-entry behavior for place and Live choices. Native Navigation Timing must identify a reload; new navigation/shared links do not inherit LAST even with identical text. Durable place references must match; without one, query and namesake qualifier must both match. The published date and snapshot day/anchor identity must agree. Unknown navigation timing or an unattested exact coordinate anchor fails closed. Explicit saved-snapshot restore remains separate and unchanged.

Recovery passes the validated ledger to the initial request directly, so React's asynchronous state adoption cannot send an empty ledger or trigger a second arrival compose. Old response facts, applied-pin verdicts and completion capabilities are never reused as fresh evidence. Midnight changes to the relative day are checked against the frozen absolute request date. Existing generation guards still reject obsolete bodies after newer adjustments.
