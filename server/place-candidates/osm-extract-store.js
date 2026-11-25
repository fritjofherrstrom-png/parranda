"use strict";

// Local read path for OpenStreetMap places, built from a regional extract by
// `scripts/build-osm-extract.js`. It answers the same grouped question the
// loader sends to Overpass, from plain tile files on disk, so a covered place
// gets its map evidence without a provider call.
//
// Layout: <dir>/<region>/manifest.json and <dir>/<region>/tiles/<y>_<x>.json.
// The manifest lists every tile that holds places, with its element count and
// SHA-256. A tile the manifest does not list is an area without places; a
// listed tile that is missing, unreadable or different is a broken store.
//
// A place is answered only when every asked circle lies wholly inside the
// region's coverage polygon. Anything else returns null and the caller asks
// its provider as before.
//
// Age is information, not a switch: a snapshot keeps answering however old
// it is, because the fallback (a public Overpass instance that often fails)
// gives no map evidence at all. Where several regions cover a place, the
// newest wins, so a refresh takes over as soon as it is in place. An operator
// can still set a limit (maxAgeMs); without one there is none.
//
// Operating contract: a region directory is immutable while a server reads
// it. Replace it as a whole (the builder swaps it in with one rename) and
// restart the server. A reader that meets a tile from another generation
// refuses it, because its hash does not match the manifest it loaded.

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const FORMAT = "parranda-osm-extract-v2";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_TILES = 64;
const KIND_ORDER = { node: 0, way: 1, relation: 2 };
const EARTH_RADIUS_M = 6371000;
const METRES_PER_DEGREE = 111320;
// Containment is decided on a local flat projection. The margin covers its
// error at the loader's apertures (at most 5 km) with room to spare.
const CONTAINMENT_MARGIN = 1.01;
const CONTAINMENT_MARGIN_M = 25;
const TILE_KEY = /^-?\d{1,5}_-?\d{1,5}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function distanceM(aLat, aLng, bLat, bLng) {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Rings are [lon, lat] pairs, as in the extract's polygon file.
function inRing(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Shortest distance in metres from the circle's centre to any edge of a ring,
// on a flat projection around the centre.
function distanceToRingM(ring, lat, lng) {
  const kx = METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
  const ky = METRES_PER_DEGREE;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const ax = (ring[j][0] - lng) * kx;
    const ay = (ring[j][1] - lat) * ky;
    const bx = (ring[i][0] - lng) * kx;
    const by = (ring[i][1] - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

// A circle lies wholly inside an area when its centre is inside the outer
// ring and outside every hole, and no edge of the outer ring or of any hole
// comes within the radius. A hole inside the circle has edges within the
// radius, so it is caught too. A circle across two adjacent areas is refused.
function circleInCoverage(coverage, lat, lng, radiusM) {
  const needed = radiusM * CONTAINMENT_MARGIN + CONTAINMENT_MARGIN_M;
  return coverage.some(area => {
    if (!inRing(area.outer, lng, lat)) return false;
    const holes = area.holes || [];
    if (holes.some(hole => inRing(hole, lng, lat))) return false;
    return [area.outer, ...holes].every(ring => distanceToRingM(ring, lat, lng) > needed);
  });
}

function validRing(ring) {
  return Array.isArray(ring) && ring.length >= 3 &&
    ring.every(point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function readManifest(regionDir) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(regionDir, "manifest.json"), "utf8"));
  } catch (_error) {
    return null;
  }
  if (!manifest || manifest.format !== FORMAT) return null;
  const dataMs = Date.parse(manifest.data_timestamp);
  if (!Number.isFinite(dataMs)) return null;
  if (!(Number.isFinite(manifest.tile_deg) && manifest.tile_deg > 0)) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(manifest.region || ""))) return null;
  if (!Array.isArray(manifest.coverage) || !manifest.coverage.length) return null;
  for (const area of manifest.coverage) {
    if (!validRing(area?.outer) || !(area.holes || []).every(validRing)) return null;
  }
  const inventory = manifest.tiles;
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) return null;
  const tiles = new Map();
  for (const [key, entry] of Object.entries(inventory)) {
    if (!TILE_KEY.test(key) || !Number.isInteger(entry?.n) || entry.n < 1 || !SHA256.test(String(entry?.sha256))) return null;
    tiles.set(key, { n: entry.n, sha256: entry.sha256 });
  }
  // The builder writes both totals beside the inventory. A list that disagrees
  // with them was damaged, and would otherwise read as a fresh, empty region.
  let listed = 0;
  for (const { n } of tiles.values()) listed += n;
  if (manifest.tile_count !== tiles.size || manifest.element_count !== listed) return null;
  return { region: manifest.region, dataMs, tileDeg: manifest.tile_deg, coverage: manifest.coverage, tiles, dir: regionDir };
}

function matchesSelector(tags, { key, value, and }) {
  if (tags[key] !== value) return false;
  return Object.entries(and || {}).every(([andKey, andValue]) => tags[andKey] === andValue);
}

