#!/usr/bin/env node
"use strict";

// Builds the local OpenStreetMap read path for one region from files already
// on disk. It downloads nothing.
//
//   node scripts/build-osm-extract.js --pbf slovenia.osm.pbf --poly slovenia.poly \
//     --region slovenia --out <dir>
//
// --poly is the extract's own boundary (Geofabrik publishes one beside every
// extract). A place is answered locally only inside it.
//
// The snapshot's data time is read from the file itself: the replication
// timestamp in its header (`osmosis_replication_timestamp`), which is the time
// the data ends. Build time and file time are recorded apart and never used
// for it. A file without that header is refused, unless the operator states
// the time with --data-timestamp; the manifest then says it came from the
// operator. A stated time that disagrees with the header is refused.
//
// The new region is written beside the old one and swapped in with a rename.
// Restart the server after a rebuild. Point PARRANDA_OSM_EXTRACT_DIR at <dir>.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { createHash } = require("node:crypto");
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

// Minimal protobuf reading for the PBF file header block. Only the fields
// needed here are decoded; everything else is skipped by wire type.
function readVarint(buffer, offset) {
  let value = 0n;
  let shift = 0n;
  for (let i = offset; i < buffer.length && i < offset + 10; i += 1) {
    const byte = buffer[i];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: i + 1 };
    shift += 7n;
  }
  throw new Error("malformed varint in the PBF header");
}

function readFields(buffer) {
  const fields = new Map();
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    const field = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    offset = tag.next;
    let value;
    if (wire === 0) {
      const varint = readVarint(buffer, offset);
      value = varint.value;
      offset = varint.next;
    } else if (wire === 2) {
      const length = readVarint(buffer, offset);
      const end = length.next + Number(length.value);
      if (end > buffer.length) throw new Error("truncated PBF header");
      value = buffer.subarray(length.next, end);
      offset = end;
    } else if (wire === 1) {
      offset += 8;
      continue;
    } else if (wire === 5) {
      offset += 4;
      continue;
    } else {
      throw new Error("unsupported wire type in the PBF header");
    }
    if (!fields.has(field)) fields.set(field, value);
  }
  return fields;
}

// The replication timestamp from the first block of an OSM PBF file, as an
// ISO instant, or null when the header does not carry one.
function readPbfReplicationTimestamp(pbfPath) {
  const fd = fs.openSync(pbfPath, "r");
  try {
    const lengthBuffer = Buffer.alloc(4);
    if (fs.readSync(fd, lengthBuffer, 0, 4, 0) !== 4) throw new Error("not an OSM PBF file");
    const headerLength = lengthBuffer.readUInt32BE(0);
    if (headerLength < 1 || headerLength > 64 * 1024) throw new Error("not an OSM PBF file");
    const blobHeader = Buffer.alloc(headerLength);
    fs.readSync(fd, blobHeader, 0, headerLength, 4);
    const headerFields = readFields(blobHeader);
    if (String(headerFields.get(1) || "") !== "OSMHeader") throw new Error("the PBF file does not start with a header block");
    const dataSize = Number(headerFields.get(3) || 0n);
    if (dataSize < 1 || dataSize > 32 * 1024 * 1024) throw new Error("not an OSM PBF file");
    const blob = Buffer.alloc(dataSize);
    fs.readSync(fd, blob, 0, dataSize, 4 + headerLength);
    const blobFields = readFields(blob);
    const block = blobFields.has(1) ? blobFields.get(1)
      : blobFields.has(3) ? zlib.inflateSync(blobFields.get(3))
      : null;
    if (!block) throw new Error("unsupported PBF header compression");
    const seconds = readFields(block).get(32);
    if (typeof seconds !== "bigint" || seconds <= 0n) return null;
    return new Date(Number(seconds) * 1000).toISOString();
  } finally {
    fs.closeSync(fd);
  }
}

