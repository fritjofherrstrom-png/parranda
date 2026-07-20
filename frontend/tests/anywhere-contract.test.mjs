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
import { buildAnywherePayload, ANYWHERE_PREFERENCES, WALK_PRESETS, isoDateFromOffset } from "../src/lib/anywhere-payload.mjs";

const require = createRequire(import.meta.url);
const decision = require("../../anywhere-render-decision.js");
const anywherePlannerSource = readFileSync(new URL("../src/components/AnywherePlanner.tsx", import.meta.url), "utf8");
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

test("planner depth: walking presets map to walking_km_target; tomorrow is a real date", () => {
  const preset = WALK_PRESETS.find((p) => p.key === "long");
  const payload = buildAnywherePayload({ place: "Lyon", dates: ["2026-07-03"], walkingKmTarget: preset.km });
  assert.equal(payload.walking_km_target, 9, "the long preset reaches the engine's walking target");
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

test("cold-start refresh is bounded: live may retry three times, structure remains one-shot", () => {
  // Cold first pass: composed route but no place_structure keeps its one-shot
  // upgrade, while pending live acquisition gets a small bounded backoff window.
  assert.match(anywherePlannerSource, /needsStructureUpgrade = cls\.status === "composed" && !safe\?\.place_structure/);
  assert.match(anywherePlannerSource, /needsTransientSourceRetry = decision\.shouldRetryTransientSource\(body, cls\)/);
  assert.match(anywherePlannerSource, /LIVE_REFRESH_DELAYS_MS = \[9000, 12000, 18000\]/);
  assert.match(anywherePlannerSource, /livePending && pollAttempt < LIVE_REFRESH_DELAYS_MS\.length/);
  assert.match(anywherePlannerSource, /!silent && \(needsStructureUpgrade \|\| needsTransientSourceRetry\)/);
  assert.match(anywherePlannerSource, /setLiveRefreshExhausted\(livePending && !canRefreshLive\)/);
  // The waiting state is honest and visible.
  assert.match(anywherePlannerSource, /Läser in mer från källorna — uppdateras automatiskt strax\./);
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
  assert.match(anywherePlannerSource, /TYPE_LABELS, stop\.type/);
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
  assert.match(anywherePlannerSource, /mapsWalkingRouteUrl\(routeStops\)/);
  // ...and the old duplicated presentations are gone (the "And tonight" card and
  // the woven-claim line no longer exist anywhere).
  assert.doesNotMatch(anywherePlannerSource, /Och ikväll|And tonight/);
  assert.doesNotMatch(anywherePlannerSource, /Vävd i rutten som sista stopp/);
});

test("Pulse section: place-titled, dedup-aware, honest states, no jargon", () => {
  // Editorial heading carries the place (or near-you mode).
  assert.match(anywherePlannerSource, /Just nu i \$\{anchorLabel\}/);
  assert.match(anywherePlannerSource, /Now in \$\{anchorLabel\}/);
  assert.match(anywherePlannerSource, /t\("Just nu nära dig", "Now near you"\)/);
  // Events render from the deduped buckets (woven event_ids excluded), never
  // straight from liveEvents arrays.
  assert.match(anywherePlannerSource, /pulseBuckets\.tonight/);
  assert.match(anywherePlannerSource, /pulseBuckets\.thisWeek/);
  assert.doesNotMatch(anywherePlannerSource, /liveEvents\[bucket\]/);
  // Quiet reference for the woven event — a line, never a second full card.
  assert.match(anywherePlannerSource, /Ingår i dagens rutt/);
  assert.match(anywherePlannerSource, /Included in today's route/);
  // Honest soft-empty state (covered, warm, nothing on).
  assert.match(anywherePlannerSource, /Inga listade händelser just nu/);
  assert.match(anywherePlannerSource, /Nothing listed right now/);
  // Ambient clothing guidance is derived from the trusted observation and
  // hidden without data (clothing && ...); attribution via the plural feeds line.
  assert.match(anywherePlannerSource, /clothingAdvice\(dayflow\?\.weather\?\.provenance\?\.observed/);
  assert.match(anywherePlannerSource, /\{clothing && \(/);
  assert.match(anywherePlannerSource, /pulseSourceLine\(liveEvents\)/);
  // No jargon on the surface.
  assert.doesNotMatch(anywherePlannerSource, /Live Pulse|dogfood|citypack/i);
});

test("route result has one authoritative route and keeps broader candidates secondary", () => {
  // The day header (§3): "A day in {place}" + honest counts, and the Maps CTA
  // over the FULL stop order (woven event included).
  assert.match(anywherePlannerSource, /t\("Din dag", "Your day"\)/);
  assert.match(anywherePlannerSource, /t\("En dag i", "A day in"\)/);
  assert.match(anywherePlannerSource, /t\("En dag", "A day"\)[\s\S]{0,120}t\("nära dig", "near you"\)/);
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
  assert.match(anywherePlannerSource, /de ingår inte i dagens stopp eller Maps-rutten/);
  assert.match(anywherePlannerSource, /mapsWalkingRouteUrl\(routeStops\)/);
  assert.doesNotMatch(anywherePlannerSource, /t\("Dagens kvarter", "Today's neighborhoods"\)/);
  assert.match(anywherePlannerSource, /Candidates near this place/);
  assert.match(anywherePlannerSource, /Parranda found place candidates, but not a reliable route yet\./);
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
  assert.match(anywherePlannerSource, /className: `route-map-marker/);
  assert.match(anywherePlannerSource, /routeContextSuggestions\.forEach/);
  assert.match(anywherePlannerSource, /if \(hasPrimaryRoute\)/);
  // Candidates are NEVER sequenced: the no-route branch draws plain dots only —
  // no numbered markers, no connecting arc (only the route branch may polyline).
  assert.doesNotMatch(anywherePlannerSource, /district-map-marker/);
  const noRouteBranch = anywherePlannerSource.split("} else {")[1] ?? "";
  assert.doesNotMatch(noRouteBranch.slice(0, 1200), /polyline|divIcon/);
});

test("a tapped stop discloses HUMAN copy — the trusted signal, said like a local, never raw tokens", () => {
  // The stop row is a disclosure (aria-expanded), not an external link: the Maps
  // jump moves INTO the panel as a deliberate action.
  assert.match(anywherePlannerSource, /\[expandedStopKey, setExpandedStopKey\] = useState/);
  assert.match(anywherePlannerSource, /aria-controls=\{`stop-panel-\$\{stopKey\}`\}/);
  assert.match(anywherePlannerSource, /t\("Öppna i Maps", "Open in Maps"\)/);
  // The "why it's here" line is warm role-clause copy from covered_preferences —
  // NOT the internal "covers {axis}" token, and NOT "partial match / lead".
  assert.match(anywherePlannerSource, /stopWhyLine\(stop, lang\)/);
  assert.match(anywherePlannerSource, /Here for \$\{joined\}/);
  assert.match(anywherePlannerSource, /green: \{ sv: "en grön paus", en: "a green breather" \}/);
  assert.doesNotMatch(anywherePlannerSource, /t\("täcker", "covers"\)/, "no internal 'covers {axis}' token in the UI");
  assert.doesNotMatch(anywherePlannerSource, /t\("delvis träff", "partial match"\)/, "no 'partial match' jargon");
  assert.doesNotMatch(anywherePlannerSource, /treat it as a lead|behandla.*lead/i, "no PM-speak");
  // The honest partial qualifier is human, not a token.
  assert.match(anywherePlannerSource, /A looser match — worth a look/);
  // Routing jargon "leg" is gone from the header too.
  assert.doesNotMatch(anywherePlannerSource, /t\("längsta ben", "longest leg"\)/);
  assert.match(anywherePlannerSource, /t\("längsta sträcka", "longest stretch"\)/);
  // Opening-hours slot is forward-compatible + honest-by-absence (renders only
  // when the engine surfaces availability onto the stop).
  assert.match(anywherePlannerSource, /availability\?\.status === "available"/);
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

test("compact planner and map controls keep a 44px mobile touch target", () => {
  assert.match(
    anywherePlannerSource,
    /aria-label=\{t\("Byt plats", "Change place"\)\}[\s\S]{0,180}min-h-11/,
  );
  assert.match(
    anywherePlannerSource,
    /aria-expanded=\{false\}[\s\S]{0,180}min-h-11/,
  );
  assert.match(
    anywherePlannerSource,
    /aria-expanded=\{mapExpanded\}[\s\S]{0,180}min-h-11/,
  );
  assert.match(anywhereStyles, /\.leaflet-control-zoom a\s*\{[\s\S]*width: 44px !important;/);
  assert.match(anywhereStyles, /\.leaflet-control-zoom a\s*\{[\s\S]*height: 44px !important;/);
  assert.match(anywherePlannerSource, /iconSize: \[44, 44\]/);
  assert.match(anywherePlannerSource, /iconAnchor: \[22, 22\]/);
});

test("route, saved-day, Blitz, and source actions keep a 44px mobile touch target", () => {
  assert.match(anywherePlannerSource, /onClick=\{blitz\}[\s\S]{0,180}min-h-11/);
  assert.match(anywherePlannerSource, /onClick=\{\(\) => restoreEntry\(entry\)\}[\s\S]{0,180}min-h-11/);
  assert.match(anywherePlannerSource, /aria-label=\{t\("Ta bort", "Remove"\)\}[\s\S]{0,180}min-h-11 min-w-11/);
  assert.match(anywherePlannerSource, /href=\{pin\}[\s\S]{0,180}min-h-11 min-w-11/);
  assert.match(anywherePlannerSource, /href=\{ev\.source_url\}[\s\S]{0,180}min-h-11 min-w-11/);
});

test("keyboard-reachable controls have one visible focus contract", () => {
  assert.match(anywhereStyles, /:where\([\s\S]*a\[href\][\s\S]*button[\s\S]*input[\s\S]*\):focus-visible/);
  assert.match(anywhereStyles, /outline: 3px solid rgb\(var\(--p-color-glow\)\)/);
  assert.match(anywhereStyles, /outline-offset: 3px/);
});

test("adjustments collapse to a summary and re-compose themselves — no submit past the landing", () => {
  // Collapsed summary (mood · day · length) with an aria-expanded toggle...
  assert.match(anywherePlannerSource, /!adjustOpen && \(/);
  assert.match(anywherePlannerSource, /\{moodLabel \|\| t\("Inga val", "No moods"\)\}/);
  assert.match(anywherePlannerSource, /t\("Justera", "Adjust"\)/);
  assert.match(anywherePlannerSource, /aria-expanded=\{false\}/);
  assert.match(anywherePlannerSource, /aria-expanded=\{true\}/);
  // ...expanding gives the grouped panel...
  assert.match(anywherePlannerSource, /t\("Känsla", "Mood"\)/);
  assert.match(anywherePlannerSource, /t\("När", "When"\)/);
  assert.match(anywherePlannerSource, /t\("Gånglängd", "Walking"\)/);
  // ...and a settled change re-composes on its own (debounced), so the only
  // submit left in the component is the no-anchor fallback input.
  assert.match(anywherePlannerSource, /recomposeTimerRef\.current = setTimeout\(/);
  assert.match(anywherePlannerSource, /\}, 400\);/);
  assert.match(anywherePlannerSource, /Changes apply on their own/);
  assert.equal((anywherePlannerSource.match(/type="submit"/g) || []).length, 1, "exactly one submit: the no-anchor fallback");
});

test("saving a live day does not freeze its adjustment controls as a restored snapshot", () => {
  const saveBlock = anywherePlannerSource.split("function saveDay() {")[1]?.split("function removeSavedDay")[0] ?? "";
  const restoreBlock = anywherePlannerSource.split("function restoreEntry(entry: SavedEntry) {")[1]?.split("const autoPlannedRef")[0] ?? "";
  assert.doesNotMatch(saveBlock, /setRestoredAt/);
  assert.match(restoreBlock, /setRestoredAt\(entry\.savedAt\)/);
});

test("latest compose wins and cancels stale network work", () => {
  assert.match(anywherePlannerSource, /activeRequestRef\.current\?\.abort\(\)/);
  assert.match(anywherePlannerSource, /const requestId = \+\+requestSequenceRef\.current/);
  assert.match(anywherePlannerSource, /signal: controller\.signal/);
  assert.match(anywherePlannerSource, /requestId !== requestSequenceRef\.current/);
});

test("composed coverage comes from the route, never the broader district structure", () => {
  assert.match(anywherePlannerSource, /routePreferenceCoverage\(routeStops, selected\)/);
  assert.match(anywherePlannerSource, /routeCoverage\.missing_preferences/);
  const composedRouteBlock = anywherePlannerSource.split("Without a primary route")[0] ?? "";
  assert.doesNotMatch(composedRouteBlock, /day\?\.missing_intents/);
});

test("planner honesty copy avoids internal catalog/citypack language", () => {
  assert.match(anywherePlannerSource, /Parranda har inte full kurering här ännu/);
  assert.match(anywherePlannerSource, /Parranda does not have full curation here yet/);
  assert.match(anywherePlannerSource, /Reading the map and looking for real places/);
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
  // `tonight` key is displayed as Today because it contains now/today/tonight.
  // The sheet renders the active bucket in full (the card keeps its capped
  // preview).
  assert.match(anywherePlannerSource, /\[liveSheetTime, setLiveSheetTime\] = useState/);
  assert.match(anywherePlannerSource, /liveSheetTime === "tonight" \? sheetBuckets\.tonight : sheetBuckets\.thisWeek/);
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
  assert.match(anywherePlannerSource, /time: liveSheetTime === "week" \? "this_week" : "tonight"/);
  assert.match(anywherePlannerSource, /preferences: selected/);
  assert.match(anywherePlannerSource, /response: safeResponse/);
  assert.match(anywherePlannerSource, /routeStops/);
  assert.match(anywherePlannerSource, /LIVE_QUERY_REFRESH_DELAYS_MS = \[1500, 3000, 5000\]/);
  assert.match(anywherePlannerSource, /attempt <= LIVE_QUERY_REFRESH_DELAYS_MS\.length/);
  assert.match(anywherePlannerSource, /sheetPulseState === "pending"/);
  const sheetBlock = anywherePlannerSource.split("THE LIVE SHEET")[1] ?? "";
  assert.ok(sheetBlock.length > 0, "live sheet block present");
  assert.doesNotMatch(
    sheetBlock,
    /resolveAndRun|execute\(|setSafeResponse|setClassification|setPlace|setMode|storeAnchorCoords|consumeAnchorCoords/,
    "the sheet must not recompose, replace route data or move the day anchor",
  );
  assert.match(anywherePlannerSource, /day's place and route are unchanged/);
  // Empty copy names the ACTIVE scope×time cell, and counts come from the
  // buckets, never from copy.
  // The legacy backend key `tonight` contains now/today/tonight, so the visible
  // label is the honest broader "Today" rather than claiming every row is evening.
  assert.match(anywherePlannerSource, /Inget verifierat idag \$\{scopePhrase\}/);
  assert.match(anywherePlannerSource, /Nothing verified today \$\{scopePhrase\}/);
  assert.doesNotMatch(anywherePlannerSource, /t\("Ikväll", "Tonight"\)/);
  assert.match(anywherePlannerSource, /Inget listat senare i veckan \$\{scopePhrase\}/);
  assert.match(anywherePlannerSource, /t\("Visa veckan", "Show this week"\)/);
  assert.match(anywherePlannerSource, /sheetBuckets\.thisWeek\.length\}/);
  assert.match(anywherePlannerSource, /sheetSourceHealth\.responding_source_count/);
  assert.match(anywherePlannerSource, /sheetSourceHealth\.event_bearing_source_count/);
  // The card's week summary is a count, not a second list.
  assert.match(anywherePlannerSource, /händelser listade", "more listed"/);
});
