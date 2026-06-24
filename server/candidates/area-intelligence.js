"use strict";

/**
 * Agnostic area / district intelligence.
 *
 * The engine has, for ANY place, a candidate set (curated catalog + open-data
 * loader: OSM/Wikidata — no citypack required). What it lacked is a notion of
 * the place's STRUCTURE: a city is not uniform, it is a handful of areas with
 * distinct character ("vintage + market quarter", "café district", "nightlife
 * strip", "scenic hill cluster"). This module derives that structure FROM the
 * candidate set, so Parranda can organize a day by area and route between areas
 * — in real time, for any city, with no per-city authoring.
 *
 * It is PURE and DETERMINISTIC: spatial clustering (union-find on a walking-link
 * distance) + per-cluster tag/type tallies. No network, no Math.random, no city
 * names, no citypack dependency. Same input → same output. Works identically for
 * a rich citypack (Rome) and a coordinate-only agnostic city (any OSM place).
 *
 * Output is DATA, not prose: dominant types/intents/daypart per area. The UI/i18n
 * layer renders labels; this layer never hardcodes language or place names.
 */

const EARTH_RADIUS_M = 6371000;

// Two candidates within this walking distance are treated as the same area. A
// district is "a few minutes' walk of related places", so ~350 m links the
// fabric of one neighbourhood without bridging across a whole city.
const DEFAULT_LINK_KM = 0.35;
// A cluster smaller than this is "scattered", not a district worth naming.
const DEFAULT_MIN_AREA_SIZE = 3;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(a, b) {
  if (!hasCoords(a) || !hasCoords(b)) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return (2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))) / 1000;
}

function hasCoords(c) {
  return c && Number.isFinite(c.lat) && Number.isFinite(c.lng);
}

// Daypart buckets a place reads best in, from its time_fit / tags (generic — the
// same tokens the fit-scorer already uses). No clock times.
const DAYPART_TOKENS = {
  morning: ["morning", "breakfast"],
  midday: ["midday", "noon", "lunch"],
  afternoon: ["afternoon", "golden-hour", "golden hour"],
  evening: ["evening", "kväll", "kvall", "night", "nattliv", "sunset"],
};

function normToken(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function candidateTokens(candidate) {
  const out = [];
  if (candidate.type) out.push(normToken(candidate.type));
  for (const tag of Array.isArray(candidate.tags) ? candidate.tags : []) out.push(normToken(tag));
  return out.filter(Boolean);
}

function candidateDayparts(candidate) {
  const fit = (Array.isArray(candidate.time_fit) ? candidate.time_fit : []).map(normToken);
  const haystack = new Set([...fit, ...candidateTokens(candidate)]);
  const out = [];
  for (const [band, tokens] of Object.entries(DAYPART_TOKENS)) {
    if (tokens.some((t) => haystack.has(t))) out.push(band);
  }
  return out;
}

// --- deterministic spatial clustering (union-find) -------------------------

function clusterCandidatesIntoAreas(candidates, { linkKm = DEFAULT_LINK_KM } = {}) {
  // Stable input order so the output is deterministic regardless of caller order.
  const items = (Array.isArray(candidates) ? candidates : [])
    .filter(hasCoords)
    .slice()
    .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")) || a.lat - b.lat || a.lng - b.lng);

  const parent = items.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i, j) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
  };

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (haversineKm(items[i], items[j]) <= linkKm) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < items.length; i += 1) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(items[i]);
  }
  return [...groups.values()];
}

// --- per-area character profile --------------------------------------------

function topEntries(counter, n) {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

function profileArea(members) {
  const list = Array.isArray(members) ? members.filter(hasCoords) : [];
  const center = list.reduce(
    (acc, c) => ({ lat: acc.lat + c.lat / list.length, lng: acc.lng + c.lng / list.length }),
    { lat: 0, lng: 0 },
  );
  const typeCounts = new Map();
  const tagCounts = new Map();
  const daypartCounts = new Map();
  for (const c of list) {
    const type = normToken(c.type);
    if (type) typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    for (const tag of Array.isArray(c.tags) ? c.tags : []) {
      const t = normToken(tag);
      if (t) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
    for (const band of candidateDayparts(c)) daypartCounts.set(band, (daypartCounts.get(band) || 0) + 1);
  }
  return {
    size: list.length,
    center: list.length ? { lat: Number(center.lat.toFixed(6)), lng: Number(center.lng.toFixed(6)) } : null,
    dominant_types: topEntries(typeCounts, 3).map((e) => e.key),
    dominant_intents: topEntries(tagCounts, 4).map((e) => e.key),
    daypart_hint: topEntries(daypartCounts, 1).map((e) => e.key)[0] || null,
    member_ids: list.map((c) => c.id).filter((id) => id != null),
  };
}

/**
 * Derive a place's structure from its candidate set.
 * @returns {{ areas: object[], scattered_count: number, area_count: number }}
 *   `areas` are profiled districts (size >= minAreaSize), sorted by size desc
 *   then by center (deterministic). `scattered_count` is candidates that did not
 *   form a district. Generic: no city pack, no network, no place-specific logic.
 */
function summarizePlaceStructure(candidates, { linkKm = DEFAULT_LINK_KM, minAreaSize = DEFAULT_MIN_AREA_SIZE } = {}) {
  const clusters = clusterCandidatesIntoAreas(candidates, { linkKm });
  const areas = [];
  let scattered = 0;
  for (const cluster of clusters) {
    if (cluster.length >= minAreaSize) {
      areas.push(profileArea(cluster));
    } else {
      scattered += cluster.length;
    }
  }
  areas.sort(
    (a, b) =>
      b.size - a.size ||
      (a.center && b.center ? a.center.lat - b.center.lat || a.center.lng - b.center.lng : 0),
  );
  return { areas, scattered_count: scattered, area_count: areas.length };
}

module.exports = {
  summarizePlaceStructure,
  clusterCandidatesIntoAreas,
  profileArea,
  haversineKm,
  DEFAULT_LINK_KM,
  DEFAULT_MIN_AREA_SIZE,
};
