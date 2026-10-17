# Published-day Live and priority feedback

Owner: Codex. Branch: `codex/live-choice-feedback-20261018`.
Base: `166609cd4482f38ff52fe91ad5f657181d2a7b54`.

Independent opening-hours PR622 remains frozen at
`05a329d474df4d745fc8ee05664a9e9d67cbc778`. Its implementation is not copied
into this branch. A release containing both must rebuild dist from combined
sources and verify its new exact head; neither PR is a deployed combined result.

## Approved behavior

- The user's local Keep intent is distinct from an exact occurrence confirmed
  in the published day. Pending/refused Keep uses the existing release action
  without claiming “Kept”. Old days and Undo remain available.
- New Keep requests, re-Keep during debounce, revalidation and retry cannot borrow
  an older acknowledgement. Only publication of the matching eligible occurrence
  restores it. Source/transport refusal does not assert a walking-limit cause.
- A newly added valid Live occurrence is named as Live even when it arrives in
  an ordinary adjustment response. Recomputing a later patch against the same
  baseline preserves the origin; title changes and invalid/placeholders do not
  manufacture a new occurrence.
- An explicit first interest that is partial/missing in the published route gets
  one short factual line. There is no inferred explanation about supply,
  distance, source failure or closing. Exact coverage is not a dominance/count
  claim. No note is shown without coverage evidence or a ranked first choice.
- Feedback is tied to the published request. New inputs during debounce/pending,
  late bodies, Undo and restored snapshots cannot borrow another intent's verdict.

The user explicitly deferred additional “Try another” explanation. Its outcome
policy, source/trust and walking gates are unchanged. No new time-of-day mode,
landmark source, activity quota, Plus, drag-and-drop or location-permission policy
is included.

## Verification scope

RED was observed before the corresponding fixes for optimistic/refused Keep,
unsupported walking copy, new-Live origin and missing first-choice feedback.
The positive Keep control, neutral/covered/no-evidence controls and the existing
Live-selection/completion tests remain. Separate regressions catch re-Keep during
400 ms debounce and retry after a refused revalidation; a controlled mutation
removing acknowledgement invalidation fails the re-Keep assertion.

Mounted UI tests use real components with controlled API replies. The built
browser/HTTP test uses the actual application handlers, composition, event
normalization and publication with controlled source transport/clock/resolver.
These are separate layers of evidence, not external provider or public-runtime
acceptance. No public cache or staging service is changed.

Run focused tests via `node --require ./tests/helpers/no-live-network.js --test`
with the relevant `frontend/tests/planner-live-*.test.mjs`,
`frontend/tests/planner-priority-feedback.test.mjs` and
`frontend/tests/day-change.test.mjs`. For built HTTP/browser verification set
`PARRANDA_TEST_CHROMIUM` to the configured real browser and run
`frontend/tests/planner-live-feedback-http-browser.test.mjs` after
`npm run build:frontend`.

Final exact SHA, full-suite counts, separate skips, independent review, Node/OS
identity and CI run belong to the PR/delivery receipt. Local runtime is
Node24.15.0/macOS-arm64; CI uses Node22/Linux. No Pi image or deployment is made.
