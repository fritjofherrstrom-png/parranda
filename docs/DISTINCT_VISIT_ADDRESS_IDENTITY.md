# Distinct visit addresses in candidate identity

## Concrete loss and change

A fresh, bounded OSM read on 2026-10-08 returned Evolutionsmuseet Zoologi and
Evolutionsmuseet Paleontologi. Both link Q10492852 and the institution website,
but carry different complete visit addresses: Villavägen 9 and Norbyvägen 22,
about 254 m apart. The university independently confirms two exhibition
buildings at those addresses:
https://www.uu.se/evolutionsmuseet/kontakt

Main 759ca8d merged those places through the 500 m hard-id rule. This is a
reproduced identity loss in freshly available supply, not an attribution of the
older bf91fa9 cold run's unknown loader_error.

Two conflicting complete source-owned street/house addresses now prevent any
identity merge, including a shared Wikidata id. Addressless institution rows
that match multiple distinct addresses cannot bridge the sites or lend evidence
to one arbitrarily. That restriction survives dedupe and canonical switches.
A safe merge preserves a missing complete source-owned address, so a richer
canonical row cannot discard the branch discriminator before another merge.

Matching normalized addresses retain ordinary shared-id matching. Missing,
partial or malformed addresses establish no conflict. This is conservative:
different legitimate addresses for one building may remain separate until
sources resolve the discrepancy. No fuzzy address matching is added.

The shared evidence, trust, availability, preference and walking gates remain
authoritative. There is no city/provider exception, new acquisition, new source
approval, raised provisional stop limit or public-address trust path. The shared
identity correction serves existing Planner and Blitz consumers.

## Executed evidence

- RED: observed branch identity, addressless bridge, close names with conflicting
  addresses and public Planner lost-site regressions failed on current main.
- Separate RED: a richer addressless canonical twin lost the site address and
  subsequently merged the other branch. The focused correction preserves it.
- GREEN: 93 affected deterministic checks passed, external network prohibited.
- Three observed OSM records replayed through the real modern Planner HTTP path:
  two stops before, three after (both museums plus fika), same future date,
  Full rhythm and source facts. This is controlled source replay, not live
  end-to-end cold-start/staging acceptance.
- Separate offline replay of 80 freshly normalized OSM plus 8 NAPI records:
  85 to 86 retained identities and 12 to 13 shared-gate route-eligible places.
  Each retained museum preserves its own evidence. Gates alone do not establish
  selected-day availability or guarantee a published stop.
- Actual source reads: one bounded OSM query succeeded in 7.12 s; the earlier
  independent NAPI query returned eight records in 2.59 s. These are separate
  source observations, not cold Planner latency measurements.

## Ownership and landing

Owner: Codex. Branch: codex/distinct-visit-addresses, independent from GitHub
main 759ca8d518edb31e15079f1d3346ac290de2a7e5. PR #571 remains separate,
awaiting its assigned runtime check; this change neither contains nor depends
on its discovery aperture. Preserve #562 and parked #501.

Landing condition: independent review, affected deterministic checks and
exact-head CI green, with the conservative duplicate-retention tradeoff and
unobserved staging/cold-runtime acceptance explicit. No merge or deployment is
claimed or requested by this implementation. Exact candidate SHA and CI are
maintained in the PR body.
