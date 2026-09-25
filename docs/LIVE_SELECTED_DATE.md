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
- A `daily` window exists only when the source states every-day sessions
  ("dagligen", "varje dag", "alla dagar", "daily", or all seven weekdays). It
  keeps the existing source start-date/session semantics and introduces no
  previous-night session expansion. A range plus one clock is not a daily
  statement.
- A recurring entry claims only days its source states. `occurrences` holds at
  most 60 explicit source-local dates with one shared local clock: dates the
  source lists, or a weekday rule expanded only inside an explicit source range
  of at most 120 days. It matches a selected day only when that date is listed
  and, for today, while the stated session has not ended. Date-only listings are
  date facts; clocked listings need the reviewed venue timezone.
- `period` is a source range whose session days are not stated or not readable.
  It never matches a calendar date: never the selected-day bucket, never an
  evening anchor, never route-eligible. It may be listed among the following
  seven days it overlaps, labelled with the source range, the clock and
  "dagar enligt källan" / "days per source" — never "dagligen".
- Ended/stale evidence cannot be revived by a future date. Date-only records
  without a timezone expire at least once their date is past everywhere; this
  conservative bound does not assign a venue timezone.
- The persistent cache key contains the selected date. v7 excludes v6 pools
  that widened recurring ranges into every-day `daily` windows; v4 now-only
  results and v5 pools truncated by midnight-gap/acquisition-window defects
  cannot be reused either. Warm reads recheck temporal eligibility against real
  time and update result/count fields, without fetching solely to rerank.
- Editing Planner intent immediately aborts an outstanding Live query. A late
  body cannot replace the newer intent, including during the compose debounce.
- Future-date continuous cards show source start/end dates, not “on now”. The
  selected-day heading is explicit. Missing clocks are not manufactured.
  Listed occurrences show the stated date the row is about (the selected day,
  or the next listed date whose session has not ended), never "dagligen".

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
day. Within that page, rows outside the selected day and the following seven
days are counted in `out_of_period_event_count` before the trust gates. Only
rows inside the period may use the four trusted venue lookups, the selected
day's first; see `LIVE_PERIOD_VENUE_BUDGET.md`. Date-window filtering cannot create missing future inventory. Source
failures remain partial/unavailable, never a claimed quiet calendar. A finished
failed refresh is now answered as that failure (held two minutes in memory,
then retried) instead of as another `pending`; see
`LIVE_SOURCE_FAILURE_STATES.md`.

Fusion, independent-family trust, preference ranking, geometry and route-event
weave gates are not weakened. A Live card is not automatically a route stop.
This does not establish universal multi-source coverage or resolve every
source/organizer disagreement. Generic homepage links are now labelled as
such (`LIVE_SOURCE_LINKS.md`). Recurring schedules are resolved only where a
reviewed adapter can read the source's own statement; see
*Recurring calendar entries*.

## Recurring calendar entries

An independent Pi review comment on PR #506 reported three recurring municipal
entries from a reviewed Sitevision calendar shown as "dagligen …" under a
selected Friday that was wrong for them. That observation is second-hand here;
it was not re-observed in this change.

Cause, reproduced against base `1be68a5` with fixtures: the Sitevision adapter
turned every explicit date range plus clock range into `daily`, and ignored the
"Återkommande tillfällen" text it had already extracted. The calendar gate, the
Live timing label and the evening weave then treated every date in the range as
a session. The existing provider fixture itself asserted `tonight` on a
Wednesday for an "Every Thursday" series.

The correction is generic; there is no municipality, city or hostname rule:

- The adapter reads the whole recurrence section, up to the next heading,
  heading anchor or bold field label. Sitevision portlet wrapper ids do not end
  it. A section that does not end inside an 8,000-character bound is treated as
  incomplete.
