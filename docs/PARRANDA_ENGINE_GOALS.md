# Parranda Engine Goals and Roadmap

**Status:** Living product/engine alignment note  
**Updated after:** #243 Experience Lens-scoring v1  
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

The recent candidate-intelligence line has built the candidate spine from inspect-only foundations into a real decision substrate:

- #231 made Your Day source-aware at the dayflow explanation layer.
- #232 introduced Candidate Intelligence Spine primitives.
- #233 added the experimental candidate-based Blitz next move.
- #234 added external/open evidence provider v1.
- #235 added source calibration v1 and agnostic confidence.
- #236 exposed coordinate intake for Agnostic Blitz through `/api/blitz`.
- #237 added the trusted OSM/Wikidata open-data loader seam.
- #238 added entity safety / dedupe so curated and external duplicates become one canonical candidate.
- #239 added coordinate/field reconciliation from merged external twins.
- #240 added deterministic Athens / Malmö / Simrishamn Agnostic Blitz scenario evaluation.
- #241 allowed thin recognized cities to receive open-data augmentation through `/api/blitz`.
- #242 expanded generic intent vocabulary and OSM tag mapping.
- #243 made experience lens affect candidate fit ranking, not just source calibration.

The result is a much stronger Blitz candidate path: curated + external, gated, calibrated, deduped, reconciled, intent-mapped, lens-aware, and honest about confidence.

The major remaining gap is that Planner / Your Day / route composition does not yet fully consume the same gated/calibrated/deduped/lens-aware candidate spine. The next strategic work should move candidate intelligence from single Blitz moves into composed dayflows.

## Product goals

### 1. Candidate spine becomes the shared substrate

Blitz, Planner, Pulse/live, and future Almanac objects should speak through common candidate/evidence/provenance/confidence concepts.

Current status:

- Blitz: strong.
- Planner / Your Day: partial; rich citypacks still use legacy catalog/template
  composition, but thin PREVIEW cities now let the reservoir's fit verdict drive
  stop SELECTION for requested preferences (different preferences → different
  `primary_route.main_stops`; a preference nothing satisfies is reported missing
  instead of silently filled by an off-intent source pack). Rich-citypack
  composition is deliberately untouched.
- Pulse/live: source-provider foundations exist, but event/local-live candidates are not yet first-class in the candidate spine.

Next step: extend reservoir-driven composition from preview-thin cities to the
general Planner path (rich citypacks + agnostic), and make missing/partial
preference coverage first-class in the route output contract.

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

Future candidate objects should include not only stable places but also:

- temporary events
- recurring local patterns
- official calendars
- trusted local media
- venue-owned signals
- community signals where source policy allows
- seasonal cafés / markets / farm shops
- local closure/custom rhythm signals
- weather-sensitive options

Do not jump straight into broad scraping. The correct sequence is still:

```txt
Candidate Spine
-> opt-in Blitz candidate path
-> external/open evidence
-> Candidate Reservoir -> Planner bridge
-> local live/event candidates
-> this-week mode
-> saved Almanac integration
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

## Immediate roadmap

### #244 Candidate Reservoir role selector v0

Build a small helper layer that lets planner/dayflow logic request role-based candidates from the existing candidate spine.

Scope:

- helper/unit level first unless a tiny integration seam is obvious
- deterministic tests only
- no full planner rewrite
- no live network
- no persistent merge memory
- no operator/admin surface

Expected output shape:

```txt
role
status: filled | partial | missing | fallback
candidate
origin: curated_catalog | external_open
confidence
provenance
covered_preferences
partial_preferences
missing_preferences
fit/lens reasons
```

### #245 Planner bridge integration behind flag

Let a narrow planner/Your Day path consume role selector output. Keep legacy fallback. Add inspect output for filled/missing role slots.

### #246 Dayflow honesty and route quality inspect

Expose why a day is full, partial, sparse, or fallback-heavy. Track walking budget, area clustering, time-of-day fit, weather fit, energy/dagsform fit, and role coverage.

### #247 Local live/event candidates v0

Add first-class event candidates with time windows, freshness/expiry, source-family provenance, and preference coverage. Start with official/venue/trusted local sources, not broad scraping.

### #248 Persistent merge/reconciliation memory v0

Persist known curated/external merge decisions and recurring reconciliation outcomes once external volume justifies it.

### #249 Operator conflict surface v0

Expose coordinate conflicts, suspicious merges, and review queues through inspect/export/CLI before building any admin UI.

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
