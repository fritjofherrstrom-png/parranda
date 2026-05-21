# Candidate Pack Intake Format

This document defines the format for **candidate packs** — human-readable
drafts of places, clusters, and route ideas that a future review pass converts
into runtime records.

**This is an intake format, not a new engine contract.** Packs are pre-promotion
proposals. They are not `PlaceCandidate` records and they do not change Planner,
Blitz, Pulse, route engine, public API, or any other runtime surface until a
separate promotion PR explicitly converts selected entries.

For the actual runtime shape and vocabulary, defer to:

- `docs/PLACE_CANDIDATES.md` — `PlaceCandidate` contract, canonical
  `candidate_kind` and `source.kind` vocabulary, trust model.
- `server/place-candidates/contract.js` — code-level source of truth.
- `docs/citypack-sourcing-provenance.md` — sourcing philosophy, selection
  principles, and provenance fields. Pack authors should read this before
  drafting.

Packs live under `docs/candidate-packs/`. One pack per file, named
`<city>-<theme>-<version>.md` (e.g. `barcelona-second-hand-v0.md`).

## Pack-level metadata

Every pack begins with a metadata block. Keep it short and concrete.

```text
pack_name:           barcelona-second-hand-v0
city:                barcelona
theme:               Second hand, vintage, flea, records, books, design-resale
intended_use:        Feed Barcelona catalog with stronger shop density; seed
                     Pulse market signals; suggest future mini-route templates.
quality_bar:         Verifiable existence; fits the theme; adds neighborhood
                     texture beyond tourist defaults; not a chain.
excluded_by_design:  Chain fast-fashion; pure tourist-trap markets; high-end
                     antique dealers with no drift quality.
promotion_criteria:  Address verified · current hours/days verified · category
                     fits Parranda intent · not a duplicate of an existing
                     catalog entry · source URL or direct observation cited.
pack_version:        v0
last_updated:        2026-05-21
author:              claude (draft)
```

Field meanings:

- `pack_name`: kebab-case slug; must match the filename.
- `city`: city key as used by `server/cities/contract.js`.
- `theme`: short human phrase. One pack = one theme.
- `intended_use`: where this pack is meant to feed once promoted (catalog,
  Pulse signals, route templates, etc.).
- `quality_bar`: the standard each candidate must meet before promotion.
- `excluded_by_design`: explicit list of what this pack should not contain.
- `promotion_criteria`: the checklist a candidate must satisfy to leave the
  pack and enter runtime. This is the gatekeeper.
- `pack_version`: `v0` for initial draft, `v0.1` for iterative refinement,
  `v1` once the pack has been through one promotion round.
- `last_updated`: ISO date.
- `author`: `claude (draft)`, `codex (draft)`, `human`, or a specific name. Use
  "draft" qualifier when the pack has not yet been human-reviewed.

## Per-candidate shape

Each candidate is a markdown block. Required fields:

```text
- proposed_id:               barcelona-encants-vells
  name:                      Mercat dels Encants (Encants Vells)
  city:                      barcelona
  neighborhood:              Plaça de les Glòries / Poblenou edge
  category:                  flea_market
  candidate_kind:            real_place
  source_kind:               city_catalog
  route_role:                [main_stop, shopping_cluster]
  vibes:                     [curious, buzzy]
  tags:                      [market, second_hand, vintage, lokalt]
  why_it_fits_parranda:      One or two sentences explaining the Parranda
                             thesis fit — local texture, drift quality, what
                             it adds beyond the tourist default.
  confidence:                needs_review
  source_notes:              Well-known Barcelona flea market. Address, current
                             open days, and hours must be verified against the
                             official Ajuntament page before promotion.
  promotion_recommendation:  promote_first
```

Field meanings:

- `proposed_id`: kebab-case, city-prefixed. Stable identifier that survives
  promotion into a real `PlaceCandidate.id`.
- `name`: human-facing label.
- `city`: city key.
- `neighborhood`: neighborhood or area string. Use the city's existing area
  model where possible.
- `category`: short tag describing the place type (`flea_market`,
  `vintage_cluster`, `book_market`, `record_shop`, `design_resale`, etc.).
  This is pack-author vocabulary; it does not need to match runtime tags.
- `candidate_kind`: **canonical value from `server/place-candidates/contract.js`.**
  One of: `real_place`, `event_venue`, `structural_anchor`, `area_preset`,
  `generated_place`, `map_result`, `draft_place`. Do not invent new values.
- `source_kind`: **canonical value from `docs/PLACE_CANDIDATES.md` §Source
  Boundary.** One of: `city_catalog`, `live_event_feed`, `map_search`,
  `generated`, `routing_config`. Do not invent new values.
- `route_role`: one or more **intake-vocabulary** roles (see §Intake-only
  vocabulary below). Promotion maps these to runtime catalog roles.
- `vibes`: subset of the **canonical Parranda vibes**: `slow`, `buzzy`,
  `romantic`, `curious`. Defined in `script.js` (`cityPulseVibeLabels`). Do
  not invent new vibes; if the candidate does not fit any, leave empty.
