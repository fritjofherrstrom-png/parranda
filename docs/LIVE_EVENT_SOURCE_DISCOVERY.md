# Live Event Source Discovery

Parranda Pulse/live should not depend on one hardcoded city feed. The live
engine needs a repeatable way to discover, evaluate, reject, and eventually
normalize multiple time-sensitive source families for any place.

This document defines the source-discovery method that feeds the existing
`time_sensitive_events` contract. It is not a citypack plan and it does not
make events into route stops. Source discovery is the acquisition layer; Pulse,
dayflow, and route composition remain downstream consumers with their own gates.

## Discovery Algorithm

Input can start from a place name, coordinates, or a resolved bounding box.

1. Resolve the place context.
   - If there is a place name, resolve city/country/bounds through the normal
     trusted resolver path.
   - If only coordinates are present, resolve an anchor/bounds when available,
     but do not claim a citypack exists.
   - Carry place label, country, coordinates, bounds, and language hints into
     discovery. Do not trust user-provided source URLs as providers.
2. Enumerate source families in priority order.
   - Official municipal calendar.
   - Official tourism/destination calendar.
   - Cultural institutions and major venues.
   - `schema.org/Event` JSON-LD on listing/detail pages.
   - Open-data event APIs.
   - Ticket/event APIs only when API and terms are compatible.
   - Stable HTML calendars when APIs/feeds are unavailable.
   - JS-rendered/browser extraction only as a reviewed last resort.
   - Existing provider families already in the repo, such as schema.org/Event
     and Linked Events, when they match the source shape.
3. Evaluate each candidate source.
   - Can title, start/end, venue/place, source URL, and recurrence be extracted?
   - Does the source provide venue coordinates, or is the venue geocodable?
   - Are source terms compatible with a provider probe, permission-required, or
     restricted?
   - Does the source map to an existing provider adapter, or does it need a new
     adapter?
4. Score and classify the source candidate.
   - `viable_provider_probe`: source is structured enough and terms look
     compatible enough for a provider probe.
   - `needs_adapter_or_permission`: useful source, but requires a new adapter or
     permission/legal review before runtime use.
   - `rejected`: missing core fields, restricted terms, or unsafe provenance.
5. Classify the extraction tier.
   - APIs/feeds and structured data are preferred.
   - HTML scraping is valid for factual event atoms when terms, robots,
     structure, caching, attribution, and source health are acceptable.
   - JS-rendered/browser scraping and weak social/manual listings are
     probe-only until explicitly reviewed.
6. Normalize provider output into `time_sensitive_events`.
   - Providers own raw facts.
   - Parranda owns normalization, timing relevance, confidence, display gates,
     salience, dedupe, and route/Pulse eligibility.

The repo harness for step 4 is `server/pulse-sources/source-discovery.js`.
It is pure, deterministic, and does not fetch the network. The repo also has a
source-coverage graph in `server/pulse-sources/local-live-source-graph.js`.
That graph turns evaluated candidates into:

- covered source families;
- needs-review / needs-corroboration families;
- missing family gaps;
- social/community coverage status;
- an acquisition plan for what source family to find next.

Local fixtures can be evaluated with:

```bash
node scripts/probe-live-event-sources.js source-candidates.json
```

The bounded website scout lives in
server/pulse-sources/local-event-source-scout.js. It closes the step before
candidate evaluation:

- OSM website / contact:website and Wikidata P856 atoms can become trusted
  website seeds without changing place confidence or route ranking;
- supplied local-language terms produce a bounded search-query plan for a
  trusted background search integration;
- an optional operator-owned SearXNG integration can execute a capped subset of
  that plan in the background and return only low-trust public website seeds;
- one reviewed public page per seed is inspected for iCal, The Events Calendar,
  event-related REST/JSON endpoints exposed in page attributes,
  schema.org/Event JSON-LD, compatible venue HTML, RSS, and social discovery
  hints. A strict `official_program_article` grammar also recognizes subordinate
  public programme sections with explicit dates/times and shared venue context;
- private/loopback URLs, unsafe redirects, robots exclusions, oversized
  responses, timeouts, and source failures fail closed;
- successful robots and source-page responses use the existing source cache;
  `PARRANDA_CACHE_DIR` makes repeat operator runs persistent, while failures are
  not cached and may recover on the next bounded run;
- discovered machine-readable interfaces become review-needed manifest
  candidates only. They never become active runtime providers automatically;
- RSS/Atom feeds can now produce review-needed manifests for a bounded generic
  detail adapter, but only when the interface is plausibly an *event* interface
  (see "RSS/Atom event-interface eligibility"). The feed is only an index:
  Parranda never treats `pubDate`, Atom `updated`, feed descriptions, or feed
  titles as event facts. The adapter follows bounded same-origin item links and
  accepts event timing only from schema.org/Event JSON-LD on the detail page. Unrecognized generic HTML still
  remains adapter-review work. Recognized Sitevision calendars and Wix event
  sites with public sitemaps can likewise produce review-needed manifests for
  their bounded generic adapters. Social links remain discovery/corroboration
  hints rather than event truth.

The operator harness is default-off. Without the live switch it emits only the
query/seed plan:

    node scripts/scout-local-event-sources.js scout-input.json

Explicit bounded probing of reviewed public seeds requires:

    node scripts/scout-local-event-sources.js scout-input.json --live

On a self-hosted deployment with the geo Source Catalog enabled, a trusted
place-mode scout can persist its normalized source profile for review:

    node scripts/scout-local-event-sources.js --place "Place name" --live --catalog

The live harness accepts the existing `PARRANDA_CACHE_DIR` and an optional
`PARRANDA_EVENT_SOURCE_SCOUT_CACHE_TTL_MS`. It remains an operator/background
job; no user request waits for this crawl.

### Cold discovery proof and deployment gate

The engine contract is covered by a deterministic cold-loop test across three
unrelated places and source languages. Each request contains only a
resolver-attested place/anchor. A background search seam returns a previously
unknown public source, the worker detects and qualifies its declared calendar
interface on separate UTC days, persists the geographic profile, and a later
request collects and surfaces its normalized event in Live. The same suite
proves that an incidental-date news page does not become a source. The proof
keeps these states separate:

```txt
DISCOVERED -> PARSED -> QUALIFIED -> RUNTIME-ELIGIBLE
           -> COLLECTED -> SALIENT -> SHOWN IN LIVE
                                      ROUTE-ELIGIBLE (separate, false by default)
```

