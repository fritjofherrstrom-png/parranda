# Barcelona Route Quality Pass

## Summary

This pass validates the first Barcelona route-seed layer through the real API and browser path after PR #53.

The pass found one real bug and fixed it:

- Preview cities with no district-style auto-anchor items could crash route generation when planner defaults used auto start/end.
- The fix now falls back to the city center as the auto anchor when no route-anchor items exist yet.

After that fix, Barcelona route generation works through the browser planner path and no longer collapses into the old preview empty state for the default one-day flow.

## Browser sanity

Checked against a clean local server on `http://localhost:8027/barcelona?lang=en`.

Confirmed:

- Barcelona remains `visibility: "preview"`.
- No Rome districts are visible.
- No Rome Pulse is visible.
- No Rome fallback route cards are shown.
- Planner can now request Barcelona routes through the user-facing flow.
- Route output no longer crashes into the preview empty state for the default planner submission.
- Preview copy still clearly says Barcelona is registered but not curated yet.

## API scenarios

### 1-day food + culture

- Days: `1`
- Primary route: `born-santa-caterina-culture-wine-loop`
- Title: `Barcelona loop • El Born / Sant Pere / Santa Caterina • local rhythm`
- Stops: `CCCB`, `Mercat de Santa Caterina`, `Bar Marsella`, `Santa Maria del Mar`, `Bar Brutal`, `Museu Picasso`
- Distance: `6.2 km`
- Areas: `raval`, `born-sant-pere-santa-caterina`
- Rome leakage: none

Assessment:

- Geographically coherent.
- Strong old-town bias.
- More culture-plus-bars than clearly food-led.

### 1-day food + bars / nightlife

- Days: `1`
- Primary route: `born-santa-caterina-culture-wine-loop`
- Title: `Barcelona loop • El Born / Sant Pere / Santa Caterina • local rhythm`
- Stops: `CCCB`, `Mercat de Santa Caterina`, `Bar Marsella`, `Santa Maria del Mar`, `Bar Brutal`, `Museu Picasso`
- Distance: `6.2 km`
- Areas: `raval`, `born-sant-pere-santa-caterina`
- Rome leakage: none

Assessment:

- Essentially the same route as food + culture.
- Nightlife intent is not yet separating the route strongly enough.

### 2-day mixed culture + food + coast

- Days: `2`
- Day 1 primary: `born-santa-caterina-culture-wine-loop`
- Day 1 stops: `Bar Brutal`, `Santa Maria del Mar`, `Bar Marsella`, `CCCB`, `Mercat de Santa Caterina`, `Museu Picasso`
- Day 1 distance: `6.6 km`
- Day 2 primary: `encants-to-coast-drift`
- Day 2 stops: `CCCB`, `Bar Marsella`, `Plaça de Sant Felip Neri`, `Mercat de Santa Caterina`
- Day 2 distance: `3.8 km`
- Rome leakage: none

Assessment:

- Day separation technically works.
- Coast intent is weak: day 2 does not actually reach the coast.
- The route ID suggests east/coast drift, but the realized route stays in old town.

### 1-day Gracia-focused start hint

- Days: `1`
- Resolved start: `Bodega Quimet`
- Primary route: `gothic-raval-cultural-connector`
- Title: `Bodega Quimet to Barcelona • Gràcia • local rhythm`
- Stops: `Cines Verdi`, `Plaça del Sol`, `CCCB`, `Plaça de Sant Felip Neri`
- Distance: `5.4 km`
- Areas: `gracia`, `raval`, `gothic`
- Rome leakage: none

Assessment:

- The hint works indirectly by resolving to a nearby place anchor.
- Better geographic spread than the default old-town loops.
- Still drifts back toward the same Raval/Gothic core.

### 1-day Sant Antoni-focused start hint

- Days: `1`
- Resolved start: `Federal Cafe Parlament`
- Primary route: `gothic-raval-cultural-connector`
- Title: `Federal Cafe Parlament to Barcelona • Raval • local rhythm`
- Stops: `Bar Calders`, `Bar Marsella`, `CCCB`, `Plaça de Sant Felip Neri`
- Distance: `3.7 km`
- Areas: `sant-antoni`, `raval`, `gothic`
- Rome leakage: none

Assessment:

- The hint works indirectly here too.
- The route is coherent and compact.
- It still slides toward the same old-town/Raval gravity.

## Quality findings

### What looks good

- Barcelona no longer needs route cards or Rome fallback to generate routes.
- English route output stayed clean in tested scenarios; no obvious Swedish template-summary leakage appeared in `lang=en`.
- Browser flow now produces a real route instead of the preview empty state.
- Bandini's does not look overweight. In the tested scenarios it did not appear in the primary route at all.

### What still looks weak

- Default route generation is too old-town-heavy.
- `food + culture` and `food + nightlife` currently collapse into nearly the same route.
- `coast` intent is not surfacing a real coast-facing day yet, even when the seed set includes one.
- Route IDs and realized routes can drift apart enough that some titles feel a little misleading after substitution.
- Gracia and Sant Antoni can influence the day, but mainly through nearby place resolution rather than a strong district-led route spine.

### Area usage

Underused in general requests:

- `gracia`
- `sant-antoni`
- `poble-sec`
- `montjuic`
- `poblenou`
- `barceloneta`

Dominant in general requests:

- `raval`
- `born-sant-pere-santa-caterina`
- `gothic`

## Beta-readiness

Barcelona is now good enough for a first narrow manual smoke test with friends if expectations are clear:

- It is a preview city.
- The planner can generate real routes.
- The routes are coherent enough to inspect and discuss.
- The citypack is not yet broad or balanced enough for confident open beta-style sharing.

Current status:

- Good for manual beta conversation.
- Not yet strong enough for “this already feels like Barcelona Parranda” confidence.

## Recommended next PR

Recommended next PR: `seed tuning`

Why:

- The current weakness is not a missing browser path anymore.
- The strongest problem is route quality concentration: old-town gravity, weak coast surfacing, and too little separation between intent mixes.
- Seed tuning is the smallest next step that can improve route shape before we add fallback cards or bigger content layers.

Keep separate after that:

- catalog expansion for underused areas
- fallback route cards
- issue #52 diagnostics / no-crash / catalog-first route generation
- Pulse/live source audit
