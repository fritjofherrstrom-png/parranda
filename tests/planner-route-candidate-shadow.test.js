const assert = require("node:assert/strict");
const test = require("node:test");

const barcelona = require("../server/cities/barcelona");
const rome = require("../server/cities/rome");
const { generateRecommendations } = require("../server/route-engine");
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
  assert.equal(diagnostics.route_candidate_count, 6);
  assert.equal(diagnostics.days.length, 1);

  const primary = diagnostics.days[0].primary_route;
  assert.equal(primary.selected_route_id, "gracia-local-evening-loop");
  assert.equal(primary.matching_route_candidate_id, "gracia-local-evening-loop");
  assert.equal(primary.planner_stop_count, 4);
  assert.equal(primary.route_candidate_user_facing_stop_count, 4);
  assert.equal(primary.route_candidate_structural_stop_count, 0);
  assert.equal(primary.stop_count_parity, true);
  assert.equal(primary.user_facing_stop_ids_match, true);
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
  assert.equal(primary.matching_route_candidate_id, "classic-loop");
  assert.equal(primary.planner_stop_count, 2);
  assert.equal(primary.route_candidate_stop_count, 6);
  assert.equal(primary.route_candidate_user_facing_stop_count, 2);
  assert.equal(primary.route_candidate_structural_stop_count, 4);
  assert.deepEqual(primary.route_candidate_user_facing_stop_ids, ["san-clemente", "colosseum"]);
  assert.equal(primary.stop_count_parity, true);
  assert.equal(primary.user_facing_stop_ids_match, true);
  assert.equal(primary.readiness, "ready");
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
  assert.equal(diagnostics.matching_route_candidate_id, null);
  assert.equal(diagnostics.planner_stop_count, 1);
  assert.equal(diagnostics.route_candidate_stop_count, 0);
  assert.equal(diagnostics.stop_count_parity, false);
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

  assert.deepEqual(plannerResult, before, "shadow diagnostics must not mutate Planner output");
  assert.equal(plannerResult.city, "barcelona");
  assert.ok(plannerResult.days[0].primary_route);
  assert.equal(diagnostics.city, "barcelona");
  assert.equal(diagnostics.days.length, plannerResult.days.length);
  assert.equal(
    diagnostics.days[0].primary_route.selected_route_id,
    plannerResult.days[0].primary_route.id,
  );
  assert.ok(
    ["ready", "ready_with_warnings", "needs_review"].includes(
      diagnostics.days[0].primary_route.readiness,
    ),
  );
  assert.equal(
    "route_candidate_shadow" in plannerResult.days[0].primary_route,
    false,
    "shadow diagnostics must not leak into Planner route output",
  );
});