This deterministic proof injects the bounded search provider; it is not proof
that a deployment is proactively searching. The production Compose contract
starts `source-scout-worker` only with the `source-catalog` profile, and source
search remains disabled unless the operator explicitly supplies both:

```txt
PARRANDA_SOURCE_SEARCH=enabled
PARRANDA_SOURCE_SEARCH_ENDPOINT=https://operator-owned-searxng.example/search
```

The endpoint must expose the reviewed SearXNG JSON contract. Without that
worker profile and endpoint, demand can be recorded but unknown sources cannot
be enumerated automatically. That deployment is `environment_not_wired`, not
evidence that a place has no events. A manually supplied URL or one-off scout
run is useful operator evidence but does not satisfy the proactive cold-loop
product claim.

### Degraded search is not an answer

A metasearch proxies engines that rate-limit, CAPTCHA, suspend and time out
independently. Parranda therefore keeps four distinct per-query truths, and
never collapses them:

| results | engines | status | meaning |
| --- | --- | --- | --- |
| yes | healthy | `ok` | clean success |
| yes | degraded | `partial` | **results are kept**; only confidence drops |
| no | healthy | `empty` | a real answer: nothing found |
| no | degraded | `degraded` | no trustworthy answer; retryable |

A run is `complete` or `partial` when it produced seeds, `empty` when every
query answered cleanly and found nothing, `degraded` when some query answered
nothing we can believe, and `failed` when nothing answered at all. Only the
last two set `retry_recommended`.

This distinction matters because "no seeds" reaches the scout target lifecycle.
A clean empty is an answer, and the target waits out the ordinary refresh. A
degraded or failed search is not an answer, so the target is retried on the
existing bounded backoff instead of being completed — otherwise one bad
provider window would cost an arbitrary cold place a full refresh cycle of
discovery opportunity.

Supporting behaviour, all bounded and city-agnostic:

- **Pacing.** The bounded query budget is paced rather than fired as a burst.
  Bursting is itself what trips proxied engines into rate limiting, so the
  unpaced version helped cause the failure it then reported.
- **Retry.** Retries are drawn from one budget for the whole run, so an
  isolated flaky request recovers while a provider that is genuinely down
  cannot double the wall clock of every query. Rate limiting, server errors,
  timeouts and engine degradation are retryable; contract and configuration
  errors (4xx other than 429, invalid payloads) are not.
- **Caching.** Only outcomes that carried results are cached. Caching a
  zero-result verdict would let the TTL replay it straight through the retry,
  making the retry a no-op for exactly the queries most worth re-asking.
- **Backoff.** Scout-target `attempt_count` resets on completion, so the
  exponential delay reflects consecutive failures rather than a target's
  lifetime claim count.

Per-query evidence is persisted, bounded: query text, status, reason, raw and
accepted result counts, unresponsive engine names, whether useful results
existed despite degraded engines, attempt count, and whether a retry is
warranted. Raw provider payloads and engine error strings are not persisted.
Source search treats the configured `PARRANDA_SOURCE_SEARCH_MAX_QUERIES` as its
diverse initial tranche, not as the total discovery ambition. Query generation
preserves locality/region/resolved-label scope and the existing local discovery
terms, then round-robins term families so an early prefix cannot monopolize the
run. Healthy expansion proceeds in small paced tranches while those tranches add
new source host identities. Two expansion tranches with no new identity stop the
run; broadly degraded tranches without trustworthy novelty stop immediately.
Partial responses keep their useful results and may continue.

The separate `PARRANDA_SOURCE_SEARCH_HARD_QUERY_LIMIT` defaults to 30. The
combined event and structured-place query universe is at most 26, so this is a
runaway safety ceiling rather than the expected stopping mechanism.
Event and place families are interleaved before the first tranche, so an early
low-novelty stop cannot consume the whole run before place discovery begins.
`PARRANDA_SOURCE_SEARCH_EXPANSION_TRANCHE_SIZE`
defaults to 4. Seed selection takes one page from each source identity before a
second page from any identity, preventing early same-domain duplicates from
crowding out later sources.

Adaptive proof remains compact: `generated_query_count`, `queried_count`,
`skipped_query_count`, `expansion_round_count`, `novel_source_identity_count`,
bounded tranche counts and one of `query_space_exhausted`,
`marginal_novelty_exhausted`, `provider_health_degraded`, or
`hard_safety_ceiling`. A low seed count is therefore never mistaken for "this
place has nothing", and no raw provider payload is persisted.

The catalog write is forced to `review_needed`, even if upstream scout data
claims otherwise. Re-running discovery cannot overwrite an approved, rejected,
or disabled profile. After terms, ownership, timezone, geography, and parser
output have been reviewed, an operator may approve the exact profile or retain
the existing versioned `PARRANDA_EVENT_FEEDS` path. User requests never perform
this discovery crawl; they consume only approved, cache-backed sources through
bounded acquisition.

The background worker also performs a bounded post-scout qualification pass for
manifest candidates that bind exactly to the discovered HTTPS endpoint,
adapter, publisher identity, and trusted bounds. It runs at most two candidates
per scout cycle through the existing provider, normalization, time, geometry,
and source-health path. Unprobed and least-recently probed candidates are chosen
first, so a larger source profile cannot starve behind the same two rows.
Candidates classified as `viable_provider_probe` may be fetched. A discovered
`needs_adapter_or_permission` candidate may also be probed only when it binds to
an already-tested adapter, has no candidate blockers, carries an exact reviewed
manifest identity, and the scout's actual robots verdict is `allowed`.
Restricted, social/corroboration-only, unknown-adapter, and robots-unknown rows
remain unprobed. Probing is evidence collection, not source approval.

Qualification stores compact status/count evidence only; provider payloads are
never persisted. One healthy probe remains `observing`. A source becomes
`qualified_for_review` only after healthy observations on two distinct days
within 30 days and at least one accepted current event. Healthy-empty results,
same-day retries, stale history, parser/geometry rejection, and a latest failed
probe cannot manufacture readiness. This verdict never changes
`runtime_review` or approves terms. When the separate
`PARRANDA_QUALIFIED_SOURCE_RUNTIME` gate is enabled, a repeatedly healthy exact
source with mechanically compatible `open_license` or
`api_terms_compatible` terms may enter a short-lived, low-confidence,
Pulse-only probation feed. Unknown terms still require operator review, and a
probation feed is never route eligible. This reduces operator guesswork while
preserving the stronger trusted review gate.

