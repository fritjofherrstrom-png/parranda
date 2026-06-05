# Agnostic Engine North Star

**Status:** Living alignment note  
**Created after:** #257 `feat(route): add inspect agnostic route candidate diagnostics`  
**Related:** `docs/PARRANDA_ENGINE_GOALS.md`

## North star

Agnostic means Parranda can produce an honest, useful route/dayflow for **any place context** without requiring a handbuilt citypack.

Citypacks are acceleration and refinement layers. They should make Parranda sharper, richer, and more local, but they must not be required for the engine to function.

The target path is:

```txt
user enters any place context
-> Parranda resolves or understands that context
-> trusted source-backed candidates are gathered and scored
-> intent, energy, weather, time, live/pulse signals, density, geometry, and confidence shape the result
-> the engine composes an honest route/dayflow
-> citypacks improve the result when present, but are not a dependency
```

This is the product direction. Do not reduce agnostic work to a named-city fixture, a single intent, or a diagnostic sidecar.

## What agnostic does not mean

Agnostic does **not** mean:

- one external candidate appears in a known city;
- a specific named city works because a PR or test hardcoded it;
- a narrow fixture intent becomes the product goal;
- the system returns anything at all, regardless of quality;
- diagnostics keep growing while no route/dayflow capability changes.

Named cities and narrow intents may be used as fixtures only when they prove generic engine behavior. They are not the goal.

## Current state after #257

The diagnostic chain now exists:

```txt
candidate spine
-> role coverage
-> dayflow honesty
-> candidate combination
-> route-output diagnostics
-> route A/B scoring
-> agnostic route-candidate diagnostics
```

#257 was initially produced by Claude and then cleanup was completed before merge. The merged state includes the cleanup: combined `inspect=route_output,agnostic_route_candidate`, stronger banned-vocabulary guards, and full tests passing. Future prompts should treat #257 as complete and merged, not as the earlier interrupted Claude state.

This work is useful foundation, but it is not the final agnostic engine. The next phase must move from observability toward capability.

## Anti-drift rule

Every PR in the agnostic/planner line must be one of:

1. **Capability PR** — the engine can do something concrete it could not do before.
2. **Blocker-removal PR** — removes a specific blocker to any-place route/dayflow output.
3. **Diagnostic PR** — allowed only when it directly enables the next capability PR.

A diagnostic PR that does not enable a concrete capability in the next one or two PRs is drift.

Ask before each PR:

```txt
After this PR, what can we do that we could not do before?
```

Weak answers:

```txt
We can see more metadata.
We have more inspect output.
The PR body is clearer.
```

Strong answers:

```txt
With an explicit flag, the API can return an experimental agnostic route output.
A non-citypack/unknown-place request now reports exact blockers instead of silently falling back.
Trusted source-backed candidates can become route-output candidates under strict eligibility.
The frontend can dogfood any-place mode.
```

## PR body requirement

Every agnostic/planner PR should include:

```md
## Parranda outcome

This PR moves the any-place engine forward by:
- ...

Concrete thing possible after this PR:
- ...

Still missing before true any-place Planner:
- ...

Next capability step:
- ...
```

If this section is vague, the PR is probably drifting.

## Review checklist

Review agnostic/planner PRs in this order:

1. Does this move Parranda toward working in any place context, not only a named fixture?
2. Does it create or unblock a concrete capability, not only add diagnostics?
3. Is default Planner behavior still safe and unchanged unless an explicit experiment flag is present?
4. Does experiment mode actually do something tangible enough to dogfood?
5. Does it avoid hardcoding named-city or narrow-intent behavior?
6. Does it preserve trust, provenance, confidence, and honest blockers?
7. Does it avoid fake ETA, walking-time, opening-hours, or route-quality claims?
8. Does it keep citypacks as accelerators rather than dependencies?

## Near-term roadmap

The current direction should be:

```txt
#258 — experimental any-place route-output POC + readiness blockers
#259 — city/context intake contract for unknown/non-citypack places
#260 — trusted provider/loader path for arbitrary place candidates
#261 — route ordering + walking-budget validation
#262 — time/live/pulse context integration
#263 — frontend dogfood mode: enter any place -> get honest route/dayflow output
```

The numbers may shift, but the sequence should not drift back into endless diagnostics.

## Required framing for #258

#258 must be a **Capability PR**, not another pure diagnostic PR.

It should prove, behind an explicit experiment flag, that a trusted candidate-route can become actual route output if strict eligibility passes.

It should also expose honest blockers when any-place route output is not yet possible.

It must not make any named city or narrow fixture the product goal.

## Claude /goal suggestion

When using Claude's `/goal`, use a short persistent condition like:

```txt
Keep working until the PR creates concrete progress toward Parranda's any-place agnostic engine.

Agnostic means: a user can eventually enter any place context, not a handbuilt citypack, and Parranda can produce an honest, useful route/dayflow using trusted source-backed candidates, local context, weather/time/live signals, geometry, confidence, and user intent.

For this PR, success means:
- default Planner behavior remains unchanged
- experiment mode makes a tangible capability possible, not only more diagnostics
- no named city or narrow fixture becomes the product goal
- citypacks remain accelerators, not dependencies
- public payload data is never trusted
- output is honest about blockers and confidence
- the PR body includes Parranda outcome, Concrete thing possible after this PR, Still missing, and Next capability step

Do not stop at polish or metadata if the PR does not move the any-place route/dayflow engine forward.
```

## Vocabulary note

Avoid using any specific city as shorthand for the goal. Use:

```txt
any-place
arbitrary-place
unknown-place
non-citypack context
coordinate-only context
```

Likewise, narrow fixtures such as coast/swimming should not become product strategy. They may be used as test fixtures only when they prove generic engine behavior.
