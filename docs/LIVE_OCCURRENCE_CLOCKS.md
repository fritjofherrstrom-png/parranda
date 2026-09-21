# Preserve source-owned clocks in Live

## Product change

The localized public-events adapter previously read only flat `start_time` and
`end_time`. Real reviewed API rows instead supply those facts in
`schedule.dates[0]`. A timed concert consequently became `all_day`, lost its
visible clock and appeared under the week rather than today's happenings.

The adapter now preserves a single explicit same-day occurrence when its date
agrees with the record envelope. It uses the reviewed source timezone, never
the browser timezone. Multiple sessions, contradictory dates/clocks, invalid
clocks and an end at/before the start are rejected rather than merged or given
an invented next-day end. No occurrence expansion, new fetch, city/name rule,
ranking change or public-payload trust is introduced. Date-only records and
existing range semantics remain unchanged. Complex schedules and partially
specified clocks are not newly supported by this patch.

Review hardening also validates optional seconds (`00`–`59`) before the
existing minute-precision projection. In a singleton schedule, a malformed
non-null clock in either the envelope or occurrence rejects the record; a valid
scheduled clock must not silently hide an invalid flat clock. Null/missing
clocks remain distinct from malformed values. This closes a legacy clock
parser weakness exposed by the newly supported schedule path.

The persistent event cache is `agnostic-events-v4`: v3 normalized all-day
results must not mask the correction. The existing 20-minute TTL, one bounded
page (configured 100 records in the observed source, adapter max 200), reviewed
source selection and background acquisition remain unchanged. This does not
claim that the existing response-size check is a streaming memory ceiling.

## Reproduction, 2026-09-21

Base: `479169ca9eb09d8dc55777dcf0d4043473d3c7db`. Real local application and
reviewed manifest, not Pi or a mock. Browser journeys started at the landing
page, entered `Stockholm, Sverige` and `Malmö, Sverige`, with food/culture/views,
6 km and Swedish language. Both September 21 and September 22 were selected.
Local source timezone: Europe/Stockholm.

| Case | Observed before | Meaning |
| --- | --- | --- |
| Stockholm, September 21 | Live today empty; Mulaa Joans appears in expanded week list as `mån 21 sep.` without a clock | API has one September 21 occurrence, 18:00–23:00; normalization discards it |
| Malmö, September 21 | Workshop: Rörliga delar, Monday 15:00, Folkets Park | Opened municipal detail confirms September 21, 15:00–18:00, same venue |
| Both, September 22 | Planner changes to tomorrow; Live remains today's calendar | Confirmed separate date-context gap, **not fixed** by this patch |

Controlled public Live API inputs for Stockholm: `scope=around_place`,
`time=tonight`, anchor `59.325,18.071`, original place query, preferences
`food,museums,scenic`. Before: 100 normalized rows, 13 accepted events, no today
event. After the correction and real background refresh: the same event identity
`a5e5e366-a0bd-437c-ab51-3b138cb3e847` has
`starts_at=2026-09-21T16:00:00.000Z` (18:00 source-local); 100 normalized rows
and 13 accepted events remain. This fixes timing/bucketing, not supply volume.
The after browser also showed the existing event weave adding that occurrence
as `Live i din rutt`, Monday 18:00, with its source link: the route changed from
four stops/~4.1 km to four stops plus one event/~6.5 km. This is a consequence
of restoring timing eligibility, not a new ranking or trust rule. The time
disagreement below means this is **not** evidence of a verified concert start
or of improved real-world arrival feasibility. Malmö's workshop stayed visible
with Monday 15:00 and its partial-source warning.

Source links opened in the real browser:

- [Mulaa Joans](https://debaser.se/events/mulaa-joans): correct event/date/venue.
  **Source disagreement:** the organizer states doors 19:00, support 20:00,
  headline 21:00, while Visit Stockholm's API says 18:00–23:00. The patch
  preserves the reviewed feed's assertion; it does NOT establish which time is
  correct, reconcile providers or claim an independently verified start time.
- [Workshop: Rörliga delar](https://malmo.se/Uppleva-och-gora/Evenemang/Evenemang-i-Malmo/Evenemangssida.html?id=5.4968b1201a03e2e5977860&title=Workshop%3A-R%C3%B6rliga-delar):
  correct municipal detail, date, time and venue.

Malmö displayed a partial-source warning alongside actual events; that is not a
proven empty calendar or a product failure. Both local journeys displayed the
calendar-loading state during background acquisition. Browser content export
was unsupported by the in-app browser; do not claim an exported trace or saved
screenshot archive. Raw local API evidence is supplementary; this document
contains the factual observations required to understand the reproduction.

## Remaining product work and independent Sol review

This is the first bounded normalization correction, not completed selected-date
Live acceptance. Next priority is carrying the frozen Planner date through the
Live request, source-local occurrence filtering, cache identity and visible
labels, without manipulating freshness/approval clocks. Do that before smarter
ranking. Other gaps include repeated schedules, broad calendar ranges, generic
organizer homepages rather than detail URLs, and source-time conflicts.

On the exact PR head, Sol should independently verify:

1. A real supported singleton schedule retains its published clock and source
   URL through acquisition, normalizing, deduplication, today bucket and card.
2. The correct detail opens; compare source assertions, explicitly recording
   any disagreement rather than declaring all times correct.
3. A date-only source and the municipal adapter do not regress. Missing clocks
   must not be invented. Expired and ambiguous sessions remain excluded.
4. Cold v4 background refresh followed by warm access and a process restart
   retains the same normalized event facts; old v3 results are not consumed.
5. Provider failures are INCONCLUSIVE/NOT OBSERVED, never synthetic acceptance.

No merge, Pi change, source approval or permanent activation belongs to this PR.