The same worker now has a separate structured-place lane. Resolver-attested
country context contributes bounded local-language place terms alongside the
event vocabulary, and the scout may follow high-precision same-origin
attractions/visitor-guide links. A page becomes a place-source candidate only
when a closed reviewed-place adapter finds either at least two stable,
exact-coordinate inline records or at least two bounded same-origin detail
pointers. The supported formats are inline schema.org place JSON-LD,
pointer-only schema.org `ItemList` pages, and `map_linked_place_html`: repeated
server-rendered cards where
one balanced semantic item or explicitly card-marked DOM unit contains an
exact heading/detail identity, one unambiguous explicit closed category and one
unambiguous high-precision coordinate pair in a recognized Google,
OpenStreetMap or Apple Maps link. Wrapping sections and sibling fragments are
not card evidence. The detail identity must be same-origin HTTPS. An
individual venue page, generic `LocalBusiness`, prose, ratings, images,
coordinate-looking text, missing/unknown card facts, out-of-bounds rows,
restricted terms, unsafe URLs and robots-disallowed pages cannot produce a
probeable manifest.

The `schema-org-place-list-detail-html-v1` probe and approved refresh follow at
most 12 exact same-origin HTTPS detail URLs, sequentially, under one aggregate
timeout and byte budget. Each detail is accepted only when exactly one
allowlisted schema.org Place node carries name, type, exact in-bounds
coordinates and an identity equal to that detail URL. Discovery records only
the bounded pointer count; qualification and approved collection perform the
actual fetch. The approved worker persists accepted rows, while Planner reads
only the revision-bound reservoir and never traverses details itself.

Place candidates live in `source_profile.place_source_candidates` and their
manifests in `place_manifest_candidates`; they do not enter event-family
coverage. A separate `place_source_qualification` probes at most two exact
endpoint/adapter/publisher/bounds bindings per worker cycle through the same
bounded reviewed-place network and parser path. It retains counts only, merges
at most one observation per UTC day, and requires two healthy days plus a
current list of at least two accepted places before `qualified_for_review`.
This verdict is review prioritization only: unlike event probation, there is no
automatic place-source runtime lane. `runtime_review.place_sources` remains
empty until an operator approves compatible terms, ownership/evidence family,
health and expiry through the existing server-owned review boundary.

Catalog approval is an authenticated operator operation, not an application
request. From a server shell that already owns the catalog credential, inspect
the server-derived review surface first:

```sh
npm run review:source-profile -- --inspect place-source-profile-v1:...
```

The decision document must name that exact `profile_key`, its returned
`profile_revision`, an expiry no more than 90 days away, and one or more closed
place-source decisions (candidate id, evidence/source tier, terms, health,
runtime policy and bounded item cap). It cannot supply or replace endpoint,
adapter or publisher identity; those are derived again from the persisted
discovery row. Apply it from an authenticated shell and provide an explicit
operator audit label:

```sh
npm run review:source-profile -- \
  --approve /server-owned/path/source-decision.json \
  --operator operator-id
```

The approval, normalized decision and configuration revision are persisted in
`pulse_source_profile_approvals`. The profile update and creation of worker
refresh targets are one conditional database statement. Reapplying the same
decision is idempotent. A changed profile revision, stale decision, expired
approval, unknown candidate or missing closed field fails closed; material
rediscovery demotes an approved profile back to `review_needed` without letting
its old reservoir remain active. There is no public approval endpoint and
discovery/qualification still cannot approve itself.

The source-scout worker owns active place acquisition after approval. It leases
`pulse_source_place_refresh_targets`, fetches through the already-reviewed
bounded adapter, writes compact observations to
`pulse_source_place_fetch_observations`, and upserts exact place identities into
`pulse_source_place_candidates`. Request handling reads only fresh persistent
rows whose profile revision and approval key still match the current approved
profile; it never fetches the reviewed endpoint. A transient refresh failure
backs off and retains still-fresh rows, while expiry, approval drift or profile
drift makes them unavailable. Route-stop provenance carries only the bounded
profile/revision/approval/feed/adapter/observation/freshness chain, not raw
loader configuration or review evidence.

Migration `004-trusted-place-source-lifecycle.sql` is additive. Deployment
rollback is therefore an image rollback: leave the new tables in place so audit
history and reservoir rows are retained, and disable the affected catalog
profile if its supply must be withdrawn. Do not drop the tables during an
incident. Old images ignore them; a later roll-forward reuses the same audit
and must still pass the current revision/expiry joins.

A live format audit on 2026-09-01 found that the map-linked adapter could
extract seven bounded records across four closed place types from an official
destination guide that the schema.org-only scout could not use. Other audited
official guides exposed stable list/detail links but kept type or coordinates
on detail pages, or exposed names without exact coordinates. The closed
schema.org pointer-list shape is now supported when the detail page itself
provides an exact matching identity, allowlisted type and coordinates. Other
list/detail shapes remain honest misses: no adapter geocodes, fuzzy-matches or
uses a city-specific fallback. Live audit rows were not committed as fixtures
and no audited endpoint was activated by discovery.

### Reviewed event source-profile runtime bridge

An event source profile may carry an explicit `runtime_review` after operator
review and be supplied through the trusted deployment variable
`PARRANDA_REVIEWED_EVENT_SOURCE_PROFILES`. Existing approved event profiles in
the Postgres geo Source Catalog remain readable for compatibility, but the
current revision-bound `review:source-profile` CLI approves place sources only;
it does not create new event-feed approvals. Discovery output starts as
`unreviewed` with no feeds, so a scout result can never activate itself.

The event runtime bridge accepts a reviewed feed only when:

- the approval is fresh and has a future expiry;
- the row binds to an exact discovered candidate id, HTTPS endpoint, compatible
  existing adapter, and publisher identity;
- terms are `open_license` or `api_terms_compatible`, source health is
  `healthy`, and runtime policy is bounded;
- social/corroboration-only evidence is excluded from standalone collection;
- floating-time adapters have a reviewed valid IANA timezone;
- the trusted profile bounds remain the collection-selection bounds.

