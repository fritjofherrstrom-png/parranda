"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildAnywhereBlitzDecision } = require("../server/blitz-anywhere");
const { buildApp } = require("../server/app");
const observation = require("./fixtures/blitz-now-observation.json");

function record(overrides = {}) {
  return { ...structuredClone(observation.selected), ...overrides };
}

function options(records, overrides = {}) {
  return {
    coords: observation.anchor,
    preferences: observation.preferences,
    clock: { now: () => observation.observed_at },
    weatherProvider: async () => ({
      precipitationProbabilityMax: 90, weatherCode: 61,
      timezone_resolution: { timezone: observation.timezone, timezone_source: "weather_provider_auto" },
    }),
    openDataLoader: async () => records,
    ...overrides,
  };
}

test("unknown-hours indoor suggestion publishes uncertainty instead of losing the time assessment", async () => {
  const out = await buildAnywhereBlitzDecision(options([record()]));
  assert.equal(out.status, "available", "status describes a found proposal, not an open business");
  assert.equal(out.context.time_band, "late");
  assert.equal(out.best_move.type, "museum");
  assert.deepEqual(out.best_move.availability, { status: "unknown", reason: "opening_hours_unavailable" });
  assert.equal(out.best_move.provenance.human_verified, false);
  assert.equal(out.route_mutation, false);
  assert.equal(out.day_anchor_mutation, false);
});

test("source-known closed indoor visit is excluded even with an outdoor tag", async () => {
  const out = await buildAnywhereBlitzDecision(options([
    record({ opening_hours: "Mo-Su 10:00-17:00", tags: ["outdoor"] }),
  ]));
  assert.equal(out.status, "blocked");
  assert.equal(out.best_move, null);
  assert.equal(out.backup_option, null);
});

test("source-backed overnight opening survives local midnight with its assessment intact", async () => {
  const out = await buildAnywhereBlitzDecision(options([
    record({ opening_hours: "Th 22:00-02:00" }),
  ]));
  assert.equal(out.context.date, "2026-10-16");
  assert.equal(out.status, "available");
  assert.deepEqual(out.best_move.availability, {
    status: "available_in_window", reason: "opening_hours_overlap_query_window",
  });
  assert.equal(out.best_move.opening_hours, undefined, "raw schedules remain private pipeline facts");
});

test("an explicitly mapped outdoor viewpoint with 24/7 hours remains usable without inventing a museum exterior", async () => {
  const out = await buildAnywhereBlitzDecision(options([
    record({ id: "mapped-viewpoint", name: "Public harbour viewpoint", type: "viewpoint", tags: ["outdoor", "viewpoint"], opening_hours: "24/7" }),
  ], { preferences: ["views"] }));
  assert.equal(out.status, "available");
  assert.equal(out.best_move.label, "Public harbour viewpoint");
  assert.equal(out.best_move.availability?.status, "available_in_window");
  assert.deepEqual(out.best_move.covered_preferences, ["scenic"]);
});

test("outdoor type with unknown access hours is not silently promoted to open", async () => {
  const out = await buildAnywhereBlitzDecision(options([
    record({ type: "viewpoint", name: "Mapped viewpoint", tags: ["outdoor"] }),
  ], { preferences: ["views"] }));
  assert.equal(out.best_move.availability?.status, "unknown");
});

test("known-open match outranks an unknown match and the backup retains its uncertainty", async () => {
  const out = await buildAnywhereBlitzDecision(options([
    record({ id: "unknown", lat: observation.anchor.lat, lng: observation.anchor.lng }),
    record({ id: "open", name: "Late exhibition", opening_hours: "Th 22:00-02:00" }),
  ]));
  assert.equal(out.best_move.candidate_id, "open");
  assert.equal(out.best_move.availability?.status, "available_in_window");
  assert.equal(out.backup_option.candidate_id, "unknown");
  assert.equal(out.backup_option.availability?.status, "unknown");
});

test("hours without trusted local time cannot certify open", async () => {
  const out = await buildAnywhereBlitzDecision(options([record({ opening_hours: "24/7" })], {
    coords: { lat: 0, lng: 0 }, weatherProvider: async () => null,
  }));
  assert.equal(out.context.time_band, null);
  assert.equal(out.best_move.availability?.status, "unknown");
});

test("actual HTTP middleware cannot accept public hours or availability as source facts", async t => {
  const server = buildApp(options([record()])).listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/blitz?anywhere_blitz=1&lang=en`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...observation.anchor, preferences: observation.preferences,
      opening_hours: "24/7", availability: { status: "available_in_window" },
      now: "2026-10-16T12:00:00Z",
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.context.time_band, "late");
  assert.equal(body.best_move.availability?.status, "unknown");
});
