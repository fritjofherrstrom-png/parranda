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

test("a cold-start thin compose schedules ONE silent structure upgrade (never loops)", () => {
  // Cold first pass: composed route but no place_structure → one silent re-ask
  // after the warm window upgrades the day with districts/map/save/share.
  assert.match(anywherePlannerSource, /needsStructureUpgrade = cls\.status === "composed" && !safe\?\.place_structure/);
  assert.match(anywherePlannerSource, /needsTransientSourceRetry = decision\.shouldRetryTransientSource\(body, cls\)/);
  // Scheduling only happens on non-silent runs → the silent retry can never re-schedule itself.
  assert.match(anywherePlannerSource, /if \(!silent && \(safe\?\.live_events\?\.pending \|\| needsStructureUpgrade \|\| needsTransientSourceRetry\)\)/);
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
  assert.match(anywherePlannerSource, /Ikväll i din rutt/);
  assert.match(anywherePlannerSource, /Tonight in your route/);
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
  assert.match(anywherePlannerSource, /Just nu i \$\{typedPlaceLabel\}/);
  assert.match(anywherePlannerSource, /Now in \$\{typedPlaceLabel\}/);
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

test("route result copy keeps route stops authoritative and district candidates contextual", () => {
  assert.match(anywherePlannerSource, /Candidates near this place/);
  assert.match(anywherePlannerSource, /Parranda found place candidates, but not a reliable route yet\./);
  assert.match(anywherePlannerSource, /t\("träffar", "places"\)/);
  assert.doesNotMatch(
    anywherePlannerSource,
    /area\.stop_ids\?\.length[\s\S]{0,120}t\("stopp", "stops"\)/,
    "district/context candidate counts must not be labelled as route stops",
  );
  assert.doesNotMatch(anywherePlannerSource, /Structure found — but no finished route yet\./);
});

test("planner surface consumes landing input instead of presenting a separate any-city product", () => {
  assert.match(anywherePlannerSource, /Planerar \$\{typedPlaceLabel\}/);
  assert.match(anywherePlannerSource, /Planning \$\{typedPlaceLabel\}/);
  assert.match(anywherePlannerSource, /Justera känsla, dag och gånglängd/);
  assert.match(anywherePlannerSource, /Adjust mood, day and walking length/);
  assert.match(anywherePlannerSource, /t\("Plats", "Place"\)/);
  assert.doesNotMatch(anywherePlannerSource, /ANY-CITY PLANNER|Any-place Alpha|Experimental route|dogfood/i);
});

test("planner honesty copy avoids internal catalog/citypack language", () => {
  assert.match(anywherePlannerSource, /Parranda har inte full kurering här ännu/);
  assert.match(anywherePlannerSource, /Parranda does not have full curation here yet/);
  assert.match(anywherePlannerSource, /Reading the map and looking for real places/);
  assert.doesNotMatch(anywherePlannerSource, /citypack|city pack|no catalog|ingen katalog|fullt citypack/i);
});