Direct `PARRANDA_EVENT_FEEDS` rows retain precedence over matching profile
feeds. Catalog rows are selected by reviewed bounds, approval expiry, and the
request's trusted server-resolved anchor; public request payload cannot provide
a source registry or catalog connection. Once accepted, a profiled source
enters the existing bounded cache, normalization, fusion, source-health,
browse, and personalized-highlight path; it does not create a parallel event
engine. Profile acceptance alone never alters a route or day anchor. A
normalized event may affect a route later only if it independently passes route
eligibility and the bounded geometry/full-walking-validation interrupt contract.

### Reviewed place-source reservoir bridge

Place profiles use a separate trust boundary. Legacy operator-managed
deployments may supply exact reviewed profiles through
`PARRANDA_REVIEWED_PLACE_SOURCE_PROFILES`; those rows use the bounded place
source cache. The Postgres-backed Source Catalog instead uses the revision-bound
approval flow described above: approval creates refresh targets, the worker
fetches the reviewed endpoint, and request handling reads only the persistent
fresh reservoir.

The place bridge accepts only exact discovered candidate, HTTPS endpoint,
adapter-contract, source-identity and reviewed-bounds bindings. Terms, evidence
family, source tier, health, runtime policy and expiry must pass the closed
review contract. The request path cannot fetch a catalog source, inject a
profile, or approve one. Official reviewed-source rows may pass route gates
without claiming place-level human verification; editorial-only rows still
need independent corroboration. Event feeds, event timing and Pulse eligibility
do not participate in this place-source bridge.

## RSS/Atom event-interface eligibility

RSS/Atom shape is *transport* evidence, not event evidence. A feed MIME type, a
`/feed` path, a `.rss` suffix or a `.xml` suffix only says a document might be a
syndication index. It says nothing about whether that index lists events.

Discovery used to treat transport shape alone as an event-source interface, so
comment feeds, OpenSearch descriptors, sitemaps, per-article feeds and archived
XML pages all became `rss_atom_event_detail` candidates. They were probed on
rotation and never carried a single event row, because the interface itself was
never an event interface.

Discovery is optimized for **recall**, not for a clean detector. The goal is a
rich local knowledge reservoir; relevance filtering happens later, downstream.
So only interfaces we can positively identify as irrelevant are rejected.
Absence of event evidence is not evidence of absence.

A large city exposes `/events`, iCal, schema.org and JSON APIs. A village,
island or seasonal destination often exposes its programme through a generic
WordPress feed, a municipal news post, a cultural association site or a venue
blog. Requiring strong event semantics too early would systematically lose the
smaller and less structured places, which is the opposite of the product goal.

Interfaces are therefore sorted into three populations, not two:

```txt
known non-event evidence        -> non_event      (rejected, fail-closed)
transport, nothing known        -> exploratory    (retained, not probed)
transport + event context       -> event_interface (probe lane)
```

`event_interface` candidates enter the bounded qualification probe lane as
before. `exploratory` interfaces are retained as discovery hints in the same
architectural lane as social discovery hints: persisted, `probe_only`,
`corroboration_required`, never runtime eligible.

Exploratory interfaces are deliberately kept **out** of the manifest lane. The
qualification rotation probes two candidates per run, oldest-first, with no
notion of candidate strength (`source-qualification.js`), so admitting
uncertain feeds there would starve real event candidates of the scarce probe
budget — which is the mechanism that produced zero event-bearing evidence in
the first place. Curiosity belongs in discovery; scarcity belongs in
qualification.

Non-event evidence — the only grounds for rejection. Each is a positive
identification of a non-event interface, not merely missing evidence. These
reject regardless of page context, because an event venue's comments feed is
still a comments feed:

- comment feeds, in path (`/comments/feed`) and query (`?feed=comments-rss2`) form;
- OpenSearch descriptors, by filename, MIME, or `rel=search`;
- sitemap XML, including indexed and CMS-generated variants;
- site-plumbing XML such as RSD and editor manifests, and non-feed `rel` values;
- archived/snapshot XML paths;
- search-result feeds;
- feed MIME with no reachable http(s) locator.

Notably **not** rejected: generic `/feed`, `/{slug}/feed`, `/music/feed`,
section and archive feeds, and bare `.xml`. A nested feed is only rejected on
an explicit comments marker, never on the shape of its parent slug. These are
exactly the interfaces a small publisher's programme hides behind, so they stay
exploratory rather than being written off.

Positive event-context evidence is source-owned page or link semantics, never
publisher identity — being an event venue is not evidence that a given feed
indexes events:

- the feed's accessible name (`<a>` text, `title`, `aria-label`) carries
  event/calendar vocabulary;
- the feed's own path carries event/calendar vocabulary;
- the page was reached as an attested same-origin calendar link;
- the page carries schema.org/Event rows;
- the page matched an existing event-surface signature (programme article,
  Sitevision, Wix, The Events Calendar, generic listing markup);
- the page's own path or heading carries event/calendar vocabulary, unless the
  page URL is itself a dated or entry-shaped article path.

Vocabulary is the existing multilingual `CALENDAR_LINK_TERMS` list plus the
resolver-attested local discovery terms for the place, so a localized calendar
needs no English word. There is no publisher, domain, or city rule.

The rule is pure and deterministic, and it answers only *"is this plausibly an
event interface?"*. Whether Parranda may activate it stays a separate question
owned by terms, robots, geometry and qualification. Unknown terms still require
review, and eligibility never shortens the qualification path.

Every feed-shaped link keeps its verdict per inspected page, so all three
populations stay measurable: `rss_transport_link_count`,
`rss_event_interface_count`, `rss_exploratory_interface_count` and
`rss_rejected_interface_count` on the scout result, with per-link reasons in
`rss_interface_decisions`. Retained uncertainty is a feature to measure, not a
precision number to maximize — a high rejection rate with a suspiciously clean
candidate list would hide false negatives.

## Source Family Priority

1. `official_municipal_calendar`
   - Highest priority for civic and local programming.
   - Often exposes structured APIs, iCal, RSS, or CMS event plugins.
   - Needs salience filtering because it may include council meetings or
     administrative notices that are not travel-relevant.
2. `official_tourism_calendar`
   - High editorial relevance for visitors.
   - Often terms-restricted. Treat as permission-required unless a public API or
     clear reuse terms exist.
