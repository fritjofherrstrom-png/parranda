const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildCandidateCombination,
  plannerUsableOptionsForRole,
} = require("../server/planner/candidate-combination");

// --- builders (mirror role-selector output shape) --------------------------

function candidate(id, over = {}) {
  return {
    candidate_id: id,
    label: over.label || id,
    type: over.type || "place",
    candidate_kind: "real_place",
    candidate_status: over.candidate_status || "filled",
    planner_usable: over.planner_usable ?? (over.candidate_status !== "fallback"),
    origin: over.origin || "curated_catalog",
    confidence: over.confidence || "high",
    coordinates: "coordinates" in over ? over.coordinates : { lat: over.lat ?? 41.9, lng: over.lng ?? 12.49 },
    also_covers: over.also_covers || [],
    fit_reasons: over.fit_reasons || ["covers:scenic(type:viewpoint)"],
    ...(over.availability ? { availability: over.availability } : {}),
  };
}

function role(name, { slot = "anchor", requested = true, candidates = [] } = {}) {
  const status = candidates.length
    ? candidates.reduce((best, c) => rank(c.candidate_status) > rank(best) ? c.candidate_status : best, "missing")
    : "missing";
  return { role: name, slot, gate: slot === "anchor" ? "may_anchor_route" : "may_influence_routes", requested, status, planner_usable: status === "filled" || status === "partial", candidates };
}
function rank(s) {
  return { missing: 0, fallback: 1, partial: 2, filled: 3 }[s] || 0;
}
function plannerRoles(roles, context = {}) {
  return { city: "test", density: "rich", lens: null, roles, context };
}

// Two compact points (~0.2 km apart) and one far point (~6 km).
const NEAR_A = { lat: 41.9000, lng: 12.4900 };
const NEAR_B = { lat: 41.9010, lng: 12.4912 };
const FAR = { lat: 41.9000, lng: 12.5600 };

// --- 1. compact filled anchors → ready -------------------------------------
test("compact filled anchors produce status ready", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [candidate("v1", { type: "viewpoint", coordinates: NEAR_A })] }),
      role("food_anchor", { candidates: [candidate("r1", { type: "restaurant", coordinates: NEAR_B })] }),
    ]),
  );
  assert.equal(out.status, "ready");
  assert.ok(["strong", "ok"].includes(out.geometry_summary.coherence));
  assert.equal(out.selected.length, 2);
  assert.deepEqual(out.unresolved_roles, []);
});

test("selected-day source hours survive as a bounded fact while malformed values are dropped", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", {
        candidates: [candidate("v1", {
          coordinates: NEAR_A,
          availability: {
            eligible: true,
            selected_day_hours: {
              status: "known",
              all_day: false,
              windows: [{ opens: "10:00", closes: "18:00" }],
              raw_schedule: "Mo 10:00-18:00",
            },
          },
        })],
      }),
      role("food_anchor", {
        candidates: [candidate("r1", {
          coordinates: NEAR_B,
          availability: {
            eligible: true,
            selected_day_hours: {
              status: "known",
              all_day: false,
              windows: [{ opens: "invalid", closes: "18:00" }],
            },
          },
        })],
      }),
    ]),
  );

  const scenic = out.selected.find((entry) => entry.candidate_id === "v1");
  const food = out.selected.find((entry) => entry.candidate_id === "r1");
  assert.deepEqual(scenic.selected_day_hours, {
    status: "known",
    all_day: false,
    windows: [{ opens: "10:00", closes: "18:00" }],
  });
  assert.equal(food.selected_day_hours, undefined);
  assert.equal(JSON.stringify(out).includes("raw_schedule"), false);
});

// --- 2. spread-out → weak_geometry -----------------------------------------
test("both roles filled but far apart produce weak_geometry, not ready", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [candidate("v1", { coordinates: NEAR_A })] }),
      role("food_anchor", { candidates: [candidate("r1", { coordinates: FAR })] }),
    ]),
  );
  assert.equal(out.status, "weak_geometry");
  assert.equal(out.geometry_summary.coherence, "weak");
  assert.ok(out.geometry_summary.max_pairwise_km > 2.5);
  assert.ok(out.quality_flags.includes("weak_geometry"));
});

