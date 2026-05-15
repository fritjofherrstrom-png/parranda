# Citypack Sourcing And Provenance Standard

## Summary

Future citypacks should not be built from memory, hallucinated recommendations, generic top-10 lists, or pure vibes.

Parranda should optimize for:

- route usefulness
- local credibility
- balanced city fabric
- reviewable provenance

Rome was built organically as the reference implementation. Future citypacks should be more explicit about sourcing and provenance so the model scales beyond Rome.

## Source Strategy

Acceptable source types:

- official venue websites
- official city, market, and event pages
- local cultural calendars
- OpenStreetMap, Wikidata, and similar structured data
- reputable local blogs, newsletters, and guides
- maps and search data where available
- beta tester recommendations
- trusted user-provided seeds
- personal or local connections, without over-weighting them

Guidelines:

- Blogs and guides are signals, not unquestioned truth.
- Personal recommendations are useful seeds, not automatic inclusion.
- A place should ideally have both existence verification and a quality or route-usefulness reason.
- If current place data cannot be verified from accessible sources, it should not be invented from memory.

## Provenance Model

Each place added later should have reviewable provenance notes. Recommended fields:

- `source_url` or `source_note`
- `source_type`
- `confidence`: `high`, `medium`, or `needs_review`
- `last_checked`
- `why_included`
- `area`
- `macro`
- `tags` / intents
- `time_fit`
- `route_role`
- `classification`
- `needs_human_verification`

Recommended practice:

- Keep runtime catalog fields as lean as possible for the engine.
- Store provenance and review metadata separately if that keeps runtime data cleaner.
- Treat provenance as a maintained editorial layer, not as throwaway research notes.

## Selection Principles

Do not optimize only for hidden gems, obscure places, or the most hip venues.

A good citypack needs a balanced mix of:

- food anchors
- bars
- culture
- markets
- vintage / second hand
- views
- beach / coast
- nightlife
- practical walking connectors
- classics only where they genuinely improve route flow
- local or repeat-visitor useful places
- less obvious discovery places

A place can be valuable because it is reliable, well-located, atmospheric, route-useful, or because it connects areas well. It does not need to be obscure to deserve inclusion.

## Catalog Sizing Guidance

Current sizing guidance:

- `20-30` places can test catalog shape and search
- `25-35` is a good first source-backed pilot
- `40-60` starts testing route quality
- `60-80` strong places is the serious private beta target if sourcing quality is good
- avoid `>100` in the first catalog PR unless metadata and sourcing are clearly strong

Quality beats quantity, but too few places make routes thin and repetitive.

## Barcelona First Pass

For Barcelona:

- first pilot catalog: `25-35` source-backed places
- later expansion: `50-60`
- serious beta target: `60-80` strong places

Bandini's from issue `#45` should be included in the first real Barcelona catalog as one normal high-quality beta seed.

Bandini's should not become:

- a flagship
- a sponsor surface
- a priority venue
- an over-weighted recommendation
- a special route behavior case

The beta-tester or personal connection only explains why it should be remembered, not why it should be treated differently from other places.

## Future Automatic Updating

Do not implement automatic updating yet.

Provenance should support future refresh workflows by tracking:

- `last_checked`
- source URLs that can be revisited
- source-owned fields that may change, such as closures, moves, opening hours, or official links
- review candidates when a place appears stale or changed

Human review should remain required for Parranda-owned judgment fields such as:

- `why_included`
- `tags`
- `route_role`
- `classification`

Automatic updates should suggest review candidates. They should not overwrite editorial judgment automatically.

## Practical Standard

Before adding a new place to a future citypack, we should be able to answer:

1. Is the place real and current from a verifiable source?
2. Why does it help Parranda build better routes?
3. Which area and macro does it belong to?
4. What role does it play in a route?
5. How confident are we that it belongs in the catalog?
6. Does it need human verification before shipping?

If those questions cannot be answered clearly, the place is not ready for inclusion.

## Next Step

After this document, the next implementation PR should be:

`feat: add Barcelona pilot place catalog`

That PR should start with roughly `25-35` source-backed places rather than trying to launch a full Barcelona catalog at once.
