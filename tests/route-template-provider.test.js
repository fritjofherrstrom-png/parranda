const assert = require("node:assert/strict");
const test = require("node:test");

const rome = require("../server/cities/rome");
const barcelona = require("../server/cities/barcelona");
const {
  RouteTemplateProvider,
  buildRouteTemplateCandidates,
} = require("../server/route-candidates/route-template-provider");
const { validateRouteCandidate } = require("../server/route-candidates/contract");

test("RouteTemplateProvider converts Barcelona route templates into RouteCandidates", () => {
  const candidates = buildRouteTemplateCandidates(barcelona);

  assert.equal(candidates.length, barcelona.catalog.routeTemplates.length);
  assert.equal(candidates.length, 7);

  for (const candidate of candidates) {
    assert.doesNotThrow(() => validateRouteCandidate(candidate));
    assert.equal(candidate.city, "barcelona");
    assert.deepEqual(candidate.source_mix, ["curated_template"]);
    assert.deepEqual(candidate.trust_summary.source_tiers, ["curated"]);
    assert.equal(candidate.trust_summary.human_verified, true);
    assert.equal(candidate.confidence, "high");
    assert.equal(candidate.warnings.length, 0);
    assert.ok(candidate.stops.length >= 4);
    assert.ok(candidate.stops.every((stop) => stop.candidate_id));
  }

  const coast = candidates.find((candidate) => candidate.id === "encants-to-coast-drift");
  assert.ok(coast);
  assert.equal(coast.route_shape, "arc");
  assert.deepEqual(coast.source_mix, ["curated_template"]);
  assert.ok(coast.covered_intents.includes("coast"));
  assert.ok(coast.area_flow.includes("poblenou"));
  assert.ok(coast.macro_flow.includes("coast-east"));
  assert.equal(coast.stops.filter((stop) => stop.is_user_facing).length, 5);
  assert.equal(coast.stops.filter((stop) => stop.stop_kind === "route_structure").length, 0);
});

test("RouteTemplateProvider converts Rome route templates and marks area presets as route structure", () => {
  const provider = new RouteTemplateProvider(rome);
  const candidates = provider.listCandidates();

  assert.equal(candidates.length, rome.catalog.routeTemplates.length);
  assert.ok(candidates.length >= 35);

  const classic = candidates.find((candidate) => candidate.id === "classic-loop");
  assert.ok(classic);
  assert.equal(classic.route_shape, "loop");
  assert.deepEqual(classic.source_mix, ["curated_template"]);
  assert.equal(classic.estimated_walking_km, 10);
  assert.ok(classic.covered_intents.includes("kultur"));
  assert.ok(classic.covered_intents.includes("vin"));

  const structuralStops = classic.stops.filter((stop) => stop.stop_kind === "route_structure");
  const userStops = classic.stops.filter((stop) => stop.is_user_facing);
  assert.ok(structuralStops.length >= 1);
  assert.ok(userStops.length >= 1);
  assert.ok(
    structuralStops.every(
      (stop) =>
        ["structural_anchor", "area_preset"].includes(stop.candidate_kind) &&
        stop.is_user_facing === false,
    ),
  );
  assert.ok(userStops.every((stop) => stop.stop_kind === "user_stop"));
  assert.doesNotThrow(() => validateRouteCandidate(classic));
});

test("RouteTemplateProvider reports unresolved template stops as warnings instead of crashing", () => {
  const cityConfig = {
    key: "diagnostic-city",
    label: "Diagnostic City",
    catalog: {
      allItems: [
        {
          id: "known-place",
          name: "Known Place",
          kind: "cafe",
          lat: 41.1,
          lng: 12.1,
          area: "center",
          tags: ["mat"],
          searchTerms: ["known place"],
        },
      ],
      routeTemplates: [
        {
          id: "broken-template",
          title: "Broken template",
          stops: ["known-place", "missing-place"],
          defaultKm: 2,
          preferenceTags: ["mat"],
        },
      ],
    },
    routing: {
      areaDefinitions: {
        center: { label: "Center", macro: "center" },
      },
    },
  };

  const [candidate] = buildRouteTemplateCandidates(cityConfig);

  assert.equal(candidate.id, "broken-template");
  assert.equal(candidate.confidence, "medium");
  assert.deepEqual(candidate.warnings, ["unresolved_template_stops:missing-place"]);
  assert.equal(candidate.stops.length, 2);
  assert.equal(candidate.stops[1].candidate_id, "missing-place");
  assert.equal(candidate.stops[1].label, "missing-place");
  assert.equal(candidate.stops[1].is_user_facing, true);
  assert.doesNotThrow(() => validateRouteCandidate(candidate));
});

test("RouteTemplateProvider requires a city config", () => {
  assert.throws(() => new RouteTemplateProvider(null), /requires a city config/);
});