function createOsmExtractStore({ dir = null, now = () => Date.now(), maxAgeMs = null } = {}) {
  if (!dir || typeof dir !== "string") return null;
  let regions = [];
  try {
    regions = fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
      .map(entry => readManifest(path.join(dir, entry.name)))
      .filter(Boolean);
  } catch (_error) {
    return null;
  }
  if (!regions.length) return null;
  // No limit unless one is given: see the header.
  const limitMs = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : null;
  const tiles = new Map();

  function withinLimit(dataMs) {
    if (!Number.isFinite(dataMs)) return false;
    return limitMs === null || now() - dataMs <= limitMs;
  }

  function readTile(region, key) {
    const listed = region.tiles.get(key);
    if (!listed) return []; // not listed: an area without places
    const cacheKey = `${region.region}:${key}`;
    if (tiles.has(cacheKey)) {
      const hit = tiles.get(cacheKey);
      tiles.delete(cacheKey);
      tiles.set(cacheKey, hit);
      return hit;
    }
    let elements;
    try {
      const raw = fs.readFileSync(path.join(region.dir, "tiles", `${key}.json`));
      if (createHash("sha256").update(raw).digest("hex") !== listed.sha256) return null;
      elements = JSON.parse(raw.toString("utf8"));
    } catch (_error) {
      return null; // listed but missing or unreadable: a broken store
    }
    if (!Array.isArray(elements) || elements.length !== listed.n) return null;
    tiles.set(cacheKey, elements);
    if (tiles.size > MAX_CACHED_TILES) tiles.delete(tiles.keys().next().value);
    return elements;
  }

  // The newest usable region that wholly covers every asked circle.
  function regionFor(anchors, radiusM) {
    return regions
      .filter(region => withinLimit(region.dataMs) &&
        anchors.every(anchor => circleInCoverage(region.coverage, anchor.lat, anchor.lng, radiusM)))
      .sort((a, b) => b.dataMs - a.dataMs || a.region.localeCompare(b.region))[0] || null;
  }

  // plan: { anchors: [{lat,lng}], radiusM, groups: [{ selectors, named }], perCategory }
  // Returns an Overpass-shaped payload plus the snapshot it came from, or null.
  function answer(plan) {
    const anchors = (Array.isArray(plan?.anchors) ? plan.anchors : [])
      .filter(anchor => Number.isFinite(anchor?.lat) && Number.isFinite(anchor?.lng));
    const radiusM = Number(plan?.radiusM);
    const perCategory = Math.floor(Number(plan?.perCategory));
    if (!anchors.length || !(radiusM > 0) || !(perCategory > 0) || !Array.isArray(plan?.groups)) return null;
    const region = regionFor(anchors, radiusM);
    if (!region) return null;

    const near = new Map();
    for (const anchor of anchors) {
      // The tiles to read must hold the whole circle as distanceM measures it:
      // degrees on the same sphere, widened by the containment margin, and the
      // longitude span taken at the edge nearest the pole, where it is widest.
      const dLat = (radiusM * CONTAINMENT_MARGIN) / ((EARTH_RADIUS_M * Math.PI) / 180);
      const poleward = Math.min(89, Math.abs(anchor.lat) + dLat);
      const dLng = dLat / Math.max(0.01, Math.cos((poleward * Math.PI) / 180));
      const y0 = Math.floor((anchor.lat - dLat) / region.tileDeg);
      const y1 = Math.floor((anchor.lat + dLat) / region.tileDeg);
      const x0 = Math.floor((anchor.lng - dLng) / region.tileDeg);
      const x1 = Math.floor((anchor.lng + dLng) / region.tileDeg);
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const tile = readTile(region, `${y}_${x}`);
          if (!tile) return null;
          for (const element of tile) {
            const lat = element?.lat ?? element?.center?.lat;
            const lon = element?.lon ?? element?.center?.lon;
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || !element.tags) continue;
            if (distanceM(anchor.lat, anchor.lng, lat, lon) <= radiusM) near.set(`${element.type}/${element.id}`, element);
          }
        }
      }
    }
    // Overpass prints a set as nodes, then ways, then relations, each by id.
    const ordered = [...near.values()].sort((a, b) =>
      (KIND_ORDER[a.type] ?? 3) - (KIND_ORDER[b.type] ?? 3) || Number(a.id) - Number(b.id));
    const elements = [];
    for (const group of plan.groups) {
      const selectors = Array.isArray(group?.selectors) ? group.selectors : [];
      let taken = 0;
      for (const element of ordered) {
        if (taken >= perCategory) break;
        if (group.named && !element.tags.name) continue;
        if (!selectors.some(selector => matchesSelector(element.tags, selector))) continue;
        elements.push(element);
        taken += 1;
      }
    }
    return {
      payload: { elements },
      snapshot: { region: region.region, data_timestamp: new Date(region.dataMs).toISOString() },
    };
  }

  // Whether an answer recorded earlier from an extract may still be replayed:
  // a configured age limit applies to a cached answer as to a direct one.
  function acceptsSnapshot(snapshot) {
    return Boolean(snapshot) && typeof snapshot.data_timestamp === "string" &&
      withinLimit(Date.parse(snapshot.data_timestamp));
  }

  return {
    answer,
    acceptsSnapshot,
    describe: () => regions.map(region => ({
      region: region.region,
      data_timestamp: new Date(region.dataMs).toISOString(),
      age_days: Math.floor((now() - region.dataMs) / DAY_MS),
      // Whether it answers: always, unless a configured limit has passed.
      fresh: withinLimit(region.dataMs),
    })),
  };
}

module.exports = {
  createOsmExtractStore,
  circleInCoverage,
  OSM_EXTRACT_FORMAT: FORMAT,
};
