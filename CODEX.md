# Parranda Codex Project Context

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

## Always inspect before agnostic/planner work

Treat these as product contracts:

- `docs/PARRANDA_ENGINE_GOALS.md`
- `docs/AGNOSTIC_ENGINE_NORTH_STAR.md`

## Codex operating rules

- Keep repo changes small, verifiable, and test-backed.
- Prefer concrete implementation over new strategy documents when the next capability step is known.
- Do not treat example places as product targets. They are fixtures proving generic any-place behavior.
- Do not let a narrow test intent become product strategy.
- Do not keep adding diagnostics unless they directly enable the next concrete capability.
- Default Planner behavior must remain safe unless an explicit experiment flag is used.
- Public payload data must never become trusted source data.
- Route/dayflow output must stay honest about confidence, blockers, source quality, geometry, and missing context.
- No live network in deterministic test suites.
- No named-city hacks unless the PR is explicitly citypack content.

## Required review questions

Before opening or finalizing any agnostic/planner PR, answer:

1. What concrete capability or blocker-removal does this PR deliver?
2. What can we do after this PR that we could not do before?
3. Does this move any-place route/dayflow capability forward, not just a named fixture?
4. Is default `/api/route-recommendations` unchanged unless an explicit experiment flag is used?
5. Are public payload injection paths blocked?
6. Are tests deterministic and focused?

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
