const assert = require("node:assert/strict");
const test = require("node:test");

const { createEvidence } = require("../server/candidates/evidence");
const { reduceEvidence } = require("../server/candidates/evidence-reducer");
const {
  evaluateCandidateGates,
  targetFromPlaceCandidate,
  targetFromContextSignal,
} = require("../server/candidates/gates");

const NOW = "2026-06-03";

function gatesFor({ target, evidence }) {
  const derived = reduceEvidence(evidence, { now: NOW });
  return { derived, gates: evaluateCandidateGates({ target, derived }) };
}

function existence(family, tier, overrides = {}) {
  return createEvidence({
    claim_type: "existence",
    value: true,
    provider_id: `${family}-p`,
    source_family: family,
    source_tier: tier,
    observed_at: NOW,
    freshness: "fresh",
    ...overrides,
  });
}

test("a curated, human-verified place with coordinates can anchor a route", () => {
  const { gates } = gatesFor({
    target: { label: "Mercato", lat: 41.9, lng: 12.5, human_verified: true, known_place_id: "x" },
    evidence: [existence("catalog", "curated", { weight: 1 })],
  });
  assert.equal(gates.may_show, true);
  assert.equal(gates.may_show_as_nearby, true);
  assert.equal(gates.may_influence_routes, true);
  assert.equal(gates.may_create_place_candidate, true);
  assert.equal(gates.may_anchor_route, true);
  assert.equal(gates.may_show_in_debug_only, false);
});

test("INVARIANT: popularity-only single-family candidate may show but never promotes", () => {
  // High rating + huge review volume, but only ONE weak family and no human
  // verification → exists "low", diversity 1. This is the anti-Tripadvisor lock.
  const { derived, gates } = gatesFor({
    target: { label: "Trendy Spot", lat: 41.4, lng: 2.1, human_verified: false },
    evidence: [
      existence("map", "inferred"),
      createEvidence({ claim_type: "sentiment", value: 4.9, provider_id: "m", source_family: "map" }),
      createEvidence({ claim_type: "popularity", value: 9000, provider_id: "m", source_family: "map" }),
    ],
  });
  assert.equal(derived.consensus.sentiment_band, "strong");
  assert.equal(gates.may_show, true); // can appear
  assert.equal(gates.may_anchor_route, false); // cannot anchor
  assert.equal(gates.may_create_place_candidate, false); // cannot materialize
  assert.equal(gates.may_influence_routes, false); // cannot steer routes
});

test("cross-family corroboration unlocks route influence without human verification", () => {
  const { gates } = gatesFor({
    target: { label: "Corroborated Cafe", lat: 41.4, lng: 2.1, human_verified: false },
    evidence: [existence("official", "official"), existence("map", "inferred")],
  });
  // diversity 2 + medium+ existence → may influence/create, but anchor needs high.
  assert.equal(gates.may_influence_routes, true);
  assert.equal(gates.may_create_place_candidate, true);
});

test("an official source under the exact reviewed-profile policy can route without pretending place verification", () => {
  const { gates } = gatesFor({
    target: {
      label: "Official local museum",
      lat: 55.5,
      lng: 13.5,
      human_verified: false,
      operator_reviewed_source: true,
      source_family: "official",
      source_tier: "official",
      source_policy: "reviewed_profile_bounded_refresh",
    },
    evidence: [existence("official", "official")],
  });
  assert.equal(gates.may_influence_routes, true);
  assert.equal(gates.may_create_place_candidate, true);
  assert.ok(gates.reasons.includes("operator_reviewed_official_source"));
  assert.equal(gates.reasons.includes("human_verified"), false);
});

test("editorial, client-shaped or wrong-policy review flags cannot self-promote", () => {
  for (const target of [
    { source_family: "editorial", source_tier: "editorial", source_policy: "reviewed_profile_bounded_refresh" },
    { source_family: "official", source_tier: "official", source_policy: "open_data_attribution_required" },
    { source_family: "official", source_tier: "editorial", source_policy: "reviewed_profile_bounded_refresh" },
  ]) {
    const { gates } = gatesFor({
      target: {
        label: "Untrusted promotion",
        lat: 55.5,
        lng: 13.5,
        human_verified: false,
        operator_reviewed_source: true,
        ...target,
      },
      evidence: [existence(target.source_family, target.source_tier)],
    });
    assert.equal(gates.may_influence_routes, false);
    assert.equal(gates.may_create_place_candidate, false);
  }
});

test("source-url-only event (no coordinates / no known place) is not a place target", () => {
  // Title + a source URL, but nothing locatable. Reducer may even believe it
  // exists, but with no reliable place target it cannot become a place/route.
  const { gates } = gatesFor({
    target: { label: "Concert tonight", human_verified: false }, // no lat/lng, no known_place_id
    evidence: [existence("live", "official"), existence("official", "official")],
  });
  assert.equal(gates.may_show, true);
  assert.equal(gates.may_show_as_nearby, false);
  assert.equal(gates.may_create_place_candidate, false);
  assert.equal(gates.may_anchor_route, false);
  assert.ok(gates.reasons.includes("no_reliable_place_target"));
});

