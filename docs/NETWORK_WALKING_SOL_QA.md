# #501 conditional pedestrian-network QA handoff

Status (2026-10-02): **BLOCKED**. #501 remains draft. No operator-approved
Valhalla endpoint or local walking graph is confirmed. Codex owns the code and
CI; Hermes owns the prerequisite confirmation and any later isolated runtime QA.
GitHub main and the published PR head are authoritative; Pi worktrees are evidence.

## Next action: confirm prerequisites only

Before live-provider/Pi acceptance, confirm without sharing credentials:

- Actual endpoint or local graph, its owner and permission to use it.
- Allowed test load: request count, rate, duration and concurrency.
- Pedestrian graph coverage, version/build and attribution/reuse obligations.

Do not substitute a public demo or a `.example` URL. Do not deploy, rebuild,
restart QA/staging or permanently activate routing before these are confirmed.
This document does not authorize a QA deployment. After prerequisites are
resolved, agree the smallest permitted runtime check against the published
head and its CI. Keep routing default-off and retain the draft meanwhile.

## Conditional bounded check after authorization

Read `AGENTS.md`, `CODEX.md`, the product contracts and
`NETWORK_WALKING_SELECTION.md`. Freeze the exact head and immutable image;
stop on drift. Record current main, head, image and CI in the report. Preserve
previous evidence, images, caches and state; never use a dirty Pi checkout as
an integration source.

Use one graph-covered barrier/detour case and one connected control, within the
approved load. Pin trusted source inputs, anchor, date, preferences, language
and **day rhythm**, with no kilometre goal or required winning identity.
Compare flag off → cold on → identical warm on → off on the exact image.
Source changes invalidate claims about selection causality.

Save redacted inputs/final JSON, stop IDs, every leg, total and shape. Separate
changed identity from geometry-only refinement. A selection PASS requires a
measured detour-driven comparable substitution with preserved rhythm, stop
count, intent/trust/availability and every other selected identity. If no
comparable choice is exposed, label selection INCONCLUSIVE; geometry agreement
alone does not prove selection quality. Never broaden the cohort automatically.

Check public chain/marker/leg parity, honest map attribution and snap/access
caveats in the browser. Verify no typed search centre is charged as a start and
explicit coordinate anchors remain unchanged. Network graphs do not prove
current access, opening hours, wheelchair suitability or live ETA.

Observe actual provider request counts and budgets without logging secrets:
pedestrian costing, at most four chains, two live jobs, five-second request,
12-second routing session, bounded body/geometry/cache. Identical warm chains
must make no routing request. Keep source acquisition measurements separate.
Where allowed, use a controlled provider outage and cancellation during body
reading: no identity switch on initial operational failure, no heuristic day
claimed as network success, retained prior day/date/map and one explicit retry.
Synthetic fault injection is contract evidence, not real graph acceptance.

The historical interrupted `0399d99` run is not acceptance of this candidate.
Its buffering observer did not propagate downstream disconnects; it cannot
prove native streaming or body/socket cancellation. Use passive observation or
verified transparent instrumentation for that claim. Do not import a graph on
the Pi or create unrelated services as part of this handoff.

## Close the check

Report PASS / FAIL / INCONCLUSIVE separately for selection, geometry, UI and
transport limits. Record observation gaps and decide their scope rather than
automatically retrying. Restore the authorized QA setup and preserve the raw
checksummed package. Hermes reports evidence; Codex reviews the frozen head
and makes the landing assessment. No merge or permanent activation in QA.
