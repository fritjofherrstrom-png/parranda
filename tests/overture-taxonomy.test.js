"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DuckDBInstance } = require("@duckdb/node-api");
const { buildOvertureQuery, mapOvertureRow, categoryMapping, createOvertureSource } = require("../server/place-candidates/overture-source");

function row(primary = "coffee_shop", hierarchy = ["food_and_drink", "non_alcoholic_beverage_venue", primary]) {
  return {
    id: "10000000-0000-0000-0000-000000000001", name: "Generic fixture",
    category: primary, category_hierarchy: hierarchy,
    lat: 40, lng: 12, confidence: 0.99, licenses: ["CC0-1.0"],
  };
}

test("missing, malformed and conflicting taxonomy cannot fall back to legacy, basic or alternate categories", () => {
  for (const hierarchy of [undefined, null, [], "coffee_shop", ["park"], ["coffee_shop", "coffee_shop"], [12, "coffee_shop"], ["", "coffee_shop"], ["coffee_shop", "park"], Array(17).fill("coffee_shop")]) {
    assert.equal(mapOvertureRow({ ...row(), category_hierarchy: hierarchy,
      categories: { primary: "coffee_shop" }, basic_category: "cafe", alternates: ["cafe"] }), null);
  }
  for (const primary of [null, "", "Coffee Shop", "coffee-shop", "future_restaurant"]) {
    assert.equal(mapOvertureRow(row(primary, [primary])), null);
  }
});

test("only reviewed primary meanings contribute intent, never basic category or ancestors", () => {
  assert.equal(mapOvertureRow({ ...row("playground", ["sports_and_recreation", "park", "playground"]),
    basic_category: "park", alternates: ["park"] }), null);
  assert.equal(mapOvertureRow({ ...row("bookstore", ["retail", "bookstore"]), alternates: ["coffee_shop"] }), null);
  const cafe = mapOvertureRow({ ...row(), alternates: ["bookstore", "park"], basic_category: "park" });
  assert.equal(cafe.type, "cafe");
  assert.deepEqual(cafe.tags, ["fika", "coffee"]);
  assert.equal("category_hierarchy" in cafe, false);
  assert.equal("alternates" in cafe, false);
});

test("closed primary mapping distinguishes food and non-alcoholic bars from nightlife", () => {
  assert.equal(categoryMapping("salad_bar")?.type, "restaurant");
  assert.equal(categoryMapping("tapas_bar")?.type, "restaurant");
  for (const primary of ["milk_bar", "smoothie_juice_bar", "hair_color_bar", "oxygen_bar", "future_bar", "future_museum", "stock_market"]) {
    assert.equal(categoryMapping(primary), null, primary);
  }
  assert.equal(categoryMapping("cocktail_bar")?.type, "bar");
  assert.equal(categoryMapping("scandinavian_restaurant")?.type, "restaurant");
  assert.equal(categoryMapping("science_museum")?.type, "museum");
  assert.equal(categoryMapping("public_market")?.type, "market");
});

