"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validateSelfHostedStack } = require("../scripts/validate-self-hosted-stack");
const { buildApp } = require("../server/app");
const { resolveNetworkWalkingProvider } = require("../server/valhalla-walking");

function health(app) {
  const route = app.router.stack.find((layer) => layer.route?.path === "/api/health");
  let body;
  route.route.stack[0].handle({}, { json(value) { body = value; } });
  return body;
}

test("ready health means configuration only and never contacts the configured endpoint", (t) => {
  const fetcher = t.mock.method(global, "fetch", () => { throw new Error("unexpected upstream call"); });
  const warning = t.mock.method(console, "warn", () => {});
  for (const endpoint of ["https://private.invalid/route", "http://localhost:8002/route", "http://127.0.0.1:8002/route", "http://[::1]:8002/route"]) {
    const body = health(appFor({ PARRANDA_NETWORK_WALKING: "enabled", PARRANDA_VALHALLA_ROUTE_URL: endpoint }));
    assert.equal(body.ok, true);
    assert.equal(body.network_walking_config, "ready");
    assert.equal(body.network_walking_config_scope, "configuration_only");
    assert.doesNotMatch(JSON.stringify(body), /private\.invalid|localhost|8002|https?:/);
  }
  assert.equal(fetcher.mock.callCount(), 0);
  assert.equal(warning.mock.callCount(), 0);
});

const invalidEndpoints = [undefined, "", "not-a-url-secret", "http://private.invalid/route", "https://private.invalid/route?key=secret", "https://user:secret@private.invalid/route", "https://private.invalid/route#secret"];

for (const [index, endpoint] of invalidEndpoints.entries()) {
  test(`misconfigured endpoint case ${index} fails closed with one sanitized startup warning`, async (t) => {
    const fetcher = t.mock.method(global, "fetch", () => { throw new Error("unexpected upstream call"); });
    const warning = t.mock.method(console, "warn", () => {});
    const provider = resolveNetworkWalkingProvider({ PARRANDA_NETWORK_WALKING: "enabled", PARRANDA_VALHALLA_ROUTE_URL: endpoint });
    assert.equal(provider.configured, false);
    const app = buildApp({ networkWalkingProvider: provider, openDataLoader: null, placeResolver: null, eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null });
    const body = health(app);
    assert.equal(body.ok, true);
    assert.equal(body.network_walking_config, "misconfigured");
    assert.equal(body.network_walking_config_scope, "configuration_only");
    health(app);
    await provider.session().route([{ lat: 1, lng: 1 }, { lat: 1.01, lng: 1.01 }]);
    assert.equal(warning.mock.callCount(), 1);
    assert.match(String(warning.mock.calls[0].arguments), /network walking.*misconfigured.*fail.closed/i);
    assert.doesNotMatch(JSON.stringify([body, warning.mock.calls.map(call => call.arguments)]), /secret|private\.invalid|user:|https?:/);
    assert.equal(fetcher.mock.callCount(), 0);
  });
}

test("self-hosted validator rejects enabled invalid endpoints with sanitized errors", (t) => {
  const fetcher = t.mock.method(global, "fetch", () => { throw new Error("unexpected upstream call"); });
  for (const endpoint of invalidEndpoints) {
    assert.throws(() => validateSelfHostedStack({ PARRANDA_NETWORK_WALKING: "enabled", PARRANDA_VALHALLA_ROUTE_URL: endpoint }), { message: "network_walking_misconfigured" });
  }
  assert.equal(fetcher.mock.callCount(), 0);
});

test("self-hosted validator accepts disabled and valid configured endpoints offline", (t) => {
  const fetcher = t.mock.method(global, "fetch", () => { throw new Error("unexpected upstream call"); });
  assert.equal(validateSelfHostedStack({ PARRANDA_VALHALLA_ROUTE_URL: "https://user:secret@private.invalid/route" }), true);
  for (const endpoint of ["https://private.invalid/route", "http://localhost:8002/route", "http://127.0.0.1:8002/route", "http://[::1]:8002/route"]) {
    assert.equal(validateSelfHostedStack({ PARRANDA_NETWORK_WALKING: "enabled", PARRANDA_VALHALLA_ROUTE_URL: endpoint }), true);
  }
  assert.equal(fetcher.mock.callCount(), 0);
});

function appFor(env) {
  return buildApp({
    networkWalkingProvider: resolveNetworkWalkingProvider(env),
    openDataLoader: null,
    placeResolver: null,
    eventSupply: null,
    sourceCatalog: null,
    reviewedPlaceSource: null,
  });
}

test("health exposes disabled network walking configuration without probing upstream", (t) => {
  const fetcher = t.mock.method(global, "fetch", () => { throw new Error("unexpected upstream call"); });
  const warning = t.mock.method(console, "warn", () => {});
  const body = health(appFor({ PARRANDA_VALHALLA_ROUTE_URL: "https://user:secret@private.invalid/route" }));
  assert.equal(body.ok, true);
  assert.equal(body.network_walking_config, "disabled");
  assert.doesNotMatch(JSON.stringify(body), /secret|private\.invalid/);
  assert.equal(fetcher.mock.callCount(), 0);
  assert.equal(warning.mock.callCount(), 0);
});
