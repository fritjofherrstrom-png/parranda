"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createSearxngSourceSearch } = require("../server/pulse-sources/source-search-provider");
const { buildLocalEventDiscoveryQueryPlan } = require("../server/pulse-sources/local-event-source-scout");

const ENDPOINT = "https://search.example/search";
const PLACE = {
  label: "Riveclaire, Département des Rives, France",
  name: "Riveclaire",
  language_hints: ["fr"],
  local_discovery_terms: ["événements", "agenda", "marché", "concert"],
};

function response(payload) {
  return {
    ok: true,
    status: 200,
    url: ENDPOINT,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  };
}

function genericRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    url: `https://guide-${index}.example/place`,
    title: `Riveclaire guide ${index}`,
    content: "History, practical information and administrative services.",
  }));
}

function eventPlan(place = PLACE) {
  return buildLocalEventDiscoveryQueryPlan({ place, localDiscoveryTerms: place.local_discovery_terms })
    .filter(item => ["locality", "resolved_label"].includes(item.label_scope))
    .slice(0, 2);
}

async function searchRows(rows, { place = PLACE, plan = eventPlan(place), cache = null, fetcher = null } = {}) {
  const calls = [];
  const search = createSearxngSourceSearch({
    endpoint: ENDPOINT,
    maxQueries: 2,
    hardQueryLimit: 2,
    queryPaceMs: 0,
    cache,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return fetcher ? fetcher(url, options) : response({ results: rows });
    },
  });
  const input = { queries: plan.map(item => item.query), query_plan: plan, place };
  return { result: await search(input), calls, search, input };
}

test("explicit local programme hints survive the unchanged five-result search prefix", async () => {
  const programmeUrl = "https://destination.example/";
  const rows = [
    ...genericRows(6),
    { url: programmeUrl, title: "Découvrir Riveclaire", content: "Grands spectacles, concerts et expositions toute l'année." },
    ...genericRows(3).map(row => ({ ...row, url: row.url.replace("guide-", "later-") })),
  ];
  const { result, calls } = await searchRows(rows);
  assert.ok(result.seeds.some(seed => seed.url === programmeUrl), "raw result seven must be inspected as a low-trust source hint, not lost behind general guides");
  assert.equal(calls.length, 2, "no additional query or retry allowance");
  assert.equal(result.result_count, 10, "the same five results per query remain selected");
  assert.equal(result.seeds.length, 5);
  const programme = result.seeds.find(seed => seed.url === programmeUrl);
  assert.equal(programme.trust_tier, "unknown");
  assert.equal(programme.family, "unknown_source_family");
  assert.equal(result.activation_performed, false);
  assert.doesNotMatch(JSON.stringify(result), /Grands spectacles|expositions|event_rows|feeds/);
});

function memoryCache(values = new Map()) {
  return {
    get: async (key, producer, options) => {
      if (values.has(key)) return values.get(key);
      const value = await producer();
      if (options.shouldStore(value)) values.set(key, value);
      return value;
    },
  };
}

test("query caches isolate topic policy and reuse only the current hint context", async () => {
  const url = "https://destination.example/";
  const rows = [...genericRows(6), { url, title: "Riveclaire", content: "Concerts locaux" }];
  const cache = memoryCache();
  const plan = [eventPlan()[0]];
  const ordinary = await searchRows(rows, { cache, plan: [{ ...plan[0], query_family: "unclassified" }] });
  assert.ok(!ordinary.result.seeds.some(seed => seed.url === url));
  const topical = await searchRows(rows, { cache, plan });
  assert.ok(topical.result.seeds.some(seed => seed.url === url), "an ordinary query's cached prefix cannot stand in for event-topic selection");
  assert.equal(topical.calls.length, 1);
  const current = await topical.search(topical.input);
  assert.deepEqual(current, topical.result);
  assert.equal(topical.calls.length, 1, "same current policy context is reused");
  const changed = await searchRows(rows, { cache, plan, place: { ...PLACE, local_discovery_terms: ["marché"] } });
  assert.equal(changed.calls.length, 1, "changed local terms must not reuse another ranking's cached prefix");
  assert.ok(!changed.result.seeds.some(seed => seed.url === url));
});

