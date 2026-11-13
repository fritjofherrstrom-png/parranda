# A second main meal needs its own place in the day: before/after, 13 Nov 2026

Branch `claude/meal-spacing-20261107`, merged with `main` c428c3cf. "Before" is that same tree with `main`'s `server/planner/day-composition-policy.js`; "after" is the branch's file. Nothing else differs.

## Method
- One composer for every pair: `tests/helpers/day-composition-fixtures.js`. That fixes the source pool, the place (the fixture anchor), the date (2026-10-22), the clock (2026-10-16T08:00Z), the weather (sun) and the walking mode (no limit).
- First a small hand-built control: `clustered`, `spread` and `forced` (the pools in `tests/day-meal-spacing.test.js`).
- Then 60 seeded synthetic pools for breadth. The generator and seed are the same in both runs, and restaurants cluster in 60% of placements.
- Each pool runs with 5 preference sets (Culture + Views + Food, Food + Culture, Food + Fika + Views, Food + Nightlife, Food alone) × 3 rhythms (calm, balanced, full), so 945 days per run.
- `compare.js` writes one JSON line per day; `--summary` compares them. `before.jsonl`, `after.jsonl` and `summary.json` are the actual outputs.

## Control (hand-built pools)
- `clustered`, the Copenhagen shape (culture together, three restaurants about 1.1 km away and 120 m apart):
  - With Culture + Views + Food and with Food + Culture, every rhythm went from two adjacent restaurants to one. The freed place went to another gallery, or to a café (a partial food fit).
  - Stop counts are unchanged, nothing lost coverage, and the walk moved by −0.2 to +0.1 km.
- `spread` (a restaurant at each end): unchanged. Both meals stay, with stops between.
- `forced` (exactly six matching places for a full day): unchanged at full, two meals together. At calm and balanced there is room for a third gallery, so the second meal gives way.
- Food alone: unchanged everywhere.

## Breadth (945 days, 756 with mixed picks)
| | before | after |
|---|---|---|
| Mixed-pick days with adjacent meals | 361 | 224 |
| Food-only days with adjacent meals | 156 | 156 |
| Meals per mixed-pick day | 2.04 | 1.91 |
| Days whose stop count changed | — | 0 |
| Days that lost a covered preference | — | 0 |

- **Days that changed:** 183, all with mixed picks.
- **The 224 that still have adjacent meals:**
  - 217 have a final set the rule itself calls inseparable. The pool left no equally covered set without the pair, for example Food + Nightlife in a pool without bars.
  - 7 (0.9% of mixed-pick days) have a separable set that ordering still left adjacent. The rule only guarantees that ordering's walk guard allows the separated order; its geometry guard and other ordering terms can still win.

## Trade-offs found (an owner decision)
- **Separated meals dropped:** 15 days already had their two meals apart on `main`, separated by walking back across the day, and now keep one meal. The rule measures separability against the set's shortest stop chain, which is stricter than what ordering achieves on `main`.
- **Walk changes:** of the changed days, 42 walk at least 0.5 km more and 26 at least 0.5 km less. The mean change is +0.11 km.
  - The largest increases are 5.4 → 9.2 km (`seeded-28`, Food + Fika + Views, full) and 6.2 → 8.9 km (`seeded-1`, Food + Nightlife, calm, where the meals were already apart).
  - The selection's own detour guards still apply. They compare with the pre-selection set, not with `main`'s final day.
- **Daypart labels:** 44 changed days lose their daypart labels and 5 gain them. Separating meals with an earlier-slot stop reads as afternoon → midday → afternoon, and the engine then withholds the labels. That behaviour already exists on `main` and is not new here.

## Reproduce
```bash
node docs/evidence/meal-spacing-20261113/compare.js > docs/evidence/meal-spacing-20261113/after.jsonl
cp server/planner/day-composition-policy.js /tmp/policy-branch.js
git show origin/main:server/planner/day-composition-policy.js > server/planner/day-composition-policy.js
node docs/evidence/meal-spacing-20261113/compare.js > docs/evidence/meal-spacing-20261113/before.jsonl
cp /tmp/policy-branch.js server/planner/day-composition-policy.js
node docs/evidence/meal-spacing-20261113/compare.js --summary docs/evidence/meal-spacing-20261113/before.jsonl docs/evidence/meal-spacing-20261113/after.jsonl
```
