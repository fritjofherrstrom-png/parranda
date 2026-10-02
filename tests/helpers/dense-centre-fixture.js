"use strict";

/**
 * Test-only synthetic place worlds for supply-sampling regressions.
 *
 * SYNTHETIC GEOGRAPHY: a seeded, food-heavy dense centre and a compact control
 * around a neutral anchor. They prove generic sampling behaviour (does a source
 * describe the walkable disc or only the nearest few hundred metres?), never a
 * named place. Real acceptance needs live providers.
 *
 * - Overture rows run through the REAL production SQL: only the S3 relation is
 *   replaced by a generated local Parquet file, as in overture-taxonomy tests.
 * - Overpass is a small evaluator of the loader's own query text: every
 *   `(...)->.cN;.cN out center M;` block is a union of tag/around filters, and
 *   Overpass prints nodes before ways, each ascending by id.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DuckDBInstance } = require("@duckdb/node-api");

const ANCHOR = Object.freeze({ lat: 46, lng: 8 });

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// category -> [count, distance distribution in km from the anchor]
const DENSE_CENTRE = Object.freeze({
  restaurant: [800, { halfNormal: 0.9 }],
  cafe: [350, { halfNormal: 0.8 }],
  bar: [250, { halfNormal: 0.6 }],
  museum: [22, { halfNormal: 1.4 }],
  art_gallery: [25, { halfNormal: 1.0 }],
  park: [35, { uniform: [0.3, 3.8] }],
  garden: [6, { uniform: [0.3, 3.8] }],
  scenic_viewpoint: [8, { uniform: [0.5, 4.0] }],
  marina: [5, { uniform: [0.8, 4.0] }],
  castle: [3, { uniform: [0.5, 3.0] }],
  // Scarce second-hand/antique supply (twelve places), for single-intent days.
  second_hand_store: [8, { halfNormal: 1.2 }],
  antique_store: [4, { halfNormal: 1.2 }],
});

// Everything within a few hundred metres: a long day genuinely cannot be
// walked between distinct places here, whatever a source samples.
const COMPACT_WORLD = Object.freeze({
  restaurant: [40, { uniform: [0.02, 0.3] }],
  cafe: [20, { uniform: [0.02, 0.3] }],
  bar: [10, { uniform: [0.02, 0.3] }],
  museum: [4, { uniform: [0.02, 0.3] }],
  art_gallery: [4, { uniform: [0.02, 0.3] }],
  park: [3, { uniform: [0.02, 0.3] }],
});

const OSM_TAGS = Object.freeze({
  restaurant: ["amenity", "restaurant", "node"],
  cafe: ["amenity", "cafe", "node"],
  bar: ["amenity", "bar", "node"],
  museum: ["tourism", "museum", "node"],
  art_gallery: ["tourism", "gallery", "node"],
  park: ["leisure", "park", "way"],
  garden: ["leisure", "garden", "way"],
  scenic_viewpoint: ["tourism", "viewpoint", "node"],
  marina: ["leisure", "marina", "way"],
  castle: ["historic", "castle", "way"],
  second_hand_store: ["shop", "second_hand", "node"],
  antique_store: ["shop", "antiques", "node"],
});

const LABEL = Object.freeze({
  restaurant: "Kitchen", cafe: "Coffee", bar: "Tavern", museum: "Collection",
  art_gallery: "Studio", park: "Green", garden: "Grove", scenic_viewpoint: "Lookout",
  marina: "Harbour", castle: "Keep", second_hand_store: "Reuse", antique_store: "Antik",
});
const SYLLABLES = ["ka", "lo", "mi", "ru", "sen", "ta", "vo", "ne", "dri", "pa", "hel", "gra", "fi", "lun", "or", "bes"];

function generatePlaces({ origin = ANCHOR, spec = DENSE_CENTRE, seed = 20260927 } = {}) {
  const rng = mulberry32(seed);
  const hex = (length) => Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("");
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  const offset = (km, theta) => ({
    lat: (km * Math.cos(theta)) / 110.574,
    lng: (km * Math.sin(theta)) / (111.32 * cosLat),
  });
  const places = [];
  let osmId = 100000;
  for (const [category, [count, distribution]] of Object.entries(spec)) {
    for (let index = 0; index < count; index += 1) {
      const km = distribution.halfNormal
        ? Math.abs(gaussian(rng)) * distribution.halfNormal
        : distribution.uniform[0] + rng() * (distribution.uniform[1] - distribution.uniform[0]);
      const at = offset(km, rng() * 2 * Math.PI);
      // The same place in both sources; the directory copy sits a few metres off.
      const jitter = offset((rng() * 15) / 1000, rng() * 2 * Math.PI);
      const word = Array.from({ length: 3 }, () => SYLLABLES[Math.floor(rng() * SYLLABLES.length)]).join("");
      osmId += 1 + Math.floor(rng() * 50);
      places.push({
        category,
        name: `${word[0].toUpperCase()}${word.slice(1)} ${LABEL[category]}`,
        lat: origin.lat + at.lat,
        lng: origin.lng + at.lng,
        directoryLat: origin.lat + at.lat + jitter.lat,
        directoryLng: origin.lng + at.lng + jitter.lng,
        overtureId: `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`,
        osmId,
      });
    }
  }
  return places;
}

// Real production SQL against a generated local Parquet artifact.
async function createOvertureQueryRows(places) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parranda-dense-centre-"));
  const rowsFile = path.join(dir, "rows.ndjson");
  fs.writeFileSync(rowsFile, places.map((place) => JSON.stringify({
    id: place.overtureId,
    name: place.name,
    category: place.category,
    lat: place.directoryLat,
    lng: place.directoryLng,
  })).join("\n"));
  // Parallel test fixtures must not allocate host-sized native resources.
  const instance = await DuckDBInstance.create(":memory:", { threads: "1", memory_limit: "128MB" });
  const conn = await instance.connect();
  const file = path.join(dir, "places.parquet");
  await conn.run(`COPY (SELECT id,
      {'primary': name} AS names,
      {'primary': category, 'hierarchy': [category], 'alternates': []::VARCHAR[]} AS taxonomy,
      0.97::DOUBLE AS confidence, 'open' AS operating_status, []::VARCHAR[] AS websites,
      {'names': {'primary': NULL::VARCHAR}} AS brand,
      [{'license': 'CDLA-Permissive-2.0'}] AS sources,
      {'xmin': lng::DOUBLE, 'ymin': lat::DOUBLE} AS bbox
    FROM read_json_auto('${rowsFile}')) TO '${file}' (FORMAT PARQUET)`);
  const stats = { queries: 0 };
  let tail = Promise.resolve();
  let closing = false;
  let closePromise = null;
  return {
    stats,
    queryRows: async (sql) => {
      if (closing) throw new Error("fixture is closed");
      stats.queries += 1;
      const query = tail.then(async () => (await conn.runAndReadAll(sql.replace(/s3:\/\/[^']+/, file))).getRowObjectsJson());
      // A rejected query must not poison later accepted queries or drain cleanup.
      tail = query.then(() => undefined, () => undefined);
      return query;
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = tail.then(() => {
        conn.closeSync();
        instance.closeSync();
        fs.rmSync(dir, { recursive: true, force: true });
      });
      return closePromise;
    },
  };
}

function distanceKm(a, b) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function createOverpassEmulator(places) {
  const stats = { calls: 0 };
  const blockPattern = /\(((?:(?:node|way)\["[^"]+"="[^"]+"\]\(around:[^)]*\);)+)\)->\.(c\d+);\.\2 out center (\d+);/g;
  const filterPattern = /(node|way)\["([^"]+)"="([^"]+)"\]\(around:([\d.]+),(-?[\d.]+),(-?[\d.]+)\);/g;
  const element = (place) => {
    const [key, value, type] = OSM_TAGS[place.category];
    const tags = { name: place.name, [key]: value };
    return type === "node"
      ? { type, id: place.osmId, lat: place.lat, lon: place.lng, tags }
      : { type, id: place.osmId, center: { lat: place.lat, lon: place.lng }, tags };
  };
  const fetcher = async (_url, options = {}) => {
    stats.calls += 1;
    const query = decodeURIComponent(String(options.body || "").replace(/^data=/, ""));
    const elements = [];
    for (const block of query.matchAll(blockPattern)) {
      const matched = new Map();
      for (const [, type, key, value, radiusM, lat, lng] of block[1].matchAll(filterPattern)) {
        const centre = { lat: Number(lat), lng: Number(lng) };
        for (const place of places) {
          const [placeKey, placeValue, placeType] = OSM_TAGS[place.category];
          if (placeType !== type || placeKey !== key || placeValue !== value) continue;
          if (distanceKm(centre, place) * 1000 <= Number(radiusM)) matched.set(`${type}/${place.osmId}`, place);
        }
      }
      const printed = [...matched.values()].sort((a, b) =>
        (OSM_TAGS[a.category][2] === "node" ? 0 : 1) - (OSM_TAGS[b.category][2] === "node" ? 0 : 1) ||
        a.osmId - b.osmId);
      elements.push(...printed.slice(0, Number(block[3])).map(element));
    }
    return { ok: true, status: 200, json: async () => ({ elements }) };
  };
  return { fetcher, stats };
}

function walkingBand(targetKm) {
  return { targetKm, floorKm: targetKm * 0.6, ceilingKm: targetKm * 1.18 };
}

module.exports = {
  ANCHOR,
  COMPACT_WORLD,
  DENSE_CENTRE,
  createOverpassEmulator,
  createOvertureQueryRows,
  distanceKm,
  generatePlaces,
  walkingBand,
};
