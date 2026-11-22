# One no-day state: evidence (12 November 2026)

**Before** (`*-staging-before.png`): staging `2590f540` (runtime profile `staging-563-564`), loaded through the built UI at 390 px on 12 November 2026 around 20:13 CET. Each case stacked four cards:
- "We couldn’t confirm a walkable day with these interests"
- "Parranda couldn't build a day here right now. One or more place sources failed" with Try again
- "Places found — no route yet"
- "No places for: waterside, bathing_places · 0 matches for your picks"

**After** (`*-after.png`): a staging replay, not a live run. This branch's built UI was served locally, and `/api/route-recommendations` was answered with the response staging gave for the same request in the before capture. Those responses are `frontend/tests/fixtures/no-day-staging-2590f540.json`, with `live_events.browse` and `live_events.this_week` removed for size. The screenshots used the untrimmed responses.

Requests:
- Copenhagen: `prefs=waterside,bathing_places`
- Mexico City: `prefs=cheap_eats`
- Stockholm: `prefs=live_music`

All three requests are `lang=en`. Copenhagen is also shown with `lang=sv`.

What the engine said in those responses:

| Case | Records loaded | Source error | Loader covered | Loader missing |
| --- | --- | --- | --- | --- |
| Copenhagen | 101 | `http_non_200` | `waterside` | `bathing_places` |
| Mexico City | 97 | `provider_unavailable` | — | `cheap_eats` |
| Stockholm | 103 | `provider_unavailable` | — (Live music is not a loader intent) | — |

In all three, `place_structure.district_day.missing_intents` listed every pick and `district_day.areas` was empty. No route was composed.

The theme follows the time of day, so both the before and after shots are dark.
