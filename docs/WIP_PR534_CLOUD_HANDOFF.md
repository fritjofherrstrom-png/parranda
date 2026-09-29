# PR #534 — Jean Bob local WIP handoff (not accepted)

This branch is a **review/handoff artifact**, not a finished change or a request to merge/deploy. It starts at PR #534 head `383fd4b18f877cc7da5475f3ca048f03946b41cc`. The PR itself remains draft and has **not** been updated by this branch.

## Parranda outcome

This PR moves the any-place engine forward by:
- Preserving source-owned OSM street/house-number and using independent location evidence to prefer an address-backed same-name shop over an incompatible addressless pin without merging distinct branches.
- Replacing the modern Planner's kilometre request with a day-rhythm request (`calm`, `balanced`, `full`, `free`) and carrying it through the API and agnostic composition.
- Keeping estimated walking distance as an output rather than a requested kilometre target in that new flow.

Concrete thing possible after this PR:
- Locally, focused tests exercise the new payload/share/saved-day shape, agnostic day profiles, curated calm day profile, source-address evidence and walking-fit variants.

Still missing before true any-place Planner:
- Prove that `free` selection does not prefer a distance/pace target anywhere in the engine while retaining sensible geography, travel time, hours and quality. `no_limit` alone has not been audited end-to-end for this promise.
- Real provider/browser acceptance, particularly the published Ystad Öppna Hjärtat pin at Herrestadsgatan 21; synthetic source-location tests are not that proof.
- Full suite and frontend build on this exact branch, and independent exact-head QA. Earlier full-suite attempts timed out and are not a pass.

Next capability step:
- Finish engine neutrality and route-level acceptance, verify total/inter-stop distance display, then evaluate a coherent integrated head with independent QA before promoting or merging anything.

## Local evidence at handoff

- `node --test tests/day-rhythm-engine.test.js tests/source-location-evidence.test.js tests/walking-fit-selection.test.js tests/planner-role-selector.test.js`: 44/44 pass.
- `npm run check` in `frontend`: pass.
- `node --test tests/anywhere-contract.test.mjs tests/anywhere-share.test.mjs tests/anywhere-storage.test.mjs tests/planner-commitment-races.test.mjs` in `frontend`: 74/74 pass.
- No claimed full-suite pass, provider-backed Ystad result, browser acceptance, or CI result on this WIP head.

## Reviewer instructions

Compare this handoff branch to `383fd4b18f877cc7da5475f3ca048f03946b41cc`, not just `main`. Inspect the actual diff and tests; do not infer acceptance from this note. Keep the PR draft; no merge or deploy without a separate decision. Existing `walking-fit-selection` edits began under the older kilometre-fit goal and should be challenged against the corrected no-kilometre-target product rule. Do not mistake source-owned OSM addresses for operator verification. Public payloads must not become trusted evidence.
