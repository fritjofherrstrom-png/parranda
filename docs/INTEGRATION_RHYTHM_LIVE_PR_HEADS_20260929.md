# Planner + selected Live PR heads — review candidate

This branch is an isolated integration for review, **not** main, a production release, or provider/Pi/mobile acceptance.

## Ancestry and membership

- Parent Planner/UI/rhythm/Ystad candidate: `integration/pr534-rhythm-modern` at `7621c82bec74f1b7cbe176807c0e77fceb37991f`.
- Live #517 Linked Events source coverage: `5823a8ebe26d74a6f69a71433521607c9ae9e443`.
- Live #523 Sitevision recurrence chain: `b53acc99a3f63a0b7f477c67a75d390d4dd3c376`, containing stacked #521 and #518.
- Live #522 evening-event gate: `8d9a428baf2b35451563d2dfdd496ec281982d18`.
- Live #516 distinct sessions and honest woven-event state: `d7d7537e104423b68c11e47160f53742afa83a84`.

#516's original `AnywherePlanner.tsx` hunk assumed the Live sheet was still inline; in the modern UI the sheet is `frontend/src/components/planner/LiveSheet.tsx`. Its three behavior decisions (woven event counts as evidence, opens the selected-day sheet, and does not produce a false empty-calendar statement) were ported to the modern components. Generated `frontend/dist` must come from a successful build, never an arbitrary conflict side. The mounted regression for the false empty-calendar claim failed before the port and passed afterward.

## Deliberate exclusions

- The 35 staged, uncommitted Live files in `/home/hermes/review-510-integrated` are **untouched and not members** of this branch. Their owner/intent and overlap with these PRs must be decided before adding them to any final candidate.
- #530's walking-band gate and #535's 6→9 km walking-goal path are excluded because they conflict with the later no-kilometer-target product rule; other unselected draft PRs are not implied members.
- Sol's potential free-rhythm/Second hand follow-up does not belong to this head until independently published and explicitly integrated.

## Acceptance boundary

A clean merge, tests, a built frontend and a health SHA are not proof of real-route quality, actual source/venue coverage, worker execution, or mobile browser behavior. Run exact-head Pi/provider/browser acceptance only after all intended members are frozen, web and worker use the same immutable image, and the served asset is verified. Mark provider failures NOT OBSERVED/INCONCLUSIVE rather than route FAIL/PASS. No merge or public deploy without a separate decision.
