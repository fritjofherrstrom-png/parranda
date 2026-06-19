const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mapAdmittedSelectionToSourceCandidates,
} = require("../server/planner/agnostic-engine-compose");

// A rich planner-role candidate, shaped like formatRoleCandidate() output:
// carries type + provenance(attribution/source_tier/human_verified) that the
// lossy combination `selected[]` (formatSelected) drops.
function richCandidate(overrides = {}) {
  return {
    candidate_id: "osm-node-1",
    label: "Harbour Café",
    type: "cafe",
    candidate_kind: "draft_place",
    confidence: "needs_review",
    coordinates: { lat: 43.51, lng: 16.44 },
    provenance: {
      provider_id: "overpass",
      source_family: "openstreetmap",
      source_tier: "inferred",
      human_verified: false,
      attribution: [{ provider_id: "overpass", label: "OpenStreetMap", url: "https://osm.org/node/1" }],
      corroborated_by_external: false,
    },
    ...overrides,
  };
}

// A combination `selected[]` pick, shaped like formatSelected() output: role +
// id + coordinates, but NO type/provenance.
function selectedPick(overrides = {}) {
  return {
    role: "coffee_start",
    candidate_id: "osm-node-1",
    label: "Harbour Café",
    confidence: "needs_review",
    coordinates: { lat: 43.51, lng: 16.44 },
    ...overrides,
  };
}

function plannerRoles(candidatesByRole) {
  return {
    city: "agnostic-engine-area",
    roles: Object.entries(candidatesByRole).map(([role, candidates]) => ({ role, candidates })),
  };
}

test("joins selected picks back to rich candidates to recover source backing", () => {
  const rich = richCandidate();
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({ coffee_start: [rich] }),
    city: "agnostic-engine-area",
  });

  assert.equal(result.length, 1);
  const c = result[0];
  assert.equal(c.id, "osm-node-1");
  assert.equal(c.city, "agnostic-engine-area");
  // type + source attribution recovered from the rich candidate (NOT present on the pick)
  assert.equal(c.type, "cafe");
  assert.equal(c.source.label, "OpenStreetMap");
  assert.equal(c.source.url, "https://osm.org/node/1");
  assert.deepEqual(c.route_roles, ["coffee_start"]);
  assert.equal(c.lat, 43.51);
  assert.equal(c.lng, 16.44);
});

test("reconstructs honest LOW trust — never curated or human-verified", () => {
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({ coffee_start: [richCandidate()] }),
  });
  const c = result[0];
  assert.equal(c.candidate_kind, "draft_place");
  assert.equal(c.city_pack_owned, false);
  assert.equal(c.trust.human_verified, false);
  assert.equal(c.trust.source_tier, "inferred");
  assert.equal(c.trust.confidence, "needs_review");
  assert.equal(c.is_structural, false);
});

test("a human-verified rich candidate still maps faithfully (does not lie either way)", () => {
  const rich = richCandidate({
    provenance: { ...richCandidate().provenance, human_verified: true, source_tier: "verified" },
  });
  const c = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({ coffee_start: [rich] }),
  })[0];
  assert.equal(c.trust.human_verified, true);
  assert.equal(c.trust.source_tier, "verified");
});

test("a pick with no coordinates (and no rich coords) is dropped — a stop must have a location", () => {
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick({ coordinates: null })],
    plannerRoles: plannerRoles({ coffee_start: [richCandidate({ coordinates: null })] }),
  });
  assert.deepEqual(result, []);
});

test("falls back to bare-id join when the role does not match", () => {
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick({ role: "mismatched_role" })],
    plannerRoles: plannerRoles({ coffee_start: [richCandidate()] }),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "cafe", "still recovered the rich type via bare-id fallback");
});

test("missing rich source still yields a usable, honest candidate from the pick alone", () => {
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick()],
    plannerRoles: plannerRoles({}), // no rich candidates to join
  });
  assert.equal(result.length, 1);
  const c = result[0];
  assert.equal(c.id, "osm-node-1");
  assert.equal(c.type, "place"); // honest default, not invented
  assert.equal(c.trust.source_tier, "inferred");
  assert.equal(c.source.label, "open data");
});

test("duplicate selected ids are collapsed", () => {
  const result = mapAdmittedSelectionToSourceCandidates({
    selected: [selectedPick(), selectedPick({ role: "scenic_anchor" })],
    plannerRoles: plannerRoles({ coffee_start: [richCandidate()] }),
  });
  assert.equal(result.length, 1);
});

test("empty / malformed input returns an empty list, never throws", () => {
  assert.deepEqual(mapAdmittedSelectionToSourceCandidates({}), []);
  assert.deepEqual(mapAdmittedSelectionToSourceCandidates({ selected: null, plannerRoles: null }), []);
  assert.deepEqual(mapAdmittedSelectionToSourceCandidates({ selected: [{}], plannerRoles: {} }), []);
});