test("weak candidate (no evidence) stays inspectable but hidden", () => {
  const { gates } = gatesFor({
    target: { label: "Unknown blob", lat: 1, lng: 1 },
    evidence: [],
  });
  assert.equal(gates.may_show, false);
  assert.equal(gates.may_show_in_debug_only, true);
});

test("context/weather-like signal can show but structurally cannot become a place", () => {
  const gates = evaluateCandidateGates({
    target: targetFromContextSignal({ title: "Rain clears by 16:00" }),
    derived: reduceEvidence([], { now: NOW }),
  });
  assert.equal(gates.may_show, true); // weather may explain
  assert.equal(gates.may_create_place_candidate, false);
  assert.equal(gates.may_anchor_route, false);
  assert.equal(gates.may_influence_routes, false);
  assert.equal(gates.may_show_as_nearby, false);
  assert.ok(gates.reasons.includes("context_not_a_place"));
});

test("gates are pure and do not mutate inputs", () => {
  const target = { label: "X", lat: 1, lng: 1, human_verified: true };
  const derived = reduceEvidence([existence("catalog", "curated")], { now: NOW });
  const a = evaluateCandidateGates({ target, derived });
  const b = evaluateCandidateGates({ target, derived });
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(target), ["label", "lat", "lng", "human_verified"]);
});

test("targetFromPlaceCandidate carries coordinates + human_verified through", () => {
  const target = targetFromPlaceCandidate({
    id: "rome-pantheon",
    label: "Pantheon",
    lat: 41.8986,
    lng: 12.4769,
    trust: { human_verified: true },
  });
  assert.equal(target.label, "Pantheon");
  assert.equal(target.lat, 41.8986);
  assert.equal(target.human_verified, true);
  assert.equal(target.is_context, false);
});

test("a draft/source-backed candidate with an id but no coordinates is NOT a reliable place target", () => {
  // id present, but not a verified catalog place and no coordinates → its id
  // must not count as a known place. This protects future draft/url candidates.
  const target = targetFromPlaceCandidate({
    id: "osm-node-12345",
    label: "Some cafe from OSM",
    trust: { human_verified: false },
    city_pack_owned: false,
  });
  assert.equal(target.known_place_id, "");

  const { gates } = gatesFor({
    target,
    evidence: [existence("map", "inferred"), existence("community", "inferred")],
  });
  assert.equal(gates.may_show, true);
  assert.equal(gates.may_create_place_candidate, false);
  assert.equal(gates.may_anchor_route, false);
  assert.ok(gates.reasons.includes("no_reliable_place_target"));
});

test("a verified catalog candidate's id counts as a known place target", () => {
  const target = targetFromPlaceCandidate({
    id: "rome-pantheon",
    label: "Pantheon",
    candidate_kind: "real_place",
    trust: { human_verified: true },
    city_pack_owned: true,
  });
  assert.equal(target.known_place_id, "rome-pantheon");

  const { gates } = gatesFor({
    target,
    evidence: [existence("catalog", "curated")],
  });
  // no coordinates, but a verified catalog id makes it a reliable target.
  assert.equal(gates.may_create_place_candidate, true);
  assert.equal(gates.may_anchor_route, true);
});

test("structural_anchor is route structure, not a user place", () => {
  const target = targetFromPlaceCandidate({
    id: "rome-trastevere",
    label: "Trastevere",
    candidate_kind: "structural_anchor",
    lat: 41.889,
    lng: 12.469,
    trust: { human_verified: true },
    city_pack_owned: true,
    is_structural: true,
  });
  assert.equal(target.is_structural, true);

  const { gates } = gatesFor({ target, evidence: [existence("catalog", "curated")] });
  // never offered to a user as a place / nearby / now move
  assert.equal(gates.may_create_place_candidate, false);
  assert.equal(gates.may_show_as_nearby, false);
  assert.equal(gates.may_suggest_now, false);
  // but a trusted structural_anchor may still carry/anchor route structure
  assert.equal(gates.may_anchor_route, true);
  assert.equal(gates.may_influence_routes, true);
  assert.ok(gates.reasons.includes("structural_route_only"));
});

test("area_preset structural candidates also cannot become user places", () => {
  const target = targetFromPlaceCandidate({
    id: "rome-centro",
    label: "Centro Storico",
    candidate_kind: "area_preset",
    lat: 41.9,
    lng: 12.48,
    trust: { human_verified: true },
    city_pack_owned: true,
  });
  assert.equal(target.is_structural, true);
  const { gates } = gatesFor({ target, evidence: [existence("catalog", "curated")] });
  assert.equal(gates.may_create_place_candidate, false);
  assert.equal(gates.may_show_as_nearby, false);
  assert.equal(gates.may_suggest_now, false);
});
