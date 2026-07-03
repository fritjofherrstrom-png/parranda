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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAnywherePayload, ANYWHERE_PREFERENCES, WALK_PRESETS, isoDateFromOffset } from "../src/lib/anywhere-payload.mjs";

const require = createRequire(import.meta.url);
const decision = require("../../anywhere-render-decision.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

function readFrontendSource(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

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

test("product surface does not reintroduce the old labs/dogfood identity", () => {
  const source = [
    readFrontendSource("src/pages/anywhere.astro"),
    readFrontendSource("src/components/AnywherePlanner.tsx"),
  ].join("\n");

  for (const forbidden of [
    /Any-place alpha/i,
    /\bdogfood\b/i,
    /Experimental route/i,
    /\blabs\/anywhere\b/i,
    /\broute_mutation\b/i,
    /\bcandidate_role_order\b/i,
    /\bselected_variant\b/i,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

test("arrival with a freeform place is a result flow, not a second search step", () => {
  const source = readFrontendSource("src/components/AnywherePlanner.tsx");

  assert.match(source, /params\.get\("place"\)/);
  assert.match(source, /setPlace\(trimmed\)/);
  assert.match(source, /execute\(\{ place: trimmed \}/);
});
