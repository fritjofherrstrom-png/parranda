const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeRouteCandidate,
  validateRouteCandidate,
} = require("../server/route-candidates/contract");

test("normalizes a curated-template RouteCandidate", () => {
  const candidate = normalizeRouteCandidate({
    id: "rome-evening-loop",
    city: "rome",
    shape: "loop",
    stops: [
      { id: "monti", label: "Monti", candidate_kind: "area_preset" },
      { id: "san-clemente", label: "San Clemente", candidate_kind: "real_place", area: "centro" },
      { id: "testaccio-market", label: "Testaccio Market", candidate_kind: "real_place", area: "testaccio" },
    ],
    estimatedWalkingKm: 5.4,
    estimatedDurationMinutes: 92,
    coveredIntents: ["food", "culture"],
    missingIntents: ["nightlife"],
    areaFlow: ["centro", "testaccio"],
    macroFlow: ["central", "south"],
    sourceMix: ["curated_template"],
    trustSummary: {
      sourceTiers: ["curated"],
      confidence: "high",
      humanVerified: true,
      freshness: "fresh",
    },
    explanationInputs: {
      route_style: "evening-loop",
      anchors: ["San Clemente", "Testaccio Market"],
      compact: true,
    },
  });

  assert.equal(candidate.id, "rome-evening-loop");
  assert.equal(candidate.city, "rome");
  assert.equal(candidate.route_shape, "loop");
  assert.deepEqual(candidate.source_mix, ["curated_template"]);
  assert.equal(candidate.confidence, "high");
  assert.equal(candidate.stops[0].stop_kind, "route_structure");
  assert.equal(candidate.stops[0].is_user_facing, false);
  assert.equal(candidate.stops[1].stop_kind, "user_stop");
  assert.equal(candidate.stops[1].is_user_facing, true);
  assert.equal(candidate.estimated_walking_km, 5.4);
  assert.equal(candidate.estimated_duration_minutes, 92);
  assert.doesNotThrow(() => validateRouteCandidate(candidate));
});

test("normalizes a candidate-provider RouteCandidate with stop ids", () => {
  const candidate = normalizeRouteCandidate({
    id: "barcelona-provider-arc",
    city: "barcelona",
    route_shape: "arc",
    stop_ids: ["mercat-sant-antoni", "bar-calders", "federal-cafe-parlament"],
    covered_intents: ["food", "bar"],
    area_flow: ["sant-antoni"],
    macro_flow: ["central-grid"],
    source_mix: ["candidate_provider"],
    trust_summary: {
      source_tiers: ["curated", "computed"],
      confidence: "medium",
      human_verified: true,
      freshness: "fresh",
    },
  });

  assert.equal(candidate.route_shape, "arc");
  assert.deepEqual(candidate.stops.map((stop) => stop.candidate_id), [
    "mercat-sant-antoni",
    "bar-calders",
    "federal-cafe-parlament",
  ]);
  assert.ok(candidate.stops.every((stop) => stop.stop_kind === "user_stop"));
  assert.deepEqual(candidate.source_mix, ["candidate_provider"]);
  assert.doesNotThrow(() => validateRouteCandidate(candidate));
});

test("supports fallback RouteCandidates with lower confidence", () => {
  const candidate = normalizeRouteCandidate({
    id: "generic-city-fallback",
    city: "unknown-preview",
    shape: "fallback",
    stops: [{ label: "Nearby center", stop_kind: "route_structure", is_user_facing: false }],
    source_mix: ["fallback"],
    trust_summary: {
      source_tiers: ["fallback"],
      confidence: "needs_review",
      human_verified: false,
      freshness: "unknown",
    },
    confidence: "needs_review",
    warnings: ["insufficient_candidates"],
    limitations: ["no_curated_citypack"],
  });

  assert.equal(candidate.route_shape, "fallback");
  assert.deepEqual(candidate.source_mix, ["fallback"]);
  assert.equal(candidate.confidence, "needs_review");
  assert.equal(candidate.stops[0].is_user_facing, false);
  assert.doesNotThrow(() => validateRouteCandidate(candidate));
});

test("rejects routes with missing city, id, or stops", () => {
  const valid = normalizeRouteCandidate({
    id: "valid-route",
    city: "rome",
    shape: "mini_route",
    stops: ["san-clemente"],
    source_mix: ["candidate_provider"],
    trust_summary: {
      source_tiers: ["computed"],
      confidence: "medium",
      human_verified: false,
      freshness: "fresh",
    },
  });

  assert.throws(() => validateRouteCandidate({ ...valid, id: "" }), /id/);
  assert.throws(() => validateRouteCandidate({ ...valid, city: "" }), /city/);
  assert.throws(() => validateRouteCandidate({ ...valid, stops: [] }), /stops/);
  assert.throws(() => validateRouteCandidate({ ...valid, route_shape: "wander" }), /route_shape/);
});

test("structural candidates are not normal user-facing stops unless marked as route structure", () => {
  const normalized = normalizeRouteCandidate({
    id: "barcelona-anchor-assisted",
    city: "barcelona",
    shape: "arc",
    stops: [
      {
        id: "gracia-route-anchor",
        label: "Gracia",
        candidate_kind: "structural_anchor",
      },
      {
        id: "casa-vicens",
        label: "Casa Vicens",
        candidate_kind: "real_place",
      },
    ],
    source_mix: ["candidate_provider"],
    trust_summary: {
      source_tiers: ["curated"],
      confidence: "medium",
      human_verified: true,
      freshness: "fresh",
    },
  });

  assert.equal(normalized.stops[0].stop_kind, "route_structure");
  assert.equal(normalized.stops[0].is_user_facing, false);
  assert.equal(normalized.stops[1].stop_kind, "user_stop");
  assert.equal(normalized.stops[1].is_user_facing, true);
  assert.doesNotThrow(() => validateRouteCandidate(normalized));

  assert.throws(
    () =>
      validateRouteCandidate({
        ...normalized,
        stops: [
          {
            ...normalized.stops[0],
            stop_kind: "user_stop",
            is_user_facing: true,
          },
        ],
      }),
    /structural candidates must be marked as route_structure/,
  );

  assert.throws(
    () =>
      validateRouteCandidate({
        ...normalized,
        stops: [
          {
            ...normalized.stops[0],
            stop_kind: "user_stop",
            is_user_facing: false,
          },
        ],
      }),
    /structural candidates must be marked as route_structure/,
  );

  assert.throws(
    () =>
      validateRouteCandidate({
        ...normalized,
        stops: [
          {
            ...normalized.stops[0],
            stop_kind: "route_structure",
            is_user_facing: true,
          },
        ],
      }),
    /is_user_facing must be false for structural candidates/,
  );
});