3. `cultural_institution_calendar`
   - Major venues, museums, festivals, and cultural institutions.
   - Useful for evening/culture anchors, but terms and page structure vary.
4. `venue_owned_calendar`
   - Venue, farm shop, gallery, club, museum, or local organizer calendar.
   - Strong for small local happenings when the venue is authoritative.
5. `market_listing`
   - Markets, flea markets, seasonal producers, popups, and local fairs.
   - Important in regions where the best day is not a permanent POI.
6. `trusted_local_media`
   - Local magazines, editorial calendars, newsletters, and town guides.
   - Valuable for discovery and coverage, but runtime use depends on terms and
     stable extraction.
7. `community_social_listing`
   - Public community/social listings.
   - Discovery/corroboration source, not a strong standalone runtime source.
8. `schema_org_event`
   - Generic, low-friction adapter when valid JSON-LD exists.
   - Page ownership/terms still matter.
9. `open_data_event_api`
   - Strong when official and openly licensed.
   - Needs mapper and freshness handling.
10. `compatible_ticket_api`
   - Only when API terms allow usage and attribution. Ticket platforms are not
     assumed usable; classify them by terms and extraction tier.
11. `existing_provider_family`
   - Use repo providers such as schema.org/Event and Linked Events when the
     source shape already matches.
12. `unknown_source_family`
   - Low-priority bucket for sources that do not match a known family yet.
   - Unknown sources must not be upgraded into official/tourism families by
     default; they stay probe-only until classified.

## Local Live Source Graph

The source graph answers a different question than a provider adapter.

A provider asks:

```text
Can this one source produce normalized time_sensitive_events?
```

The source graph asks:

```text
For this place and time window, do we have enough independent source families
to believe we are seeing the local live picture?
```

The graph is intentionally conservative:

- official/tourism/cultural/venue/market sources can cover runtime families;
- social/community sources are captured so Parranda does not ignore them, but
  they remain `needs_corroboration` unless stronger source families support the
  same local event layer;
- missing families become acquisition-plan steps rather than silent absence;
- local-language terms and source language are preserved so discovery is not
  English-only; place resolvers and source probes inject local discovery terms
  rather than the graph guessing one region's vocabulary for every place;
- source health and runtime policy are real gates, not display-only metadata;
- coverage strength counts independent publisher identities, so one site cannot
  appear as several independent source families;
- source coverage means Parranda can collect/evaluate candidates. It never by
  itself claims an event is happening now or is suitable for a route;
- community/social source context is not event corroboration. Corroboration is
  deferred until normalized event atoms can be matched across sources;
- the graph does not fetch, scrape, promote Pulse cards, or create route stops.

For regions like Österlen or southern Skåne, the graph should reveal whether
Parranda has municipal/tourism coverage, venue calendars, market/loppis
coverage, trusted local media, and community/social hints. A route can then be
honest about whether it is based on broad live coverage or only on a narrow
slice of sources.

## Extraction Tiers

Scraping is not categorically forbidden. It is a valid source family when
official APIs or feeds are unavailable, but it must be constrained and scored
honestly. Parranda should extract factual event atoms, not republish editorial
content.

1. `official_api_open_data`
   - Official API or open-data feed.
   - Preferred runtime source when terms and source health are acceptable.
2. `ics_rss_feed`
   - ICS, RSS, calendar feed, or similar structured feed.
   - ICS may own explicit calendar timing. Generic RSS/Atom is discovery-only
     until a reviewed detail page provides structured event timing; publication
     timestamps are never promoted into event start/end facts.
3. `schema_org_json_ld`
   - `schema.org/Event` / JSON-LD structured data on listing or detail pages.
   - Uses existing provider family when the page exposes real Event objects.
4. `stable_html_calendar`
   - Stable HTML calendar/listing/detail scraping.
   - Runtime-eligible only when robots/terms/structure/source health are
     acceptable and extraction is limited to factual atoms.
5. `js_rendered_browser`
   - JS-rendered/browser extraction.
   - Last resort. Probe-only until reviewed because it is heavier, more brittle,
     and easier to abuse operationally.
6. `weak_social_manual`
   - Weak social/manual listings.
   - Discovery-only or needs-review. Useful as pointers, not authoritative
     runtime providers.

Allowed factual atoms:

- title;
- start/end;
- venue/address/geo;
- source URL;
- status;
- category;
- organizer.

Do not copy full editorial descriptions or images into Parranda content. Always
preserve `source_url` and attribution.

## Trust Scoring

Source trust is evaluated before Pulse salience:

- `official`: municipal, tourism board, open-data portal, public institution.
- `civic`: public/civic organization that is authoritative for the event.
- `institution`: venue, museum, festival, university, or major cultural body.
- `commercial`: ticketing or commercial event listing.
- `community`: community calendar with weaker provenance.
- `unknown`: provenance unclear.

Terms status is separate from trust:

- `open_license`: compatible license or open-data terms.
- `api_terms_compatible`: API/feed appears intended for programmatic access.
- `permission_required`: useful but not runtime-safe until permission is clear.
- `unknown`: needs review.
- `restricted`: reject for runtime provider use.

Trust does not override legality or source clarity. An official source with
restricted terms is still not runtime-ready.

Robots, terms, structure, and source health affect trust/runtime eligibility.
They should not make scraping disappear from the architecture. If a source is
legally or structurally unclear, classify it as `needs_adapter_or_permission` /
probe-only rather than pretending no source exists.

## Freshness And Timing

Every provider must preserve enough timing to let
`normalizeTimeSensitiveSourceEvent()` decide:

- `now`: currently active.
- `today`: relevant later or earlier today.
- `tonight`: same-day evening relevance.
- `future`: not for current Pulse promotion.
- `stale`: expired or stale, even if raw data claims `now`.
- `unknown`: not enough time information.

Provider output should include `last_checked` and source freshness where
available. Expiry facts win over source-provided `timing_relevance`.

Timezone handling belongs in the provider adapter or trusted context layer. A
reviewed source manifest may carry a validated IANA timezone for a known local
calendar. Explicit UTC/offset timestamps remain source facts; floating local
date-times are normalized only when that reviewed timezone is present. Missing,
invalid, or nonexistent daylight-saving times stay unknown instead of being
silently interpreted as server-local or UTC time.

