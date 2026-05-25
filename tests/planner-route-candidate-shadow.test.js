const assert = require("node:assert/strict");
const test = require("node:test");

const barcelona = require("../server/cities/barcelona");
const rome = require("../server/cities/rome");
const { generateRecommendations, getRouteLineage } = require("../server/route-engine");
const {
  buildPlannerRouteCandidateShadowDiagnostics,
  comparePlannerRouteToRouteCandidate,
} = require("../server/planner/route-candidate-shadow");
const { buildRouteTemplateCandidates } = require("../server/route-candidates/route-template-provider");

const originalFetch = global.fetch;

function createWeatherFetch() {
  return async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname !== "api.open-meteo.com") {
      throw new Error(`Unexpected fetch in shadow Planner test: ${parsed.hostname}`);
    }

    return {
      ok: true,
      async json() {
        return {
          daily: {
            time: ["2026-05-14"],
            weathercode: [0],
            temperature_2m_max: [24],
          },
        };
      },
    };
  };
}

function plannerRouteFromTemplate(cityConfig, templateId) {
  const template = cityConfig.catalog.routeTemplates.find((entry) => entry.id === templateId);
  assert.ok(template, `expected template ${templateId}`);

  const itemsById = new Map(cityConfig.catalog.allItems.map((item) => [item.id, item]));
  const mainStops = template.stops
    .map((stopId) => itemsById.get(stopId))
    .filter((item) => item && !["district", "district-group"].includes(item.kind))
    .map((item) => ({
      id: item.id,
      label: item.name,
      area: item.area,
      lat: item.lat,
      lng: item.lng,
      tags: item.tags || [],
    }));

  return {
    id: template.id,
    title: template.title || template.id,
    main_stops: mainStops,
  };
}

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("shadow diagnostics match a Planner route/template with a RouteCandidate", () => {
  const plannerResult = {
    city: "barcelona",
    days: [
      {
        date: "2026-05-14",
        primary_route: plannerRouteFromTemplate(barcelona, "gracia-local-evening-loop"),
      },
    ],
  };

  const diagnostics = buildPlannerRouteCandidateShadowDiagnostics({
    cityConfig: barcelona,
    plannerResult,
  });

  assert.equal(diagnostics.city, "barcelona");
  assert.equal(diagnostics.route_candidate_count, 8);
  assert.equal(diagnostics.days.length, 1);

  const primary = diagnostics.days[0].primary_route;
  assert.equal(primary.selected_route_id, "gracia-local-evening-loop");
  assert.equal(primary.source_template_id, "gracia-local-evening-loop");
  assert.equal(primary.realized_route_id, null);
  assert.equal(primary.template_match_status, "exact");
  assert.equal(primary.matching_route_candidate_id, "gracia-local-evening-loop");
  assert.equal(primary.planner_stop_count, 4);
  assert.equal(primary.route_candidate_user_facing_stop_count, 4);
  assert.equal(primary.route_candidate_structural_stop_count, 0);
  assert.equal(primary.stop_count_parity, true);
  assert.equal(primary.user_facing_stop_ids_match, true);
  assert.equal(primary.user_facing_stop_id_set_match, true);
  assert.deepEqual(primary.missing_from_planner, []);
  assert.deepEqual(primary.extra_in_planner, []);
  assert.deepEqual(primary.missing_template_stops, []);
  assert.deepEqual(primary.extra_realized_stops, []);
  assert.deepEqual(primary.unresolved_stops, []);
  assert.deepEqual(primary.mismatch_reasons, []);
  assert.equal(primary.readiness, "ready");
});

test("shadow diagnostics keep structural route-template stops non-user-facing", () => {
  const plannerResult = {
    city: "rome",
    days: [
      {
        date: "2026-05-14",
        primary_route: plannerRouteFromTemplate(rome, "classic-loop"),
      },
    ],
  };

  const diagnostics = buildPlannerRouteCandidateShadowDiagnostics({
    cityConfig: rome,
    plannerResult,
  });
  const primary = diagnostics.days[0].primary_route;

  assert.equal(primary.selected_route_id, "classic-loop");
  assert.equal(primary.source_template_id, "classic-loop");
  assert.equal(primary.template_match_status, "exact");
  assert.equal(primary.matching_route_candidate_id, "classic-loop");
  assert.equal(primary.planner_stop_count, 2);
  assert.equal(primary.route_candidate_stop_count, 6);
  assert.equal(primary.route_candidate_user_facing_stop_count, 2);
  assert.equal(primary.route_candidate_structural_stop_count, 4);
  assert.deepEqual(primary.route_candidate_user_facing_stop_ids, ["san-clemente", "colosseum"]);
  assert.deepEqual(primary.missing_from_planner, []);
  assert.deepEqual(primary.extra_in_planner, []);
  assert.equal(primary.stop_count_parity, true);
  assert.equal(primary.user_facing_stop_ids_match, true);
  assert.equal(primary.user_facing_stop_id_set_match, true);
  assert.equal(primary.readiness, "ready");
});

