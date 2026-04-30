const test = require("node:test");
const assert = require("node:assert/strict");

const { buildGeocodeQuery, geocodeQuery } = require("../server/geocoding");

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

test("legacy geocodeQuery behåller Rome-kompatibilitet via katalogträff", async () => {
  const results = await geocodeQuery("Trastevere");

  assert.ok(results.length >= 1);
  assert.equal(results[0].label, "Trastevere");
  assert.equal(typeof results[0].lat, "number");
  assert.equal(typeof results[0].lng, "number");
  assert.equal(results[0].source, "catalog");
});
