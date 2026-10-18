"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOperatorVisitEnricher } = require("../server/place-candidates/operator-visit-evidence");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const parseHours = (...args) => require("../server/place-candidates/selected-place-hours").parseSelectedPlaceHours(...args);
const row = { id: "map-museum", name: "Juniper Museum", type: "museum", lat: 55.6, lng: 13,
  website: "https://juniper.example/visit", sources: [{ provider: "osm", family: "map", tier: "inferred" }] };
const entity = overrides => ({ "@type": "Museum", "@id": row.website + "#place", url: row.website,
  name: row.name, geo: { latitude: row.lat, longitude: row.lng }, openingHours: "Mo-Su 09:00-17:00", ...overrides });
const html = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const response = value => new Response(value, { status: 200, headers: { "content-type": "text/html" } });
const dns = async () => [{ address: "93.184.216.34", family: 4 }];
const options = extra => ({ cache: createSourceCache(), hoursCache: createSourceCache(), resolveHost: dns,
  fetcher: async () => response(html(entity())), ...extra });

test("selected hours come from one exact JSON-LD place without creating evidence", () => {
  assert.deepEqual(parseHours(html(entity()), row, row.website), {
    opening_hours: "Mo-Su 09:00-17:00", url: row.website,
  });
  assert.equal(parseHours(html(entity({ "@type": "Organization" })), row, row.website), null);
  assert.ok(parseHours(html(entity({ "@type": "LocalBusiness" })), row, row.website));
});

test("different names, visit branches, identities and temporal overrides remain unknown", () => {
  for (const value of [entity({ name: "Juniper Museum Annex" }), entity({ geo: { latitude: 55.601, longitude: 13 } }),
    entity({ url: "https://juniper.example/other", "@id": "https://juniper.example/other#place" }),
    entity({ url: "https://other.example/visit" }), entity({ geo: undefined }),
    entity({ openingHours: "sunrise-sunset" }), entity({ specialOpeningHoursSpecification: [{ validFrom: "2026-12-25" }] }),
    { "@graph": [entity(), entity({ "@id": row.website + "#another", openingHours: "Mo-Su 10:00-18:00" })] },
    { "@graph": [entity(), entity({ name: "Other Museum", geo: { latitude: 56, longitude: 14 } })] },
  ]) assert.equal(parseHours(html(value), row, row.website), null, JSON.stringify(value));
});

test("JSON-LD namespace overrides cannot rename untrusted properties into schema.org facts", () => {
  for (const context of ["https://unrelated.example/", { "@vocab": "https://schema.org/", openingHours: "https://unrelated.example/reviews" }]) {
    assert.equal(parseHours(html({ "@context": context, "@graph": [entity()] }), row, row.website), null);
  }
});

test("only selected unknown rows are checked and enriched in their original order", async () => {
  const seen = [];
  const session = createOperatorVisitEnricher(options({ fetcher: async url => { seen.push(url); return response(html(entity())); } })).forRequest();
  const other = { ...row, id: "other", website: "https://other.example/" };
  const known = { ...row, id: "known", opening_hours: "unsupported existing source syntax" };
  const result = await session.enrichSelected([other, row, known], { selectedIds: [row.id, known.id], website: other.website });
  assert.deepEqual(result.map(value => value.id), ["other", row.id, "known"]);
  assert.deepEqual(seen, [row.website]);
  assert.equal(result[1].opening_hours, "Mo-Su 09:00-17:00");
  assert.deepEqual(result[1].sources, row.sources);
  assert.equal(result[1].operator_visit_evidence, undefined);
  assert.deepEqual(Object.keys(result[1].opening_hours_source), ["url", "observed_at"]);
  assert.equal(result[0], other);
  assert.equal(result[2], known);
});

test("fresh selected facts reuse the cache and failed expired refreshes never renew them", async () => {
  let now = 1_800_000_000_000, calls = 0, healthy = true;
  const hoursCache = createSourceCache({ now: () => now, ttlMs: 6 * 60 * 60 * 1000 });
  const factory = createOperatorVisitEnricher(options({ hoursCache, now: () => now,
    fetcher: async () => { calls++; return response(healthy ? html(entity()) : "No facts"); } }));
  const run = () => factory.forRequest().enrichSelected([row], { selectedIds: [row.id] });
  const first = await run();
  now += 1000;
  assert.equal((await run())[0].opening_hours_source.observed_at, first[0].opening_hours_source.observed_at);
  assert.equal(calls, 1);
  now += 6 * 60 * 60 * 1000; healthy = false;
  assert.equal((await run())[0].opening_hours, undefined);
  assert.equal(calls, 2);
  assert.equal((await run())[0].opening_hours, undefined);
  assert.equal(calls, 3, "failed refresh does not cache an error as fresh evidence");
});

test("selected fact cache keys bind the original id, coordinates, type, name and URL", async () => {
  let calls = 0;
  const factory = createOperatorVisitEnricher(options({ fetcher: async () => { calls++; return response(html(entity())); } }));
  await factory.forRequest().enrichSelected([row], { selectedIds: [row.id] });
  for (const changed of [{ id: "other-id" }, { lat: 55.601 }, { type: "gallery" }, { name: "Other Museum" }, { website: "https://juniper.example/other" }]) {
    const value = { ...row, ...changed };
    await factory.forRequest().enrichSelected([value], { selectedIds: [value.id] });
  }
  assert.equal(calls, 6);
});

