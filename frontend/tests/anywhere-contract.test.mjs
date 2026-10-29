/**
 * The new frontend's any-city surface must speak the SAME API + honesty contract
 * as the production anywhere mode: freeform place only (never a city key), the
 * three agnostic flags, and classification through the SHARED
 * anywhere-render-decision module (so a fallback city day can never be dressed
 * up as the typed place in EITHER frontend).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { buildAnywherePayload, ANYWHERE_PREFERENCES, DAY_RHYTHMS, isoDateFromOffset } from "../src/lib/anywhere-payload.mjs";
import { LIVE_COMPLETION_QUERY } from "../src/lib/live-completion.mjs";
import { routePreferenceCoverage } from "../src/lib/route-context-view.mjs";
import { limitationNote } from "../src/lib/day-limitations.mjs";
import { componentSource, plannerSurfaceSource } from "./helpers/planner-source.mjs";

const require = createRequire(import.meta.url);
const decision = require("../../anywhere-render-decision.js");
// The planner surface: the orchestrator plus the pieces it renders (see the helper).
const anywherePlannerSource = plannerSurfaceSource();
const anywhereStyles = readFileSync(new URL("../src/styles/tailwind.css", import.meta.url), "utf8");

test("payload carries the freeform place + the three agnostic flags, never a city key", () => {
  const payload = buildAnywherePayload({ place: "Lyon", dates: ["2026-07-02"], preferences: ["food", "views"] });
  assert.equal(payload.place, "Lyon");
  assert.equal(payload.place_query, "Lyon");
  assert.equal(payload.experimental_agnostic_route_output, 1);
  assert.equal(payload.include_external_candidates, 1);
  assert.equal(payload.agnostic_engine_compose, 1);
  assert.ok(!("city" in payload), "a recognized city key must never be sent from the anywhere surface");
  assert.deepEqual(payload.preferences, ["food", "views"]);
});

test("a legacy curated-city input uses the shared place engine and keeps its preferences", () => {
  const payload = buildAnywherePayload({ city: "barcelona", place: "Barcelona", dates: ["2026-08-26"], preferences: ["food", "views"] });
  assert.equal(payload.place, "Barcelona");
  assert.equal(payload.place_query, "Barcelona");
  assert.ok(!("city" in payload));
  assert.equal(payload.experimental_agnostic_route_output, 1);
  assert.equal(payload.include_external_candidates, 1);
  assert.equal(payload.agnostic_engine_compose, 1);
  assert.deepEqual(payload.preferences, ["food", "views"]);
});

test("explicit coordinates win over obsolete city identity", () => {
  const payload = buildAnywherePayload({ city: "rome", place: "Rome", coords: { lat: 48.5, lng: 8.5 } });
  assert.equal(payload.lat, 48.5);
  assert.equal(payload.lng, 8.5);
  assert.ok(!("city" in payload) && !("place" in payload));
});

test("day rhythm carries no kilometer goal while preserving real date math", () => {
  assert.deepEqual(DAY_RHYTHMS.map((p) => p.key), ["calm", "balanced", "full", "free"]);
  for (const rhythm of DAY_RHYTHMS) {
    const payload = buildAnywherePayload({ place: "Lyon", dates: ["2026-07-03"], dayRhythm: rhythm.key });
    assert.ok(!("walking_km_target" in payload));
    assert.equal(payload.day_rhythm, rhythm.key);
    assert.equal(payload.distance_mode, "no_limit");
    if (rhythm.key === "free") assert.ok(!("leg_pacing" in payload));
  }
  assert.match(anywherePlannerSource, /t\("Dagens rytm", "Day rhythm"\)/);
  assert.match(anywherePlannerSource, /dayRhythm: rhythm\.key/);
  // Deterministic date math (injectable base, no real clock in tests).
  assert.equal(isoDateFromOffset(0, new Date("2026-07-02T12:00:00Z")), "2026-07-02");
  assert.equal(isoDateFromOffset(1, new Date("2026-07-02T12:00:00Z")), "2026-07-03");
  // Month rollover stays correct.
  assert.equal(isoDateFromOffset(1, new Date("2026-07-31T12:00:00Z")), "2026-08-01");
});

test("start context: a coords anchor ('near me now') sends top-level lat/lng and NO place text", () => {
  const payload = buildAnywherePayload({
    coords: { lat: 59.437, lng: 24.7536 },
    dates: ["2026-07-03"],
    preferences: ["food"],
  });
  // Explicit coords WIN in the agnostic intake (parseBlitzCoordinates reads
  // body.lat/lng) — the anchor is the user's real position.
  assert.equal(payload.lat, 59.437);
  assert.equal(payload.lng, 24.7536);
  assert.ok(!("place" in payload) && !("place_query" in payload), "no place text in coords mode");
  assert.ok(!("city" in payload), "never a recognized city key");
  // The three agnostic flags still engage the engine path.
  assert.equal(payload.experimental_agnostic_route_output, 1);
  assert.equal(payload.include_external_candidates, 1);
  assert.equal(payload.agnostic_engine_compose, 1);
});

test("start context: a typed place sends NO coords (the modes are exclusive)", () => {
  const payload = buildAnywherePayload({ place: "Lyon", dates: ["2026-07-03"] });
  assert.ok(!("lat" in payload) && !("lng" in payload), "no coords in typed mode");
  assert.equal(payload.place, "Lyon");
});

test("preference chips map to the engine's canonical intent axes", () => {
  const keys = ANYWHERE_PREFERENCES.map((p) => p.key);
  for (const key of ["food", "culture", "views", "fika", "nightlife", "green", "second_hand"]) {
    assert.ok(keys.includes(key), `${key} chip present`);
  }
});

test("classification flows through the SHARED honesty module (no duplicated rule)", () => {
  // structure_only: place structure present, no composed day → panel only.
  const structureOnly = decision.classifyAnywhereResult(
    {
      days: [{ primary_route: { main_stops: [{ name: "Baseline stop" }] } }],
      place_structure: {
        provenance: "agnostic_anchor",
        area_count: 2,
        district_day: { areas: [{ center: { lat: 1, lng: 2 }, stop_ids: ["a"] }], legs: [], covered_intents: [], missing_intents: [] },
      },
    },
    { place: "Lyon" },
  );
  assert.equal(structureOnly.status, "structure_only");
  // The SAFE response must empty the baseline days so the island can never
  // render a fallback city's day under the typed place.
  const safe = decision.safeResponseFor(
    {
      days: [{ primary_route: { main_stops: [{ name: "Baseline stop" }] } }],
      place_structure: structureOnly.hasStructure ? { district_day: { areas: [] } } : null,
    },
    structureOnly,
  );
  assert.equal((safe.days ?? []).length, 0, "baseline days emptied for non-composed results");

  // unavailable: nothing trustworthy at all.
  const unavailable = decision.classifyAnywhereResult({ days: [] }, { place: "Nowhere" });
  assert.equal(unavailable.status, "unavailable");
});

test("public share capacity refusals render as capacity, never false place absence", () => {
  assert.match(anywherePlannerSource, /composeServiceRefusal\(response\.status, body\)/);
  assert.match(anywherePlannerSource, /Parranda is busy right now/);
  assert.match(anywherePlannerSource, /try again in about/);
});

test("cold-start refresh is bounded: the component delegates to the tested follow-up policy", () => {
  // The POLICY (one-shot upgrade) lives in the pure planComposeFollowup —
  // behavior-pinned by compose-followup.test.mjs. Here we pin the WIRING: the
  // component consults the policy with the real inputs and consumes its output
  // instead of re-deriving any of it inline.
  assert.match(anywherePlannerSource, /planComposeFollowup\(\{/);
  assert.match(anywherePlannerSource, /composed: cls\.status === "composed"/);
  assert.match(anywherePlannerSource, /structureOnly: cls\.status === "structure_only"/);
  assert.match(anywherePlannerSource, /hasStructure: Boolean\(safe\?\.place_structure\)/);
  assert.match(anywherePlannerSource, /transientSourceRetry: decision\.shouldRetryTransientSource\(body, cls\)/);
  // Pending Live is followed through the original compose's own capability,
  // never by recomposing the route (planner-live-completion.test.mjs).
  assert.doesNotMatch(anywherePlannerSource, /livePending/);
  assert.match(anywherePlannerSource, /takeLiveCompletion\(rawBody\)/);
  assert.match(anywherePlannerSource, /&\$\{LIVE_COMPLETION_QUERY\}/);
  assert.equal(LIVE_COMPLETION_QUERY, "include_live_completion=1&include_live_route_upgrade=1");
  // The waiting state is honest and visible.
  assert.match(anywherePlannerSource, /Letar efter fler platser/);
  // A silent UPGRADE refreshes the stored entry so save/share use the full day.
  assert.match(anywherePlannerSource, /if \(!silent \|\| safe\?\.place_structure\)/);
});

test("the surface renders the engine's TRUSTWORTHY richness — and never the contaminated fields", () => {
  // Rendered: the trusted weather read, real walking numbers, per-leg distances,
  // per-stop type/daypart chips, and the real route geometry on the map.
  assert.match(anywherePlannerSource, /dayflow\?\.weather\?\.headline/);
  assert.match(anywherePlannerSource, /primaryRoute\?\.estimated_km/);
  assert.match(anywherePlannerSource, /estimated_walk_minutes/);
  assert.match(anywherePlannerSource, /map_path_points/);
  // Curated/known engine kinds use #519's closed translated copy; only the
  // second-hand route kind uses #532's source-owned subtype.
  assert.match(anywherePlannerSource, /stop\?\.type === "vintage-shop"/);
  assert.match(anywherePlannerSource, /stopTypeLabel\(stop, lang\)/);
  assert.match(anywherePlannerSource, /typeLabel\(stop\?\.type, lang\)/);
  assert.match(anywherePlannerSource, /\{stopKindLabel\}/);
  // Unknown hours now belong inside the place disclosure; known closures stay
  // visible. The mounted planner-stop-hours tests and real HTTP browser test
  // exercise that behavior, instead of locking the old duplicated badge/banner
  // implementation with source-text patterns here.
  assert.match(anywherePlannerSource, /DAYPART_LABELS, stop\.daypart/);
  // NEVER rendered: fields that can carry baseline-city phrasing or placeholder
  // labels on the agnostic path (verified live: date_signals said "i Rom" for a
  // Malmö day; title/summary said "Nearby loop").
  assert.doesNotMatch(anywherePlannerSource, /date_signals/);
  assert.doesNotMatch(anywherePlannerSource, /primaryRoute\?\.title|primaryRoute\?\.summary|why_recommended|curator_voice/);
});

test("route/Pulse hierarchy: a woven event is a route EXTENSION with exactly one full presentation", () => {
  // Core numbered stops render from the partition's core list — a woven live
  // event is never an ordinary numbered POI...
  assert.match(anywherePlannerSource, /split\.core\.map\(/);
  // ...it renders once, as an attached route extension...
  assert.match(anywherePlannerSource, /split\.woven\.map\(/);
  assert.match(anywherePlannerSource, /Live i din rutt/);
  assert.match(anywherePlannerSource, /Live in your route/);
  assert.match(anywherePlannerSource, /Tillagt till dagens rutt/);
  assert.match(anywherePlannerSource, /Added to today's route/);
  // ...stays in the complete Google Maps route (FULL stop order, not the split)...
  assert.match(anywherePlannerSource, /mapsWalkingRouteParts\([\s\S]{0,80}routeStops,[\s\S]{0,180}origin: routeOrigin/);
  // ...and the old duplicated presentations are gone (the "And tonight" card and
  // the woven-claim line no longer exist anywhere).
  assert.doesNotMatch(anywherePlannerSource, /Och ikväll|And tonight/);
  assert.doesNotMatch(anywherePlannerSource, /Vävd i rutten som sista stopp/);
});

test("Pulse section: place-titled, dedup-aware, honest states, no jargon", () => {
  // Editorial heading carries the place (or near-you mode).
  assert.match(anywherePlannerSource, /Live i \$\{anchorLabel\}/);
  assert.match(anywherePlannerSource, /Live in \$\{anchorLabel\}/);
  assert.match(anywherePlannerSource, /t\("Live nära dig", "Live near you"\)/);
  // Events render from the deduped buckets (woven event_ids excluded), never
  // straight from liveEvents arrays.
  assert.match(anywherePlannerSource, /pulseBuckets\.tonight/);
  assert.match(anywherePlannerSource, /pulseBuckets\.thisWeek/);
  assert.doesNotMatch(anywherePlannerSource, /liveEvents\[bucket\]/);
  // Quiet reference for the woven event — a line, never a second full card.
  assert.match(anywherePlannerSource, /Ingår i dagens rutt/);
  assert.match(anywherePlannerSource, /Included in today's route/);
  // Honest soft-empty state (covered, warm, every source responded, nothing
  // listed). It states what the sources list — never that the place is quiet.
  assert.match(anywherePlannerSource, /Källorna svarade men listar inga händelser för perioden/);
  assert.match(anywherePlannerSource, /The sources responded but list no events for this period/);
  assert.doesNotMatch(anywherePlannerSource, /lugnt i kalendern|Nothing listed for this period — a quiet calendar/);
  // Ambient clothing guidance is derived from the trusted observation and
  // hidden without data (clothing && ...); attribution via the plural feeds line.
  assert.match(anywherePlannerSource, /clothingAdvice\(dayflow\?\.weather\?\.provenance\?\.observed/);
  assert.match(anywherePlannerSource, /\{clothing && \(/);
  assert.match(anywherePlannerSource, /pulseSourceLine\(liveEvents\)/);
  // No jargon on the surface.
  assert.doesNotMatch(anywherePlannerSource, /Live Pulse|dogfood|citypack/i);
});

test("route result has one authoritative route and keeps broader candidates secondary", () => {
  // The day header (§3): "A day in {place}", the selected date, honest
  // counts, and the Maps CTA over the FULL stop order (woven event included).
  assert.match(anywherePlannerSource, /t\("Din dag", "Your day"\)/);
  assert.match(anywherePlannerSource, /t\("En dag i", "A day in"\)/);
  assert.match(anywherePlannerSource, /t\("En dag", "A day"\)[\s\S]{0,120}t\("nära dig", "near you"\)/);
  assert.match(anywherePlannerSource, /<time dateTime=\{date!\}/);
  assert.match(anywherePlannerSource, /t\("till fots", "on foot"\)/);
  assert.match(anywherePlannerSource, /t\("Öppna rutten i Maps", "Open route in Maps"\)/);
  // Daypart group headings come from stop.daypart and render only when the
  // engine emitted one — grouping never reorders the route.
  assert.match(anywherePlannerSource, /daypart && daypart !== previousDaypart/);
  // Detours are collapsed by default with the caption always visible.
  assert.match(anywherePlannerSource, /aria-expanded=\{detoursOpen\}/);
  assert.match(anywherePlannerSource, /\[detoursOpen, setDetoursOpen\] = useState\(false\)/);
  assert.match(anywherePlannerSource, /buildRouteContextSuggestions\(routeStops, day\?\.areas/);
  assert.match(anywherePlannerSource, /detour idea near your route/);
  assert.match(anywherePlannerSource, /inte ingår i dagens rutt/);
  assert.match(anywherePlannerSource, /destination: routeDestination/);
  assert.doesNotMatch(anywherePlannerSource, /t\("Dagens kvarter", "Today's neighborhoods"\)/);
  assert.match(anywherePlannerSource, /Places nearby/);
  assert.match(anywherePlannerSource, /Parranda found places, but couldn.t build a route yet/);
  assert.match(anywherePlannerSource, /t\("träffar", "places"\)/);
  assert.doesNotMatch(
    anywherePlannerSource,
    /area\.stop_ids\?\.length[\s\S]{0,120}t\("stopp", "stops"\)/,
    "district/context candidate counts must not be labelled as route stops",
  );
  assert.match(anywherePlannerSource, /structure && !hasPrimaryRoute/);
  assert.doesNotMatch(anywherePlannerSource, /Structure found — but no finished route yet\./);
});

test("map hierarchy mirrors route authority instead of numbering two competing plans", () => {
  // Every numbered pin starts on its own stop; overlapping stops share a group
  // pin instead of being fanned out away from their places.
  assert.doesNotMatch(anywherePlannerSource, /routeMarkerPresentation\(/);
  assert.match(anywherePlannerSource, /const shiftX = 0;/);
  assert.match(anywherePlannerSource, /shell\.className = "route-map-marker-shell"/);
  assert.match(anywherePlannerSource, /origin\.style\.setProperty\("--route-marker-x", `\$\{shiftX\}px`\)/);
  assert.match(anywherePlannerSource, /routeContextSuggestions\.filter/);
  assert.match(anywherePlannerSource, /if \(hasPrimaryRoute\)/);
  // Candidates are NEVER sequenced: the no-route branch draws plain dots only —
  // no numbered markers, no connecting arc (only the route branch may polyline).
  assert.doesNotMatch(anywherePlannerSource, /district-map-marker/);
  const routeMapSource = componentSource("planner/RouteMap.tsx");
  const noRouteBranch = routeMapSource.split("} else {")[1] ?? "";
  assert.match(noRouteBranch, /No route exists: these are CANDIDATES/, "the no-route branch is the one inspected");
  assert.doesNotMatch(noRouteBranch.slice(0, 1200), /LineString|Marker\(|route-map-marker/);
  // Optional detour dots join the map only while their list is open, so no
  // mark on the map is left without its explanation.
  assert.match(routeMapSource, /if \(showContext\) \{\s*const shown = routeContextSuggestions\.filter/);
  assert.match(componentSource("AnywherePlanner.tsx"), /showContext=\{detoursOpen\}/);
  // A line joining the stops' own coordinates is drawn as a sketch (dotted),
  // never as a street path Parranda did not compute.
  assert.match(routeMapSource, /"line-dasharray", sketch \? \[[\d., ]+\] : null/);
  assert.match(componentSource("AnywherePlanner.tsx"), /routePathIsSketch\(primaryRoute\?\.map_path_points, routeStops\.length\)/);
});

test("map controls preserve provider attribution space", () => {
  assert.match(anywherePlannerSource, /absolute right-2\.5 top-2\.5/);
  assert.doesNotMatch(anywherePlannerSource, /absolute bottom-2\.5 right-2\.5/);
});

test("a tapped stop discloses route facts before an explicit Maps action", () => {
  // The stop row is a disclosure (aria-expanded), not an external link: the Maps
  // jump moves INTO the panel as a deliberate action.
  assert.match(anywherePlannerSource, /\[expandedStopKey, setExpandedStopKey\] = useState/);
  assert.match(anywherePlannerSource, /const panelId = `route-stop-panel-\$\{i\}`/);
  assert.match(anywherePlannerSource, /aria-controls=\{panelId\}/);
  assert.match(anywherePlannerSource, /id=\{panelId\}/);
  assert.match(anywherePlannerSource, /t\("Öppna i Maps", "Open in Maps"\)/);
  assert.match(anywherePlannerSource, /selectedDayHoursLabel\(stop\?\.selected_day_hours, lang\)/);
  assert.match(anywherePlannerSource, /\{hoursLabel && <span>\{hoursLabel\}<\/span>\}/);
  // The panel does not lecture the user or create a parallel type-to-intent
  // interpretation layer in the frontend.
  assert.doesNotMatch(anywherePlannerSource, /Why it's here|Varför här/, "no explain-the-obvious heading");
  assert.doesNotMatch(anywherePlannerSource, /stopWhyLine|WHY_ROLES|Here for \$\{/, "no generic why-sentence generator");
  assert.doesNotMatch(anywherePlannerSource, /AXIS_FAMILY|TYPE_FAMILY|nonObviousAxisLabels/);
  assert.doesNotMatch(anywherePlannerSource, /t\("Även bra för", "Also good for"\)/);
  assert.doesNotMatch(anywherePlannerSource, /t\("täcker", "covers"\)/, "no internal 'covers {axis}' token in the UI");
  assert.doesNotMatch(anywherePlannerSource, /t\("delvis träff", "partial match"\)/, "no 'partial match' jargon");
  assert.doesNotMatch(anywherePlannerSource, /treat it as a lead|behandla.*lead/i, "no PM-speak");
  // Preference fit and source trust are separate truths: an adjacent match is
  // named only from partial_preferences, while candidate_status describes
  // provisional evidence rather than pretending an exact match is partial.
  assert.match(anywherePlannerSource, /partialPreferenceLabels\(stop, selected, lang\)/);
  assert.match(anywherePlannerSource, /A looser match for:/);
  assert.match(anywherePlannerSource, /Place details are not yet confirmed/);
  assert.doesNotMatch(anywherePlannerSource, /Matches some, but not all, of what you chose/);
  assert.doesNotMatch(anywherePlannerSource, /worth a look before you go/, "no hand-holding instruction");
  // Routing jargon "leg" is gone from the header too.
  assert.doesNotMatch(anywherePlannerSource, /t\("längsta ben", "longest leg"\)/);
  // The header no longer states the longest stretch: each stop states its own walk.
  assert.doesNotMatch(anywherePlannerSource, /t\("längsta sträcka", "longest stretch"\)/);
  // Do not invent a future availability payload in the view. Hours can render
  // only after the route-stop contract exposes reviewed availability facts.
  assert.doesNotMatch(anywherePlannerSource, /stop\?\.availability|closes_at_local|Open during your visit/);
  assert.match(anywherePlannerSource, /Opening hours unavailable for the selected day/);
  // Raw engine reason tokens never render.
  assert.doesNotMatch(anywherePlannerSource, /fit_reasons|time_reasons|lens_reasons|route_roles/);
});

test("candidate clusters read as candidates, not a second itinerary", () => {
  assert.doesNotMatch(anywherePlannerSource, /till nästa distrikt|to the next district/);
  assert.doesNotMatch(anywherePlannerSource, /Dagens kvarter|Today's neighborhoods/);
  const structureOnlyHeader = anywherePlannerSource
    .split("{showStructure && structure && !(showDay && routeStops.length > 0) && (")[1]
    ?.split('{phase === "done" && upgradePending')[0] ?? "";
  assert.doesNotMatch(structureOnlyHeader, /shareDay|saveDay|Share day|Save day/);
});

test("secondary candidates disclose in Parranda before offering an explicit Maps action", () => {
  assert.match(anywherePlannerSource, /\[expandedCandidateKey, setExpandedCandidateKey\] = useState/);
  assert.match(anywherePlannerSource, /candidate-panel-detour-/);
  assert.match(anywherePlannerSource, /candidate-panel-cluster-/);
  assert.match(anywherePlannerSource, /aria-controls=\{candidatePanelId\}/);
  assert.match(anywherePlannerSource, /setExpandedCandidateKey\(expanded \? null : candidateKey\)/);
  assert.match(anywherePlannerSource, /t\("Öppna platsen i Maps", "Open place in Maps"\)/);

  const detourSurface = anywherePlannerSource
    .split("{routeContextSuggestions.map((stop, index) => {")[1]
    ?.split("Without a primary route")[0] ?? "";
  const structureSurface = anywherePlannerSource
    .split("{(day?.areas ?? []).map((area, index) => (")[1]
    ?.split("{/* The evening event is NOT presented here")[0] ?? "";
  assert.doesNotMatch(detourSurface, /<a[^>]*>\s*\{name\}\s*<\/a>/s, "detour names must not eject directly");
  assert.doesNotMatch(structureSurface, /<a[^>]*>\s*\{name\}\s*<\/a>/s, "cluster names must not eject directly");
});

test("the weather read lives in Pulse (context), not as its own competing section", () => {
  // The Pulse section carries the trusted weather read + clothing; it renders
  // even when no event source exists (weather must not vanish with events).
  assert.match(anywherePlannerSource, /\{showDay && dayflow\?\.weather\?\.headline && \(/);
  assert.doesNotMatch(anywherePlannerSource, /Dagens läsning|Today's reading/);
});

test("walking leg copy uses the shared sub-100-metre formatter", () => {
  assert.match(anywherePlannerSource, /walkingDistanceLabel\(leg\.km, lang\)/);
  assert.doesNotMatch(anywherePlannerSource, /`\$\{leg\.km\} km`/);
});

test("the anchor is chosen once: the planner shows it, and adjusts — never a second form", () => {
  // The anchor from the landing is DISPLAYED (pill + "Change" back to landing),
  // not re-asked. The old planner header/mode-toggle/place-form are gone.
  assert.match(anywherePlannerSource, /hasAnchor && \(/);
  assert.match(anywherePlannerSource, /\{anchorLabel\}/);
  assert.match(anywherePlannerSource, /t\("Byt", "Change"\)/);
  assert.match(anywherePlannerSource, /aria-label=\{t\("Byt plats", "Change place"\)\}/);
  assert.doesNotMatch(anywherePlannerSource, /Planerar \$\{typedPlaceLabel\}|Planning \$\{typedPlaceLabel\}/);
  assert.doesNotMatch(anywherePlannerSource, /Justera känsla, dag och gånglängd/);
  assert.doesNotMatch(anywherePlannerSource, /t\("Skriv stad", "Type a city"\)/, "no start-context mode toggle past the landing");
  assert.doesNotMatch(anywherePlannerSource, /ANY-CITY PLANNER|Any-place Alpha|Experimental route|dogfood/i);
});

test("on a phone the map is a short, still overview until the reader expands it", () => {
  // A tall map above the stops once kept them off the first screen and caught
  // the thumb that meant to scroll. The overview is short, takes no pan or
  // zoom gesture while collapsed, and shows no zoom buttons; its stops still
  // open on a tap, and Expand gives the full interactive map.
  const routeMap = componentSource("planner/RouteMap.tsx");
  assert.match(anywherePlannerSource, /mapExpanded \? "h-\[min\(70vh,36rem\)\]" : "h-52"/);
  assert.match(anywherePlannerSource, /still=\{!splitLayout && !mapExpanded\}/);
  assert.match(routeMap, /function applyStill\(map: any, still: boolean\)/);
  assert.match(routeMap, /\[map\.dragPan, map\.touchZoomRotate, map\.doubleClickZoom, map\.boxZoom, map\.keyboard\]/);
  assert.match(routeMap, /applyStill\(map, stillRef\.current\)/, "applied as soon as the map exists");
  assert.match(routeMap, /data-still=\{still \|\| undefined\}/);
  assert.match(anywhereStyles, /\.route-map-frame\[data-still\] \.maplibregl-ctrl-top-left \{\s*display: none;/);
});

test("compact planner and map controls keep a 44px mobile touch target", () => {
  // The anchor card's Change and Adjust share one 44px pill (controlPill).
  const anchorCard = componentSource("planner/AnchorCard.tsx");
  assert.match(anchorCard, /const controlPill = "inline-flex min-h-11 /);
  assert.match(anchorCard, /aria-label=\{t\("Byt plats", "Change place"\)\}\s*className=\{controlPill\}/);
  assert.match(anchorCard, /aria-expanded=\{false\}[\s\S]{0,120}className=\{controlPill\}/);
  // The map's expand control is an icon: a 44×44 target named in both
  // languages, so it covers no more of the map than a thumb needs.
  assert.match(
    anywherePlannerSource,
    /aria-expanded=\{mapExpanded\}\s*aria-label=\{mapExpanded \? t\("Förminska kartan", "Shrink map"\) : t\("Förstora kartan", "Expand map"\)\}[\s\S]{0,260}min-h-11 min-w-11/,
  );
  assert.match(anywhereStyles, /\.route-map-frame \.maplibregl-ctrl-group button\s*\{[\s\S]*width: 44px;/);
  assert.match(anywhereStyles, /\.route-map-frame \.maplibregl-ctrl-group button\s*\{[\s\S]*height: 44px;/);
  // A route stop's disc and its touch target are 44px markers, both drawn where
  // the disc is (beside its coordinate when clustered).
  const routeMapSource = componentSource("planner/RouteMap.tsx");
  assert.match(routeMapSource, /new ml\.Marker\(\{ element: target, anchor: "center", offset: \[shiftX, shiftY\] \}\)/);
  assert.match(routeMapSource, /new ml\.Marker\(\{ element: shell, anchor: "center", offset: \[shiftX, shiftY\] \}\)/);
  assert.match(anywhereStyles, /\.route-map-marker-shell,\s*\.route-map-target\s*\{[^}]*width: 44px;[^}]*height: 44px;/);
  assert.match(anywhereStyles, /\.route-map-marker\s*\{[\s\S]*width: 44px;/);
  assert.match(anywhereStyles, /\.route-map-marker\s*\{[\s\S]*height: 44px;/);
});

test("a route stop's visible number is its own tap target", () => {
  const routeMapSource = componentSource("planner/RouteMap.tsx");
  // The touch targets sit beneath every stop's disc: no stop's target reaches
  // over a neighbour's number. The target is no keyboard stop; the disc is.
  assert.match(routeMapSource, /target\.style\.zIndex = "1";\s*shell\.style\.zIndex = String\(1200 \+ index\);/);
  assert.match(routeMapSource, /shell\.tabIndex = 0;/);
  assert.doesNotMatch(routeMapSource, /target\.tabIndex/);
  // On the disc's side only the visible pin takes a tap, never the marker box.
  assert.match(anywhereStyles, /\.route-map-frame \.maplibregl-marker\.route-map-marker-shell\s*\{\s*pointer-events: none;/);
  assert.match(anywhereStyles, /\.route-map-marker::before\s*\{[^}]*pointer-events: auto;/);
  // Both surfaces open the same name, while distinguishing transient hover
  // from an explicit selection. Native behavior (including expansion/leave,
  // keyboard and touch) is exercised in tests/route-map-selection.test.js.
  assert.match(routeMapSource, /target\.addEventListener\("mouseenter", \(event\) => open\("hover", event\)\);[\s\S]{0,200}target\.addEventListener\("click", \(event\) => open\("click", event\)\);/);
  assert.match(routeMapSource, /disc\.addEventListener\("mouseenter", \(event\) => open\("hover", event\)\);[\s\S]{0,200}disc\.addEventListener\("click", \(event\) => open\("click", event\)\);/);
});

test("route, saved-day, Blitz, and source actions keep a 44px mobile touch target", () => {
  assert.match(anywherePlannerSource, /busyButton\([^)]*, blitz\)\}[\s\S]{0,180}min-h-11/);
  assert.match(anywherePlannerSource, /onClick=\{\(\) => restoreEntry\(entry\)\}[\s\S]{0,180}min-h-11/);
  assert.match(anywherePlannerSource, /aria-label=\{t\("Ta bort", "Remove"\)\}[\s\S]{0,180}min-h-11 min-w-11/);
  assert.match(anywherePlannerSource, /href=\{pin\}[\s\S]{0,180}min-h-11 min-w-11/);
  // Live source links (rows, woven stop, Blitz) name their destination. Inline
  // ones draw the 44px target with ::before, so wrapping never moves the text.
  assert.match(anywherePlannerSource, /href=\{link\.href\}[\s\S]{0,120}\$\{inlineLinkTarget\}/);
  assert.match(anywherePlannerSource, /href=\{sourceLink\.href\}[\s\S]{0,120}\$\{inlineLinkTarget\}/);
  assert.match(componentSource("shared/ui.tsx"), /inlineLinkTarget = "relative before:absolute before:-inset-x-1 before:-inset-y-\[14px\]/);
  assert.doesNotMatch(anywherePlannerSource, /-my-3|&nbsp;↗/);
  assert.match(anywherePlannerSource, /href=\{liveSourceLink\.href\}[\s\S]{0,180}min-h-11/);
});

test("keyboard-reachable controls have one visible focus contract", () => {
  assert.match(anywhereStyles, /:where\([\s\S]*a\[href\][\s\S]*button[\s\S]*input[\s\S]*summary[\s\S]*\):focus-visible/);
  assert.match(anywhereStyles, /outline: 3px solid rgb\(var\(--p-color-glow\)\)/);
  assert.match(anywhereStyles, /outline-offset: 3px/);
});

// The whole Linje surface with its comments removed, so a sentence that
// mentions a border is never read as a class.
function linjeSurface() {
  return [plannerSurfaceSource(), componentSource("PlaceSearchField.tsx"), componentSource("LandingHero.tsx")]
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\w])\/\/.*$/gm, "$1");
}

const tokensCss = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
function tokenBlock(selector) {
  const start = tokensCss.indexOf(`${selector} {`);
  return tokensCss.slice(start, tokensCss.indexOf("}", start));
}
function tokenValue(block, name) {
  return block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
}
const channels = (value) => value.split(/\s+/).map(Number);
const over = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const INK_ROLES = ["ink-soft", "ink-muted", "ink-meta", "line-strong", "line-firm", "line", "line-faint", "fill-strong", "fill", "fill-faint"];

test("small text keeps AA contrast on every Linje surface", () => {
  // Secondary text never goes below meta, 68 % ink. ink/60 was 4.42:1 on a
  // day-theme panel, white at 85 % on terracotta 4.18:1, and the digit on a
  // white/22 disc 3.7:1. A component writes no ink percentage at all (24 of
  // them had drifted in by the 23 Oct audit): its lighter strengths are the
  // named roles, so the floor is checked once, here, for every text strength
  // on the strongest fill text can sit on, in both themes.
  const surface = linjeSurface();
  assert.doesNotMatch(surface, /parranda-ink\/(\d|\[)/, "ink strengths are named, never numbers");
  assert.doesNotMatch(surface, /(?<![\w-])text-white(?![\w-])/, "text on terracotta is on-terracotta");
  for (const role of INK_ROLES) {
    const token = `--p-ink-${role.replace(/^ink-/, "")}`;
    assert.ok(anywhereStyles.includes(`--color-parranda-${role}: rgb(var(--p-color-ink) / var(${token}));`), role);
  }
  const day = tokenBlock(":root");
  const night = tokenBlock(':root[data-theme="night"]');
  const fillStrong = Number(tokenValue(day, "--p-ink-fill-strong"));
  for (const strength of ["--p-ink-soft", "--p-ink-muted", "--p-ink-meta"]) {
    const alpha = Number(tokenValue(day, strength));
    for (const [theme, block] of [["day", day], ["night", night]]) {
      const ink = channels(tokenValue(block, "--p-color-ink"));
      const panel = over(ink, fillStrong, channels(tokenValue(block, "--p-color-paper")));
      const ratio = contrast(over(ink, alpha, panel), panel);
      assert.ok(ratio >= 4.5, `${strength} on a ${theme} fill-strong panel is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("frames, elevation, layers and small text come from Linje tokens", () => {
  // 7fb8c10 design-system audit: 35 hand-written 1.5px borders, raw z-index
  // numbers, black shadows in five strengths and 52 fixed px text sizes. The
  // 23 Oct audit found what those patterns let through: 34 one-pixel frames
  // beside the 1.5px line, z-[2000] above the Live sheet's documented layer,
  // black and white written raw, and arbitrary role opacities.
  const surface = linjeSurface();
  assert.doesNotMatch(surface, /border(-[trblxy])?-\[1\.5px\]/);
  assert.doesNotMatch(surface, /(?<=[\s"'`:{])border(-[trblxy])?(?=[\s"'`}])/, "every frame is border-line");
  assert.doesNotMatch(surface, /(?<![\w-])z-(\d+(?![\w-])|\[)/);
  assert.doesNotMatch(surface, /(?<![\w-])shadow-(xs|sm|md|lg|xl|2xl)(?![\w-])/);
  assert.doesNotMatch(surface, /(?<![\w-])(bg|text|border|ring|from|via|to)-(black|white)(?![\w-])/);
  assert.doesNotMatch(surface, /parranda-[a-z-]+\/\[/, "no arbitrary opacity on a role");
  assert.doesNotMatch(surface, /text-\[\d+px\]/);
  for (const token of ["--p-line", "--p-shadow-control", "--p-shadow-marker", "--p-shadow-pop", "--p-shadow-sheet", "--p-scrim", "--p-shade", "--p-color-on-terracotta", "--p-z-raised", "--p-z-popover", "--p-z-map-control", "--p-z-map-tooltip", "--p-z-map-overlay", "--p-z-sheet"]) {
    assert.match(tokensCss, new RegExp(`${token}:`), token);
  }
  // The layers stack in their documented order, the Live sheet on top.
  const day = tokenBlock(":root");
  const layers = ["--p-z-raised", "--p-z-popover", "--p-z-map-control", "--p-z-map-tooltip", "--p-z-map-overlay", "--p-z-sheet"].map((name) => Number(tokenValue(day, name)));
  assert.deepEqual(layers, [...layers].sort((a, b) => a - b));
  assert.doesNotMatch(anywhereStyles, /box-shadow:[^;]*rgb\(0 0 0/);
  assert.doesNotMatch(anywhereStyles, /border(-top|-right|-bottom|-left)?: 1px/);
  assert.doesNotMatch(anywhereStyles, /font-size: \d+px/);
  assert.match(anywhereStyles, /z-index: var\(--p-z-map-tooltip\)/);
});

test("the map's own focusable parts keep a visible ring inside its clipped frame", () => {
  assert.match(anywhereStyles, /\.route-map-frame \.maplibregl-canvas:focus-visible \{[^}]*outline-offset: -3px/);
  assert.match(anywhereStyles, /\.route-map-frame \.maplibregl-marker:focus-visible,\s*\.route-map-frame \.maplibregl-ctrl-attrib a:focus-visible \{\s*outline-offset: 0;/);
});

test("no control is disabled under the focus that pressed it", () => {
  // A focused button that turns disabled drops keyboard focus to the top of
  // the page. Working and finished states use busyButton or aria-disabled;
  // \`disabled\` is only for a choice that was never available (a Live scope
  // without a route). #611's stop edits and priority buttons came in with it.
  const surface = [plannerSurfaceSource(), componentSource("PlaceSearchField.tsx"), componentSource("LandingHero.tsx")].join("\n");
  const bound = [...surface.matchAll(/(?<![\w-])disabled=\{([^}]*)\}/g)].map((m) => m[1].trim());
  assert.deepEqual(bound.filter((expression) => !/^!\w+ScopeAvailable$/.test(expression)), []);
});

test("grouped controls never clip the focus ring that sits outside them", () => {
  // The ring is drawn 3px outside a control. A rounded group with
  // overflow-hidden cut it to a sliver on EN/SV, Today/Tomorrow, rhythm and
  // Live's When/Order; each segment now rounds its own ends instead.
  const ui = componentSource("shared/ui.tsx");
  assert.match(ui, /export const segmentGroup = "(?![^"]*overflow-hidden)[^"]*rounded-full/);
  assert.match(ui, /first:rounded-l-full last:rounded-r-full/);
  for (const file of ["shared/AppBar.tsx", "planner/AnchorCard.tsx", "planner/LiveSheet.tsx"]) {
    const source = componentSource(file);
    assert.doesNotMatch(source, /className="[^"]*overflow-hidden[^"]*"\s+role="group"/, `${file} clips a group`);
    assert.doesNotMatch(source, /overflow-hidden[^"\n]*rounded-full[^"\n]*"\s*\n?\s*role="group"/, `${file} clips a group`);
  }
  assert.doesNotMatch(componentSource("planner/AnchorCard.tsx"), /className=\{`overflow-hidden \$\{panelCard\}`\}/);
});

test("adjustments collapse to a summary and re-compose themselves — no submit past the landing", () => {
  // Collapsed summary (mood · day · length) with an aria-expanded toggle...
  assert.match(anywherePlannerSource, /!adjustOpen && \(/);
  assert.match(anywherePlannerSource, /\{moodLabel \|\| t\("Inga intressen", "No interests"\)\}/);
  assert.match(anywherePlannerSource, /t\("Justera", "Adjust"\)/);
  assert.match(anywherePlannerSource, /aria-expanded=\{false\}/);
  assert.match(anywherePlannerSource, /aria-expanded=\{true\}/);
  // ...expanding gives the grouped panel...
  assert.match(anywherePlannerSource, /t\("Intressen", "Interests"\)/);
  assert.match(anywherePlannerSource, /t\("När", "When"\)/);
  assert.match(anywherePlannerSource, /t\("Dagens rytm", "Day rhythm"\)/);
  // ...and a settled change re-composes on its own (debounced).
  // Root owns the only place-entry submit, including no-anchor fallback.
  assert.match(anywherePlannerSource, /recomposeTimerRef\.current = setTimeout\(/);
  assert.match(anywherePlannerSource, /\}, 400\);/);
  // The panel says so where it starts: there is nothing to submit.
  assert.match(anywherePlannerSource, /t\("Dagen byggs om direkt när du ändrar\.", "The day rebuilds as you change it\."\)/);
  assert.equal((anywherePlannerSource.match(/type="submit"/g) || []).length, 0, "no second entry submit, even without an anchor");
});

test("saving a live day does not freeze its adjustment controls as a restored snapshot", () => {
  const saveBlock = anywherePlannerSource.split("function saveDay() {")[1]?.split("function removeSavedDay")[0] ?? "";
  // Additive restore options must not make this wiring check inspect an empty
  // block. Mounted exact-navigation tests prove the behavioral boundary.
  const restoreBlock = anywherePlannerSource.match(/function restoreEntry\([^\n]*\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(saveBlock && restoreBlock, "both actual handlers were located");
  assert.doesNotMatch(saveBlock, /setRestoredAt/);
  assert.match(restoreBlock, /setRestoredAt\(kind === "saved" \? entry\.savedAt : null\)/);
  assert.match(restoreBlock, /setNavigationCapturedAt\(kind === "navigation" \? entry\.savedAt : null\)/);
});

test("latest compose wins and cancels stale network work", () => {
  assert.match(anywherePlannerSource, /activeRequestRef\.current\?\.abort\(\)/);
  assert.match(anywherePlannerSource, /const requestId = \+\+requestSequenceRef\.current/);
  assert.match(anywherePlannerSource, /signal: controller\.signal/);
  assert.match(anywherePlannerSource, /requestId !== requestSequenceRef\.current/);
});

test("composed coverage comes from the route, never the broader district structure", () => {
  assert.match(anywherePlannerSource, /routePreferenceCoverage\(routeStops, selected\)/);
  assert.match(anywherePlannerSource, /routeCoverage\.partial_preferences/);
  assert.match(anywherePlannerSource, /routeCoverage\.missing_preferences/);
  const composedRouteBlock = anywherePlannerSource.split("Without a primary route")[0] ?? "";
  assert.doesNotMatch(composedRouteBlock, /day\?\.missing_intents/);
});

test("planner honesty copy avoids internal catalog/citypack language", () => {
  assert.match(anywherePlannerSource, /Platserna kommer från externa källor/);
  assert.match(anywherePlannerSource, /Places come from external sources/);
  assert.match(anywherePlannerSource, /Looking for places/);
  assert.doesNotMatch(anywherePlannerSource, /citypack|city pack|no catalog|ingen katalog|fullt citypack/i);
});

test("the anchor pill shows the primary locality, never the full resolver chain", () => {
  // A resolver label is "Lyon, Métropole de Lyon, Rhône, …, France" — the pill
  // must read "Lyon", the same trim the engine applies to route prose.
  assert.match(anywherePlannerSource, /const primaryLocality = \(value\?: string \| null\) =>/);
  assert.match(anywherePlannerSource, /\.split\(","\)\[0\]\.trim\(\)/);
  assert.match(anywherePlannerSource, /primaryLocality\(classification\?\.placeLabel\)/);
});

test("the Live sheet explores events only — it never touches the day's anchor or route", () => {
  // Trigger + modal chrome.
  assert.match(anywherePlannerSource, /t\("Se allt live", "See all live"\)/);
  assert.match(anywherePlannerSource, /role="dialog"/);
  assert.match(anywherePlannerSource, /aria-modal="true"/);
  assert.match(anywherePlannerSource, /aria-label=\{t\("Stäng live", "Close live"\)\}/);
  assert.match(anywherePlannerSource, /liveSheetCloseRef\.current/);
  assert.match(anywherePlannerSource, /e\.key !== "Tab"/);
  assert.match(anywherePlannerSource, /liveSheetTriggerRef\.current/);
  // TIME is a real axis over the scoped live_events buckets; the legacy
  // `tonight` key displays the server-selected calendar day, not always Today.
  // The sheet renders the active bucket in full (the card keeps its capped
  // preview).
  assert.match(anywherePlannerSource, /\[liveSheetTime, setLiveSheetTime\] = useState/);
  assert.match(anywherePlannerSource, /liveSheetTime === "tonight" \? sheetBuckets\.tonight : sheetBuckets\.thisWeek/);
  assert.match(anywherePlannerSource, /pulseBrowseBuckets\(sheetLiveEvents, wovenEventIds\(routeStops\)\)/);
  assert.match(anywherePlannerSource, /Höjdpunkter för dina val/);
  assert.match(anywherePlannerSource, /Show \$\{sheetMoreEvents\.length\} more events/);
  assert.match(anywherePlannerSource, /<details className=/);
  assert.doesNotMatch(anywherePlannerSource, /sheetEvents\.slice\(/, "the sheet is the uncapped surface");
  // SCOPE now calls the explicit non-mutating API contract. Around-place reads
  // the trusted response anchor, near-route sends bounded primary-route points,
  // and near-me obtains separate coordinates for Live only.
  assert.match(anywherePlannerSource, /buildLiveEventQueryPayload/);
  assert.match(anywherePlannerSource, /acceptedLiveEventQuery/);
  assert.match(anywherePlannerSource, /fetch\(`\/api\/live-events\?lang=\$\{lang\}`/);
  assert.match(anywherePlannerSource, /requestLiveSheetScope\("around_place"\)/);
  assert.match(anywherePlannerSource, /requestLiveSheetScope\("near_route"\)/);
  assert.match(anywherePlannerSource, /requestLiveSheetScope\("near_me"\)/);
  assert.match(anywherePlannerSource, /time: nextTime === "week" \? "this_week" : "tonight"/);
  assert.match(anywherePlannerSource, /preferences: selected/);
  assert.match(anywherePlannerSource, /response: safeResponse/);
  assert.match(anywherePlannerSource, /routeStops/);
  assert.match(anywherePlannerSource, /LIVE_QUERY_REFRESH_DELAYS_MS = \[1500, 3000, 5000,/);
  assert.match(anywherePlannerSource, /attempt <= LIVE_QUERY_REFRESH_DELAYS_MS\.length/);
  assert.match(anywherePlannerSource, /sheetPulseState === "pending"/);
  const dayMutators = /resolveAndRun|execute\(|setSafeResponse|setClassification|setPlace|setMode|storeAnchorCoords|consumeAnchorCoords|setSelected|setCommitments/;
  const sheetBlock = componentSource("planner/LiveSheet.tsx");
  assert.match(sheetBlock, /THE LIVE SHEET/, "live sheet component present");
  assert.doesNotMatch(sheetBlock, dayMutators, "the sheet must not recompose, replace route data or move the day anchor");
  // ...and the planner hands it nothing that could: read-only data plus the
  // scope, time and close callbacks.
  const sheetElement = componentSource("AnywherePlanner.tsx").split("<LiveSheet")[1]?.split("/>")[0] ?? "";
  assert.ok(sheetElement.length > 0, "the planner renders the Live sheet");
  assert.doesNotMatch(sheetElement, dayMutators, "no prop of the sheet can recompose or move the day");
  assert.match(anywherePlannerSource, /Din plats kunde inte hämtas/);
  // Empty copy names the ACTIVE scope×time cell, and counts come from the
  // buckets, never from copy.
  // The legacy key carries the selected day; do not label tomorrow as Today.
  assert.match(anywherePlannerSource, /Inget verifierat \$\{liveDayLabel\} \$\{scopePhrase\}/);
  assert.match(anywherePlannerSource, /Nothing verified \$\{liveDayLabel\} \$\{scopePhrase\}/);
  assert.doesNotMatch(anywherePlannerSource, /t\("Ikväll", "Tonight"\)/);
  assert.match(anywherePlannerSource, /Inget listat under följande 7 dagar \$\{scopePhrase\}/);
  assert.match(anywherePlannerSource, /t\("Visa följande dagar", "Show following days"\)/);
  assert.match(anywherePlannerSource, /sheetBuckets\.thisWeek\.length\}/);
  assert.match(anywherePlannerSource, /sheetSourceHealth\.responding_source_count/);
  assert.match(anywherePlannerSource, /sheetSourceHealth\.event_bearing_source_count/);
  // The card's week summary is a count, not a second list.
  assert.match(anywherePlannerSource, /till", "more"/);
});

// --------------------------------------------------------------------------
// Slice 01 — a partially satisfied explicit request must stay visibly honest.
//
// requested [food, coffee, scenic] / covered [food, coffee] / missing [scenic]
// The day publishes as composed_limited, and the rendered coverage model names
// the missing intent specifically rather than only generically.
// --------------------------------------------------------------------------

test("a partially covered request stays composed_limited and names the missing intent", () => {
  const response = {
    days: [{
      experimental_agnostic_route_applied: true,
      primary_route: {
        main_stops: [
          { id: "cafe-0", label: "Cafe 0", covered_preferences: ["coffee"], partial_preferences: [] },
          { id: "food-0", label: "Food 0", covered_preferences: ["food"], partial_preferences: [] },
        ],
      },
    }],
    agnostic_route_output_experiment: {
      promotion: {
        readiness: "promotable_limited",
        qualifying_caps: ["capped_by_thin_day", "capped_by_requested_intent_partial"],
        unmet_requested_intents: ["scenic"],
      },
    },
  };

  // 1. The day survives as a first-class limited day.
  const classification = decision.classifyAnywhereResult(response, { place: "Somewhere" });
  assert.equal(classification.status, "composed_limited");
  assert.ok(classification.limitations.includes("capped_by_requested_intent_partial"));

  const safe = decision.safeResponseFor(response, classification);
  assert.equal(safe.days.length, 1);

  // 2. The visible coverage model names the missing intent, from the same stop
  //    metadata the route section renders.
  const stops = safe.days[0].primary_route.main_stops;
  //    Coverage speaks the planner vocabulary: coffee -> fika, scenic -> views.
  const coverage = routePreferenceCoverage(stops, ["food", "coffee", "scenic"]);
  assert.equal(coverage.has_coverage_evidence, true);
  assert.deepEqual(coverage.covered_preferences, ["food", "fika"]);
  assert.deepEqual(coverage.missing_preferences, ["views"], "the missing intent must be visible");

  // 3. The generic caveat does not duplicate it; the thin-day caveat still shows.
  const note = limitationNote(classification.limitations, stops.length, (_sv, en) => en);
  assert.equal(note, "A shorter day — 2 stops we can stand behind.");
  assert.ok(!note.toLowerCase().includes("scenic"));
  assert.ok(!note.toLowerCase().includes("views"));
});