- A closed grammar accepts one daily statement, one weekday set (with ranges
  such as "mån–fre" or "måndag till söndag"), or one date list (with optional
  weekday prefixes validated against the date, a shared month as in "2, 9 och
  16 juli", or ISO dates). Clocks may accompany any of them, with "kl" allowed.
  Any other word, such as "varannan", "utom" or numeric "2/7", fails the whole
  statement.
- The result becomes `period` when a listed date falls outside the stated range,
  clocks conflict, a weekday rule is open-ended or spans more than 120 days, the
  list exceeds 60 dates, or a stated "dagligen" is contradicted. One explicitly
  stated date with an open-ended rule keeps only that date.
- A listing row has no recurrence section, so a range with a clock stays a
  period until its bounded detail page states which days. Detail timing
  replaces the listing's timing atoms together, so a listing instant cannot
  survive beside a detail period.
- The contract normalizes a declared but unknown window kind to `period`, never
  to `daily`. Fusion merges listed occurrences or periods only with the same
  kind and identical stated days. The evening weave materializes a listed
  occurrence only on a stated evening. Listed occurrences keep the 14-day span
  bound for route eligibility that daily windows already had.

The other three `daily` producers follow the same rule. The grammar lives in
`server/pulse-sources/source-recurrence.js` and is shared, not copied:

- **Public-events API** (`localized_events_api`): a multi-day record claims only
  the sessions its `schedule.dates` lists inside the record's span with one
  shared clock. Listing every day of the span is a daily statement (read up to
  400 entries). These listings become a period: dates outside the span,
  conflicting, malformed or overnight clocks, a start or end that only some
  sessions state (one session's clock is never lent to another unless the record
  states it), more than 60 non-consecutive dates, or a malformed record clock
  beside the listing. A clocked span without listings is a period. A date-only
  span without listings stays all-day. `schedule.range` is not interpreted.
- **Wix sitemap** (`wix_event_sitemap`): the "När" and "Öppettider"/"Tid" labels
  are read around the parsed range:
  - A stated daily phrase makes the window `daily`.
  - Weekdays in the time label ("Tis–sön 11.00–17.00"), and plural or "varje"
    weekdays in the date label, become occurrences inside the range. A
    singular weekday before a date only names that date.
  - Two or more explicit dates ("15 juli, 22 juli", "15 och 22 juli") name
    exactly those days. They were previously read as the range from the first
    to the second date.
  - Unknown words beside weekday evidence become a period. So do different
    clocks for different days, which also drop the clock.
  - Without recurrence words, a clocked range is a period and a date-only range
    stays all-day.
  - Clocked periods and occurrences take the timed detail quota that the
    replaced daily rows used.
- **Official programme articles** (`official_program_article`): a row with a
  clock and a multi-day range is `daily` only when the row states daily sessions
  in its own words before the first clock. The range may be the row's own or a
  dated heading such as a festival span above timed rows. Apart from the date,
  those words must be exactly one closed daily phrase in the programme
  languages (sv, en, es, ca, fr, it, de, pt or nl). Title words after the clock
  never count, and a stated phrase is removed from the title. Every other such
  row is a period. Incidental fix in the same title cleanup: clock prefixes
  such as "at", "a" or "h" are whole words only. Before, titles lost their
  first letters ("Harbour concert" became "arbour concert").

Deliberate behaviour change: a source that publishes a range and one clock
without saying "daily" (for example a summer programme "20 juli – 7 augusti,
10–17", or an API exhibition with only start/end dates and opening clocks) no
longer appears under a selected day. It appears among the following days as a
period. The source did not state that every day carries a session.

Evidence, labelled honestly: deterministic regressions only. They cover the
adapter (listed dates, weekday rules, stated daily, unreadable and truncated
recurrences, listing/detail replacement), the normalizer, `eventOccursOnDate` and
`selectedDateBucket`, fusion, the evening weave, the v7 cache and the frontend
`eventTiming`. An end-to-end supply test selects a Friday and a Thursday over
the defect's shape. These tests fail on `1be68a5` and pass after the change.
The real reviewed detail markup was **not** observed: the development session's
egress policy denied the calendar host. The fixture therefore follows the
adapter's existing anchor contract and the reviewed defect's described shape.
Fixtures are not provider or Pi acceptance.

For the other three adapters, per-adapter tests and one end-to-end test each
select days through `collectAnchorEvents`. These fail on `82e28db`, the head
with only the Sitevision fix, and pass after. The reviewed public-events API
and Wix hosts were also denied by the session's egress policy. Their fixtures
follow the adapters' existing wire and DOM contracts, not observed real
records.

Pi or Sol should verify the frozen head:

1. In the same reviewed geography, select the same Friday. The three entries
   must not appear under the selected day. Open each source link and compare
   its stated recurrence with the visible label.
2. Record each entry's real "Återkommande tillfällen" text and resulting kind.
   A shape the grammar does not read stays a period; that is honest, not a
   failure, but record it as a follow-up grammar case.
3. Select one stated occurrence date. The entry must appear under that day with
   the stated clock.
4. Warm v7, restart with the same cache and repeat. No v6 pool may satisfy v7.
5. For the reviewed public-events API and Wix sources, pick one multi-day entry
   each. Compare its source schedule or opening hours with the Live kind
   (`occurrences`, `period` or `daily`) and the day it appears under.

Remaining gaps:

- The public-events API's `schedule.range` object is not interpreted; its real
  shape was not observed.
- Programme rows with weekday rules ("Tuesdays") and daily statements made only
  in a dated heading stay periods.
- Pre-existing and unchanged here: the Wix clock parser reads "7:00 pm" as
  07:00.
- Date-only ranges without recurrence evidence remain all-day date facts under
  the existing contract.
- Recurrence phrased outside the closed grammars degrades to a period rather
  than being guessed.

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
