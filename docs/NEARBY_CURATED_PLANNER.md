# Nearby curated supply in modern Planner

The coordinate/typed-place modern rhythm path built an empty curated context,
even beside a registered catalog. Thus known nearby food and coffee disappeared
when external acquisition failed; selecting a citypack explicitly and choosing
"Use my location" had different supply despite using the same route engine.

On main `6aa077752ec64ecf387fdc3e93f1cd0fa6a78dd7`, a Pi request at
41.3786, 2.1618 for 2026-10-06, food + coffee, balanced rhythm, returned HTTP 200
with no day after 45,126 ms of status polling. External acquisition reported
`error_failed_closed` / `fetch_error`. That establishes the observed failure,
not its upstream provider cause or the friend's exact GPS position. The first
attached screenshot is Copenhagen and is not Barcelona-specific evidence.

Modern engine/rhythm requests now collect real curated candidates within five
kilometres of the trusted anchor from the server-owned registry. Internal packs,
structural presets, nonfinite coordinates, selected-date closed weekdays and
user-dismissed IDs stay out. Original catalog identity and human verification
are preserved through the candidate spine and engine projection. Shared role,
preference-focus, entity reconciliation, availability, geometry, pin and walking
gates remain authoritative. The bounded lifecycle can consume its independent
catalog supply when an external completion is outstanding; catalog rows never
masquerade as a successful external source answer. Late external rows cannot
mutate the day. This adds no network retry or timeout extension.

The first frozen candidate also reproduced an independent temporal loss: a
coffee role with unknown hours was removed after morning, despite explicit
coffee intent and no source closure. Requested experiences with unknown hours
now retain the full, explicitly unanchored arc. Known source closure still
rejects them; known remaining-day availability can still retime them. A typical
role label cannot certify a place is unavailable.

This is a geographic supplier, not a city recognition or template switch.
The explicit-coordinate anchor remains unchanged and a public city label,
context, candidate array or trust claim cannot add a curated place. Existing
recognized-city and legacy kilometre paths keep their prior behavior. A curated
day retains its provenance and no longer claims the place lacks full curation.

Deterministic regression coverage exercises food + coffee during an external
outage, another registered catalog, arbitrary fictional catalog geography,
structural/weekday filtering, dismissals, single-interest focus, outside-catalog
injection and the existing legacy boundary. These tests establish behavior with
controlled sources; live Pi observations are recorded separately in the PR.
