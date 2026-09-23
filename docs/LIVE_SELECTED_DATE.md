# Selected-date Live events

Live now carries the frozen Planner date through collection, persistent cache,
calendar filtering, the non-mutating Live query and the visible date heading.
Previously Planner passed only the actual clock to event supply, and Live scope
queries had no date field. A tomorrow plan therefore browsed today's events.

## Contract

- `selected_date` is an optional canonical `YYYY-MM-DD` request/response field
  on `/api/live-events`. Planner passes its resolved route date internally as
  `selectedDate`; the frontend reuses the server response date for every scope.
  Missing date retains legacy now-based API behavior. Invalid dates return 400.
- Date is user intent, never source evidence. Source approval, acquisition
  freshness, cancellation and normalization use the actual clock. Public
  timezone/source metadata cannot become trusted facts.
- With a selected date, legacy `tonight` means the selected calendar day;
  `this_week` means the following seven calendar days. An occurrence overlapping
  the selected day is shown there once, not repeated in the later bucket.
- Continuous intervals intersect source-local midnight boundaries (including
  DST), with an exclusive end. Unknown venue timezone cannot imply a date.
  Start-only events match only their source-local start day, with no invented
  duration. Explicit all-day ranges remain date facts, not opening hours.
  Daily windows keep the existing source start-date/session semantics; this
  slice does not introduce a previous-night session expansion.
- Ended/stale evidence cannot be revived by a future date. Date-only records
  without a timezone expire at least once their date is past everywhere; this
  conservative bound does not assign a venue timezone.
- The v6 persistent cache key contains the selected date. v4 now-only results
  and v5 pools truncated by midnight-gap/acquisition-window defects cannot be
  reused. Warm reads recheck temporal eligibility against real time
  and update result/count fields, without fetching solely to rerank.
- Editing Planner intent immediately aborts an outstanding Live query. A late
  body cannot replace the newer intent, including during the compose debounce.
- Future-date continuous cards show source start/end dates, not “on now”. The
  selected-day heading is explicit. Missing clocks are not manufactured.

## Bounds and unchanged trust gates

No new source, approval, provider key, worker or crawler. Existing source plan:
at most four sources, at most three local. Twenty-minute event TTL; background
warm timeout remains 30 seconds per provider (not a new global deadline).
One global Ticketmaster page remains capped at 40 records. For selected dates
its acquisition envelope begins no earlier than actual now or selected midnight
minus 14 hours, and ends independently at selected midnight plus eight days
plus 12 hours. This covers the selected day and seven following days across
UTC+14 to UTC-12; final source-local date filtering removes padding.
One page and the 40-record cap are unchanged.
Existing local adapter item/detail/byte limits remain unchanged; e.g. the
reviewed Stockholm API page is capped at 100 and municipal detail fan-out is
bounded by its existing descriptor. Six highlights and at most 24 additional
rows per bucket remain the display limits. Live scope retry remains three
delays (1.5, 3, 5 seconds), not an unbounded poll.

Date-unaware feeds still expose only their bounded source page. Empty means no
accepted result from the available evidence, **not** proof nothing happens that
day. Date-window filtering cannot create missing future inventory. Source
failures remain partial/unavailable, never a claimed quiet calendar.

Fusion, independent-family trust, preference ranking, geometry and route-event
weave gates are not weakened. A Live card is not automatically a route stop.
This PR does not establish universal multi-source coverage or resolve every
source/organizer disagreement, recurring schedule gap or generic homepage link.

## Independent review corrections

Review of `75b2340` found and reproduced four defects, now covered by regressions:

- A Live scope request started while a previous day was held during composition
  could publish its old-date body under the replacement day's heading. Requests
  now belong to the exact published response as well as the input intent;
  replacement clears both completed scope results and outstanding requests.
- Warm projection evaluated every bucket twice and repeatedly normalized local
  midnights across eight days. Projection now computes one bucket per event and
  jumps directly to its possible date overlap; a bounded operation-count test
  guards against repeating this expensive work for every horizon day.
- Continuous intervals on a day whose midnight is skipped by DST were lost.
  Calendar overlap now uses actual endpoint instants, including exclusive ends;
  regressions cover Santiago, Havana and an entirely skipped Apia date.
- A nine-day global UTC envelope missed late events on the last local day in
  negative offsets. Independent lower/upper bounds preserve that day without
  adding pages or increasing the record cap. A query-respecting provider fixture
  catches this, unlike a fixture that returns records outside the request window.

These are deterministic correctness checks, not live DST/provider acceptance.
The correcting reviewer is also the patch author; final corrective changes still
need a separate focused review before merge.

## Evidence and independent QA

Deterministic regressions cover API date validation/forwarding, real-clock
separation, DST/local date overlap, daily/all-day facts, expired warm results,
date-key isolation and persisted cache reload, the one-page global envelope,
and a mounted Planner late-response race. These are not provider/Pi acceptance.

Local real-provider checks on 22 September 2026 use Stockholm and Malmö with
selected dates 22/23 September. Base `f835bcd` API accepts but ignores a tomorrow
date and returns the 22 September Amity Affliction concert; the changed path
excludes it from tomorrow and includes only overlapping date evidence. Browser
checks show an explicit 23 September heading and no prior-day concert after
changing the date. Malmö's source link confirms the 22 September Kirseberg walk
at 18:00–19:30. One of Malmö's two sources fails: coverage is partial, not full
multi-source acceptance. Exact final-head checks and raw artifacts are recorded
in the PR; working-tree observations are not relabelled as final-head evidence.

Sol should independently verify the frozen PR head before merge:

1. Compare the same anchor/preferences and actual date for today/tomorrow.
2. Follow a visible event's exact link; compare source date, time and venue.
3. Check a source-local midnight/DST boundary with deterministic fixtures;
   classify unobserved real timing boundaries honestly.
4. Warm two dates, restart the real process with the same cache, repeat both
   requests and compare identities/buckets. No v4/v5 result may satisfy v6.
5. Change date while Live is in flight; old results must not overwrite it.
6. Check both narrow and wide viewport, explicit date/unknown-time copy, and
   distinct pending/empty/partial/unavailable states. Do not seed fake events.

No deployment, source activation, Pi change or #501 change belongs to this PR.
