# Pulse Signal Quality v1

Parranda Pulse should only promote signals that are clear enough to help a user
decide what to do next. City packs and source adapters improve quality, but the
quality rules themselves must stay city-agnostic.

## Current source inputs

The Pulse engine already carries useful trust/source fields on normalized
signals:

- `source.kind`: `editorial`, `live_feed`, `weather`, `catalog`, or `computed`
- `source.label` / `source.url`: provider or rule context when useful
- `trust_level`: `official`, `verified`, `editorial`, or `inferred`
- `freshness`: `live`, `today`, `this_week`, or `evergreen`
- target fields such as `official_event_id`, `place_query`, `related_stop_id`,
  `where`, `area`, `venue`, and `time_window`

`server/pulse-engine/signal-quality.js` is the first shared layer that turns
those fields into display decisions.

## Quality shape

Every normalized signal now receives:

```js
signal_quality: {
  displayable: true,
  promotable: false,
  actionable: true,
  confidence: "medium",
  reasons: ["meaningful_title", "has_source", "has_timing"],
}
```

The classifier answers four product questions:

- Can this signal be shown as a normal Pulse card?
- Can this signal be promoted into the masthead/hero?
- Can the user do something with it?
- Why did the engine decide that?

## Confidence levels

- `strong`: clear source, timing, target, and actionability. Example: an official
  live event with a real venue and event id.
- `medium`: honest and useful context, but not necessarily a place-level action.
  Example: computed golden-hour or city-rhythm signals.
- `weak`: missing or thin metadata. Weak placeholder live signals are not
  displayable in v1.
- `fallback`: reserved for no-signal states and future explicit fallbacks.

## Promotion rules

Weak placeholder live signals such as `Concert at Barcelona venue` must not be
promoted into Pulse cards or masthead copy. The engine filters non-displayable
signals before ranking, and masthead selection requires `promotable: true`.

URL-only live signals may be displayable/actionable when they have a source URL,
but they are not treated as internal place-drawer actions unless they have an
internal target such as `official_event_id`, `place_query`, or `related_stop_id`.

## Time-sensitive source events

Time-sensitive source events from providers enter Pulse through a separate
consumption gate before normalization. The gate is intentionally narrower than
provider collection:

- `timing_relevance` must be `now`, `today`, or `tonight`.
- `confidence` must be `strong` or `medium`.
- source backing must exist through `source_url`, `source_label`, or provenance.
- stale, future, unknown, source-thin, or low-confidence rows stay out of Pulse.

Eligible rows become normal Pulse signals and then pass through the same
`normalizeSignal()`, `classifySignalQuality()`, ranking, and masthead logic as
other signals. Salience is generic: timing relevance, confidence/source tier,
place/coordinate evidence, role hints, and event specificity can move a real
timed happening up the hierarchy without making it a route stop.

## Non-goals for v1

- No city-specific quality branches.
- No route/planner behavior changes.
- No large UI redesign.

Time-sensitive Pulse signals remain context until a later gated dayflow/route
consumption step explicitly decides otherwise.