Local calendar dates are not UTC instants. Date-only/all-day sources preserve
`starts_on` / `ends_on`, while actual instants use `starts_at` / `ends_at`.
Ambiguous daylight-saving folds also stay unresolved unless the source supplies
an explicit offset. A multi-day listing with daily opening hours uses an
explicit `time_window.kind: "daily"` with local start/end clocks; it must not be
flattened into one continuous interval across nights. Truly continuous
multi-day events may still use one bounded instant interval. Date-only rows are
valid inspectable and fusable source facts, but remain ineligible for
current-time route promotion because they do not establish a daypart.

## Local-Language And Translation

Local-language sources are first-class candidates. Parranda should not reject a
good source because it is Greek, Catalan, Italian, Swedish, or any other local
language.

Discovery should:

- use local-language discovery terms alongside English terms;
- detect and preserve `source_language` and `event_language`;
- preserve original titles and source-owned truth;
- translate only short factual atoms when needed for display, search, or
  salience;
- record `translation_status` and `translation_confidence` when translation
  happens;
- keep translated atoms separate from raw source facts.

Examples of factual atoms that may be translated:

- category;
- short venue type;
- status;
- simple event kind;
- route/salience hint labels.

Do not translate or rewrite full editorial descriptions as Parranda-owned
content. If translation is missing, the event can still be source-backed; Pulse
should wrap it in localized Parranda chrome while keeping the raw event title in
its source language.

## Geocoding And Venue Handling

For Pulse display, a source-backed city-level event can be useful. For nearby
or route influence, a stronger place target is required:

- Provider coordinates are best.
- Known place IDs or stable venue identifiers are acceptable.
- Venue name plus address can become a geocoding candidate if confidence is
  high enough.
- A source URL alone must not create a place card, nearby claim, or route stop.

Venue geocoding should be cached and attributable. If geocoding is ambiguous,
the event can remain city-level Pulse context but should not become a route
candidate.

## Dedupe And Fusion

Discovery may find the same event through several families. Fusion should be
conservative:

- Same official event ID from same source is a duplicate.
- Canonical source URL match is a strong duplicate.
- Title + venue + start date can be a probable duplicate when normalized
  strings and timing align.
- Coordinates may support a duplicate decision but must not be the only match.
- Distinct performances in a recurring series should not collapse into one
  event unless the source explicitly models them that way.

The provider registry now runs conservative event-evidence fusion after
normalization. Cross-publisher rows merge only when title, start time, and
venue or nearby coordinates agree. The canonical event keeps compact
`sources[]`, field-level provenance, publisher-independent source count, and
conflict reasons while preferring the strongest source for missing fields.

Two adapters from one publisher are not independent corroboration. Weak
social/community evidence stays low-confidence on its own, while independent
trusted evidence may lift the fused event to medium confidence. Title-only,
untimed, geographically incompatible, stale, or conflicting rows are never
silently promoted.

## Runtime Strategy

The runtime path is a-la-minute but bounded:

1. Resolve place/bounds.
2. Load cached source-discovery profile for that place or nearby region.
3. If a resolver-attested bounded place has no approved local source, record one
   deduplicated geographic demand row. The public request never waits for or
   performs discovery.
4. A bounded background worker claims demand with a lease, runs the existing
   low-volume scout, probes at most two exact manifest candidates through the
   real acquisition gates, and writes findings plus compact qualification
   evidence as `review_needed`. Failures back off; stale completed targets
   become eligible for a later refresh.
5. Run only approved provider adapters. Do not fetch arbitrary user URLs.
6. Normalize into `time_sensitive_events`.
7. Feed normalized events into Pulse salience and, later, dayflow/route gates.

The worker does not auto-approve discoveries. `qualified_for_review` proves
repeated bounded parser yield, not ownership, terms approval, or production
readiness. This preserves source trust while removing city-specific scouting
and request-path crawling. Any later automated promotion needs a separate,
explicit policy for ownership, terms, freshness, and trust.
8. Fail soft with source status instead of blocking Planner/Pulse.

Runtime discovery should be opt-in/gated until source families are proven. City
packs may add curated source descriptors, but they should accelerate discovery,
not become required for Pulse/live to work.

## Caching And Rate Limits

- Source discovery profiles: cache per place/bounds/source family for days to
  weeks.
- Provider results: cache according to source cadence, usually 15 minutes to
  24 hours.
- Venue geocoding: cache stable venue/address resolutions longer.
- Respect robots, API terms, source health, user-agent requirements, and rate
  limits.
- Prefer fresh cache plus bounded refresh. Do not perform unbounded live
  scraping per user request.
- Provider failures return a bounded empty collection plus explicit failed or
  unavailable `source_status`; they do not crash Pulse and are never classified
  as a healthy empty.

## Fail-Soft Behavior

Each failure should be explicit:

- `no_source_family_found`
- `terms_restricted`
- `permission_required`
- `missing_start_time`
- `missing_source_url`
- `venue_not_geocodable`
- `provider_failed`
- `stale_events_only`

Pulse should prefer an honest soft-empty state over promoting weak or stale
signals. Planner/dayflow should not treat missing live events as evidence that
nothing is happening.

## Feeding `time_sensitive_events`

Approved providers should return raw `time_sensitive_events`. The registry
normalizes them through `normalizeTimeSensitiveSourceEvent()` and exposes them
to inspect mode. Pulse consumes only events that are:

- timing-relevant (`now`, `today`, `tonight`);
- confidence `strong` or `medium`;
- source-backed;
- meaningful enough to render without raw provider payloads.

The normalized event shape should include:

```json
{
  "id": "source-specific-id",
  "title": "Event title",
  "source_url": "https://source.example/event",
  "source_label": "Official source",
  "source_type": "official_open_data",
  "source_tier": "official",
  "city": "place-key",
  "lat": 37.9708,
  "lng": 23.7246,
  "area": "Venue or district",
  "starts_at": "2026-06-18T21:00:00+03:00",
  "ends_at": "2026-06-18T23:00:00+03:00",
  "freshness": "fresh",
  "last_checked": "2026-06-18T08:00:00Z",
  "confidence": "medium",
  "source_language": "el",
  "event_language": "el",
  "translation_status": "provided",
  "translation_confidence": "medium",
  "translated_atoms": ["category"],
  "provenance": {
    "source_label": "Official source",
    "source_url": "https://source.example/event"
  },
  "candidate_kind": "source_event",
  "tags": ["culture", "evening"],
  "intents": ["culture", "nightlife"],
  "route_role_hint": "culture_stop",
  "timing_relevance": "tonight"
}
```

