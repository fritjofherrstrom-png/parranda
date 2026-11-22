# A second main meal needs its own place in the day: before/after

`#702`, branch `claude/meal-spacing-20261107`. The current evidence is bound to the head that carries this README. It is compared with an exact export of `main` c428c3cf on the same saved pools.

## The rule
The rule follows the owner decision of 13 Nov 2026 and the review of 14 Nov.
- Ordinary composition is `main`'s.
- **When it runs:** only when the finished day, on a day with food and another interest and with no user edit, puts two meals side by side. The same question is then asked again with the meal-spacing selection.
- **How it decides:** on comparable final results. Both days get the same Live weave and the same final walking validation.
- **When the alternative wins:** it replaces the held day whole only if:
  - both results are measured the same way and both are valid;
  - Live stops, weave outcome and total stop count are the same;
  - no meals are side by side;
  - pins and meals that were already apart are kept;
  - no requested interest is less covered;
  - the published walk is not longer.

  Any refusal or failure keeps the held day, never the baseline fallback.
- **Where it applies:** only where that whole final chain is local, meaning no injected walking router and no OSRM provider. It never spends a provider call. Where walking runs through OSRM, as on staging, no meal change is made.

## Method
- **Pools:** `tests/helpers/meal-spacing-pools.js` and the hand-built pools in `compare.js`, the same pools the regression tests use.
  - A small control: `clustered` (the Copenhagen shape), `spread` and `forced`.
  - 60 seeded synthetic pools. The same seed always gives the same pool.
- **Settings:** the fixture composer of `tests/helpers/day-composition-fixtures.js`, with date 2026-10-22, clock 2026-10-16T08:00Z, sun and no walking limit. Its walking chain is local, so this run exercises the decision path itself.
- **Coverage:** 5 preference sets × 3 rhythms, 945 days per run.
- **Before:** `before-c428c3cf.jsonl` comes from an exact export of `main` c428c3cf (`--root`). The pools always come from this checkout.
- **After:** `after.jsonl` comes from this checkout.

## Result: this head against the exact baseline (`summary.json`)
| | `main` c428c3cf | this head |
|---|---|---|
| Mixed-pick days with adjacent meals (of 756) | 361 | 309 |
| Food-only days changed (of 189) | — | 0 |
| Days changed | — | 52, every one adjacent on `main` |
| Changed days whose meals were already apart | — | 0 |
| Changed days with a longer walk | — | 0 (18 equal, 34 shorter) |
| Changed days with a different stop count, lost coverage, or meals still adjacent | — | 0 |

- **Walk change:** the mean of −0.53 km (range −2.4 to 0.0) is over the **52 changed days only**. The other 893 days are identical to `main`.
- **Control:** the Copenhagen-shaped pool goes from two adjacent restaurants to one at calm, balanced and full with Culture + Views + Food, and at calm and full with Food + Culture. At balanced with Food + Culture, `main`'s day stays: separating the meals would have walked 0.1 km more.
- **Presentation trade-off, not a change in daypart semantics:** of the 52 changed days, 20 lose their daypart labels and 2 gain them. The engine withholds labels when a stop of an earlier slot comes between two later ones, which is `main`'s existing behaviour.
- **The remaining 309 adjacent mixed-pick days** had no recomposition that met every condition. Mostly the pool forces the pair; otherwise separating would walk further or drop something.
- **Not a target:** the 52 changed days are an outcome on these pools. New code is not meant to reproduce them.

## History (kept as raw data)
| File | What it is |
|---|---|
| `before.jsonl` | The first baseline: this branch's tree with only `main`'s policy file swapped in. Identical to `before-c428c3cf.jsonl` in all 945 rows except the later-added `separable` field. |
| `after-8c128613-strict.jsonl`, `summary-8c128613-strict.json` | The first, strict rule. It dropped 15 already-separated second meals and lengthened 42 walks, which led to the owner's narrowing. |
| `after-408bd0f9.jsonl`, `summary-408bd0f9.json` | The narrowed rule, decided before the Live weave and final validation. On these pools its days are identical to this head's. The review fixed the decision point (regressions in `tests/day-meal-spacing.test.js`), which only shows with a Live weave or a validating walking provider. |

## Reproduce
```bash
git worktree add --detach /tmp/baseline-c428c3cf c428c3cf
ln -s "$PWD/node_modules" /tmp/baseline-c428c3cf/node_modules
node docs/evidence/meal-spacing-20261113/compare.js --root /tmp/baseline-c428c3cf > docs/evidence/meal-spacing-20261113/before-c428c3cf.jsonl
node docs/evidence/meal-spacing-20261113/compare.js > docs/evidence/meal-spacing-20261113/after.jsonl
node docs/evidence/meal-spacing-20261113/compare.js --summary docs/evidence/meal-spacing-20261113/before-c428c3cf.jsonl docs/evidence/meal-spacing-20261113/after.jsonl
```
No provider, model or reader calls are made. The composer's sources, weather and clock are controlled.
