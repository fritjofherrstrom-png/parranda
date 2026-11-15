"use strict";

// Local read path for OpenStreetMap places, built from a regional extract by
// `scripts/build-osm-extract.js`. It answers the same grouped question the
// loader sends to Overpass, from plain tile files on disk, so a covered place
// gets its map evidence without a provider call.
//
// Layout: <dir>/<region>/manifest.json and <dir>/<region>/tiles/<y>_<x>.json.
// A place is answered only when every asked circle lies inside the region's
// coverage polygon and the snapshot is not older than the allowed age.
// Anything else returns null and the caller asks its provider as before.

const fs = require("node:fs");
const path = require("node:path");

const FORMAT = "parranda-osm-extract-v1";
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CACHED_TILES = 64;
const KIND_ORDER = { node: 0, way: 1, relation: 2 };
const EARTH_RADIUS_M = 6371000;

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

function inCoverage(coverage, lng, lat) {
  return coverage.some(area => inRing(area.outer, lng, lat) && !(area.holes || []).some(hole => inRing(hole, lng, lat)));
}

// The centre and eight points on the circle. A circle that crosses the edge of
// the extract would be answered with part of its places missing.
function circleInCoverage(coverage, lat, lng, radiusM) {
  if (!inCoverage(coverage, lng, lat)) return false;
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  for (let step = 0; step < 8; step += 1) {
    const angle = (step * Math.PI) / 4;
    if (!inCoverage(coverage, lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle))) return false;
  }
  return true;
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
  return { region: manifest.region, dataMs, tileDeg: manifest.tile_deg, coverage: manifest.coverage, dir: regionDir };
}

function matchesSelector(tags, { key, value, and }) {
  if (tags[key] !== value) return false;
  return Object.entries(and || {}).every(([andKey, andValue]) => tags[andKey] === andValue);
}

function createOsmExtractStore({ dir = null, now = () => Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  if (!dir || typeof dir !== "string") return null;
  let regions = [];
  try {
    regions = fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => readManifest(path.join(dir, entry.name)))
      .filter(Boolean);
  } catch (_error) {
    return null;
  }
  if (!regions.length) return null;
  const boundedMaxAgeMs = Number.isFinite(maxAgeMs) && maxAgeMs > 0 ? maxAgeMs : DEFAULT_MAX_AGE_MS;
  const tiles = new Map();

  function readTile(region, y, x) {
    const key = `${region.region}:${y}_${x}`;
    if (tiles.has(key)) {
      const hit = tiles.get(key);
      tiles.delete(key);
      tiles.set(key, hit);
      return hit;
    }
    let elements = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(region.dir, "tiles", `${y}_${x}.json`), "utf8"));
      if (!Array.isArray(parsed)) return null;
      elements = parsed;
    } catch (error) {
      // A tile with no places is not written. Any other failure is a broken
      // store, and the caller must not take it for an empty neighbourhood.
      if (error?.code !== "ENOENT") return null;
    }
    tiles.set(key, elements);
    if (tiles.size > MAX_CACHED_TILES) tiles.delete(tiles.keys().next().value);
    return elements;
  }

  function regionFor(anchors, radiusM) {
    const nowMs = now();
    return regions.find(region => nowMs - region.dataMs <= boundedMaxAgeMs &&
      anchors.every(anchor => circleInCoverage(region.coverage, anchor.lat, anchor.lng, radiusM))) || null;
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
      const dLat = radiusM / 111320;
      const dLng = radiusM / (111320 * Math.max(0.01, Math.cos((anchor.lat * Math.PI) / 180)));
      const y0 = Math.floor((anchor.lat - dLat) / region.tileDeg);
      const y1 = Math.floor((anchor.lat + dLat) / region.tileDeg);
      const x0 = Math.floor((anchor.lng - dLng) / region.tileDeg);
      const x1 = Math.floor((anchor.lng + dLng) / region.tileDeg);
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const tile = readTile(region, y, x);
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

  return {
    answer,
    describe: () => regions.map(region => ({
      region: region.region,
      data_timestamp: new Date(region.dataMs).toISOString(),
      fresh: now() - region.dataMs <= boundedMaxAgeMs,
    })),
  };
}

module.exports = { createOsmExtractStore, OSM_EXTRACT_FORMAT: FORMAT, DEFAULT_OSM_EXTRACT_MAX_AGE_MS: DEFAULT_MAX_AGE_MS };
