#!/usr/bin/env node
"use strict";

// Builds the local OpenStreetMap read path for one region from files already
// on disk. It downloads nothing.
//
//   node scripts/build-osm-extract.js --pbf slovenia.osm.pbf --poly slovenia.poly \
//     --region slovenia --data-timestamp 2026-11-14T21:20:00Z --out <dir>
//
// --poly is the extract's own boundary (Geofabrik publishes one beside every
// extract). A place is answered locally only inside it. --data-timestamp is the
// time the extract's data ends (Geofabrik: "contains all OSM data up to").
// Point PARRANDA_OSM_EXTRACT_DIR at <dir> to use the result.

const fs = require("node:fs");
const path = require("node:path");
const { OSM_TAG_MAP } = require("../server/place-candidates/open-data-loader");
const { OSM_EXTRACT_FORMAT } = require("../server/place-candidates/osm-extract-store");

const TILE_DEG = 0.05;
const ATTRIBUTION = "© OpenStreetMap contributors, ODbL 1.0";

function parsePolyFile(text) {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim());
  const coverage = [];
  let ring = null;
  let hole = false;
  for (const line of lines.slice(1)) {
    if (!line) continue;
    if (line === "END") {
      if (ring) {
        if (ring.length >= 3) {
          if (hole) {
            if (coverage.length) coverage[coverage.length - 1].holes.push(ring);
          } else coverage.push({ outer: ring, holes: [] });
        }
        ring = null;
      }
      continue;
    }
    const numbers = line.split(/\s+/).map(Number);
    if (ring && numbers.length === 2 && numbers.every(Number.isFinite)) {
      ring.push(numbers);
    } else if (!ring) {
      ring = [];
      hole = line.startsWith("!");
    }
  }
  if (!coverage.length) throw new Error("no polygon found in the boundary file");
  return coverage;
}

function isMappedPlace(tags) {
  if (!tags || typeof tags.name !== "string" || !tags.name.trim()) return false;
  return OSM_TAG_MAP.some(({ key, value }) => tags[key] === value);
}