test("shadow diagnostics name RouteCandidate stops missing from Planner output", () => {
  const routeCandidateById = new Map(
    buildRouteTemplateCandidates(barcelona).map((candidate) => [candidate.id, candidate]),
  );

  const diagnostics = comparePlannerRouteToRouteCandidate(
    {
      id: "gracia-local-evening-loop",
      main_stops: [
        { id: "casa-vicens", label: "Casa Vicens" },
        { id: "cines-verdi", label: "Cines Verdi" },
        { id: "placa-del-sol", label: "Placa del Sol" },
      ],
    },
    routeCandidateById,
  );

  assert.equal(diagnostics.stop_count_parity, false);
  assert.equal(diagnostics.user_facing_stop_ids_match, false);
  assert.equal(diagnostics.user_facing_stop_id_set_match, false);
  assert.deepEqual(diagnostics.missing_from_planner, ["bodega-quimet"]);
  assert.deepEqual(diagnostics.missing_template_stops, ["bodega-quimet"]);
  assert.deepEqual(diagnostics.extra_in_planner, []);
  assert.deepEqual(diagnostics.extra_realized_stops, []);
  assert.equal(diagnostics.template_match_status, "realized_variant");
  assert.deepEqual(diagnostics.mismatch_reasons, [
    "stop_count_mismatch:planner=3:route_candidate_user_facing=4",
    "missing_template_stops:bodega-quimet",
  ]);
  assert.equal(diagnostics.readiness, "ready_with_warnings");
});

test("shadow diagnostics name extra Planner stops", () => {
  const routeCandidateById = new Map(
    buildRouteTemplateCandidates(barcelona).map((candidate) => [candidate.id, candidate]),
  );

  const diagnostics = comparePlannerRouteToRouteCandidate(
    {
      id: "gracia-local-evening-loop",
      main_stops: [
        { id: "casa-vicens", label: "Casa Vicens" },
        { id: "cines-verdi", label: "Cines Verdi" },
        { id: "placa-del-sol", label: "Placa del Sol" },
        { id: "bodega-quimet", label: "Bodega Quimet" },
        { id: "bar-calders", label: "Bar Calders" },
      ],
    },
    routeCandidateById,
  );

  assert.equal(diagnostics.stop_count_parity, false);
  assert.equal(diagnostics.user_facing_stop_ids_match, false);
  assert.equal(diagnostics.user_facing_stop_id_set_match, false);
  assert.deepEqual(diagnostics.missing_from_planner, []);
  assert.deepEqual(diagnostics.missing_template_stops, []);
  assert.deepEqual(diagnostics.extra_in_planner, ["bar-calders"]);
  assert.deepEqual(diagnostics.extra_realized_stops, ["bar-calders"]);
  assert.equal(diagnostics.template_match_status, "realized_variant");
  assert.deepEqual(diagnostics.mismatch_reasons, [
    "stop_count_mismatch:planner=5:route_candidate_user_facing=4",
    "extra_realized_stops:bar-calders",
  ]);
  assert.equal(diagnostics.readiness, "ready_with_warnings");
});

test("shadow diagnostics distinguish order differences from missing stops", () => {
  const routeCandidateById = new Map(
    buildRouteTemplateCandidates(barcelona).map((candidate) => [candidate.id, candidate]),
  );

  const diagnostics = comparePlannerRouteToRouteCandidate(
    {
      id: "gracia-local-evening-loop",
      main_stops: [
        { id: "cines-verdi", label: "Cines Verdi" },
        { id: "casa-vicens", label: "Casa Vicens" },
        { id: "placa-del-sol", label: "Placa del Sol" },
        { id: "bodega-quimet", label: "Bodega Quimet" },
      ],
    },
    routeCandidateById,
  );

  assert.equal(diagnostics.stop_count_parity, true);
  assert.equal(diagnostics.user_facing_stop_ids_match, false);
  assert.equal(diagnostics.user_facing_stop_id_set_match, true);
  assert.deepEqual(diagnostics.missing_from_planner, []);
  assert.deepEqual(diagnostics.extra_in_planner, []);
  assert.deepEqual(diagnostics.missing_template_stops, []);
  assert.deepEqual(diagnostics.extra_realized_stops, []);
  assert.equal(diagnostics.template_match_status, "reordered");
  assert.deepEqual(diagnostics.mismatch_reasons, ["user_facing_stop_ids_differ"]);
  assert.equal(diagnostics.readiness, "ready_with_warnings");
});

