# Nearby start order — bounded candidate

Owner: Codex. Branch: `codex/nearby-start-order-20261106`.
Base: `c8cae52c3258932eceb47d15ea366082dd9f922c`.

## Cause and behavior

An observed public Copenhagen bar loop put Floss last, about 3 metres from
the simulated planning anchor. Reordering the same six admitted places could
put it first with exactly the same existing geometry objective. The optimizer
kept the first encountered permutation on ties, so input order decided the
first stop. This does not establish that every reported ordering issue has
this cause.

The candidate prefers a shorter first gap only when the existing whole-route
geometry objective is exactly equal. The private option is enabled for ordinary
agnostic loops without a manual day edit. Default/template calls and arcs keep
their established behavior. Dayparts, source windows, meal rules, edits, events
and final walking validation keep authority. The admitted place identities,
source facts, distance budgets and search bounds are unchanged.

## Controlled verification

- Baseline optimizer/daypart regression: **18 PASS**.
- `RED.log`: unchanged product code; **4 PASS, 2 FAIL**. Both the optimizer
  witness and the published real-HTTP day put the nearby place in the wrong
  position. Other controls passed. Additional stronger-geometry/manual-order
  controls were strengthened afterward.
- `GREEN.log`: final affected regression run, **169 PASS, 0 FAIL, 0 skips**.
  It includes the six maintained nearby-start tests, bounded optimizer,
  daypart/window/meal policies, stop edits, Live Keep/upgrade and route output.
- `node scripts/check-frontend-dist-drift.js`: PASS. No frontend inputs or
  tracked build output changed.
- `git diff --check`: PASS.

The HTTP test uses a real local Express server, the frontend payload builder,
composition engine and published response. Place inputs, weather and clock are
controlled; fixture geometry is translated to a generic anchor. No product API
response is replaced. This is not live-provider, built-browser, physical-phone
or Pi acceptance. Local runtime: Node 24.15.0, macOS arm64; full candidate CI
uses Node 22 on Ubuntu and is reported separately on the PR.

## Boundaries and landing

The public service was observed on `f3f429e4c5c3b7832ae27956ab85f988346fb47e`
during investigation. This candidate has not been deployed or tested there.
Independent whole-branch review and exact-head CI are required before landing.

Missing/misclassified catalogue records (Thrift Planet / København K),
persistent visited history and ratings are separate work. This fix cannot add
an absent candidate, infer a visit, override a required time window or promise
the nearest place always comes first. No public cache or deployment changed.
