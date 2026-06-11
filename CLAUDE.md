# Parranda Claude Project Context

## North star

Parranda's agnostic goal is not a specific city, fixture, or narrow intent.

Agnostic means any-place route/dayflow capability:

```txt
freeform / any-place context
-> trusted location/context anchor
-> trusted source-backed candidates
-> weather/time/live/pulse signals when available
-> route/dayflow engine
-> honest output with confidence, blockers, provenance, and missing-context caveats
```

Citypacks are acceleration and refinement layers. They improve output when present, but must not be required for the engine to function.

The engine should become more capable over time. Guardrails exist to prevent fake confidence, public-payload trust, city hacks, and accidental default behavior drift — not to freeze the architecture or block deliberate new capabilities.

## Always read before agnostic/planner work

Treat these as living product contracts:

- `docs/PARRANDA_ENGINE_GOALS.md`
- `docs/AGNOSTIC_ENGINE_NORTH_STAR.md`

If implementation intentionally evolves a previous constraint, update the relevant docs/comments/tests in the same PR or in an immediate follow-up. Do not let stale documentation contradict the actual product contract.

## Anti-drift rules

- Do not treat example places as product targets. They are fixtures proving generic any-place behavior.
- Do not let a narrow test intent become product strategy.
- Do not keep adding diagnostics unless they directly enable the next concrete capability.
- Do not preserve old guardrails when they block a deliberate, reviewed capability. Evolve the guardrail, update the contract, and keep the output honest.
- Default Planner behavior must remain unchanged unless a PR explicitly promotes an experiment after readiness has been proven.
- Experiment flags are for safe development and dogfood, not a permanent excuse to avoid product progress.
- Public payload data must never become trusted source data.
- Route/dayflow output must stay honest about confidence, blockers, source quality, geometry, missing context, and whether a result is experimental.
- Missing weather/time/live/pulse context should degrade gracefully when possible. It should not automatically block a route unless that context is actually required for the claimed output.
- Do not add city-specific hacks when the generic engine should learn the lesson.
- Do not turn trust boundaries into product paralysis. If the engine can honestly do something useful with source-backed data, build the capability and label its limits.

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

If that section is vague, the PR is probably drifting.
