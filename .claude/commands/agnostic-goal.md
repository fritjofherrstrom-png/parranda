# /agnostic-goal

Use this as the persistent goal condition for agnostic/planner work:

```txt
Keep working until the PR creates concrete progress toward Parranda's any-place agnostic engine.

Agnostic means: a user can eventually enter any place context, not a handbuilt citypack, and Parranda can produce an honest, useful route/dayflow using trusted source-backed candidates, local context, weather/time/live signals, geometry, confidence, and user intent.

For this PR, success means:
- default Planner behavior remains unchanged unless the PR explicitly introduces a guarded experiment flag
- experiment mode makes a tangible capability possible, not only more diagnostics
- no named city or narrow fixture becomes the product goal
- citypacks remain accelerators, not dependencies
- public payload data is never trusted
- output is honest about blockers and confidence
- the PR body includes Parranda outcome, Concrete thing possible after this PR, Still missing, and Next capability step

Do not stop at polish or metadata if the PR does not move the any-place route/dayflow engine forward.
```

Before coding, read:

- `docs/PARRANDA_ENGINE_GOALS.md`
- `docs/AGNOSTIC_ENGINE_NORTH_STAR.md`
- `CLAUDE.md`
