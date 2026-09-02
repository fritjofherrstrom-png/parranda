# Parranda Engine Goals and Roadmap

**Status:** Current product/engine alignment note

**Updated after:** #492 trusted place-source lifecycle
**Related:** `docs/CANDIDATE_PREFERENCE_COVERAGE.md`, `docs/LOCAL_LIVE_INTELLIGENCE.md`, `docs/CITYPACK_INSTALLATION.md`

## Core thesis

Parranda is not primarily a collection of city packs. City packs are an acceleration and refinement layer. The core product is an experience engine that can understand a place's rhythm and compose better dayflows than a generic top-10 list or map/review app.

Parranda should be able to work across:

- rich curated city packs such as Rome or Barcelona
- thin recognized city packs such as Athens during beta buildout
- urban but not tourist-assumption-heavy contexts such as Malmö
- sparse small-town or regional contexts such as Simrishamn / Österlen
- future agnostic locations where the user only provides coordinates

The engine should source broadly, judge better, stay honest about confidence, and preserve the user's specific intent all the way into final recommendations and dayflows.

## Current state

The candidate spine is now a real shared decision substrate rather than an
inspect-only foundation. Candidate-based Blitz, thin registered-city fill and
any-place Planner composition consume gated source-backed places; the ordinary
route engine composes eligible any-place supply. Broad OSM/Wikidata/Overture
loaders and the revision-bound reviewed local-source reservoir supply it.

Rich citypacks remain curated-first, and Pulse keeps a separate signal/event
path with a bounded route-interrupt boundary. The major remaining gap is supply
breadth and quality across real geographies—not another Planner bridge.

## Product goals

### 1. Candidate spine becomes the shared substrate

Blitz, Planner, Pulse/live, and future Almanac objects should speak through common candidate/evidence/provenance/confidence concepts.

Current status:

- Blitz: strong.
- Planner / Your Day: source-backed any-place and thin-preview composition is
  live behind reviewed boundaries; rich citypacks remain deliberately
  curated/template-first.
- Pulse/live: normalized source events feed gated Pulse surfaces and may affect
  a route only through the explicit geometry/walking-validated interrupt
  contract.

Next step: operate and broaden trustworthy supply, improve preference/ranking
quality and deliberately graduate proven paths without flattening rich
citypacks.

### 2. City packs are accelerators, not dependencies

A city pack should make Parranda sharper, richer, and more local, but the engine must still behave honestly and usefully when curation is thin or absent.

Target behavior:

```txt
rich citypack   -> curated-first, high confidence where appropriate
thin citypack   -> curated + trusted open-data augmentation, medium/honest confidence
absent citypack -> agnostic coordinate context + source-backed candidates, sparse/honest confidence
```

### 3. Experience lens changes actual choices

The same candidate universe should produce different results depending on whether the user is in a `first_time`, `local`, `rediscover`, `surprise`, or `balanced` mode.

The key product distinction:

- `first_time`: legible, iconic, classic, scenic, easy-to-understand anchors.
- `local` / `rediscover`: neighborhood texture, hidden/local-feeling places, less obvious defaults.
- `surprise`: wider but still coherent/provenanced choices.
- `balanced`: stable default behavior.

Lens is a bounded ranking influence. It must not override gates, hard intent coverage, or honest confidence.

### 4. Preference coverage is preserved end-to-end

The engine must not collapse specific user intent into broad categories.

Failure examples:

- User asks for second hand, scanner returns only generic shopping.
- User asks for views, scanner returns only famous landmarks.
- User asks for local-feeling evening, route returns only top-rated restaurants.

Every candidate-intelligence PR should answer:

```txt
Does this preserve specific user preferences rather than collapsing them into generic buckets?
```

Final recommendations and dayflows should track:

```txt
covered_preferences
partial_preferences
missing_preferences
match_tier: primary | supporting | fallback
```

### 5. Routes become composed experiences, not just templates

Parranda's product is better dayflows/routes, not just a better next move.

The planner should be able to request role-based candidates from the same spine:

- scenic anchor
- food anchor
- coffee/fika stop
- evening/bar option
- swimming/coast option where relevant
- vintage/second-hand option where relevant
- fallback or low-confidence alternative

The planner should preserve each role's provenance, confidence, covered preferences, missing preferences, and lens/fit reasons.

### 6. Local rhythm becomes first-class

Parranda should understand local rhythm, not only local inventory.

The broader intelligence substrate includes stable places and can also include:

- temporary events
- recurring local patterns
- official calendars
- trusted local media
- venue-owned signals
- community signals where source policy allows
- seasonal cafés / markets / farm shops
- local closure/custom rhythm signals
- weather-sensitive options

Do not jump into unbounded request-time scraping. The shipped sequence is:

```txt
trusted acquisition / reviewed discovery
-> Candidate Spine and time-sensitive event contracts
-> gated Blitz / Planner / Pulse consumers
-> bounded route-event weave where eligible
-> future saved Almanac integration
```

