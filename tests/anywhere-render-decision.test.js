/**
 * The any-place alpha honesty classifier. Asserts the STATUS enum and the gated
 * DATA (safe `days` length), never user-facing copy — so a fallback baseline city
 * day can never be shown as the typed place's success.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { classifyAnywhereResult, safeResponseFor } = require("../anywhere-render-decision");

const agnosticStructure = (areaCount = 2) => ({
  provenance: "agnostic_anchor",
  area_count: areaCount,
  district_day: { areas: [{ stop_ids: ["a", "b"] }], legs: [], covered_intents: ["food"], missing_intents: [] },
});

test("a replaced agnostic day → composed (and the day survives the data gate)", () => {
  const res = { days: [{ experimental_agnostic_route_applied: true, primary_route: {} }], place_structure: agnosticStructure() };
  const cls = classifyAnywhereResult(res, { place: "Genoa" });
  assert.equal(cls.status, "composed");
  assert.equal(safeResponseFor(res, cls).days.length, 1, "composed keeps the day");
});

test("a synthesized agnostic day (markers) → composed", () => {
  const res = {
    days: [{ experimental_agnostic_day: true, source: "agnostic_route_output_experiment" }],
    place_structure: agnosticStructure(1),
  };
  assert.equal(classifyAnywhereResult(res, { place: "Nantes" }).status, "composed");
});

test("agnostic structure but no composed day → structure_only, and days are emptied", () => {
  const res = { days: [{ date: "2026-06-23", primary_route: {} }], place_structure: agnosticStructure(3) };
  const cls = classifyAnywhereResult(res, { place: "Porto" });
  assert.equal(cls.status, "structure_only");
  assert.equal(cls.hasStructure, true);
  const safe = safeResponseFor(res, cls);
  assert.equal(safe.days.length, 0, "structure_only must not pass any day to rendering");
  assert.ok(safe.place_structure, "structure is preserved for the district panel");
});

test("a FALLBACK baseline city structure (no agnostic provenance) is NOT trusted → unavailable", () => {
  // The ambiguous/blocked case: the response carries the fallback CITY's structure
  // (no provenance) and a baseline day. It must never read as the typed place.
  const res = {
    days: [{ date: "2026-06-23", primary_route: { id: "baseline" } }],
    place_structure: { area_count: 12, district_day: { areas: [{ stop_ids: ["x"] }] } }, // NO provenance
  };
  const cls = classifyAnywhereResult(res, { place: "Valencia" });
  assert.equal(cls.status, "unavailable");
  assert.equal(cls.hasStructure, false);
  assert.equal(safeResponseFor(res, cls).days.length, 0, "the baseline day is dropped");
});

test("no day and no structure → unavailable", () => {
  assert.equal(classifyAnywhereResult({ days: [] }, { place: "Nowhere" }).status, "unavailable");
  assert.equal(classifyAnywhereResult({}, { place: "Nowhere" }).status, "unavailable");
});

test("placeLabel prefers the resolved anchor label, falls back to the typed place", () => {
  const resolved = {
    days: [{ experimental_agnostic_route_applied: true }],
    place_structure: agnosticStructure(),
    agnostic_route_output_experiment: { intake: { resolved: { label: "Porto, Portugal" } } },
  };
  assert.equal(classifyAnywhereResult(resolved, { place: "Porto" }).placeLabel, "Porto, Portugal");
  assert.equal(classifyAnywhereResult({ days: [] }, { place: "Porto" }).placeLabel, "Porto");
});
