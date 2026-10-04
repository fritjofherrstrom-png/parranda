# Generic scheduled calendar extraction

This is the extraction continuation of #548, based on its exact head
`8eb4bb711e1ffcf2a5c8259a4fafed304084f0c9`. Main remains
`d824a807cd5a72e1716e5140c657b78541fb1f29`. #548's unsupported-interface
fallback and worker search-budget forwarding are included unchanged; the
fallback regression now uses an unsupported range rather than a supported
single date. Neither PR is authorized for merge or deployment.

## Behavior and trust boundary

The host-independent `scheduled_event_cards` adapter recognizes at least two
distinct `article.node--type-event` identities, each with its own title/detail
link and `field--name-field-schedule`. Only exact ISO dates or textual
day/month/explicit-year dates using the existing multilingual month grammar
are supported. Impossible dates, periods, weekday recurrence, dates without
years, numeric ambiguous dates, clocks and surrounding prose are unsupported.
Conflicting facts for a detail identity are rejected.

The list supplies an explicit occurrence date. A same-origin detail must bind
that identity through its canonical URL and matching page title, contain one
full event article, and publish one event-owned contact with a structured
postal address. Any article-owned explicit title/permalink must also agree;
the page shell cannot override a contradictory event article. An exact
supported date in the detail's own schedule must agree with the listed date.
An absent occurrence or opaque opening-hours widget supplies no detail date.
**Contact information alone is insufficient:** the event's own
geographic field must contain one Google Maps directions API link explicitly
routing to that same street, postal code and locality. That standard URL is
parsed as evidence; it is never fetched. Explicit address and directions
countries must agree. Country codes and agreeing country names in the page's
language (or English) are retained; unsupported name/code comparisons reject
the contact. A country published by either agreeing address or directions is
preserved in the address and normalized event, and prevents an unrelated
anchor region/country from being added to the venue query. Without either
country fact, none is inferred from the hostname or timezone.
An unrelated office address, related
article, Leaflet map center, or separate contact marker cannot supply a venue
or coordinates. The committed detail fixture is a structural excerpt from the
real page retaining the contact/location relationship.

Output contains factual title, date, address and source provenance. It uses a
single listed `occurrences` date with unknown hours, never an invented midnight,
all-day opening assertion or recurrence. Existing source normalization keeps
today's unknown hours as `timing_relevance: unknown`. The trusted server-side
venue resolver can recover geometry from the source-owned address; ambiguity
remains mapless. Existing source-scoped Pulse may retain a mapless row, with no
route eligibility. `near_me` excludes it; no distance is fabricated.

## Bounds and collection outcomes

- HTTPS only, credential/fragment-free same-origin detail identities, existing
  public-URL checks, manual redirects limited to three per resource.
- Fresh robots fetch before the list; rules checked before every detail and
  redirected request. Unknown/failed robots fail closed. Wildcard/end rules are
  matched without a backtracking regex. Robots allowance does not grant terms.
- One collection deadline, default 10 seconds and hard maximum 15 seconds,
  covering fetch and body reads; abort plus a deadline race also handles a
  fetch implementation that does not honor its signal.
- Maximum 2 MiB per HTML response, 128 KiB robots, 8 MiB combined bodies;
  default four details, hard maximum eight, explicit source-local date window
  default seven days and hard maximum fourteen. Stale/out-of-window cards spend
  no detail fetches. This is a bounded sample, not exhaustive calendar coverage.
- DOM budgets: 20,000 inspected nodes, depth 256, 1,000,000 inspected characters,
  200 event articles; iterative ownership/text summaries, inert/hidden content
  excluded, including hidden nodes' own attributes. Excluded nodes still count
  against inspection limits. Line breaks and block boundaries separate text
  tokens, so `20<br>26` cannot manufacture an explicit year; inline emphasis
  remains supported. Any exhausted document budget rejects the whole document.
- Network/robots/redirect/budget failures discard partial rows and produce a
  failed collection. An unrecognized payload or current cards with no safely
  joined venue is a parse failure, not a healthy empty calendar. A recognized
  calendar with no date in the requested window is honestly empty.
  A detail inspection reports budget failure separately from an inspected but
  unsupported contact. A later detail budget failure discards earlier valid
  rows; it cannot produce healthy partial qualification evidence. Existing
  aggregate health labels a failed sole source `unavailable`, with
  `source_failures_present`, zero normalized/accepted events and zero healthy
  or event-bearing probes.

## Qualification and operations

The adapter is wired into discovery, manifest mapping, real collection,
qualification and reviewed-source allowlists. Manifest candidates remain
`review-needed`. A reviewed timezone and source language are mandatory before
collection. Existing exact endpoint/adapter/identity binding, robots, compatible
terms, repeated distinct-day observations and fresh qualification gates apply.
One successful probe is still observing. With compatible terms, repeated useful
probes may enter existing low-trust Pulse-only probation; no source approval is
manufactured. Unknown terms cannot create a runtime feed.

