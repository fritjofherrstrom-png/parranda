/**
 * #263 — production trusted place resolver (Nominatim), behind the #260 seam.
 *
 * Default-off, low-volume dogfood/MVP wiring. Proves: honest Nominatim mapping,
 * conservative confidence (clear single anchors; near-ties → ambiguous; junk →
 * low), normalization + reject-without-fetch, clamped limit, fail-closed on
 * http/network/parse errors, in-memory TTL cache, in-flight dedupe, GLOBAL
 * per-instance rate spacing, deploy-configurable User-Agent, env-gated default
 * factory tested with explicit env objects, and end-to-end via buildApp.
 *
 * Fully deterministic: injected fetcher / now / sleep — no live network.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApp } = require("../server/app");
const {
  externalRecord,
  makeLoader,
  requestJson,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

const {
  createNominatimPlaceResolver,
  resolveDefaultPlaceResolver,
  DEFAULT_USER_AGENT,
} = require("../server/place-candidates/place-resolver");

const ORIGINAL_FETCH = global.fetch;
const FLAG = "experimental_agnostic_route_output=1";
const DATE = "2026-05-25";

// A minimal fake Response.
function jsonResponse(status, body, headers = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => normalizedHeaders.get(String(name).toLowerCase()) || null },
    async json() {
      if (typeof body === "string") throw new Error("invalid json");
      return body;
    },
  };
}

// Capturing fetcher returning a fixed Nominatim payload.
function fetcherReturning(body, calls = []) {
  return async (url, opts) => {
    calls.push({ url, headers: opts && opts.headers });
    return jsonResponse(200, body);
  };
}

function nominatim(displayName, lat, lon, importance, osm, address = { city: "X", country: "Y" }) {
  return {
    display_name: displayName,
    lat: String(lat),
    lon: String(lon),
    importance,
    osm_type: osm && osm[0],
    osm_id: osm && osm[1],
    // raw payload that must NOT be exposed:
    boundingbox: ["1", "2", "3", "4"],
    address,
    place_rank: 16,
  };
}

function withNominatimName(candidate, name) {
  return { ...candidate, name };
}

// === Pure: createNominatimPlaceResolver ====================================

test("pure: maps a clear single result to a conservative 'medium' candidate with compact provenance only", async () => {
  const r = createNominatimPlaceResolver({ fetcher: fetcherReturning([nominatim("Trastevere, Rome", 41.9, 12.47, 0.55, ["relation", "123"])]), minIntervalMs: 0 });
  const out = await r("Trastevere");
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]).sort(), ["admin_context", "attribution", "confidence", "label", "lat", "license", "lng", "osm_ref", "provenance", "source_tier"]);
  assert.equal(out[0].confidence, "medium");
  assert.equal(out[0].provenance, "nominatim_osm");
  assert.equal(out[0].attribution, "© OpenStreetMap contributors");
  assert.equal(out[0].license, "ODbL");
  assert.equal(out[0].osm_ref, "relation/123");
  // No raw provider payload leaks.
  for (const banned of ["boundingbox", "address", "place_rank", "display_name", "importance", "name", "osm_type", "osm_id"]) {
    assert.equal(banned in out[0], false, `must not expose ${banned}`);
  }
});

test("pure: preserves only compact administrative identity for trusted source discovery", async () => {
  const calls = [];
  const r = createNominatimPlaceResolver({
    fetcher: fetcherReturning([
      nominatim("Stockholm, Stockholms kommun, Sverige", 59.3293, 18.0686, 0.8, ["relation", "175242"], {
        city: "Stockholm",
        municipality: "Stockholms kommun",
        county: "Stockholms län",
        state: "Stockholms län",
        country: "Sverige",
        country_code: "SE",
        postcode: "111 29",
        road: "Private street atom",
      }),
    ], calls),
    minIntervalMs: 0,
  });
  const [candidate] = await r("Stockholm");

  assert.deepEqual(candidate.admin_context, {
    locality: "Stockholm",
    municipality: "Stockholms kommun",
    county: "Stockholms län",
    region: "Stockholms län",
    country: "Sverige",
    country_code: "se",
  });
  assert.equal(new URL(calls[0].url).searchParams.get("addressdetails"), "1");
  assert.doesNotMatch(JSON.stringify(candidate), /postcode|Private street atom|road/);
});

test("pure: confidence is never 'high' (reserved for human-verified)", async () => {
  const r = createNominatimPlaceResolver({ fetcher: fetcherReturning([nominatim("Big City", 40, 10, 0.98)]), minIntervalMs: 0 });
  const out = await r("Big City");
  assert.equal(out[0].confidence, "medium");
});

test("pure: near-tie results stay strong → both 'medium' (intake reports ambiguous)", async () => {
  const r = createNominatimPlaceResolver({
    fetcher: fetcherReturning([
      withNominatimName(nominatim("Springfield, Illinois", 39.8, -89.6, 0.6), "Springfield"),
      withNominatimName(nominatim("Springfield, Massachusetts", 42.1, -72.5, 0.55), "Springfield"),
    ]),
    minIntervalMs: 0,
  });
  const out = await r("Springfield");
  assert.deepEqual(out.map((c) => c.confidence), ["medium", "medium"]);
});

test("pure: exact place name wins a near-tie with its administrative container", async () => {
  const r = createNominatimPlaceResolver({
    fetcher: fetcherReturning([
      withNominatimName(
        nominatim("Simrishamns kommun, Skåne län, Sverige", 55.5667, 14.3, 0.481, ["relation", "935529"]),
        "Simrishamns kommun",
      ),
      withNominatimName(
        nominatim("Simrishamn, Simrishamns kommun, Skåne län, Sverige", 55.5566, 14.35, 0.474, ["node", "27374563"]),
        "Simrishamn",
      ),
    ]),
    minIntervalMs: 0,
  });

  const out = await r("Simrishamn");
  assert.equal(out.find((candidate) => candidate.label.startsWith("Simrishamn,"))?.confidence, "medium");
  assert.equal(out.find((candidate) => candidate.label.startsWith("Simrishamns kommun"))?.confidence, "low");
});

test("pure: a clear winner anchors; weaker matches drop to 'low'", async () => {
  const r = createNominatimPlaceResolver({ fetcher: fetcherReturning([nominatim("Rome", 41.9, 12.5, 0.85), nominatim("Rome cafe", 41.8, 12.4, 0.3)]), minIntervalMs: 0 });
  const out = await r("Rome");
  assert.deepEqual(out.map((c) => c.confidence), ["medium", "low"]);
});

test("pure: a vague/junk single match (low importance) → 'low'", async () => {
  const r = createNominatimPlaceResolver({ fetcher: fetcherReturning([nominatim("Obscure node", 1, 1, 0.05)]), minIntervalMs: 0 });
  const out = await r("zzz");
  assert.equal(out[0].confidence, "low");
});

test("pure: multiple low-importance near-ties remain low, not medium", async () => {
  const r = createNominatimPlaceResolver({
    fetcher: fetcherReturning([
      nominatim("Junk A", 1, 1, 0.05),
      nominatim("Junk B", 2, 2, 0.04),
    ]),
    minIntervalMs: 0,
  });
  const out = await r("junk query");
  assert.deepEqual(out.map((c) => c.confidence), ["low", "low"]);
});

test("pure: empty / whitespace / too-long / non-string queries return [] WITHOUT fetching", async () => {
  const calls = [];
  const r = createNominatimPlaceResolver({ fetcher: fetcherReturning([], calls), minIntervalMs: 0 });
  assert.deepEqual(await r("   "), []);
  assert.deepEqual(await r("x".repeat(201)), []);
  assert.deepEqual(await r(12345), []);
  assert.deepEqual(await r(null), []);
  assert.equal(calls.length, 0, "no fetch for rejected queries");
});

test("pure: results with invalid coordinates are dropped", async () => {
  const r = createNominatimPlaceResolver({ fetcher: fetcherReturning([nominatim("Bad", 999, 12, 0.5), nominatim("Good", 41.9, 12.49, 0.6)]), minIntervalMs: 0 });
  const out = await r("x");
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Good");
});

test("pure: http error / network throw / malformed json all fail closed (no throw)", async () => {
  const httpErr = createNominatimPlaceResolver({ fetcher: async () => jsonResponse(429, []), minIntervalMs: 0 });
  assert.deepEqual(await httpErr("x"), []);
  const netErr = createNominatimPlaceResolver({ fetcher: async () => { throw new Error("network down"); }, minIntervalMs: 0 });
  assert.deepEqual(await netErr("x"), []);
  const badJson = createNominatimPlaceResolver({ fetcher: async () => jsonResponse(200, "not-an-array"), minIntervalMs: 0 });
  assert.deepEqual(await badJson("x"), []);
});

test("pure: a transient provider failure is NOT cached (retries on next call)", async () => {
  const calls = [];
  let nth = 0;
  const fetcher = async (url, opts) => {
    calls.push({ url, headers: opts && opts.headers });
    nth += 1;
    return nth === 1 ? jsonResponse(500, []) : jsonResponse(200, [nominatim("Trastevere", 41.9, 12.49, 0.55, ["relation", "1"])]);
  };
  const r = createNominatimPlaceResolver({ fetcher, minIntervalMs: 0 });
  const first = await r("Trastevere");
  assert.deepEqual(first, [], "transient 500 → []");
  const second = await r("Trastevere");
  assert.equal(calls.length, 2, "failure was not cached → fetched again");
  assert.equal(second.length, 1, "second call returns the real candidate");
  assert.equal(second[0].confidence, "medium");
});

test("pure: an invalid configured endpoint fails closed without throwing or fetching", async () => {
  const calls = [];
  const r = createNominatimPlaceResolver({ endpoint: "not a url", fetcher: fetcherReturning([nominatim("A", 1, 1, 0.5)], calls), minIntervalMs: 0 });
  let out;
  await assert.doesNotReject(async () => { out = await r("Trastevere"); });
  assert.deepEqual(out, []);
  assert.equal(calls.length, 0, "fetch must not be called for an invalid endpoint");
});

test("pure: limit is clamped to [1,10]", async () => {
  const calls = [];
  const r = createNominatimPlaceResolver({ fetcher: fetcherReturning([nominatim("A", 1, 1, 0.5)], calls), limit: 50, minIntervalMs: 0 });
  await r("x");
  assert.match(calls[0].url, /[?&]limit=10(&|$)/);
});

test("pure: identical repeat query hits the in-memory cache (one fetch); result is cloned", async () => {
  const calls = [];
  const r = createNominatimPlaceResolver({ fetcher: fetcherReturning([nominatim("A", 1, 1, 0.5)], calls), minIntervalMs: 0 });
  const a = await r("Same Place");
  a.push({ tampered: true }); // mutating the returned array must not poison the cache
  const b = await r("  same   place "); // normalized to same key
  assert.equal(calls.length, 1, "served from cache");
  assert.equal(b.length, 1, "cached value not corrupted by caller mutation");
});

test("pure: concurrent identical queries dedupe in-flight (one fetch)", async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const r = createNominatimPlaceResolver({
    fetcher: async () => { calls.push(1); await gate; return jsonResponse(200, [nominatim("A", 1, 1, 0.5)]); },
    minIntervalMs: 0,
  });
  const p1 = r("dup");
  const p2 = r("dup");
  release();
  await Promise.all([p1, p2]);
  assert.equal(calls.length, 1);
});

test("pure: GLOBAL per-instance rate gate spaces DISTINCT queries by minIntervalMs", async () => {
  let clock = 0;
  const slept = [];
  const r = createNominatimPlaceResolver({
    fetcher: fetcherReturning([nominatim("A", 1, 1, 0.5)]),
    minIntervalMs: 1000,
    now: () => clock,
    sleep: async (ms) => { slept.push(ms); clock += ms; },
  });
  await Promise.all([r("q1"), r("q2"), r("q3")]);
  // First runs immediately; each subsequent distinct query waits one interval.
  assert.deepEqual(slept, [1000, 1000]);
});

test("pure: a queued distinct query honors Retry-After after a 429 without retrying the failed query", async () => {
  let clock = 0;
  const slept = [];
  const calls = [];
  const r = createNominatimPlaceResolver({
    fetcher: async (url) => {
      calls.push(new URL(url).searchParams.get("q"));
      return calls.length === 1
        ? jsonResponse(429, [], { "Retry-After": "3" })
        : jsonResponse(200, [nominatim("Recovered", 1, 1, 0.5)]);
    },
    minIntervalMs: 0,
    now: () => clock,
    sleep: async (ms) => { slept.push(ms); clock += ms; },
  });

  const [limited, recovered] = await Promise.all([r("first"), r("second")]);
  assert.deepEqual(limited, []);
  assert.equal(recovered.length, 1);
  assert.deepEqual(calls, ["first", "second"], "the failed query is not retried automatically");
  assert.deepEqual(slept, [3000], "the already-queued query waits out the provider cooldown");
});

test("pure: provider cooldown falls back safely and clamps an excessive Retry-After", async () => {
  for (const testCase of [
    { status: 503, headers: {}, expected: 5000 },
    { status: 429, headers: { "Retry-After": "999" }, expected: 60000 },
  ]) {
    let clock = 0;
    const slept = [];
    let calls = 0;
    const r = createNominatimPlaceResolver({
      fetcher: async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse(testCase.status, [], testCase.headers)
          : jsonResponse(200, [nominatim("Recovered", 1, 1, 0.5)]);
      },
      minIntervalMs: 0,
      now: () => clock,
      sleep: async (ms) => { slept.push(ms); clock += ms; },
    });

    await r("first");
    await r("second");
    assert.deepEqual(slept, [testCase.expected]);
  }
});

test("pure: User-Agent header is sent and is deploy-configurable", async () => {
  const calls = [];
  const def = createNominatimPlaceResolver({ fetcher: fetcherReturning([nominatim("A", 1, 1, 0.5)], calls), minIntervalMs: 0 });
  await def("x");
  assert.equal(calls[0].headers["User-Agent"], DEFAULT_USER_AGENT);
  assert.match(DEFAULT_USER_AGENT, /\+https?:\/\//, "default UA includes a contact URL");

  const calls2 = [];
  const custom = createNominatimPlaceResolver({ fetcher: fetcherReturning([nominatim("A", 1, 1, 0.5)], calls2), userAgent: "MyApp/2.0 (+https://example.test/contact)", minIntervalMs: 0 });
  await custom("x");
  assert.equal(calls2[0].headers["User-Agent"], "MyApp/2.0 (+https://example.test/contact)");
});

// === resolveDefaultPlaceResolver (explicit env objects — never process.env) ==

test("env factory: disabled by default and for unrelated values", () => {
  assert.equal(resolveDefaultPlaceResolver({}), null);
  assert.equal(resolveDefaultPlaceResolver({ PARRANDA_PLACE_RESOLVER: "" }), null);
  assert.equal(resolveDefaultPlaceResolver({ PARRANDA_PLACE_RESOLVER: "no" }), null);
});

test("env factory: enabled via enabled/1/true returns a resolver function", () => {
  for (const v of ["enabled", "1", "true", "TRUE"]) {
    assert.equal(typeof resolveDefaultPlaceResolver({ PARRANDA_PLACE_RESOLVER: v }), "function", v);
  }
});

test("env factory: User-Agent flows from env (verified via injected fetcher override)", async () => {
  const calls = [];
  const r = resolveDefaultPlaceResolver(
    { PARRANDA_PLACE_RESOLVER: "1", PARRANDA_PLACE_RESOLVER_USER_AGENT: "Deploy/9.9 (+https://deploy.test)" },
    { fetcher: fetcherReturning([nominatim("A", 1, 1, 0.5)], calls), minIntervalMs: 0 },
  );
  await r("x");
  assert.equal(calls[0].headers["User-Agent"], "Deploy/9.9 (+https://deploy.test)");
});

// === End-to-end via buildApp ================================================

function fixtureNear(base) {
  const recs = [];
  const j = (i) => ({ lat: base.lat + (i % 5) * 0.0008, lng: base.lng + Math.floor(i / 5) * 0.0008 });
  for (let i = 0; i < 11; i += 1) { const c = j(i); recs.push(externalRecord(`food-${i}`, `Food ${i}`, "restaurant", c.lat, c.lng, ["mat"])); }
  for (let i = 0; i < 11; i += 1) { const c = j(i + 2); recs.push(externalRecord(`cafe-${i}`, `Cafe ${i}`, "cafe", c.lat, c.lng, ["fika"])); }
  for (let i = 0; i < 5; i += 1) { const c = j(i + 1); recs.push(externalRecord(`view-${i}`, `View ${i}`, "viewpoint", c.lat, c.lng, ["utsikt"])); }
  return recs;
}

function withServer(opts, run) {
  return async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp(opts).listen(0);
    try {
      await run(server);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  };
}

const BASE = { lat: 41.9, lng: 12.49 };
const placeBody = (extra = {}) => ({ city: "unknown-x", dates: [DATE], place: "Trastevere", preferences: ["food", "coffee", "scenic"], include_external_candidates: 1, ...extra });

test(
  "api: a real resolver resolves a place → anchor → route; provenance + attribution surface",
  withServer({
    openDataLoader: makeLoader(fixtureNear(BASE)),
    placeResolver: createNominatimPlaceResolver({ fetcher: fetcherReturning([nominatim("Trastevere, Rome", BASE.lat, BASE.lng, 0.55, ["relation", "1"])]), minIntervalMs: 0 }),
  }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: placeBody() });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, true);
    assert.equal(exp.intake.mode, "place");
    assert.equal(exp.intake.resolved.provenance, "nominatim_osm");
    assert.equal(exp.intake.resolved.attribution, "© OpenStreetMap contributors");
    assert.equal(exp.intake.resolved.license, "ODbL");
    assert.equal(exp.intake.resolved.timezone, null, "no timezone supplied → stays null");
    assert.ok(r.body.days[0].primary_route.main_stops.length >= 2);
  }),
);

test(
  "api: an ambiguous resolution fails closed with ambiguous_place (no route)",
  withServer({
    openDataLoader: makeLoader(fixtureNear(BASE)),
    placeResolver: createNominatimPlaceResolver({ fetcher: fetcherReturning([nominatim("Springfield IL", 39.8, -89.6, 0.6), nominatim("Springfield MA", 42.1, -72.5, 0.55)]), minIntervalMs: 0 }),
  }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: placeBody({ place: "Springfield" }) });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.ok(exp.readiness_blockers.includes("ambiguous_place"));
    assert.ok(Array.isArray(exp.intake.candidates) && exp.intake.candidates.length === 2);
  }),
);

test(
  "api: a resolver that finds nothing fails closed with place_not_resolved",
  withServer({
    openDataLoader: makeLoader(fixtureNear(BASE)),
    placeResolver: createNominatimPlaceResolver({ fetcher: fetcherReturning([]), minIntervalMs: 0 }),
  }, async (server) => {
    const r = await requestJson(server, { path: `/api/route-recommendations?lang=en&${FLAG}`, body: placeBody({ place: "asdfghjkl" }) });
    const exp = r.body.agnostic_route_output_experiment;
    assert.equal(exp.route_mutation, false);
    assert.ok(exp.readiness_blockers.includes("place_not_resolved"));
  }),
);