// --- 3. partial coverage but coherent → partial ----------------------------
test("a missing target role yields partial when the rest is coherent", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [candidate("v1", { coordinates: NEAR_A })] }),
      role("food_anchor", { candidates: [] }), // missing
    ]),
  );
  assert.equal(out.status, "partial");
  assert.equal(out.selected.length, 1);
  assert.deepEqual(out.unresolved_roles, [{ role: "food_anchor", reason: "no_candidate" }]);
});

// --- 4. all target roles missing → insufficient ----------------------------
test("no usable target roles produce insufficient with explicit unresolved roles", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [] }),
      role("food_anchor", { candidates: [] }),
    ]),
  );
  assert.equal(out.status, "insufficient");
  assert.equal(out.selected.length, 0);
  assert.equal(out.unresolved_roles.length, 2);
});

// --- 5. same candidate covers multiple roles → honest ----------------------
test("a single candidate covering two roles is reported, not overstated", () => {
  const rooftop = candidate("rooftop", { type: "rooftop-bar", coordinates: NEAR_A, also_covers: [{ role: "evening_bar_option", status: "filled" }] });
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [rooftop] }),
      role("evening_bar_option", { slot: "option", candidates: [rooftop] }),
    ]),
  );
  assert.ok(out.duplicate_role_coverage.some((d) => d.candidate_id === "rooftop" && d.roles.length === 2));
  assert.ok(out.quality_flags.includes("duplicate_role_coverage"));
});

// --- 6. missing coordinates → incomplete geometry, not ready ---------------
test("a selected candidate without coordinates makes geometry incomplete and blocks ready", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [candidate("v1", { coordinates: NEAR_A })] }),
      role("food_anchor", { candidates: [candidate("r1", { coordinates: null })] }),
    ]),
  );
  assert.equal(out.geometry_summary.coherence, "incomplete");
  assert.notEqual(out.status, "ready");
  assert.ok(out.quality_flags.includes("incomplete_geometry_missing_coordinates"));
});

// --- 7. curated-first tie behavior -----------------------------------------
test("curated wins over a comparable external candidate at the same spot", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", {
        candidates: [
          candidate("ext", { origin: "external_open", coordinates: NEAR_A }),
          candidate("cur", { origin: "curated_catalog", coordinates: NEAR_A }),
        ],
      }),
      role("food_anchor", { candidates: [candidate("r1", { coordinates: NEAR_B })] }),
    ]),
  );
  const scenicPick = out.selected.find((s) => s.role === "scenic_anchor");
  assert.equal(scenicPick.candidate_id, "cur"); // curated-first tie-break
});

// --- 8. proximity chooses a more coherent same-tier candidate --------------
test("within the same status tier, proximity prefers the more coherent candidate", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [candidate("v1", { coordinates: NEAR_A })] }),
      role("food_anchor", {
        candidates: [
          candidate("r-far", { candidate_status: "filled", coordinates: FAR }), // ranked first by reservoir
          candidate("r-near", { candidate_status: "filled", coordinates: NEAR_B }), // closer to scenic
        ],
      }),
    ]),
  );
  const foodPick = out.selected.find((s) => s.role === "food_anchor");
  assert.equal(foodPick.candidate_id, "r-near"); // geometry breaks the same-tier tie
  assert.equal(out.status, "ready");
});

test("within the same safe anchor tier, stronger source trust beats a marginally tighter cluster", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [candidate("v1", { coordinates: NEAR_A })] }),
      role("food_anchor", {
        candidates: [
          candidate("low-near", {
            confidence: "low",
            origin: "external_open",
            coordinates: NEAR_B,
          }),
          candidate("medium-near", {
            confidence: "medium",
            origin: "external_open",
            coordinates: { lat: 41.906, lng: 12.496 },
          }),
        ],
      }),
    ]),
    {},
    { origin: NEAR_A },
  );

  const foodPick = out.selected.find((entry) => entry.role === "food_anchor");
  assert.equal(out.geometry_summary.coherence, "strong");
  assert.equal(out.geometry_summary.origin_reach, "near");
  assert.equal(foodPick.candidate_id, "medium-near");
});

