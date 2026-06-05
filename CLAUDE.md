# Parranda Claude Project Context

## North star

Parranda's agnostic goal is not a specific city, fixture, or narrow intent.

Agnostic means any-place route/dayflow capability:

```txt
freeform / any-place context
-> trusted location, source, weather, time, live/pulse context
-> candidate reservoir
-> route/dayflow engine
-> honest output with confidence, blockers, and provenance
```

Citypacks are acceleration and refinement layers. They improve output when present, but must not be required for the engine to function.

## Always read before agnostic/planner work

Treat these as product contracts:

- `docs/PARRANDA_ENGINE_GOALS.md`
- `docs/AGNOSTIC_ENGINE_NORTH_STAR.md`

## Anti-drift rules

- Do not treat example places as product targets. They are fixtures proving generic any-place behavior.
- Do not let a narrow test intent become product strategy.
- Do not keep adding diagnostics unless they directly enable the next concrete capability.
- Default Planner behavior must remain safe unless an explicit experiment flag is used.
- Public payload data must never become trusted source data.
- Route/dayflow output must stay honest about confidence, blockers, source quality, geometry, and missing context.

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