test("cached selected facts must still contain supported hours from the bound source website", async () => {
  const { selectedPlaceHoursKey } = require("../server/place-candidates/selected-place-hours");
  for (const changed of [{ url: "https://other.example/" }, { opening_hours: "ask the operator" }]) {
    const hoursCache = createSourceCache();
    const key = selectedPlaceHoursKey(row);
    await hoursCache.get(key, async () => ({ identity_key: key, opening_hours: "Mo-Su 09:00-17:00", url: row.website,
      observed_at: new Date().toISOString(), ...changed }));
    let calls = 0;
    const session = createOperatorVisitEnricher(options({ hoursCache, fetcher: async () => { calls++; return response("Unknown"); } })).forRequest();
    assert.equal((await session.enrichSelected([row], { selectedIds: [row.id] }))[0].opening_hours, undefined);
    assert.equal(calls, 1);
  }
});

test("generic checks share four identities and the original six seconds with vintage checks", async () => {
  const seen = [];
  const session = createOperatorVisitEnricher(options({ fetcher: async url => { seen.push(url); return response("Unknown"); } })).forRequest();
  const vintage = Array.from({ length: 4 }, (_, index) => ({ ...row, id: `vintage-${index}`, type: "vintage-shop", website: `https://vintage-${index}.example/` }));
  await session(vintage);
  await session.enrichSelected([row], { selectedIds: [row.id] });
  assert.equal(seen.length, 4);

  let now = 0, calls = 0;
  const timed = createOperatorVisitEnricher(options({ now: () => now, fetcher: async () => { calls++; now += 7000; return response("Unknown"); } })).forRequest();
  await timed(vintage.slice(0, 1));
  await timed.enrichSelected([row], { selectedIds: [row.id] });
  assert.equal(calls, 1, "the selected pass cannot start a second six-second window");
});

test("unresolved generic pages are attempted once per request without following contact links", async () => {
  let calls = 0;
  const session = createOperatorVisitEnricher(options({ fetcher: async () => { calls++; return response('<a href="/contact">Contact</a>'); } })).forRequest();
  await session.enrichSelected([row], { selectedIds: [row.id] });
  await session.enrichSelected([row], { selectedIds: [row.id] });
  assert.equal(calls, 1);
});

test("private targets, unrelated redirects and oversized selected pages stay unknown", async () => {
  for (const extra of [
    { resolveHost: async () => [{ address: "127.0.0.1", family: 4 }], fetcher: async () => assert.fail("private network") },
    { fetcher: async () => new Response("", { status: 302, headers: { location: "https://unrelated.example/" } }) },
    { fetcher: async () => response("x".repeat(512 * 1024 + 1)) },
  ]) {
    const session = createOperatorVisitEnricher(options(extra)).forRequest();
    assert.equal((await session.enrichSelected([row], { selectedIds: [row.id] }))[0].opening_hours, undefined);
  }
});

test("canonical www redirects stay pinned and retain the exact final hours source", async () => {
  const hosts = [];
  const session = createOperatorVisitEnricher(options({ resolveHost: async host => { hosts.push(host); return dns(); },
    fetcher: async url => url.includes("//www.") ? new Response("", { status: 301, headers: { location: row.website } }) : response(html(entity())),
  })).forRequest();
  const changed = { ...row, website: "https://www.juniper.example/visit" };
  const [result] = await session.enrichSelected([changed], { selectedIds: [changed.id] });
  assert.equal(result.opening_hours_source.url, row.website);
  assert.deepEqual(hosts, ["www.juniper.example", "juniper.example"]);
});

test("source-owned HTTP identities can match their exact safely fetched HTTPS page", async () => {
  const original = { ...row, website: "http://juniper.example/visit" };
  const seen = [];
  const session = createOperatorVisitEnricher(options({ fetcher: async url => {
    seen.push(url);
    return response(html(entity({ url: original.website, "@id": original.website + "#place" })));
  } })).forRequest();
  const [result] = await session.enrichSelected([original], { selectedIds: [original.id] });
  assert.equal(result.opening_hours, "Mo-Su 09:00-17:00");
  assert.equal(result.opening_hours_source.url, "https://juniper.example/visit");
  assert.deepEqual(seen, ["https://juniper.example/visit"]);
});

test("cancellation rejects promptly and an abort-ignoring late response cannot fill the cache", async () => {
  let settle, started;
  const ready = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const factory = createOperatorVisitEnricher(options({ fetcher: async () => { calls++; started(); return new Promise(resolve => { settle = resolve; }); } }));
  const controller = new AbortController();
  const result = factory.forRequest().enrichSelected([row], { selectedIds: [row.id], signal: controller.signal });
  await ready; controller.abort();
  await assert.rejects(result, /abort/i);
  settle(response(html(entity())));
  await new Promise(resolve => setImmediate(resolve));
  const next = factory.forRequest().enrichSelected([row], { selectedIds: [row.id] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  settle(response("Unknown"));
  assert.equal((await next)[0].opening_hours, undefined);
});

test("cancelling one request cannot cancel another request's selected-hours acquisition", async () => {
  const pending = [];
  const factory = createOperatorVisitEnricher(options({ fetcher: async (_url, { signal }) => new Promise((resolve, reject) => {
    pending.push({ resolve, signal });
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }) }));
  const controller = new AbortController();
  const first = factory.forRequest().enrichSelected([row], { selectedIds: [row.id], signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  const second = factory.forRequest().enrichSelected([row], { selectedIds: [row.id] });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(first, /abort/i);
  pending[1]?.resolve(response(html(entity())));
  const [result] = await second;
  assert.equal(result.opening_hours, "Mo-Su 09:00-17:00");
  assert.equal(pending.length, 2, "each live request owns its acquisition while positive cached facts remain shared");
  assert.equal(pending[1].signal.aborted, false);
  const [cached] = await factory.forRequest().enrichSelected([row], { selectedIds: [row.id] });
  assert.equal(cached.opening_hours, result.opening_hours);
  assert.equal(pending.length, 2);
});
