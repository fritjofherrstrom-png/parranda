# Second-Hand Source Pack Playbook

Reusable, city-agnostic sourcing rules distilled from the Barcelona second-hand
candidate docs:

- `docs/candidate-packs/barcelona-second-hand-v0.md`
- `docs/candidate-packs/barcelona-second-hand-verification-scout.md`
- `docs/candidate-packs/barcelona-second-hand-expansion-scout.md`
- `docs/candidate-packs/barcelona-second-hand-promotion-plan.md`

This file is not a city pack and does not promote any candidate by itself. It
defines the category scope, source standards, and runtime-install rules that a
city-specific second-hand pack should follow.

## Category Scope

The Parranda `second_hand` intent means:

- clothing resale
- vintage clothing
- fashion resale
- curated resale
- thrift / charity second-hand clothing
- kilo-format vintage clothing
- recurring flea / second-hand markets only when the market context is the
  actual user value and the candidate is modeled honestly

Out of scope as standalone `second_hand` candidates:

- generic shopping
- new-stock retro boutiques with no resale signal
- standalone record shops
- standalone bookshops
- coins, stamps, postcards, or collectibles-only markets
- general antiques
- furniture resale
- ceramics / decor resale
- generic flea-market miscellany

Out-of-scope items may appear only as a secondary feature inside a real
clothing/vintage/resale stop or as part of a clearly relevant market context.

## Source Tiers

Tier A, sufficient on its own for a verified promotion candidate:

- operator / official shop pages
- municipal market or city listings
- official market/operator pages
- reputable city authority or tourism pages for markets

Tier B, sufficient when corroborated by another Tier A/B source:

- reputable local editorial guides
- city-specific magazines with address-bearing venue pages
- strong local culture or commerce guides

Tier C, corroboration only:

- generic business directories
- map listings
- tourist aggregators
- social profiles without stable address/context

Open geodata such as OpenStreetMap can seed a **provisional source candidate**
when it has coordinates and a second-hand/vintage signal. Open geodata alone
must not promote a candidate into the verified catalog.

## Candidate Roles

Use these roles when classifying source candidates:

- `character_anchor`: distinctive independent vintage/resale stop that can
  carry route identity after verification.
- `utility_anchor`: practical reliable second-hand/vintage stop that adds
  density and routeability.
- `market_context_anchor`: flea / second-hand market context where the user
  value is the market drift, not a generic shop claim.
- `cluster_context`: a street or neighborhood reputation. This must remain
  structural unless decomposed into named active `real_place` entries.
- `hold`: surfaced but not currently safe for route use.

## Runtime Install Rules

Verified catalog promotion requires:

- named candidate with current address
- current existence verified against Tier A or corroborated Tier B sources
- category fits the strict `second_hand` scope
- not a duplicate of an existing catalog entry
- provenance source URL or direct observation note
- confidence not `needs_review`

Provisional source-candidate install may use lower trust when:

- the city is explicitly thin/preview or the feature is explicitly source-fill
- the candidate has stable coordinates
- the candidate has a clear resale/vintage signal
- it is marked `city_pack_owned: false`
- it is marked `candidate_kind: "draft_place"`
- trust is capped to `source_tier: "inferred"`,
  `confidence: "needs_review"`, `human_verified: false`
- it does not inflate verified catalog counts or readiness

## Hard Rules

- Do not turn an `area_preset`, cluster, or street reputation into a fake shop.
- Do not promote a recurring market as always-on catalog content when the value
  exists only on specific days.
- Do not add opening hours or closed weekdays from brittle source snippets to a
  provisional candidate.
- Do not let generic `shopping` satisfy `second_hand`.
- Do not use popularity, ratings, or tourist-list presence as existence proof.
- Do not promote source-note-only candidates to high confidence.
- Do not wire Pulse/Live schedules from this playbook alone.

## Search Checklist

For a new city, search in local language plus English:

- second-hand clothing
- thrift shop
- vintage clothing
- vintage kilo
- circular fashion
- charity shop
- flea market + vintage clothing
- neighborhood + vintage / second-hand clothing

Reject false friends where the source shows new-stock retro, generic antiques,
furniture/decor resale, or collectibles without a clothing/resale route value.

## Applying to Athens

The Athens preview second-hand source candidates should use this playbook as
their category scope. The current Athens install is provisional, not verified:
OpenStreetMap can seed route-fill candidates, but every such stop must remain
`needs_review` and visibly provisional until an Athens-specific verification
pass promotes named shops with stronger sources.