test("legacy unranked cache entries cannot bypass the current source selection", async () => {
  const { createHash } = require("node:crypto");
  const plan = [eventPlan()[0]];
  const key = createHash("sha256").update(`${ENDPOINT}|fr|5|${plan[0].query.toLowerCase()}`).digest("hex");
  const legacy = { status: "ok", results: genericRows(5).map(({ url, title }) => ({ url, title })) };
  const before = JSON.stringify(legacy);
  const values = new Map([[key, legacy]]);
  const url = "https://programme.example/";
  const current = await searchRows([...genericRows(6), { url, content: "concerts" }], { plan, cache: memoryCache(values) });
  assert.ok(current.result.seeds.some(seed => seed.url === url), "legacy cache cannot attest topic-aware discovery");
  assert.equal(current.calls.length, 1);
  assert.equal(JSON.stringify(values.get(key)), before, "legacy evidence is left intact");
});

test("equal topic hints keep provider order and non-event query families keep their original prefix", async () => {
  const tied = genericRows(8).map(row => ({ ...row, content: "Concert local" }));
  const event = await searchRows(tied);
  assert.deepEqual(event.result.seeds.map(seed => seed.url), tied.slice(0, 5).map(row => row.url));
  const rows = [...genericRows(6), { url: "https://programme.example/", content: "concerts" }];
  for (const family of ["unclassified", "local_place_guide", "official_place_guide", "things_to_do_guide"]) {
    const plan = [{ ...eventPlan()[0], query_family: family }];
    const other = await searchRows(rows, { plan });
    assert.deepEqual(other.result.seeds.map(seed => seed.url), rows.slice(0, 5).map(row => row.url));
  }
});

test("local-language hints are accent-insensitive but do not match unrelated word fragments", async () => {
  for (const [term, text, language] of [["événements", "EVENEMENTS locaux", "fr"], ["evenemang", "Evenemang nära dig", "sv"], ["concierto", "Conciertos del barrio", "es"]]) {
    const place = { ...PLACE, language_hints: [language], local_discovery_terms: [term] };
    const url = "https://publisher.example/";
    const result = await searchRows([...genericRows(6), { url, content: text }], { place });
    assert.ok(result.result.seeds.some(seed => seed.url === url), term);
  }
  const place = { ...PLACE, local_discovery_terms: ["market", "concert"] };
  const unrelated = await searchRows([...genericRows(6), { url: "https://irrelevant.example/", content: "Marketing and deconcerting history" }], { place });
  assert.deepEqual(unrelated.result.seeds.map(seed => seed.url), genericRows(5).map(row => row.url));
});

test("unsafe topical results cannot consume the bounded inspection prefix", async () => {
  const rows = [
    { url: "http://127.0.0.1/private", content: "Concerts and events" },
    { url: "https://user:secret@unsafe.example/calendar", content: "Concerts" },
    null,
    { url: "javascript:alert(1)", content: "Events" },
    ...genericRows(6),
    { url: "https://publisher.example/", content: "concerts" },
  ];
  const { result } = await searchRows(rows);
  assert.equal(result.seeds[0].url, "https://publisher.example/");
  assert.equal(result.result_count, 10);
  assert.doesNotMatch(JSON.stringify(result), /127\.0\.0\.1|secret|javascript:|Concerts/);
});

test("topic selection preserves degraded-engine truth instead of declaring clean coverage", async () => {
  const rows = [...genericRows(6), { url: "https://publisher.example/", content: "concerts" }];
  const { result, calls } = await searchRows(rows, { fetcher: async () => response({ results: rows, unresponsive_engines: [["engine_a", "timeout"]] }) });
  assert.equal(result.status, "partial");
  assert.equal(result.seeds[0].url, "https://publisher.example/");
  assert.equal(calls.length, 2);
  assert.ok(result.query_outcomes.every(outcome => outcome.status === "partial" && outcome.engine_failure_count === 1));
  assert.equal(result.activation_performed, false);
});