test("proximity never lets a partial candidate beat a filled one (status tier first)", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [candidate("v1", { coordinates: FAR })] }),
      role("food_anchor", {
        candidates: [
          candidate("r-filled-far", { candidate_status: "filled", coordinates: NEAR_A }),
          candidate("r-partial-near", { candidate_status: "partial", coordinates: FAR }),
        ],
      }),
    ]),
  );
  const foodPick = out.selected.find((s) => s.role === "food_anchor");
  assert.equal(foodPick.candidate_id, "r-filled-far"); // filled wins despite worse geometry
});

// --- 9. fallback candidates never make a ready combination ------------------
test("a fallback-only role is unresolved and the combination is not ready", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [candidate("v1", { coordinates: NEAR_A })] }),
      role("food_anchor", { candidates: [candidate("fb", { candidate_status: "fallback", planner_usable: false, coordinates: NEAR_B })] }),
    ]),
  );
  assert.notEqual(out.status, "ready");
  assert.ok(out.unresolved_roles.some((r) => r.role === "food_anchor" && r.reason === "fallback_only"));
  assert.ok(!out.selected.some((s) => s.candidate_id === "fb")); // fallback never selected
  assert.ok(out.quality_flags.includes("fallback_only_food_anchor"));
});

test("a proven-unavailable candidate cannot re-enter the shared planner reservoir", () => {
  const open = candidate("open-local");
  const closed = candidate("closed-local");
  closed.availability = {
    eligible: false,
    status: "closed_for_window",
    reason: "opening_hours_closed_for_query_window",
  };

  assert.deepEqual(
    plannerUsableOptionsForRole(role("food_anchor", { candidates: [closed, open] })).map(
      (entry) => entry.candidate_id,
    ),
    ["open-local"],
  );
});

// --- 10. determinism --------------------------------------------------------
test("same input is deterministic (ids, status, geometry)", () => {
  const input = plannerRoles([
    role("scenic_anchor", { candidates: [candidate("v1", { coordinates: NEAR_A }), candidate("v2", { coordinates: NEAR_B })] }),
    role("food_anchor", { candidates: [candidate("r1", { coordinates: NEAR_B }), candidate("r2", { coordinates: FAR })] }),
  ]);
  const a = buildCandidateCombination(input);
  const b = buildCandidateCombination(input);
  assert.deepEqual(a, b);
});

// --- 11. input immutability -------------------------------------------------
test("the helper does not mutate its inputs", () => {
  const input = plannerRoles([
    role("scenic_anchor", { candidates: [candidate("v1", { coordinates: NEAR_A })] }),
    role("food_anchor", { candidates: [candidate("r1", { coordinates: NEAR_B })] }),
  ]);
  const snapshot = JSON.stringify(input);
  buildCandidateCombination(input);
  assert.equal(JSON.stringify(input), snapshot);
});

// --- additions: single-role + origin distance ------------------------------
test("a single target role is coherent (no spread) and can be ready", () => {
  const out = buildCandidateCombination(
    plannerRoles([role("food_anchor", { requested: true, candidates: [candidate("r1", { coordinates: NEAR_A })] })]),
  );
  // only food_anchor requested → it's the sole target
  const food = out.selected.find((s) => s.role === "food_anchor");
  assert.ok(food);
  assert.equal(out.geometry_summary.max_pairwise_km, 0);
  assert.equal(out.geometry_summary.coherence, "strong");
  assert.ok(out.quality_flags.includes("single_role_combination"));
});