test("shadow diagnostics report mismatches without throwing", () => {
  const routeCandidateById = new Map(
    buildRouteTemplateCandidates(barcelona).map((candidate) => [candidate.id, candidate]),
  );

  const diagnostics = comparePlannerRouteToRouteCandidate(
    {
      id: "unknown-template",
      main_stops: [{ id: "casa-vicens", label: "Casa Vicens" }],
    },
    routeCandidateById,
  );

  assert.equal(diagnostics.selected_route_id, "unknown-template");
  assert.equal(diagnostics.source_template_id, "unknown-template");
  assert.equal(diagnostics.template_match_status, "generated_or_unknown");
  assert.equal(diagnostics.matching_route_candidate_id, null);
  assert.equal(diagnostics.planner_stop_count, 1);
  assert.equal(diagnostics.route_candidate_stop_count, 0);
  assert.equal(diagnostics.stop_count_parity, false);
  assert.deepEqual(diagnostics.missing_from_planner, []);
  assert.deepEqual(diagnostics.extra_in_planner, ["casa-vicens"]);
  assert.deepEqual(diagnostics.missing_template_stops, []);
  assert.deepEqual(diagnostics.extra_realized_stops, ["casa-vicens"]);
  assert.deepEqual(diagnostics.mismatch_reasons, ["no_matching_route_candidate"]);
  assert.equal(diagnostics.readiness, "needs_review");
});

test("shadow diagnostics can inspect real Planner output without mutating it", async () => {
  global.fetch = createWeatherFetch();

  const plannerResult = await generateRecommendations({
    city: "barcelona",
    dates: ["2026-05-14"],
    walkingKmTarget: 8,
    preferences: ["mat", "kultur"],
    legPacing: "balanced",
    distanceMode: "soft_target",
    budgetTier: "standard",
    lang: "en",
  });
  const before = structuredClone(plannerResult);

  const diagnostics = buildPlannerRouteCandidateShadowDiagnostics({
    cityConfig: barcelona,
    plannerResult,
    includeAlternatives: true,
  });
  const primaryDiagnostics = diagnostics.days[0].primary_route;
  const primaryRoute = plannerResult.days[0].primary_route;
  const routeLineage = getRouteLineage(primaryRoute);

  assert.deepEqual(plannerResult, before, "shadow diagnostics must not mutate Planner output");
  assert.equal(plannerResult.city, "barcelona");
  assert.ok(primaryRoute);
  assert.ok(routeLineage, "real Planner route should carry internal route lineage");
  assert.equal(primaryRoute.source_template_id, undefined);
  assert.equal(Object.keys(primaryRoute).includes("source_template_id"), false);
  assert.equal(JSON.stringify(plannerResult).includes("source_template_id"), false);
  assert.equal(routeLineage.source_template_id, "encants-to-coast-drift");
  assert.equal(routeLineage.template_match_status, "realized_variant");
  assert.ok(
    routeLineage.realized_route_id.startsWith(
      "encants-to-coast-drift--realized--granja-m-viader--bormuth",
    ),
  );
  assert.deepEqual(routeLineage.template_stop_ids, [
    "platja-bogatell",
    "palo-alto-market",
    "museu-can-framis",
    "la-cova-fumada",
    "mercat-encants",
  ]);
  assert.deepEqual(routeLineage.realized_stop_ids, [
    "granja-m-viader",
    "bormuth",
    "mercat-de-la-boqueria",
    "mercat-santa-caterina",
  ]);
  assert.deepEqual(routeLineage.missing_template_stops, [
    "platja-bogatell",
    "palo-alto-market",
    "museu-can-framis",
    "la-cova-fumada",
    "mercat-encants",
  ]);
  assert.deepEqual(routeLineage.extra_realized_stops, [
    "granja-m-viader",
    "bormuth",
    "mercat-de-la-boqueria",
    "mercat-santa-caterina",
  ]);
  assert.equal(diagnostics.city, "barcelona");
  assert.equal(diagnostics.days.length, plannerResult.days.length);
  assert.equal(
    primaryDiagnostics.selected_route_id,
    plannerResult.days[0].primary_route.id,
  );
  assert.equal(primaryDiagnostics.source_template_id, "encants-to-coast-drift");
  assert.equal(primaryDiagnostics.template_match_status, "realized_variant");
  assert.deepEqual(
    primaryDiagnostics.missing_template_stops,
    routeLineage.missing_template_stops,
  );
  assert.deepEqual(
    primaryDiagnostics.extra_realized_stops,
    routeLineage.extra_realized_stops,
  );
  assert.deepEqual(primaryDiagnostics.mismatch_reasons, [
    "stop_count_mismatch:planner=4:route_candidate_user_facing=5",
    "missing_template_stops:platja-bogatell,palo-alto-market,museu-can-framis,la-cova-fumada,mercat-encants",
    "extra_realized_stops:granja-m-viader,bormuth,mercat-de-la-boqueria,mercat-santa-caterina",
  ]);
  assert.ok(
    ["ready", "ready_with_warnings", "needs_review"].includes(
      primaryDiagnostics.readiness,
    ),
  );
  assert.equal(primaryDiagnostics.readiness, "ready_with_warnings");
  assert.ok(Array.isArray(primaryDiagnostics.missing_from_planner));
  assert.ok(Array.isArray(primaryDiagnostics.extra_in_planner));
  assert.ok(primaryDiagnostics.source_template_id);
  assert.ok(primaryDiagnostics.realized_route_id);
  assert.ok(primaryDiagnostics.template_match_status);
  assert.equal(
    "route_candidate_shadow" in plannerResult.days[0].primary_route,
    false,
    "shadow diagnostics must not leak into Planner route output",
  );
});
