# Parranda — Claude project context

Parranda is a city-companion PWA that plans an honest, walkable day for any
place. The job is to make that engine more capable with every change. This file
exists to speed that up, not to slow it down.

## What we are building

```txt
freeform / any-place context
-> trusted location/context anchor
-> trusted source-backed candidates (citypacks accelerate, never required)
-> weather/time/live/pulse signals when available
-> route/dayflow engine
-> honest output: confidence, blockers, provenance, missing context
```

The product contracts are `docs/PARRANDA_ENGINE_GOALS.md` and
`docs/AGNOSTIC_ENGINE_NORTH_STAR.md`. Read them before planner or agnostic work.
They describe a direction that is still evolving. They do not freeze the
architecture.

## Bias to progress

- Prefer building the next concrete capability over writing new strategy,
  diagnostics or process docs.
- If the engine can do something useful with source-backed data, build it and
  label its limits honestly. Trust boundaries must not become paralysis.
- If a guardrail blocks a deliberate capability, evolve it: change the code,
  the contract doc and the tests in the same PR. Do not quietly work around a
  guardrail, and do not quietly give up on the capability.
- Missing weather, time, live or pulse context should degrade the output
  gracefully. It should block only when the claimed output actually needs it.
- Use experiment flags as a safe way to ship. They are not a permanent place
  to park finished work.
- Dated notes (`MEMORY.md`, handoffs, `*_20260929.md`, QA reports) are
  history, not rules. Check current `main` instead of trusting them.

## Hard invariants (few, on purpose)

These protect honesty and safety. Everything else is a default that can change.

1. Public payload data never becomes trusted source data.
2. Output never claims more than the evidence supports. Never invent venues,
   dates, coordinates, opening hours or rights. Unknown rights are not open data.
3. Default `/api/route-recommendations` behavior changes only when a PR
   explicitly says so.
4. Deterministic tests make no live network calls.
5. No named-city hacks in the generic engine. Let the generic engine learn the
   lesson; city content belongs in citypacks.
6. Merging, deploying, production data, paid services and secrets (`.env`)
   need Fritjof's explicit go-ahead. Everything local is fair game.

The live-supply and event-reader policy is in `CODEX.md` and
`docs/MACHINE_VERIFIED_LIVE_SUPPLY.md`. Follow it when you touch Live or Pulse.

## How to work

- **Before building or opening a PR:** check the current GitHub `main` SHA and
  the SHA staging actually runs (`/api/health` → `build_sha`). Report anything
  you could not check as not checked.
- **Feature:** take the smallest slice that makes a new thing possible, add a
  focused test and keep unrelated code untouched.
- **Bug:** reproduce it first. If two attempts at the same failure don't fix
  it, stop guessing. Compare 3–5 sourced options against the evidence and pick
  the best-supported one.
- **Checks:** run the smallest meaningful check for what changed. See the
  table in `agent_docs/testing.md`.
- **Landing, integration or handoff:** this is when `AGENTS.md` and
  `REVIEW-CHECKLIST.md` apply. They govern landing, not exploring or building.

```sh
npm test                      # root suite, live network blocked
npm run test:frontend
npm run check:frontend        # typecheck
npm run build:frontend && node scripts/check-frontend-dist-drift.js
npm run dev                   # local server
```

## Reporting

Keep build evidence and behavior evidence separate:

- **Build:** the commands you actually ran, with their results.
- **Behavior:** the journey you exercised, labeled with its evidence level
  (fixture, source replay, staging or physical device).
- **Not checked:** what remains, as exact manual steps.

A planned check is not a performed one. Every agnostic or planner PR body includes:

```md
## Parranda outcome
This PR moves the any-place engine forward by:
Concrete thing possible after this PR:
Still missing before true any-place Planner:
Next capability step:
```

If that section is vague, the PR is probably drifting.

## Keeping this file healthy

- Add a rule here only after a real, reproduced failure. Name that failure in
  the commit message.
- Never add rules here or in `AGENTS.md` on your own initiative. Propose them
  to Fritjof instead.
- When a rule no longer prevents anything, delete it. Shorter is better.