test("origin_distance_km is exposed when an origin is provided", () => {
  const out = buildCandidateCombination(
    plannerRoles(
      [
        role("scenic_anchor", { candidates: [candidate("v1", { coordinates: NEAR_A })] }),
        role("food_anchor", { candidates: [candidate("r1", { coordinates: NEAR_B })] }),
      ],
      { origin: { lat: 41.95, lng: 12.49 } },
    ),
  );
  assert.ok(Number.isFinite(out.geometry_summary.origin_distance_km));
  assert.ok(out.geometry_summary.origin_distance_km > 0);
  assert.ok(["near", "reachable", "extended"].includes(out.geometry_summary.origin_reach));
});

test("an anchored selection prefers the nearby coherent cluster over a tighter remote cluster", () => {
  const origin = { lat: 41.9, lng: 12.49 };
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", {
        candidates: [
          candidate("scenic-remote", { coordinates: { lat: 41.94, lng: 12.54 } }),
          candidate("scenic-near", { coordinates: { lat: 41.902, lng: 12.492 } }),
        ],
      }),
      role("food_anchor", {
        candidates: [
          candidate("food-remote", { coordinates: { lat: 41.9402, lng: 12.5402 } }),
          candidate("food-near", { coordinates: { lat: 41.909, lng: 12.499 } }),
        ],
      }),
    ]),
    {},
    { origin },
  );

  assert.deepEqual(
    out.selected.map((entry) => entry.candidate_id).sort(),
    ["food-near", "scenic-near"],
  );
  assert.equal(out.geometry_summary.origin_reach, "near");
});

test("without an origin, compactness keeps the existing deterministic behavior", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", {
        candidates: [
          candidate("scenic-remote", { coordinates: { lat: 41.94, lng: 12.54 } }),
          candidate("scenic-near", { coordinates: { lat: 41.902, lng: 12.492 } }),
        ],
      }),
      role("food_anchor", {
        candidates: [
          candidate("food-remote", { coordinates: { lat: 41.9402, lng: 12.5402 } }),
          candidate("food-near", { coordinates: { lat: 41.909, lng: 12.499 } }),
        ],
      }),
    ]),
  );
  assert.deepEqual(
    out.selected.map((entry) => entry.candidate_id).sort(),
    ["food-remote", "scenic-remote"],
  );
  assert.equal("origin_reach" in out.geometry_summary, false);
});

test("an explicit origin reach ceiling selects a reachable cluster over a remote compact cluster", () => {
  const origin = { lat: 41.9, lng: 12.49 };
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", {
        candidates: [
          candidate("scenic-remote", { coordinates: { lat: 41.95, lng: 12.55 } }),
          candidate("scenic-reachable", { coordinates: { lat: 41.91, lng: 12.5 } }),
        ],
      }),
      role("food_anchor", {
        candidates: [
          candidate("food-remote", { coordinates: { lat: 41.9502, lng: 12.5502 } }),
          candidate("food-reachable", { coordinates: { lat: 41.911, lng: 12.501 } }),
        ],
      }),
    ]),
    {},
    { origin, maxOriginDistanceKm: 3 },
  );

  assert.deepEqual(out.selected.map((entry) => entry.candidate_id).sort(), [
    "food-reachable",
    "scenic-reachable",
  ]);
  assert.notEqual(out.geometry_summary.origin_reach, "extended");
});

test("an explicit origin reach ceiling fails honestly when every coherent cluster is remote", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [candidate("scenic-remote", { coordinates: { lat: 41.95, lng: 12.55 } })] }),
      role("food_anchor", { candidates: [candidate("food-remote", { coordinates: { lat: 41.951, lng: 12.551 } })] }),
    ]),
    {},
    { origin: { lat: 41.9, lng: 12.49 }, maxOriginDistanceKm: 3 },
  );

  assert.equal(out.status, "insufficient");
  assert.deepEqual(out.selected, []);
  assert.ok(out.reasons.includes("no_combination_within_origin_reach"));
  assert.ok(out.unresolved_roles.every((entry) => entry.reason === "outside_origin_reach"));
});