- `tags`: free-form intent tags. Align with the city's existing catalog tag
  dialect (e.g. Barcelona already uses `vintage`, `second_hand`, `market`,
  `kultur`, `lokalt`). New shared tags need cross-city review before
  promotion.
- `why_it_fits_parranda`: 1–2 sentences. Specific, not generic praise. If you
  cannot articulate why it fits the Parranda thesis beyond "it exists", do
  not include it.
- `confidence`: `high`, `medium`, or `needs_review`. **If existence, address,
  hours, or category are not verified, this must be `needs_review`** — no
  exceptions, regardless of how well-known the place feels.
- `source_notes`: URL, direct-observation note, or explicit "unverified —
  needs research". Memory alone is not a source.
- `promotion_recommendation`: `promote_first`, `keep_as_optional`,
  `needs_research`, or `reject_for_now`. `promote_first` should only be used
  when the candidate also meets the pack's `promotion_criteria`.

## Intake-only vocabulary

The following `route_role` values are **intake-only** — they describe author
intent in a way that is friendlier to draft writing than the runtime catalog
vocabulary:

| Intake role            | Meaning                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `main_stop`            | A core anchor on a route, intended as a primary stop.                   |
| `optional_detour`      | A short side-trip worth doing only if the route makes sense for it.     |
| `neighborhood_anchor`  | A place that defines a neighborhood's character.                        |
| `rainy_day`            | Works as a fallback or substitute when weather is bad.                  |
| `shopping_cluster`     | Part of a shopping drift; usually multiple shops in the same area.      |
| `evening_anchor`       | Best in the late afternoon / evening time band.                         |
| `food_nearby`          | Useful as a food-adjacent pivot, not itself the food stop.              |

These are not runtime values. The promotion step is responsible for mapping
intake roles to the existing catalog role vocabulary:

| Intake role           | Promotion mapping (catalog reality)                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `main_stop`           | Catalog `start` / `final` / `middle` depending on the route template using it.                                              |
| `optional_detour`     | Catalog `connector` or `optional_detour` (the latter already exists on live-event candidates).                              |
| `neighborhood_anchor` | Catalog `neighborhood_anchor` (already exists).                                                                              |
| `rainy_day`           | Catalog `tags` (`rainy_day`) plus `time_fit` adjustments — no dedicated route role.                                          |
| `shopping_cluster`    | Catalog `tags` (`shopping`) plus possibly a new `shopping_anchor` role if density warrants — needs review at promotion time. |
| `evening_anchor`      | Catalog `time_fit: ["evening"]` plus `bar_anchor` / `culture_anchor` / `food_anchor` depending on category.                  |
| `food_nearby`         | Catalog `food_anchor` if it is itself a food stop, otherwise a `tags` annotation linking to nearby food.                     |

The intent is that **drafting in intake vocabulary stays human-friendly** and
**promotion makes the mapping explicit**. Packs should not try to "speak"
catalog vocabulary natively — that's the promoter's job.

## Promotion workflow

1. Pack is drafted under `docs/candidate-packs/<name>.md`, version `v0`.
2. Human or follow-up Codex pass reviews candidates against
   `docs/citypack-sourcing-provenance.md` and the pack's own
   `promotion_criteria`.
3. A separate promotion PR picks the `promote_first` subset and:
   - verifies each entry (address, hours, current existence, source URL);
   - converts verified entries into city catalog records or wires them into
     a candidate provider following `docs/PLACE_CANDIDATES.md`;
   - moves unverified entries to a new pack version (`v0.1`) with updated
     `confidence` and `source_notes`.
4. `needs_review` and `needs_research` candidates **never** silently land in
   runtime. They remain in the pack until verified.

## Hard rules for pack authors

- **Do not invent facts.** Anything you cannot verify (address, hours,
  current existence, category) must be `confidence: needs_review` with a
  clear note about what specifically needs to be verified.
- **Memory alone is not a source.** A `source_notes` of "I recall this
  exists" is not acceptable. Either cite a URL / observation or mark
  `needs_research`.
- **Do not promote inside a pack PR.** Pack PRs are docs-only. Promotion is
  a separate, explicit PR.
- **Do not introduce new vibes, `candidate_kind`, or `source_kind` values.**
  Those vocabularies are engine-wide and live in `script.js`,
  `server/place-candidates/contract.js`, and `docs/PLACE_CANDIDATES.md`. If
  you need a value that doesn't exist, that's a different PR against those
  files.
- **City-specific tag dialect is allowed** in `tags` (Barcelona already uses
  `vintage`, `second_hand`, `lokalt`, etc.) but should be aligned with the
  city's existing catalog where possible. New shared tags need cross-city
  review at promotion time.
- **Clusters and areas are valid candidates** — not every entry has to be a
  single venue. Use `candidate_kind: area_preset` for neighborhood clusters
  and `candidate_kind: generated_place` for route-themed cluster ideas.
  These cannot be promoted to runtime venues without first being decomposed
  into real underlying places.
