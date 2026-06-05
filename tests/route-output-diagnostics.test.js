const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApp } = require("../server/app");
const { attachRouteLineage, getRouteLineage } = require("../server/route-engine");
const {
  buildRouteOutputDiagnostics,
  summarizeRouteOutput,
} = require("../server/planner/route-output-diagnostics");
const {
  mockStableWeatherFetch,
  primaryRouteShape,
  requestJson,
  routeBody,
} = require("./helpers/planner-reservoir-compare");

const originalFetch = global.fetch;

test.afterEach(() => {
  global.fetch = originalFetch;
});

test("builds diagnostics for a route with internal lineage without mutating input", () => {
  const route = attachRouteLineage(
    {
      id: "public-route",
      main_stops: [{ id: "a" }, { place_id: "b" }, { candidate_id: "c" }],
    },
    {
      source_template_id: "source-template",
      realized_route_id: "source-template--realized--a--b--c",
      realization_kind: "template_realized_variant",
      template_match_status: "realized_variant",
      template_stop_ids: ["a", "b"],
      realized_stop_ids: ["a", "b", "c"],
      missing_template_stops: [],
      extra_realized_stops: ["c"],
    },
  );
  const beforeJson = JSON.stringify(route);
  const beforeLineage = JSON.stringify(getRouteLineage(route));

  const out = buildRouteOutputDiagnostics({
    city: "test-city",
    routeResult: {
      city: "test-city",
      days: [{ date: "2026-05-25", primary_route: route, alternatives: [] }],
    },
  });

  assert.equal(JSON.stringify(route), beforeJson);
  assert.equal(JSON.stringify(getRouteLineage(route)), beforeLineage);
  assert.equal(out.status, "available");
  assert.equal(out.city, "test-city");
  assert.equal(out.route_mutation, false);
  const primary = out.days[0].primary_route;
  assert.equal(primary.selected_route_id, "public-route");
  assert.equal(primary.source_template_id, "source-template");
  assert.equal(primary.realized_route_id, "source-template--realized--a--b--c");
  assert.equal(primary.realization_kind, "template_realized_variant");
  assert.equal(primary.template_match_status, "realized_variant");
  assert.deepEqual(primary.stop_ids, ["a", "b", "c"]);
  assert.equal(primary.has_stable_stop_ids, true);
  assert.equal(primary.output_contract, "current_primary_route_json");
  assert.equal(primary.public_route_mutated, false);
});

test("falls back safely when lineage is absent", () => {
  const out = summarizeRouteOutput(
    {
      id: "manual-route",
      main_stops: [{ id: "a" }, { place_id: "b" }, { candidate_id: "c" }],
    },
    "current_primary_route_json",
  );

  assert.equal(out.selected_route_id, "manual-route");
  assert.equal(out.source_template_id, null);
  assert.equal(out.realized_route_id, null);
  assert.equal(out.realization_kind, null);
  assert.equal(out.template_match_status, null);
  assert.deepEqual(out.stop_ids, ["a", "b", "c"]);
  assert.equal(out.stop_count, 3);
  assert.equal(out.has_stable_stop_ids, true);
});

test("does not invent stable ids from labels or coordinates", () => {
  const out = summarizeRouteOutput(
    {
      id: "label-only-route",
      main_stops: [
        { label: "Same Name", lat: 41.9, lng: 12.5 },
        { name: "Other Name", coordinates: { lat: 41.91, lng: 12.51 } },
      ],
    },
    "current_primary_route_json",
  );

  assert.deepEqual(out.stop_ids, []);
  assert.equal(out.stop_count, 2);
  assert.equal(out.has_stable_stop_ids, false);
});

async function routeRequest({ query = "", body = routeBody("rome", ["scenic", "food"]) } = {}) {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp().listen(0);
  try {
    const suffix = query ? `&${query}` : "";
    const response = await requestJson(server, {
      path: `/api/route-recommendations?lang=en${suffix}`,
      body,
    });
    assert.equal(response.status, 200);
    return response.body;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
  }
}

test("default route response omits route output diagnostics", async () => {
  const body = await routeRequest();

  assert.equal(body.route_output_diagnostics, undefined);
  assert.equal(body.planner_roles, undefined);
  assert.equal(body.dayflow_honesty, undefined);
  assert.equal(body.route_ab_scoring, undefined);
});

test("inspect_route_output attaches only route output diagnostics and preserves route shape", async () => {
  const requestBody = routeBody("rome", ["scenic", "food"]);
  const def = await routeRequest({ body: requestBody });
  const inspected = await routeRequest({ body: requestBody, query: "inspect_route_output=1" });

  assert.deepEqual(primaryRouteShape(inspected), primaryRouteShape(def));
  assert.ok(inspected.route_output_diagnostics);
  assert.equal(inspected.planner_roles, undefined);
  assert.equal(inspected.dayflow_honesty, undefined);
  assert.equal(inspected.candidate_combination, undefined);
  assert.equal(inspected.route_candidate_adapter, undefined);
  assert.equal(inspected.route_ab_scoring, undefined);

  const diagnostics = inspected.route_output_diagnostics;
  assert.equal(diagnostics.city, "rome");
  assert.equal(diagnostics.experimental, true);
  assert.equal(diagnostics.route_mutation, false);
  assert.ok(Array.isArray(diagnostics.days));
  assert.ok(diagnostics.days[0].primary_route);
  assert.equal(diagnostics.days[0].primary_route.output_contract, "current_primary_route_json");
  assert.equal(diagnostics.days[0].primary_route.public_route_mutated, false);
});

test("inspectRouteOutput and inspect=route_output aliases work", async () => {
  const camel = await routeRequest({ query: "inspectRouteOutput=1" });
  const list = await routeRequest({ query: "inspect=route_output" });

  assert.ok(camel.route_output_diagnostics);
  assert.ok(list.route_output_diagnostics);
});

test("public payload cannot inject diagnostics, days, or lineage", async () => {
  const inspected = await routeRequest({
    query: "inspect_route_output=1",
    body: routeBody("rome", ["scenic", "food"], {
      route_output_diagnostics: {
        days: [{ primary_route: { source_template_id: "payload-template" } }],
      },
      days: [{ primary_route: { main_stops: [{ id: "payload-stop" }] } }],
    }),
  });

  const diagnostics = inspected.route_output_diagnostics;
  const serialized = JSON.stringify(diagnostics);
  assert.ok(!serialized.includes("payload-template"));
  assert.ok(!serialized.includes("payload-stop"));
  assert.notEqual(diagnostics.days[0].primary_route.source_template_id, "payload-template");
  assert.ok(!diagnostics.days[0].primary_route.stop_ids.includes("payload-stop"));
});

test("serialized diagnostics avoid mutation, timing, and candidate-promotion claims", async () => {
  const inspected = await routeRequest({ query: "inspect_route_output=1" });
  const serialized = JSON.stringify(inspected.route_output_diagnostics);

  for (const banned of [
    "walking_time",
    "travel_time",
    "eta",
    "duration_min",
    "selected_variant",
    "route_claim",
    "candidate_wins",
  ]) {
    assert.equal(serialized.includes(banned), false, `diagnostics must not include ${banned}`);
  }
});
