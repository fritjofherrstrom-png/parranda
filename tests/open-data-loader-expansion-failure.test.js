"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createOpenDataLoader } = require("../server/place-candidates/open-data-loader");

const ENDPOINT = "https://overpass.example.test/api/interpreter";
const THIN_ELEMENTS = [
  { type: "node", id: 1, lat: 1, lon: 1, tags: { name: "Base museum", tourism: "museum" } },
  { type: "node", id: 2, lat: 1.001, lon: 1, tags: { name: "Base cafe", amenity: "cafe" } },
];

async function loadExpansion(firstElements, { widerStatus = 503, widerElements = [] } = {}) {
  const calls = [];
  const loader = createOpenDataLoader({
    endpoint: ENDPOINT,
    radiusKm: 1.5,
    fetcher: async (endpoint, options) => {
      const query = decodeURIComponent(options.body);
      calls.push({ endpoint, radiusM: Number(query.match(/around:(\d+)/)?.[1]) });
      if (calls.length === 1) {
        return { ok: true, status: 200, json: async () => ({ elements: firstElements }) };
      }
      return {
        ok: widerStatus === 200,
        status: widerStatus,
        json: async () => ({ elements: widerElements }),
      };
    },
  });
  return { records: await loader({ lat: 1, lng: 1 }), calls };
}

function assertOneBoundedExpansion(calls) {
  assert.deepEqual(calls, [
    { endpoint: ENDPOINT, radiusM: 1500 },
    { endpoint: ENDPOINT, radiusM: 5000 },
  ], "one base query and one wider query use the same endpoint, without another attempt");
}

test("a failed wider query preserves thin base supply and reports its source failure", async () => {
  const { records, calls } = await loadExpansion(THIN_ELEMENTS);

  assertOneBoundedExpansion(calls);
  assert.deepEqual(records.map(({ id, name, type }) => ({ id, name, type })), [
    { id: "osm-node-1", name: "Base museum", type: "museum" },
    { id: "osm-node-2", name: "Base cafe", type: "cafe" },
  ]);
  assert.equal(records.loader_status, "loaded:2", "valid base rows remain usable after the wider failure");
  assert.equal(records.loader_metadata.selected_radius_km, 1.5);
  assert.equal(records.loader_metadata.expansion_applied, false);
  assert.equal(records.loader_error, "http_non_200", "the rejected wider result must not erase the safe error token");
});

test("a failed wider query preserves a real empty base answer without hiding the source failure", async () => {
  const { records, calls } = await loadExpansion([]);

  assertOneBoundedExpansion(calls);
  assert.deepEqual(records, []);
  assert.equal(records.loader_status, "loaded:0", "the successful base query remains a real empty answer");
  assert.equal(records.loader_metadata.selected_radius_km, 1.5);
  assert.equal(records.loader_metadata.expansion_applied, false);
  assert.equal(records.loader_error, "http_non_200", "failure to collect the wider aperture remains visible");
});

test("a successful non-richer wider query keeps base supply without inventing a source failure", async () => {
  const { records, calls } = await loadExpansion(THIN_ELEMENTS, { widerStatus: 200 });

  assertOneBoundedExpansion(calls);
  assert.deepEqual(records.map(record => record.id), ["osm-node-1", "osm-node-2"]);
  assert.equal(records.loader_status, "loaded:2");
  assert.equal(records.loader_metadata.selected_radius_km, 1.5);
  assert.equal(records.loader_metadata.expansion_applied, false);
  assert.equal(records.loader_error, null);
});