function writeExtractStore({ outDir, region, dataTimestamp, coverage, elements, tileDeg = TILE_DEG }) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(region || ""))) throw new Error("region must be a short lowercase name");
  if (!Number.isFinite(Date.parse(dataTimestamp))) throw new Error("data timestamp is not a date");
  const regionDir = path.join(outDir, region);
  const tilesDir = path.join(regionDir, "tiles");
  fs.rmSync(regionDir, { recursive: true, force: true });
  fs.mkdirSync(tilesDir, { recursive: true });
  const tiles = new Map();
  let count = 0;
  for (const element of elements) {
    const lat = element?.lat ?? element?.center?.lat;
    const lon = element?.lon ?? element?.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isMappedPlace(element.tags)) continue;
    const key = `${Math.floor(lat / tileDeg)}_${Math.floor(lon / tileDeg)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(element);
    count += 1;
  }
  for (const [key, tile] of tiles) fs.writeFileSync(path.join(tilesDir, `${key}.json`), JSON.stringify(tile));
  // The manifest is written last: a store without one is not used.
  fs.writeFileSync(path.join(regionDir, "manifest.json"), JSON.stringify({
    format: OSM_EXTRACT_FORMAT,
    region,
    data_timestamp: new Date(Date.parse(dataTimestamp)).toISOString(),
    tile_deg: tileDeg,
    element_count: count,
    tile_count: tiles.size,
    attribution: ATTRIBUTION,
    coverage,
  }));
  return { element_count: count, tile_count: tiles.size, dir: regionDir };
}

function tagFilterSql() {
  const byKey = new Map();
  for (const { key, value } of OSM_TAG_MAP) {
    if (!/^[a-z_]+$/.test(key) || !/^[a-z_]+$/.test(value)) throw new Error("unexpected tag in the mapping");
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(value);
  }
  return [...byKey].map(([key, values]) => `tags['${key}'] IN (${[...values].map(value => `'${value}'`).join(",")})`).join(" OR ");
}

async function readPlaces(pbfPath, { memoryLimit = "2GB", tempDir }) {
  const { DuckDBInstance } = require("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  const sqlPath = value => String(value).replace(/'/g, "''");
  await conn.run(`INSTALL spatial; LOAD spatial; SET memory_limit='${memoryLimit}'; SET temp_directory='${sqlPath(tempDir)}'`);
  const source = `st_readosm('${sqlPath(pbfPath)}')`;
  await conn.run(`CREATE TABLE picked AS SELECT kind::VARCHAR AS kind, id, tags, lat, lon, refs, ref_types
    FROM ${source} WHERE tags IS NOT NULL AND tags['name'] IS NOT NULL AND (${tagFilterSql()})`);
  // A way or relation is placed at the middle of its bounding box, as
  // Overpass does for `out center`. Relations use their member ways.
  await conn.run(`CREATE TABLE member_ways AS
    SELECT id AS owner, 'way' AS owner_kind, id AS way_id FROM picked WHERE kind = 'way'
    UNION ALL
    SELECT owner, 'relation', way_id FROM (
      SELECT id AS owner, unnest(refs) AS way_id, unnest(ref_types)::VARCHAR AS ref_type FROM picked WHERE kind = 'relation'
    ) WHERE ref_type = 'way'`);
  await conn.run(`CREATE TABLE way_nodes AS
    SELECT m.owner, m.owner_kind, unnest(w.refs) AS node_id
    FROM member_ways m JOIN (SELECT id, refs FROM ${source} WHERE kind = 'way') w ON w.id = m.way_id`);
  await conn.run(`CREATE TABLE centres AS
    SELECT x.owner, x.owner_kind, (min(n.lat) + max(n.lat)) / 2 AS lat, (min(n.lon) + max(n.lon)) / 2 AS lon
    FROM way_nodes x JOIN (SELECT id, lat, lon FROM ${source} WHERE kind = 'node') n ON n.id = x.node_id
    GROUP BY x.owner, x.owner_kind`);
  const reader = await conn.runAndReadAll(`
    SELECT kind, id::VARCHAR AS id, lat, lon, to_json(tags)::VARCHAR AS tags FROM picked WHERE kind = 'node'
    UNION ALL
    SELECT p.kind, p.id::VARCHAR, c.lat, c.lon, to_json(p.tags)::VARCHAR
    FROM picked p JOIN centres c ON c.owner = p.id AND c.owner_kind = p.kind WHERE p.kind IN ('way', 'relation')`);
  const elements = reader.getRowObjectsJson().map(row => {
    const base = { type: row.kind, id: Number(row.id), tags: JSON.parse(row.tags) };
    return row.kind === "node"
      ? { ...base, lat: Number(row.lat), lon: Number(row.lon) }
      : { ...base, center: { lat: Number(row.lat), lon: Number(row.lon) } };
  });
  conn.closeSync();
  return elements;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[String(argv[i]).replace(/^--/, "")] = argv[i + 1];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const name of ["pbf", "poly", "region", "data-timestamp", "out"]) {
    if (!args[name]) {
      console.error("usage: build-osm-extract.js --pbf <file> --poly <file> --region <name> --data-timestamp <iso> --out <dir>");
      process.exit(2);
    }
  }
  const started = Date.now();
  const coverage = parsePolyFile(fs.readFileSync(args.poly, "utf8"));
  const tempDir = path.join(args.out, ".build-tmp");
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    const elements = await readPlaces(args.pbf, { tempDir, memoryLimit: args["memory-limit"] || "2GB" });
    const written = writeExtractStore({ outDir: args.out, region: args.region, dataTimestamp: args["data-timestamp"], coverage, elements });
    console.log(JSON.stringify({ ...written, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) }));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error?.message || error); process.exit(1); });

module.exports = { parsePolyFile, writeExtractStore, isMappedPlace };