## Pulse Salience

Pulse salience should consume normalized events, not raw feeds:

- `now` beats `tonight`, which beats `today`.
- Strong/official/source-backed events rank higher.
- Coordinates or stable venue context improve salience.
- Route role hints such as `market_stop`, `culture_stop`, or `evening_anchor`
  can help explain why the event matters.
- A stale event, unsupported source, or source-url-only event should not be
  promoted.

This is the bridge from “a source has an event” to “Parranda knows something
timely is happening here.”

## What Citypacks May Add

Citypacks may optionally add:

- approved source descriptors;
- known source labels and attribution;
- venue aliases and stable IDs;
- local timezone/language hints;
- source cadence and parsing risk notes.

Citypacks must not be required for the generic engine. They speed up discovery
and improve trust, but the source-discovery method remains place-agnostic.

## Athens Worked Example

Athens is the first worked example because it is a near-term field-test place.
These are source-family evaluations, not Athens-specific runtime branches.

| Source family | Source / discovery method | Extractability | Geo / venue | Terms / license read | Adapter path | Assessment |
| --- | --- | --- | --- | --- | --- | --- |
| Official municipal calendar | [City of Athens calendar](https://www.cityofathens.gr/en/calendar-events/) exposes The Events Calendar REST endpoint at `https://www.cityofathens.gr/wp-json/tribe/events/v1/` plus iCal/RSS feeds. | REST/ICS can expose title, start/end, source URL, categories, and sometimes venue. | Venue may be absent or city-level for civic meetings; venue/address fields need probing and geocoding. | Official source. No clear open reuse license found in the quick pass, but REST/ICS feeds are public and structured. Treat as viable provider probe with legal/attribution review. | Needs generic `the_events_calendar` or `ical` adapter. | Viable first provider probe, but salience must filter administrative/civic meetings. |
| Official destination calendar | [This is Athens events](https://www.thisisathens.org/events), the official Athens guide, lists visitor-relevant events and detail pages. | Listing/detail pages expose titles, dates, venues, and source URLs. Quick pass did not find reliable `schema.org/Event` JSON-LD. | Venues are usually named and likely geocodable. | [Terms](https://www.thisisathens.org/tia-terms-of-use) are restrictive enough that runtime scraping should be permission-required. | Needs permissioned API or HTML adapter after approval; not current schema.org/Linked Events. | High-value discovery source, but not runtime-ready without permission/API clarity. |
| Cultural institution / major venue | [Megaron events calendar](https://www.megaron.gr/events/events-calendar/) and Athens Epidaurus Festival detail pages such as [Einstürzende Neubauten](https://aefestival.gr/festival_events/einsturzende-neubauten/?lang=en). | Event pages expose titles, dates, venue names, source URLs, and ticket/detail links. Some pages expose map links that can reveal venue coordinates. | Strong venue anchors such as Odeon of Herodes Atticus or Megaron. Coordinates may come from venue pages or map links. | Terms vary/unclear in quick pass; treat as needs review per provider. | Needs `venue_calendar` / `html_event_listing` adapter unless schema.org/Event exists on a specific source. | Good second source family for field-test coverage once terms and parsing risk are reviewed. |
| schema.org/Event JSON-LD | Probe official/event detail pages for `application/ld+json` with `@type: Event`. | Generic extraction works when valid Event JSON-LD is present. | Depends on JSON-LD `location` and venue address/geo. | Terms still source-specific. | Existing `schema_org_event` provider. | Useful generic fallback, but sampled Athens pages mostly exposed WebPage/CollectionPage JSON-LD rather than Event. |
| Linked Events / open-data API | Search local/civic open-data portals for Linked Events compatible APIs. | Existing provider can map title, date, venue, source URL, and geo when the API matches. | Strong when `location` or geo fields exist. | Depends on portal license. | Existing `linked_events` provider. | No Athens Linked Events endpoint confirmed in this pass; keep as source-family probe. |

### Athens Actionable Path

The immediate generic path is:

1. Build a `the_events_calendar` / iCal provider probe using City of Athens as
   fixture source.
2. Keep output as `time_sensitive_events`, not route stops.
3. Add salience filters so civic/admin events do not dominate visitor Pulse.
4. Separately pursue permission/API clarity for This is Athens and venue/festival
   calendars.
5. Reuse schema.org/Event provider wherever Event JSON-LD is actually present.

This gives more than one independent source family:

- municipal official structured calendar;
- official destination calendar, permission-required;
- cultural institution / venue calendars;
- generic schema.org/Event probing;
- open-data/Linked Events probing where available.

If only the municipal provider is runtime-approved at first, the fallback is not
to hardcode Athens. The generic fallback is:

- discover venue/institution calendars in bounds;
- evaluate terms and extractability through the same harness;
- approve adapters source by source;
- feed successful outputs into `time_sensitive_events`.

### Sample Normalized Event

Example based on a City of Athens structured calendar item. Exact timezone and
venue handling would be owned by the provider adapter.

```json
{
  "id": "cityofathens-226719",
  "title": "9η Συνεδρίαση 1ης ΔΚ",
  "source_url": "https://www.cityofathens.gr/data/9i-synedriasi-1is-dk-9/",
  "source_label": "Municipality of Athens",
  "source_type": "official_open_data",
  "source_tier": "official",
  "city": "athens",
  "place_context": "Municipality of Athens",
  "starts_at": "2026-06-18T18:00:00+03:00",
  "ends_at": "2026-06-18T21:00:00+03:00",
  "freshness": "fresh",
  "last_checked": "2026-06-18T08:00:00Z",
  "confidence": "medium",
  "source_language": "el",
  "event_language": "el",
  "translation_status": "needed",
  "translation_confidence": "none",
  "provenance": {
    "source_label": "Municipality of Athens",
    "source_url": "https://www.cityofathens.gr/data/9i-synedriasi-1is-dk-9/"
  },
  "candidate_kind": "source_event",
  "tags": ["civic", "administrative"],
  "intents": [],
  "timing_relevance": "today",
  "visitor_relevance": "low",
  "salience": "low"
}
```

This event would be source-backed and time-sensitive, but its salience may be
low for a visitor route because it is civic/admin rather than cultural or
experiential. It should remain inspectable and maybe city-contextual, but it
should not masquerade as a culture stop or visitor route anchor. That is the
point of separating source discovery from Pulse salience.

## Trusted Event Geometry

Event acquisition uses the resolved place scope rather than assuming every
request is a city-centre circle:

- local settlements and coordinate anchors keep the bounded anchor radius;
- only resolver-attested, bounded `municipality` or `region` scopes may accept
  event or resolved-venue geometry elsewhere inside their exact bounds;
- the request anchor must itself be inside those bounds, and broad/detached
  scopes cannot widen the gate;
- venue resolution still requires exactly one medium-or-better trusted match;
- the geometry scope participates in cache identity so local and regional
  evidence cannot be confused.

This allows a regional request to surface a worthwhile event outside the town
centre without fabricating proximity. The real anchor distance remains
visible, and route eligibility is unchanged: a far regional event still needs
the existing walking validation and final-leg distance gate before it can
become a route stop.

## Reviewed Sitevision Calendar Adapter

Parranda now recognizes the stable Sitevision event-calendar family as a
bounded adapter target. This is a CMS/interface capability, not a claim that
every Sitevision website is trusted or safe to collect.

- source discovery may propose a `sitevision_calendar` manifest, but the
  proposal remains `review-needed` and never activates itself;
- reviewed manifest data owns source trust, terms, language, IANA timezone,
  geographic bounds, and activation;
- collection caps listing rows, detail-page requests, response size,
  concurrency, and request time;
- the adapter extracts factual atoms only: title, source URL, local date/time,
  venue/address, coordinates when published, and recurrence text;
- local clock times require a reviewed IANA timezone and otherwise remain
  timing-unknown rather than being treated as UTC;
- one failed detail page does not erase usable listing evidence, while listing
  failure remains an explicit fail-soft provider outcome.

This makes reviewed municipal and regional Sitevision calendars consumable
through the same provider registry and `time_sensitive_events` path. It does
not activate a municipality, promote an event into Pulse, or turn an event into
a route stop by itself.

## Reviewed Wix Event Sitemap Adapter

Wix event sites can expose a public sitemap index, event-only dynamic sitemaps,
and server-rendered event detail pages even when no public CMS API or Event
JSON-LD is available. Parranda treats that declared public surface as a bounded
stable-HTML source family, not as permission to call Wix's private CMS APIs.

- discovery requires a strong Wix signature plus an event/calendar page signal
  and proposes a `wix_event_sitemap` manifest as `review-needed` only;
- collection manually follows only same-origin redirect chains and verifies the
  final response origin, with explicit caps on sitemap files, accepted events,
  total detail requests, bytes, concurrency, redirects, and the complete
  fetch/body timeout lifecycle;
- a reviewed manifest owns terms, geographic bounds, source trust, activation,
  an explicit event-path prefix, a valid IANA timezone, and an explicit `sv` or
  `en` source language. Missing prerequisites fail before any network request;
- only factual atoms are retained: title, source URL, date/time, venue/address,
  and language/translation state. Page-global map coordinates are deliberately
  ignored until reviewed geocoding or source fusion ties geometry to the venue.
  Editorial descriptions and images are not copied;
- date ranges preserve both their first and final day; an unresolved range
  remains timing-unknown rather than silently collapsing to day one;
- stale and unparseable detail rows do not consume the accepted-event limit,
  but collection always stops at the reviewed total detail budget. Parser
  failure is reported separately from a legitimate empty/current-free source;
- an explicit passed-event marker or past final date remains stale;
- events with address but no coordinates may inform Pulse after normal gates,
  but cannot silently become bounded route evidence. Later reviewed geocoding
  or place fusion must establish that geometry.

This adapter makes destination and regional Wix calendars provider-consumable
without introducing a destination branch. It is not active by default and does
not claim complete source coverage: the bounded detail sample and source-health
output must be evaluated before an operator promotes a reviewed manifest.

Worked example, not runtime configuration: the public
[Visit Ystad Österlen sitemap](https://www.visitystadosterlen.se/sitemap.xml)
exposes Wix-generated event sitemaps whose public SSR detail pages contain short
factual atoms such as title, date/time, venue/address, and canonical source URL.
A bounded live probe normalized current rows through this adapter. The source
still requires explicit terms, scope, timezone, yield, and source-health review
before a deployment manifest may activate it.

## Reviewed Official Programme Article Adapter

Important local happenings are often published as an official news or festival
programme rather than a calendar feed. The generic
`official_program_article` adapter recognizes a document grammar, never a
publisher or place:

- a subordinate heading or emphasized row explicitly labels a programme;
- at least two rows carry explicit local dates and times;
- a shared venue is stated by the programme section or a dated venue heading;
- article introductions, ticket/practical sections, descriptions, images, and
  unrelated clock mentions are excluded;
- date-only rows remain honest all-day evidence and use a separate cap, while
  multi-day daily windows remain daily rather than becoming continuous nights;
- floating local times require a trusted IANA timezone, ambiguous DST folds fail
  closed, and no geometry is inferred from the page;
- fetches retain one timeout through body parsing, enforce byte and redirect
  caps, and never follow a redirect off the reviewed origin.

Discovery proposes this adapter as `review-needed`. An actual `robots: allowed`
verdict permits bounded qualification through the real normalization, venue,
time, geometry, and source-health gates, but unknown ownership or terms still
blocks runtime. After explicit review, the adapter enters the existing
`time_sensitive_events` pipeline; it creates neither a city branch nor a second
Pulse engine.

The implementation is intentionally split by reusable responsibility:
bounded HTTP collection, document/block extraction, programme-row grouping,
locale/time parsing, and event normalization. It must not grow publisher-name
branches. Historical recaps, incidental-date municipal news, ticket/practical
sections, yearly history, ordinary opening-hours pages, and mixed-year prose
are retained as negative corpus tests because false events are more damaging
than declining a weak page.

When a reviewed source is geographically scoped to the resolved place but an
event venue cannot be resolved uniquely, its factual event atoms may remain a
source-scoped Pulse-only signal. Such evidence keeps no coordinates and is
always `route_eligible: false`. Unique trusted in-scope venue resolution may add
geometry; ambiguous, weak, or out-of-scope results never do, and the place
anchor is never substituted as event geometry.