There is no new worker or schema migration and no new activation flag. The
already running source-scout worker collects this adapter through its ordinary
qualification path after the code is explicitly accepted. Cached discoveries
with `needs_adapter` must be refreshed on the ordinary worker schedule before
their new candidate/manifest can be probed. A missing reviewed timezone or
permission remains an explicit source-review task; do not invent either from
an event's title or listing URL. Do not change public search configuration to
imitate the isolated QA provider.

## Verification and real-page observation limits

Deterministic tests cover real-card/excerpt replay on an unrelated hostname,
multilingual dates, invalid/ambiguous dates, conflicting identities, explicit
contact-to-location joining, inert/nested DOM, robots paths and redirects,
payload/deadline/detail bounds, stale cards, real-provider qualification, terms,
trusted/ambiguous venue resolution and mapless near-me exclusion. Synthetic
distinct-day qualification tests verify state transitions; they do not claim
two days of real worker observations.

Independent review of frozen `a93b33769054aec8744e4fffae952c0054de7b96`
identified six synthetic blockers, reproduced before implementation changes:
article identity, detail date, conflicting/lost country, directly hidden route,
fabricated year across a line/block boundary, and hidden detail budget failure.
The initial added tests produced seven failures (country conflict and country
passthrough tested separately), with all 18 original/positive controls passing.
Corrections and regression controls remain in this same PR. Review findings do
not establish that the captured real pages contain those synthetic failures.
Corrected-head CI and renewed independent review belong in the PR handoff;
the original green CI is evidence only for the original head.

Bounded public HTTP 200 reads on 2026-10-04, without following redirects:

| URL path on `https://visit.gent.be` | Saved UTC | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `/robots.txt` | 18:53:05 | 3356 | `a54d037f8990b1afef6afa7766d180378de1f04d77bc3e5f585492147e77d7b3` |
| `/nl/agenda/evenementen` | 18:56:37 | 131979 | `5bcd6ef0c84f7858ed11839d2c92dcec283265b82d5c51d8b438a9dada9bbcf8` |
| `/nl/agenda/bloemenmarkt` | 18:55:47 | 81050 | `752b47fda7bce5cffa05915042165af606d783b48b5ae9529f75fa294dd756a4` |
| `/nl/agenda/biomarkt` | 19:04:45 | 71324 | `867a2ed8e3fafb47962b95d69c237557bf897b367488a761d1d4c56b3ce948a8` |

The saved list contains 13 supported single-date identities. Offline replay of
the full raw list plus robots and the first two full details, with detail limit
two, returns two source-backed date/address rows: Bloemenmarkt at Kouter and
Biomarkt at Koningin Maria Hendrikaplein. Both retain unknown hours and no
coordinates. **This proves extraction of those captured pages, not permission,
geocoding, deployed-worker qualification, public search stability or broad
European Live coverage.** No catalog writes or runtime changes were performed.
Workspace raw files and provenance/replay records are in `/tmp/parranda-*`;
the URL/hash record above and committed structural fixtures are durable.
The correction replays the same hash-verified captures offline and still
produces those two rows, now retaining the published `BE` country in each
address. No new public reads or runtime changes are required for that replay.

## Handoff and smallest runtime QA

Owner / target: Codex, `fix/qualified-scheduled-calendars`, main-targeted PR
including exact #548 ancestry. Integration decision: Fritjof. Runtime QA owner:
Jean Bob. Public staging/worker remain main `d824a807…` per operator report;
they have not run this candidate. Candidate SHA and CI link belong in the PR
record, updated after publication.

Landing condition: review and full CI on the frozen combined head, followed by
Fritjof's explicit merge/deploy decision. #548 must be reconciled against that
same ancestry if the combined PR is chosen; do not independently land a stale
fallback test after this extraction change. #501 and other experimental stacks
are excluded.

After a separate QA deployment decision, Jean Bob should use the accepted SHA
for both QA web and its existing worker, preserving the current search/catalog
configuration. Observe the ordinary scheduled retry of one evidenced calendar.
PASS: new adapter/manifest identity retained, provider produces source-backed
current date/address rows, unknown hours remain unknown, geometry and terms
retain their actual verdicts; `near_me` includes only resolved in-radius rows.
FAIL: fabricated clocks/recurrence/geometry, unrelated contact venue, unsafe
follow, implicit permission, or lost known-valid extraction. INCONCLUSIVE:
upstream changed/empty response, absent reviewed timezone/permission, search
failure, or no ordinary retry yet. Record that cause; do not call it European
coverage or automatically widen the probe. Public rollout remains a separate
Fritjof decision.
