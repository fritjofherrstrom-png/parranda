# Published day → Google Maps walking directions

The modern Planner hands its published route to consumer Google Maps URLs.
No API key, billing account or internal routing provider is needed for this
handoff. It does not calculate street-network costs inside Parranda or change
candidate selection. Network-aware selection remains the separate #501 work.

## Contract

- Use `primary_route.main_stops` in published order, including woven events.
  Display-only district ideas never enter the directions.
- Include explicit `start`/`end` points from the published `map_route_points`.
  Those legs already contribute to the map and distance. The chosen near-me
  coordinates retain precedence at both ends. A typed discovery anchor is never
  invented as a walking start. Without explicit endpoints, first/last stop are
  the endpoints.
- Every stop and supplied endpoint needs finite, in-range coordinates. Missing
  coordinates suppress the whole-route action with an individual-place fallback
  message; no point is silently skipped.
- Use `api=1` and `travelmode=walking`. Each link has at most three intermediate
  waypoints, matching Google's documented mobile-browser limit. Longer routes
  split into consecutive numbered parts with a shared endpoint. Every point
  remains in order; adjacent identical coordinates need no extra walking leg,
  while nonadjacent return visits are preserved. Open subsequent parts manually.
- Show start/end and explain estimated distances/times beside the action.
  Google computes its own path; Parranda does not claim that its estimate is
  Google's measurement or that the heuristic map line validates barriers.

Official URL contract:
[Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started#directions-action).
Google documents platform differences, including products without waypoint
support. Three waypoints is a portable ceiling, not a guarantee for every client.

## Reproductions and verification

Base: `8bd06680c78d335537d62070d856b3072afb3f89`.

1. Previous link builder sampled long routes down to eight intermediate points.
   It both lost published stops and exceeded the documented mobile-web limit.
2. Previous Planner ignored published non-stop endpoints. The real local
   Barcelona citypack response estimated 4 km from El Born / Santa Caterina
   through four stops to Poblenou / Coast. The old directions omitted both
   endpoints; Google displayed 1.5 km between the four stops alone.
3. The previous builder filtered out coordinate-less stops without disclosure.

Regression tests cover all three, portable link boundaries, a near-me loop,
intermediate revisits, a woven stop, exclusion of display-only ideas, and the
real Planner component's labels/actions using controlled API responses. Those
component tests are synthetic evidence, not provider or Pi acceptance.

Local browser check: `http://127.0.0.1:18120/` → curated Barcelona → modern
Planner, using the normal local server and real citypack composition. The new
links include both public endpoints and all four stops in two walking parts.
Google Maps opened walking directions and retained all five coordinates in
the first part, including all three intermediates. The second part starts at
the first part's destination and ends at the published final coordinate.
Google displayed 2.0 km + 2.2 km for the two parts (Parranda estimated 4 km).
Coordinates remain authoritative; Google may display a nearby address/business
label, so this is not proof of exact Google listing identity.

Desktop and narrow browser layout were checked visually. The measured narrow
viewport was 351 CSS px, with equal document width (no horizontal overflow)
and full-width Maps buttons approximately 48 CSS px tall. This is responsive
desktop-browser evidence, not an Android/iOS app test. No Pi deployment or new
live source acceptance was performed.
The Swedish landing → Rome path stayed in modern Planner and produced three
stops plus the published Monti/Trastevere endpoints in one walking link. Both
local Planner checks had no captured console warnings/errors. Screenshots were
visually inspected in the browser session; no standalone screenshot archive is
claimed.

## Recheck

```sh
npm ci
npm ci --prefix frontend
node --test frontend/tests/maps-links.test.mjs frontend/tests/planner-maps-handoff.test.mjs frontend/tests/anywhere-contract.test.mjs frontend/tests/location-anchor.test.mjs
npm test
npm run test:frontend
npm run check:frontend
npm run build:frontend
node scripts/check-frontend-dist-drift.js
npm run validate:self-hosted
git diff --check
```

Browser: follow a curated city from the landing, compare the published map
endpoints and stop order with every directions URL, open each part and confirm
walking mode. Check both languages and narrow/wide viewports. A physical phone
with/without the Google Maps app remains useful follow-up coverage; do not
claim that native navigation was exercised by the local browser check.
