const test = require("node:test");
const assert = require("node:assert/strict");

const { buildGeocodeQuery, geocodeQuery } = require("../server/geocoding");

const originalFetch = global.fetch;

test.after(() => {
  global.fetch = originalFetch;
});

test("buildGeocodeQuery fungerar generiskt med lokala items utan extern fetch", async () => {
  const query = buildGeocodeQuery({
    items: [
      {
        id: "sample-1",
        name: "Harbor Steps",
        lat: 41.1,
        lng: 2.1,
        kind: "viewpoint",
        area: "Waterfront",
        searchTerms: ["steps", "harbor"],
      },
    ],
    findByName(name) {
      return name === "Harbor Steps"
        ? {
            id: "sample-1",
            name: "Harbor Steps",
            lat: 41.1,
            lng: 2.1,
            kind: "viewpoint",
            area: "Waterfront",
          }
        : null;
    },
    searchLabel: "Test City",
    countryLabel: "Testland",
  });

  const results = await query("Harbor Steps");

  assert.equal(results.length, 1);
  assert.equal(results[0].label, "Harbor Steps");
  assert.equal(results[0].lat, 41.1);
  assert.equal(results[0].lng, 2.1);
  assert.equal(results[0].source, "catalog");
});

test("buildGeocodeQuery använder injicerad city-sökning vid extern geocoding", async () => {
  let requestedUrl = null;
  let requestedUserAgent = null;

  global.fetch = async (url, options = {}) => {
    requestedUrl = String(url);
    requestedUserAgent = options.headers?.["User-Agent"] || null;

    return {
      ok: true,
      async json() {
        return [
          {
            display_name: "Harbor Steps, Test City, Testland",
            lat: "41.1",
            lon: "2.1",
            type: "viewpoint",
          },
        ];
      },
    };
  };

  const query = buildGeocodeQuery({
    items: [],
    findByName: () => null,
    searchLabel: "Test City",
    countryLabel: "Testland",
    defaultAreaLabel: "Test City",
    userAgent: "Parranda Test City/1.0",
  });

  const results = await query("Harbor Steps");
  const parsedUrl = new URL(requestedUrl);

  assert.equal(parsedUrl.searchParams.get("q"), "Harbor Steps, Test City, Testland");
  assert.equal(requestedUserAgent, "Parranda Test City/1.0");
  assert.equal(results[0].area, "Test City");
  assert.equal(results[0].source, "nominatim");
  assert.ok(!parsedUrl.searchParams.get("q").includes("Rome"));
});

test("legacy geocodeQuery behåller Rome-kompatibilitet via katalogträff", async () => {
  const results = await geocodeQuery("Trastevere");

  assert.ok(results.length >= 1);
  assert.equal(results[0].label, "Trastevere");
  assert.equal(typeof results[0].lat, "number");
  assert.equal(typeof results[0].lng, "number");
  assert.equal(results[0].source, "catalog");
});
