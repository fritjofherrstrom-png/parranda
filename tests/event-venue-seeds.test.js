"use strict";

// Event venues as website seeds: one bounded WDQS area query per cell.
// Recorded response only; no live network.
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildVenueQuery,
  createEventVenueSeeds,
  resolveDefaultEventVenueSeeds,
  venueSeedsFromBindings,
} = require("../server/pulse-sources/event-venue-seeds");
// Recorded 2026-10-18 from query.wikidata.org (CC0) for Berlin-Mitte, 3 km.
const recorded = require("./fixtures/wdqs-event-venues-berlin-20261018.json");

function memoryCache() {
  const store = new Map();
  return {
    async get(key, producer, { shouldStore = () => true } = {}) {
      if (store.has(key)) return store.get(key);
      const value = await producer();
      if (shouldStore(value)) store.set(key, value);
      return value;
    },
  };
}
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("the query is one bounded area query over event venue classes with an official website", () => {
  const query = buildVenueQuery({ lat: 52.52, lng: 13.39, radiusKm: 3 });
  assert.match(query, /wikibase:around/);
  assert.match(query, /"Point\(13\.39 52\.52\)"/);
  assert.match(query, /bd:serviceParam wikibase:radius "3"/);
  assert.match(query, /wdt:P856/, "only venues with an official website");
  assert.match(query, /wdt:P576[\s\S]*wdt:P3999/, "dissolved and closed venues are excluded");
  assert.match(query, /\(wd:Q1060829 0\)/, "concert halls rank first");
  assert.match(query, /GROUP BY \?item ORDER BY \?bestRank \?dist LIMIT \d+$/);
});

test("recorded Berlin venues become stage-first seeds, one per website", () => {
  const seeds = venueSeedsFromBindings(recorded.results.bindings);
  assert.ok(seeds.length >= 20, `recorded shape yields many venues (${seeds.length})`);
  const labels = seeds.slice(0, 6).map((seed) => seed.label);
  assert.ok(labels.includes("Admiralspalast") && labels.includes("Konzerthaus Berlin"), labels.join(", "));
  const kinds = seeds.map((seed) => seed.venue_kind);
  const firstLowRank = kinds.findIndex((kind) => ["library", "museum", "art_gallery", "venue"].includes(kind));
  assert.ok(kinds.slice(0, firstLowRank).every((kind) => !["library", "museum", "art_gallery", "venue"].includes(kind)),
    "stages, halls and clubs come before libraries, museums and generic venues");
  const hosts = seeds.map((seed) => new URL(seed.url).hostname.replace(/^www\./, ""));
  assert.equal(new Set(hosts).size, hosts.length, "one seed per website");
  for (const seed of seeds) {
    assert.match(seed.wikidata_ref, /^Q\d+$/);
    assert.ok(Number.isFinite(seed.lat) && Number.isFinite(seed.lng));
    assert.equal(seed.discovery_method, "wikidata_venue_website");
    assert.equal(seed.trust_tier, "inferred", "a website seed raises no trust");
  }
});

test("rows without a usable website, coordinate or venue class are dropped, never repaired", () => {
  const row = (overrides) => ({
    item: { value: "http://www.wikidata.org/entity/Q1" }, itemLabel: { value: "Hall" }, classes: { value: "http://www.wikidata.org/entity/Q1060829" },
    website: { value: "https://hall.example/" }, lat: { value: "52.5" }, lng: { value: "13.4" }, dist: { value: "0.4" }, ...overrides,
  });
  assert.equal(venueSeedsFromBindings([row({})]).length, 1);
  for (const broken of [
    { website: { value: "javascript:alert(1)" } },
    { website: { value: "https://user:pw@hall.example/" } },
    { website: { value: "http://127.0.0.1/" } },
    { lat: { value: "not a number" } },
    { classes: { value: "http://www.wikidata.org/entity/Q5" } },
    { item: { value: "http://www.wikidata.org/entity/L1" } },
  ]) assert.deepEqual(venueSeedsFromBindings([row(broken)]), [], JSON.stringify(broken));
  const shared = venueSeedsFromBindings([
    row({}), row({ item: { value: "http://www.wikidata.org/entity/Q2" }, website: { value: "https://www.hall.example/other" }, dist: { value: "0.1" } }),
  ]);
  assert.equal(shared.length, 1, "two venues on one website are one seed");
});

test("a cell is looked up once and kept; a failed lookup is not kept", async () => {
  const urls = [];
  let fail = true;
  const seeds = createEventVenueSeeds({
    cache: memoryCache(),
    fetcher: async (url, init) => {
      urls.push(url);
      assert.match(init.headers["User-Agent"], /^Parranda\//);
      if (fail) { fail = false; return json({}, 503); }
      return json(recorded);
    },
  });
  const failed = await seeds({ anchor: { lat: 52.5203, lng: 13.3897 } });
  assert.deepEqual([failed.status, failed.reason, failed.seeds.length], ["failed", "venue_lookup_http_503", 0]);
  const first = await seeds({ anchor: { lat: 52.5203, lng: 13.3897 } });
  const again = await seeds({ anchor: { lat: 52.5197, lng: 13.3903 } });
  assert.equal(first.status, "ok");
  assert.ok(first.seeds.length >= 20);
  assert.deepEqual(again, first, "the same ~1 km cell reuses the lookup");
  assert.equal(urls.length, 2);
  assert.match(decodeURIComponent(urls[1]), /Point\(13\.39 52\.52\)/, "the query centre is the rounded cell, not the exact anchor");
});

test("an invalid anchor, a broken body or a hanging service is a failed lookup, never a throw", async () => {
  const broken = createEventVenueSeeds({ cache: memoryCache(), fetcher: async () => json({ unexpected: true }) });
  assert.equal((await broken({ anchor: { lat: 52.5, lng: 13.4 } })).reason, "venue_lookup_invalid");
  assert.equal((await broken({ anchor: { lat: 200, lng: 13.4 } })).reason, "invalid_anchor");
  const hanging = createEventVenueSeeds({ cache: memoryCache(), timeoutMs: 100,
    fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))) });
  assert.equal((await hanging({ anchor: { lat: 52.5, lng: 13.4 } })).reason, "venue_lookup_timeout");
});

test("the default follows request-time discovery and has its own opt-in and opt-out", () => {
  assert.equal(resolveDefaultEventVenueSeeds({}), null, "off without the configured lane");
  assert.equal(typeof resolveDefaultEventVenueSeeds({ PARRANDA_SOURCE_SEARCH: "enabled" }), "function");
  assert.equal(resolveDefaultEventVenueSeeds({ PARRANDA_SOURCE_SEARCH: "enabled", PARRANDA_EVENT_VENUE_SEEDS: "disabled" }), null);
  assert.equal(typeof resolveDefaultEventVenueSeeds({ PARRANDA_EVENT_VENUE_SEEDS: "enabled" }), "function");
});