test("production SQL executes against taxonomy-only Parquet and ignores conflicting legacy columns", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-taxonomy-sql-"));
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  t.after(() => { conn.closeSync(); instance.closeSync(); fs.rmSync(dir, { recursive: true, force: true }); });
  await conn.run(`CREATE TABLE fixtures (
    id VARCHAR, names STRUCT("primary" VARCHAR),
    taxonomy STRUCT("primary" VARCHAR, hierarchy VARCHAR[], alternates VARCHAR[]),
    basic_category VARCHAR, confidence DOUBLE, operating_status VARCHAR,
    websites VARCHAR[], brand STRUCT(names STRUCT("primary" VARCHAR)),
    sources STRUCT(license VARCHAR)[], bbox STRUCT(xmin DOUBLE, ymin DOUBLE))`);
  const cases = [
    ["cafe", ["food_and_drink", "casual_eatery", "cafe"], "cafe"],
    ["garden", ["geographic_entities", "built_feature", "garden"], "garden"],
    ["playground", ["sports_and_recreation", "park", "playground"], "park"],
    ["bookstore", ["retail", "bookstore"], "coffee_shop"],
    ["salad_bar", ["food_and_drink", "restaurant", "salad_bar"], "bar"],
    ["garden", ["park"], "garden"], // inconsistent leaf
  ];
  for (const [i, [primary, hierarchy, basic]] of cases.entries()) {
    await conn.run(`INSERT INTO fixtures VALUES (?, {'primary': ?},
      ?::JSON::STRUCT("primary" VARCHAR, hierarchy VARCHAR[], alternates VARCHAR[]),
      ?, 0.99, 'open', [], {'names': {'primary': NULL}}, [{'license': 'CC0-1.0'}], {'xmin': 12.0, 'ymin': 40.0})`,
    [`10000000-0000-0000-0000-${String(i).padStart(12, "0")}`, `Fixture ${i}`, JSON.stringify({ primary, hierarchy, alternates: [basic] }), basic]);
  }
  const sql = buildOvertureQuery({ release: "2026-08-19.0", lat: 40, lng: 12 });
  // Replace ONLY the remote relation with a generated local Parquet artifact.
  // Projection/filter/order/limit all remain the actual production SQL.
  for (const legacy of [false, true]) {
    if (legacy) await conn.run(`ALTER TABLE fixtures ADD categories STRUCT("primary" VARCHAR, alternate VARCHAR[]); UPDATE fixtures SET categories = {'primary': 'park', 'alternate': ['park']}`);
    const file = path.join(dir, legacy ? "dual.parquet" : "taxonomy.parquet");
    await conn.run(`COPY fixtures TO '${file}' (FORMAT PARQUET)`);
    const localSql = sql.replace(/s3:\/\/[^']+/, file);
    const queryRows = async () => (await conn.runAndReadAll(localSql)).getRowObjectsJson();
    // Binder errors must not be hidden by the source's fail-soft [] wrapper.
    assert.ok((await queryRows()).length >= 3);
    if (!legacy) await assert.rejects(conn.runAndReadAll(`SELECT categories.primary FROM read_parquet('${file}')`), /categories/);
    const source = createOvertureSource({ releaseResolver: async () => "2026-08-19.0", queryRows });
    const mapped = await source({ lat: 40, lng: 12 });
    assert.deepEqual(mapped.map(r => r.type).sort(), ["cafe", "garden", "restaurant"]);
    assert.ok(mapped.every(r => r.sources.length === 1 && r.sources[0].family === "open_directory"));
  }
});

test("invalid new taxonomy and legacy-only rows cannot use name, basic or alternate fallback", () => {
  const legacy = { ...row(), name: "Park Cafe Museum", alternate: ["park"], basic_category: "park" };
  delete legacy.category_hierarchy;
  assert.equal(mapOvertureRow(legacy), null);
  assert.equal(mapOvertureRow(row("future_park", ["sports_and_recreation", "park", "future_park"])), null);
  assert.equal(mapOvertureRow(row("garden", ["geographic_entities", "bad category", "garden"])), null);
});

test("one taxonomy query keeps geographic/output budgets and rejects unsafe row states", async () => {
  let queries = 0;
  let resolutions = 0;
  const source = createOvertureSource({
    radiusKm: 1000, limit: 1000,
    releaseResolver: async () => { resolutions++; return "2026-08-19.0"; },
    queryRows: async (sql) => {
      queries++;
      assert.match(sql, /LIMIT 600$/);
      assert.doesNotMatch(sql, /categories\.|basic_category|alternates/);
      return [
        { ...row(), lng: 13 }, // far outside the hard five-kilometre aperture
        { ...row(), confidence: 0.5 },
        { ...row(), operating_status: "closed_permanently" },
        { ...row(), licenses: ["unknown"] },
        ...Array.from({ length: 150 }, (_, i) => ({ ...row(), id: `10000000-0000-0000-0000-${String(i).padStart(12, "0")}` })),
      ];
    },
  });
  const records = await source({ lat: 40, lng: 12 });
  assert.equal(records.length, 100);
  assert.equal(queries, 1);
  assert.equal(resolutions, 1);
  assert.ok(records.every(r => r.lng === 12 && r.operational_status !== "inactive"));
});
