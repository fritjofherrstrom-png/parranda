# Athens Content And Source Strategy

This is an issue-level brief for the next Athens city-pack work. It does not promote places, events, sources, route templates, or editorial content into runtime.

Athens is currently a registered preview skeleton:

- `visibility: "preview"`
- `0` catalog items
- `0` route templates
- city page baseline: yes
- Pulse baseline: yes
- Blitz baseline: no
- Planner baseline: no
- `inspect-city-pack athens`: `preview_ready`

The next goal is to define a source-backed path from empty skeleton to first pilot catalog without turning Athens into a fake launched city.

## Product Goal

Athens should become a real Parranda city pack through the same shared engine path as Rome and Barcelona:

```txt
registered preview skeleton
-> source strategy
-> candidate intake
-> verified pilot catalog
-> route templates
-> source descriptors/live adapters
-> readiness checks
-> beta review
```

The first Athens content pass should prove that the city-pack workflow can create useful local density from reviewable sources, not from memory or generic travel lists.

## First Research Questions

Before adding runtime entries, answer:

- Which areas should form the first Athens neighborhood model?
- Which official and structured sources can verify existence, coordinates, programming, or event timing?
- Which local sources help identify route-useful places without becoming unquestioned truth?
- Which place categories matter most for a first beta route experience?
- Which source types are strong enough for runtime and which should remain candidate-only?

## Area Model Draft

Use this as a research starting point, not as runtime truth:

- `monastiraki-psyrri`: old-center food, markets, bars, second hand, evening movement.
- `syntagma-plaka`: central civic/classic connector area, use selectively to avoid tourist-only routes.
- `exarchia`: bookshops, bars, culture, local evening texture, higher human-review sensitivity.
- `kolonaki-lycabettus`: galleries, cafes, views, uphill pacing.
- `kypseli`: municipal market, neighborhood culture, food, local rhythm.
- `koukaki-makrygianni`: museums, food, walking connectors, south-of-center routes.
- `petralona-thisseio`: low-key food, bars, walking arcs, less postcard-heavy center.
- `gazi-kerameikos`: nightlife, live music, industrial/cultural anchors.
- `pangrati-mets`: cafes, bars, galleries, residential-local flow.
- `piraeus-coast`: optional later macro if Athens expands toward port/coast routes.

The first catalog does not need every area. It should have enough density in `4-6` areas to make real routes possible.

## Source Candidates To Verify

These are candidate source families. They must be checked before runtime use.

| Source family | Likely use | Why it matters | Runtime caution |
| --- | --- | --- | --- |
| City of Athens / Athens Culture Net | Pulse/source descriptors, cultural venues, official context | City-owned cultural layer and institutional signal | Verify current URLs, language availability, and whether event data is structured enough |
| This is Athens / official Athens guide | Event discovery, visitor-facing official listings, venue context | Official city guide can bridge local/visitor usefulness | Avoid tourist-only picks; source-owned prose should not become Parranda editorial |
| Athens Epidaurus Festival | Seasonal live/culture source, venue programming | High-value official performing arts programming | Seasonal source, not broad daily rhythm; avoid over-weighting classics |
| Kypseli Municipal Market | Market/culture anchor, possible event source | Strong neighborhood-useful municipal market/culture hub | Verify schedule structure and whether events are source-owned enough for Live |
| Athens Attica official guide | Existence/context signal, regional cultural/event listings | Official destination layer with useful venue/event context | Treat as support source, not sole quality proof |
| Official venue sites | Existence, opening context, programming | Best source for place currentness and venue-owned details | Runtime catalog still needs Parranda-owned route rationale |
| OSM/Wikidata/structured map data | Coordinates and existence verification | Useful for location sanity and candidate normalization | Existence/location only; not full quality proof |
| Reputable local guides/newsletters | Candidate discovery and taste signal | Can reveal useful everyday places and less obvious areas | Must be paired with existence verification |
| Beta/user seeds | Discovery and review prioritization | Helps find real local texture early | Signal only; never automatic promotion |

## First Pilot Catalog Shape

Target the first runtime catalog at roughly `25-35` verified real places.

Prefer density over breadth:

- `6-8` food anchors across central/local areas.
- `5-7` bars/evening anchors.
- `4-6` culture/gallery/bookshop/cinema-style anchors.
- `3-5` markets/second-hand/vintage candidates if sources are solid.
- `3-5` views/parks/walking connectors.
- `2-4` classic/civic anchors only where they improve route flow.

Avoid filling the first pass with famous monuments. Athens needs enough recognizable context, but Parranda routes should not collapse into a generic top-10 itinerary.

## Candidate Intake Rules

Use candidate intake before runtime catalog promotion.

Every candidate should capture:

- proposed id
- candidate kind
- source kind
- source URLs or source notes
- area/macro guess
- why it may help Parranda routes
- route role
- likely tags/intents
- verification priority
- promotion recommendation
- confidence
- risks or reasons to hold back

Hard rules:

- No `needs_review` candidate enters runtime.
- No generated area idea becomes a fake venue.
- No event schedule becomes Live data without source-owned dates and links.
- No invented addresses, coordinates, hours, or claims.
- No OSM/Wikidata-only candidate gets treated as full quality proof.
- No venue receives special weighting because it was mentioned early.

## First Runtime PR Proposal

After source verification, the first runtime implementation PR should be:

`feat(city-pack): add Athens pilot catalog v1`

Scope:

- add `25-35` verified Athens real places
- add provenance metadata for every runtime entry
- keep Athens `visibility: "preview"`
- keep route templates empty unless a broken structural requirement appears
- add catalog/readiness/search tests
- run `node scripts/inspect-city-pack.js athens`

Acceptance:

- Athens remains preview.
- Athens real place count rises from `0` to the reported total.
- Every real place has coordinates, valid area token, search terms, tags, and provenance.
- OSM/Wikidata-only entries remain human-verification gated.
- Blitz/Planner readiness is reported honestly and may remain `no`.

## Route And Source Work After Catalog

Route templates should wait until the pilot catalog has enough real density to avoid misleading route identity.

Likely sequence:

```txt
pilot catalog
-> inspect-city-pack athens
-> place-candidate readiness review
-> 4-6 route templates from existing catalog only
-> route-candidate comparison/readiness
-> source descriptors for official Live/Pulse candidates
-> one official Live source adapter if structured and stable
```

Pulse and Live should remain noop/preview until a source is wired. Do not invent Athens editorial moments.

## Non-Goals

- Do not add real Athens places in the strategy PR.
- Do not add route templates before the catalog exists.
- Do not add live/source adapters before source shape is verified.
- Do not change Planner, Blitz, route engine, Pulse UI, or public API.
- Do not make Athens curated-public.
- Do not use this document as runtime provenance.

## Recommended Next PR

Create an Athens candidate intake pack:

`docs(candidate-packs): add Athens pilot catalog candidate pack`

That PR should be docs-only and should collect verified or review-ready candidates with source notes. Runtime promotion should happen in a later implementation PR after review.