// The data time for the manifest and where it came from.
function resolveDataTimestamp({ headerTimestamp, statedTimestamp }) {
  const stated = statedTimestamp ? Date.parse(statedTimestamp) : NaN;
  if (statedTimestamp && !Number.isFinite(stated)) throw new Error("--data-timestamp is not a date");
  if (headerTimestamp) {
    if (statedTimestamp && stated !== Date.parse(headerTimestamp)) {
      throw new Error(`--data-timestamp disagrees with the file header (${headerTimestamp})`);
    }
    return { dataTimestamp: headerTimestamp, source: "pbf_header" };
  }
  if (!statedTimestamp) {
    throw new Error("the file header has no replication timestamp; state the data time with --data-timestamp");
  }
  return { dataTimestamp: new Date(stated).toISOString(), source: "operator" };
}

function isMappedPlace(tags) {
  if (!tags || typeof tags.name !== "string" || !tags.name.trim()) return false;
  return OSM_TAG_MAP.some(({ key, value }) => tags[key] === value);
}

function writeExtractStore({
  outDir, region, dataTimestamp, dataTimestampSource = "operator", coverage, elements,
  tileDeg = TILE_DEG, builtAt = new Date().toISOString(),
}) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(region || ""))) throw new Error("region must be a short lowercase name");
  if (!Number.isFinite(Date.parse(dataTimestamp))) throw new Error("data timestamp is not a date");
  if (!["pbf_header", "operator"].includes(dataTimestampSource)) throw new Error("unknown data timestamp source");
  const regionDir = path.join(outDir, region);
  // Build beside the live region, then swap it in with one rename, so a
  // reader never meets a half-written region.
  const buildDir = path.join(outDir, `.${region}.building-${process.pid}-${Date.now()}`);
  const tilesDir = path.join(buildDir, "tiles");
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
  const inventory = {};
  for (const [key, tile] of tiles) {
    const raw = Buffer.from(JSON.stringify(tile));
    fs.writeFileSync(path.join(tilesDir, `${key}.json`), raw);
    inventory[key] = { n: tile.length, sha256: createHash("sha256").update(raw).digest("hex") };
  }
  // The manifest is written last: a region without one is not used.
  fs.writeFileSync(path.join(buildDir, "manifest.json"), JSON.stringify({
    format: OSM_EXTRACT_FORMAT,
    region,
    data_timestamp: new Date(Date.parse(dataTimestamp)).toISOString(),
    data_timestamp_source: dataTimestampSource,
    built_at: builtAt,
    tile_deg: tileDeg,
    element_count: count,
    tile_count: tiles.size,
    attribution: ATTRIBUTION,
    coverage,
    tiles: inventory,
  }));
  const retiredDir = path.join(outDir, `.${region}.retired-${process.pid}-${Date.now()}`);
  const hadPrevious = fs.existsSync(regionDir);
  if (hadPrevious) fs.renameSync(regionDir, retiredDir);
  fs.renameSync(buildDir, regionDir);
  if (hadPrevious) fs.rmSync(retiredDir, { recursive: true, force: true });
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
  for (const name of ["pbf", "poly", "region", "out"]) {
    if (!args[name]) {
      console.error("usage: build-osm-extract.js --pbf <file> --poly <file> --region <name> --out <dir> [--data-timestamp <iso>]");
      process.exit(2);
    }
  }
  const started = Date.now();
  const coverage = parsePolyFile(fs.readFileSync(args.poly, "utf8"));
  const { dataTimestamp, source } = resolveDataTimestamp({
    headerTimestamp: readPbfReplicationTimestamp(args.pbf),
    statedTimestamp: args["data-timestamp"] || null,
  });
  const tempDir = path.join(args.out, ".build-tmp");
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    const elements = await readPlaces(args.pbf, { tempDir, memoryLimit: args["memory-limit"] || "2GB" });
    const written = writeExtractStore({
      outDir: args.out, region: args.region, dataTimestamp, dataTimestampSource: source, coverage, elements,
    });
    console.log(JSON.stringify({ ...written, data_timestamp: dataTimestamp, data_timestamp_source: source, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) }));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => { console.error(error?.message || error); process.exit(1); });

module.exports = { parsePolyFile, writeExtractStore, isMappedPlace, readPbfReplicationTimestamp, resolveDataTimestamp };
