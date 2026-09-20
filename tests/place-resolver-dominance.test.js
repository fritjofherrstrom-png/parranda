const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtempSync, rmSync, readdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const { createNominatimPlaceResolver } = require("../server/place-candidates/place-resolver");
const { resolveAgnosticIntake } = require("../server/planner/agnostic-place-intake");

// Provider-shaped fixtures, not production geography rules. Stockholm scores
// reflect the observed provider response; the second city proves generality.
function settlement(name, region, lat, lon, importance, id) {
  return {
    name, display_name: `${name}, ${region}`, lat: String(lat), lon: String(lon),
    importance, osm_type: "node", osm_id: id, type: "city", addresstype: "city",
    address: { city: name, state: region },
    boundingbox: [lat - 0.05, lat + 0.05, lon - 0.05, lon + 0.05].map(String),
  };
}

function resolverFor(rows, options = {}) {
  return createNominatimPlaceResolver({
    fetcher: async () => ({ ok: true, status: 200, json: async () => rows }),
    minIntervalMs: 0,
    ...options,
  });
}

test("old persisted ambiguity is bypassed and the new decision survives restart", async (t) => {
  const cacheDir = mkdtempSync(join(tmpdir(), "parranda-dominance-"));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  const endpointId = createHash("sha256")
    .update("https://nominatim.openstreetmap.org/search|limit:5").digest("hex").slice(0, 16);
  const queryId = createHash("sha256").update("stockholm").digest("hex");
  const oldCache = createSourceCache({ namespace: "place-resolver-nominatim-v2", dir: cacheDir });
  const oldCandidates = [stockholm, maine].map((row) => ({
    label: row.display_name, lat: Number(row.lat), lng: Number(row.lon), confidence: "medium",
  }));
  await oldCache.get(`v2:${endpointId}:${queryId}`, async () => ({ ok: true, candidates: oldCandidates }));
  let fetches = 0;
  const resolver = resolverFor([], {
    cacheDir,
    fetcher: async () => {
      fetches += 1;
      return { ok: true, status: 200, json: async () => [stockholm, maine] };
    },
  });
  const candidates = await resolver("Stockholm");
  assert.equal(fetches, 1, "v2 medium-confidence ambiguity must not survive the semantics change");
  assert.deepEqual(candidates.map((c) => c.confidence), ["medium", "low"]);
  assert.ok(readdirSync(join(cacheDir, "place-resolver-nominatim-v3")).some((file) => file.startsWith("v3_")));
  const restarted = resolverFor([], { cacheDir, fetcher: async () => { throw new Error("cache miss"); } });
  assert.deepEqual(await restarted("Stockholm"), candidates);
});

// Guard regressions: these are existing behaviors, not additional policy.
for (const [description, scores] of [
  ["close competitors", [0.8, 0.75, 0.3]],
  ["margin boundary", [0.8, 0.8 - 0.1]],
  ["literal 0.8/0.7 margin boundary", [0.8, 0.7]],
  ["literal 0.7/0.6 margin boundary", [0.7, 0.6]],
  ["missing competitor importance", [0.8, null]],
  ["all importance missing", [null, null]],
  ["junk-floor leader", [0.19, 0.01]],
]) {
  test(`exact ${description} remain ambiguous`, async () => {
    const rows = scores.map((score, i) => settlement("Shared", `Region ${i}`, i * 10, i * 20, score, i + 1));
    for (const ordered of [rows, [...rows].reverse()]) {
      const result = await resolveAgnosticIntake({ placeQuery: "Shared", placeResolver: resolverFor(ordered) });
      assert.equal(result.anchor, null);
      assert.deepEqual(result.intake.blockers, ["ambiguous_place"]);
      assert.equal(result.intake.candidates.length, rows.length);
    }
  });
}

