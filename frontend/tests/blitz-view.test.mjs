import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { anywhereBlitzView } from "../src/lib/blitz-view.mjs";

const plannerSource = readFileSync(new URL("../src/components/AnywherePlanner.tsx", import.meta.url), "utf8");

test("Blitz view preserves one source-backed place without route or inspect internals", () => {
  const input = {
    contract: "anywhere_contextual_blitz_v1",
    status: "available",
    route_mutation: false,
    inspect: { secret: "do not render" },
    best_move: {
      kind: "place",
      candidate_id: "place-1",
      label: "Independent bookshop",
      type: "shop",
      lat: 59.33,
      lng: 18.06,
      covered_preferences: ["culture"],
      provenance: {
        source_family: "map",
        attribution: [{ label: "OpenStreetMap", url: "https://www.openstreetmap.org/node/1" }],
      },
    },
    confidence: { level: "medium" },
    context: { time_band: "afternoon", timezone: "Europe/Stockholm" },
  };
  const before = structuredClone(input);
  const view = anywhereBlitzView(input);

  assert.equal(view.state, "available");
  assert.equal(view.best.title, "Independent bookshop");
  assert.equal(view.best.source.label, "OpenStreetMap");
  assert.equal(view.confidence_level, "medium");
  assert.equal(view.time_band, "afternoon");
  assert.equal("inspect" in view, false);
  assert.equal("route_mutation" in view, false);
  assert.deepEqual(input, before);
});

test("Blitz view keeps trusted Live timing and removes duplicate Live alternatives", () => {
  const live = {
    kind: "live_event",
    candidate_id: "live-event:event-1",
    event_id: "event-1",
    title: "Courtyard concert",
    lat: 55.6,
    lng: 13,
    starts_at: "2026-08-10T18:00:00+02:00",
    timezone: "Europe/Stockholm",
    walking_minutes: 9,
    source: { label: "Official venue", url: "https://example.com/event-1", type: "venue" },
  };
  const view = anywhereBlitzView({
    contract: "anywhere_contextual_blitz_v1",
    status: "available",
    best_move: live,
    live_option: { ...live },
  });

  assert.equal(view.best.kind, "live_event");
  assert.equal(view.best.walking_minutes, 9);
  assert.equal(view.best.source.label, "Official venue");
  assert.equal(view.live_option, null);
});

test("Blitz view expands known provider ids without inventing unknown attribution", () => {
  const response = {
    contract: "anywhere_contextual_blitz_v1",
    status: "available",
    best_move: {
      kind: "place",
      candidate_id: "place-2",
      label: "Neighbourhood cafe",
      provenance: { attribution: [{ label: "osm", url: "https://www.openstreetmap.org/node/2" }] },
    },
    backup_option: {
      kind: "place",
      candidate_id: "place-3",
      label: "Independent gallery",
      provenance: { attribution: [{ label: "Local archive" }] },
    },
  };

  const view = anywhereBlitzView(response);
  assert.equal(view.best.source.label, "OpenStreetMap");
  assert.equal(view.backup.source.label, "Local archive");
});

test("Blitz view fails closed for malformed, unavailable and unrelated responses", () => {
  assert.equal(anywhereBlitzView(null).state, "invalid");
  assert.equal(anywhereBlitzView({ contract: "other", best_move: { title: "Injected" } }).best, null);
  assert.deepEqual(
    anywhereBlitzView({ contract: "anywhere_contextual_blitz_v1", status: "blocked", reasons: ["raw_token"] }),
    {
      state: "blocked",
      best: null,
      backup: null,
      live_option: null,
      confidence_level: null,
      time_band: null,
      timezone_known: false,
    },
  );
});

test("product Blitz calls the trusted contract without re-composing or mutating the day", () => {
  const body = plannerSource.match(/async function blitz\(\)[\s\S]*?\n  }\n\n  \/\/ An ANCHOR/)?.[0] || "";

  assert.match(body, /\/api\/blitz\?anywhere_blitz=1/);
  assert.match(body, /preferences: selected/);
  assert.match(body, /routeAnchorCoords/);
  assert.doesNotMatch(body, /setSelected|resolveAndRun|execute\(/);
  assert.doesNotMatch(plannerSource, /chooseBlitzPreferences/);
  assert.match(plannerSource, /It does not change today's route/);
});