### 7. Trust remains visible

Every result should know why it was shown and how trusted it is.

Required surfaces:

- source family / tier / policy
- provenance and attribution
- human-verified vs source-backed
- catalog density: rich / thin / absent
- entity-resolution merges
- reconciliation/conflict notes
- fit/lens reasons
- missing roles/preferences

## Trusted source-supply checkpoint — 2026-08

The any-place path now has two complementary broad place suppliers rather than
one public Overpass dependency:

- OSM/Overpass remains the `map` family and can corroborate with Wikidata.
- Overture Places supplies a bounded five-kilometre global `open_directory`
  family through cached GeoParquet reads. It is filtered at confidence 0.95,
  never contributes ratings or generic prose, and is counted as one family.
- Compact exact settlements such as Kivik resolve from structural provider
  identity rather than popularity. This is a generic small-place rule.
- A resolver-attested small settlement searches approved Live sources locally
  first and only then exposes source-backed happenings up to 25 km away with an
  explicit distance. Client geometry cannot activate that fallback.

This removes the “Overpass or nothing” blocker. It does not declare the source
supply finished: directory-only candidates remain provisional, discovered
event sources remain review/probation gated, and the next source work should
improve independent local/editorial/official corroboration and entity resolution
instead of adding more synthesis diagnostics.

The reviewed-place bridge now lets a fresh, geo-bounded Source Catalog profile
feed an approved official/editorial place list into that same reservoir. It
supports schema.org JSON-LD plus a closed map-linked-card adapter that requires
same-card name, category, same-origin detail identity and high-precision
coordinates from a recognized map URL. It accepts only a closed type vocabulary
plus exact source-owned coordinates and stable identities; prose, ratings,
images, generic businesses, unknown facts/adapters and off-origin redirects
never enter. Official reviewed-source rows can route without pretending the
individual place was human-verified; editorial-only rows remain
display/corroboration evidence. This is generic for any approved geography.

The generic worker now proactively searches for local-language and English
place-guide interfaces, follows bounded same-origin guide links, and recognizes
only multi-item schema.org lists or map-linked cards with stable identities plus
exact in-scope coordinates. Exact endpoint/adapter/publisher/bounds candidates
are re-probed on separate days and promoted only to `qualified_for_review`; no
place source auto-activates or enters probation. This closes one additional
common list format, not coverage itself. The next source slices are bounded
detail-page fan-out for list/detail guides, source operation across real
geographies, Wix/entity-data extraction where exact coordinates exist, and
conservative cross-provider aliases—not more route synthesis.

The remaining reviewed-place lifecycle gap is now closed. Source Catalog
approval binds an operator decision to the exact server-derived discovery
revision, persists an immutable audit row and worker target atomically, and is
idempotent. The worker—not the Planner request—refreshes the approved endpoint
into a persistent, freshness-bounded place reservoir. The composer consumes
only records whose approval key and profile revision still match; expiry,
unknown state and material rediscovery fail closed. This makes a newly approved
generic local source capable of contributing a source-backed Planner stop after
the worker lifecycle, while preserving the next supply priorities: operating
more real sources, bounded list/detail fan-out, and conservative entity
resolution.

## Current roadmap after #492

The candidate reservoir, role selection, Planner bridges, event candidates,
source qualification and operator approval lifecycle have shipped. Do not use
the old #244–#249 migration sequence as current work.

Priorities now are:

1. Harden `map_linked_place_html` so heading, category, identity and coordinates
   must come from one verified DOM card; bump the adapter contract and require
   re-review.
2. Add bounded list→detail ingestion for a concrete official source shape:
   same-origin links, capped fan-out, explicit terms/source policy, a versioned
   adapter contract and worker-owned persistence.
3. Operate reviewed sources across a large unsupported place and a
   smaller/regional place; measure coverage, refresh health and route quality.
4. Improve conservative entity aliases/reconciliation as independent source
   volume grows, without letting ratings or popularity become ranking power.
5. Define explicit graduation criteria for experimental/legacy Planner paths:
   readiness evidence, dogfood matrix, promotion decision and deletion target.
6. Let time-sensitive events affect dayflow only through the existing bounded
   eligibility, geometry and walking-validation boundary.

## Review rules

1. Prefer implementation over strategy docs when the next step is already known.
2. Keep PRs small enough to review.
3. Use deterministic tests; no live network in test suites.
4. Do not hardcode Athens, Malmö, Simrishamn, Rome, or Barcelona behavior unless the PR is explicitly citypack content. Use those cities as fixtures for generic engine behavior.
5. Preserve curated-first when fit is comparable, but allow external candidates to fill genuine gaps.
6. Never let popularity/review volume become ranking power.
7. Do not let broad categories replace specific user intent.
8. Inspect output should explain why something won and what was missing.
9. City packs should improve the experience, not become a hard dependency.
10. The product bar is not “a result exists”; it is “the result feels like Parranda rather than a generic map app.”
