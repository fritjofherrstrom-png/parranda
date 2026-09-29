# Modern Planner + day rhythm / Ystad source evidence — integration candidate

This is a **candidate only**. No PR, main merge, production deploy, provider-backed acceptance or Live integration is implied by this document. The immutable SHA and final test state must be filled in after the integration commit and its checks.

## Parranda outcome

This integration moves the any-place engine forward by:
- Combining the modern Planner/UI from `qa/integrated-519-528-532-533` at `7c11b7a9324b114aa7b76f3827f8d0b0225195d8` with the #534 handoff branch `wip/pr534-jean-bob-handoff` at `796ceb16fbe517c16cf1f8ea52fdaa4d147e04ae`.
- Preserving #519's modern anchor/adjustment and #532's source-owned second-hand type chip while changing its walking-kilometre control to **Dagens rytm** (`calm`, `balanced`, `full`, `free`). The new payload has no `walking_km_target`; `free` also has no `leg_pacing`. Estimated route distance and inter-stop distance remain *outputs*.
- Keeping source-owned OSM address/website evidence for same-named Ystad shops without merging separately addressed branches or pretending operator verification.

Concrete thing possible: a testable modern Planner flow can send the same no-kilometre day-rhythm contract to its server engine for freeform and curated anchors. Legacy `km` links translate to rhythm *intent*, not a requested kilometre distance.

Still missing before product acceptance:
- Prove that `free` does not favor distance or pace anywhere in full candidate selection while still selecting time-/place-/opening-hours-smart, visitable stops. The backend currently maps `free` to the `peak` day profile; that is a density choice, not evidence of perfect neutral composition.
- Verify the published Ystad Öppna Hjärtat pin against its operator address (Herrestadsgatan 21) with real provider data; synthetic source tests alone cannot establish this.
- Independent exact-head provider/Pi/mobile QA across different cities and intents, including Second hand preference coverage and trustworthy Live. The September 29 #535 cohort failed product criteria and is not acceptance for this code.
- Explicit selection and integration of Live PR heads and review/ownership of `/home/hermes/review-510-integrated`'s 35 staged, uncommitted Live files. None is included here. #535's kilometre-target optimization is **not** part of this candidate.

Next capability step: run full local checks and exact-head browser/provider acceptance on an isolated build, then decide a separately reviewed Live membership list. Keep #534 and #535 draft; do not merge or deploy without a fresh explicit decision.

## Conflict decisions

- `frontend/src/components/AnywherePlanner.tsx`: modern #519 hierarchy, location restoration, and #532 second-hand badge survive; the conflicting older WIP adjustment markup is superseded. Only day-rhythm semantics and legacy saved-choice normalization are ported. No kilometre-shortfall warning is shown for a flow that requested no kilometre target.
- `frontend/tests/anywhere-contract.test.mjs`: both #519 stop-type semantics and the no-kilometre contract are asserted; older walking-preset assertions are superseded.
- `frontend/dist/anywhere/index.html` and `frontend/dist/index.html`: generated anew with `npm run build`, not hand-merged. Obsolete hash-named assets are removed.
- The previous `docs/WIP_PR534_CLOUD_HANDOFF.md` describes the *source branch at handoff time*; its test counts and caveats are historical, not this integration's acceptance.