test("an exact-origin ceiling checks the farthest selected stop, not only the cluster centroid", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", {
        candidates: [candidate("scenic-near", { coordinates: { lat: 41.9135, lng: 12.49 } })],
      }),
      role("food_anchor", {
        candidates: [candidate("food-too-far", { coordinates: { lat: 41.935, lng: 12.49 } })],
      }),
    ]),
    {},
    { origin: { lat: 41.9, lng: 12.49 }, maxOriginDistanceKm: 3 },
  );

  assert.equal(out.status, "insufficient");
  assert.ok(out.reasons.includes("no_combination_within_origin_reach"));
});

// --- regression: requested roles must never be silently dropped by the cap --
test("six requested roles all surface — none are silently dropped by the role cap", () => {
  const roles = [
    role("scenic_anchor", { candidates: [candidate("v", { coordinates: NEAR_A })] }),
    role("food_anchor", { candidates: [candidate("r", { coordinates: NEAR_B })] }),
    role("coffee_fika_stop", { slot: "stop", candidates: [candidate("c", { coordinates: NEAR_A })] }),
    role("evening_bar_option", { slot: "option", candidates: [candidate("b", { coordinates: NEAR_B })] }),
    role("swimming_coast_option", { slot: "option", candidates: [candidate("s", { coordinates: NEAR_A })] }),
    role("vintage_second_hand_option", { slot: "option", candidates: [candidate("vt", { coordinates: NEAR_B })] }),
  ];
  const out = buildCandidateCombination(plannerRoles(roles));
  assert.equal(out.selected.length, 6, "all six requested roles should be present");
  assert.deepEqual(out.unresolved_roles, [], "nothing should be silently capped out");
});

test("capped-out requested roles become explicit unresolved and the result is not ready", () => {
  // force the cap below the requested role count
  const roles = [
    role("scenic_anchor", { candidates: [candidate("v", { coordinates: NEAR_A })] }),
    role("food_anchor", { candidates: [candidate("r", { coordinates: NEAR_B })] }),
    role("coffee_fika_stop", { slot: "stop", candidates: [candidate("c", { coordinates: NEAR_A })] }),
  ];
  const out = buildCandidateCombination(plannerRoles(roles), {}, { maxTargetRoles: 2 });
  // capped-out role surfaces honestly
  const cappedNames = out.unresolved_roles
    .filter((r) => r.reason === "capped_out")
    .map((r) => r.role);
  assert.deepEqual(cappedNames, ["coffee_fika_stop"]);
  // …and the result cannot be `ready` while requested roles are unresolved
  assert.notEqual(out.status, "ready");
  assert.ok(out.quality_flags.includes("capped_out_coffee_fika_stop"));
});

// --- regression: deterministic candidate-id tie-break -----------------------
test("final tie-break is candidate-id, not caller order", () => {
  // Two food candidates with IDENTICAL coords, status, origin, confidence —
  // every score dimension ties. Reverse caller order and assert the same id wins.
  const scenic = role("scenic_anchor", { candidates: [candidate("v", { coordinates: NEAR_A })] });
  const a = candidate("alpha", { coordinates: NEAR_B });
  const b = candidate("beta", { coordinates: NEAR_B });
  const out1 = buildCandidateCombination(plannerRoles([scenic, role("food_anchor", { candidates: [a, b] })]));
  const out2 = buildCandidateCombination(plannerRoles([scenic, role("food_anchor", { candidates: [b, a] })]));
  const food1 = out1.selected.find((s) => s.role === "food_anchor").candidate_id;
  const food2 = out2.selected.find((s) => s.role === "food_anchor").candidate_id;
  assert.equal(food1, food2, "caller order must not change the selected id");
  assert.equal(food1, "alpha", "lexicographically smaller id should win the tie");
});

test("the result is never labeled a route / day plan (framing guard)", () => {
  const out = buildCandidateCombination(
    plannerRoles([
      role("scenic_anchor", { candidates: [candidate("v1", { coordinates: NEAR_A })] }),
      role("food_anchor", { candidates: [candidate("r1", { coordinates: NEAR_B })] }),
    ]),
  );
  const keys = Object.keys(out);
  for (const forbidden of ["route", "day_plan", "itinerary", "main_stops", "sequence"]) {
    assert.ok(!keys.includes(forbidden), `must not expose ${forbidden}`);
  }
});