test("exact lead just beyond the margin still anchors", async () => {
  const winner = settlement("Shared", "Region 0", 0, 0, 0.800000000001, 1);
  const rival = settlement("Shared", "Region 1", 10, 20, 0.7, 2);
  for (const rows of [[winner, rival], [rival, winner]]) {
    const resolver = resolverFor(rows);
    assert.deepEqual((await resolver("Shared")).map((c) => c.confidence), ["medium", "low"]);
    const result = await resolveAgnosticIntake({ placeQuery: "Shared", placeResolver: resolver });
    assert.deepEqual(result.anchor, { lat: 0, lng: 0 });
    assert.deepEqual(result.intake.blockers, []);
  }
});

test("sole exact small settlement still anchors below the popularity floor", async () => {
  const row = settlement("Smallville", "Example region", 5, 6, 0.01, 3);
  const result = await resolveAgnosticIntake({ placeQuery: row.name, placeResolver: resolverFor([row]) });
  assert.deepEqual(result.anchor, { lat: 5, lng: 6 });
  assert.equal(result.intake.resolved.confidence, "medium");
});

test("explicit qualified query is sent intact to provider and selects the namesake", async () => {
  const queries = [];
  const resolver = resolverFor([], {
    fetcher: async (url) => {
      const query = new URL(url).searchParams.get("q");
      queries.push(query);
      // Nominatim does the qualification; do not strip it to the city name or
      // reuse the bare-name dominant result from cache.
      return { ok: true, status: 200, json: async () => query === "Stockholm Maine" ? [maine] : [stockholm, maine] };
    },
  });
  await resolver("Stockholm");
  const result = await resolveAgnosticIntake({ placeQuery: "Stockholm Maine", placeResolver: resolver });
  assert.deepEqual(queries, ["Stockholm", "Stockholm Maine"]);
  assert.deepEqual(result.anchor, { lat: Number(maine.lat), lng: Number(maine.lon) });
});

test("explicit coordinates still override even a dominant place query", async () => {
  let searches = 0;
  const resolver = resolverFor([stockholm, maine]);
  const result = await resolveAgnosticIntake({
    coords: { lat: 47, lng: -68 }, placeQuery: "Stockholm",
    placeResolver: async (query) => { searches += 1; return resolver(query); },
  });
  assert.deepEqual(result.anchor, { lat: 47, lng: -68 });
  assert.equal(searches, 0);
});

test("non-exact administrative container cannot veto the dominant exact settlement", async () => {
  const container = { ...stockholm, name: "Stockholms kommun", display_name: "Stockholms kommun, Sverige", osm_id: 398021, importance: 0.79 };
  const result = await resolveAgnosticIntake({
    placeQuery: "Stockholm", placeResolver: resolverFor([container, maine, stockholm]),
  });
  assert.deepEqual(result.anchor, { lat: Number(stockholm.lat), lng: Number(stockholm.lon) });
});

const stockholm = settlement("Stockholm", "Sverige", 59.3251172, 18.0710935, 0.8025029343706332, 25929985);
const maine = settlement("Stockholm", "Maine, United States", 47.042522, -68.139954, 0.4332019127802897, 12222317);

for (const [winner, namesake] of [
  [stockholm, maine],
  [settlement("Lima", "Perú", -12.0464, -77.0428, 0.85, 1),
    settlement("Lima", "Ohio, United States", 40.7426, -84.1052, 0.45, 2)],
]) {
  test(`dominant exact settlement resolves ${winner.name} independent of provider order`, async () => {
    for (const rows of [[namesake, winner], [winner, namesake]]) {
      const resolver = resolverFor(rows);
      const candidates = await resolver(winner.name);
      assert.deepEqual(candidates.map((c) => c.confidence), ["medium", "low"]);
      const result = await resolveAgnosticIntake({ placeQuery: winner.name, placeResolver: resolver });
      assert.deepEqual(result.anchor, { lat: Number(winner.lat), lng: Number(winner.lon) });
      assert.equal(result.intake.resolved.confidence, "medium");
      assert.equal(result.intake.resolved.provenance, "nominatim_osm");
      assert.deepEqual(result.intake.blockers, []);
    }
  });
}
