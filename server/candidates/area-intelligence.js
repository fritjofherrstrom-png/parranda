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

// Fallback walking-link when a set is too small to derive its own spacing. A
// district is "a few minutes' walk of related places".
const DEFAULT_LINK_KM = 0.35;
// A cluster smaller than this is "scattered", not a district worth naming.
const DEFAULT_MIN_AREA_SIZE = 3;

// Structure-adaptive clustering: when no explicit link distance is given, the
// radius is CHOSEN per place from this small walkable-scale set — the one that
// yields the best district structure (see chooseAdaptiveRadius). A single fixed
// radius blobs concentrated cities and over-scatters spread ones; searching adapts
// to each place's actual layout.
const CANDIDATE_RADII_KM = [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45];
// Don't chase more than this many districts — a dense city should not be shredded
// into a dozen tiny areas; the composer only uses a few anyway.
const TARGET_DISTRICTS = 4;

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

// When a place carries no explicit daypart token, its TYPE still implies when it
// reads best (a café is a morning thing, a bar an evening one). Generic, no place
// names — the same vocabulary the engine already uses. Explicit time signals are
// weighted above these inferred ones, so this only fills the silence; it never
// overrides a real time_fit.
const TYPE_DAYPART_HINTS = {
  cafe: "morning", "café": "morning", coffee: "morning", bakery: "morning", pastry: "morning", breakfast: "morning",
  market: "midday", marketplace: "midday", deli: "midday", "vintage-shop": "midday", vintage: "midday", thrift: "midday", shop: "midday",
  restaurant: "midday", food: "midday", taverna: "midday", "street-food": "midday", "fast_food": "midday", lunch: "midday",
  museum: "midday", gallery: "midday", "arts_centre": "midday", castle: "midday", monument: "midday", church: "midday", history: "midday",
  viewpoint: "afternoon", scenic: "afternoon", park: "afternoon", garden: "afternoon", "nature_reserve": "afternoon", beach: "afternoon", promenade: "afternoon", waterfront: "afternoon",
  bar: "evening", pub: "evening", nightclub: "evening", "wine-bar": "evening", cocktail: "evening",
};
const DAYPART_EXPLICIT_WEIGHT = 2;
const DAYPART_INFERRED_WEIGHT = 1;

// How DEFINITIVE a type's daypart is. A bar/nightclub is unambiguously an evening
// place; a café a morning one — so they should out-weigh the ambiguous daytime
// types (a restaurant spans lunch AND dinner; a museum could be any daytime hour).
// Without this, a nightlife district full of restaurants + a few bars tallies as
// "midday" because every type counted the same. Default strength is 1.
const TYPE_DAYPART_STRENGTH = {
  bar: 3, pub: 3, nightclub: 3, "wine-bar": 3, cocktail: 3,
  cafe: 2, "café": 2, coffee: 2, bakery: 2, pastry: 2, breakfast: 2,
  restaurant: 0.5, food: 0.5, taverna: 0.5, "street-food": 0.5, "fast_food": 0.5, lunch: 0.5,
};

// Ordinal position of each daypart, for weighted-mean scoring downstream.
const DAYPART_RANK = { morning: 0, midday: 1, afternoon: 2, evening: 3 };

function normToken(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

// A single inferred daypart from a candidate's type/tags (first match wins by
// band order), with the token's DEFINITIVENESS strength. Used as a fallback
// alongside explicit signals; the strength lets a bar out-weigh a restaurant.
function inferDaypartFromType(candidate) {
  for (const token of candidateTokens(candidate)) {
    const band = TYPE_DAYPART_HINTS[token];
    if (band) {
      const strength = TYPE_DAYPART_STRENGTH[token] ?? DAYPART_INFERRED_WEIGHT;
      return { band, strength };
    }
  }
  return null;
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

// --- deterministic, structure-adaptive, compact clustering -----------------

// Greedy compact grouping at a FIXED radius on already-sorted items. A district
// is a walkable disk around the densest seed — NOT a single-linkage chain (which
// merges a whole dense city into one blob). Deterministic: densest-first seed
// order with stable tie-breaks.
function groupItemsAtRadius(items, radius) {
  const density = items.map((_, i) => {
    let n = 0;
    for (let j = 0; j < items.length; j += 1) {
      if (j !== i && haversineKm(items[i], items[j]) <= radius) n += 1;
    }
    return n;
  });
  const order = items
    .map((_, i) => i)
    .sort(
      (a, b) =>
        density[b] - density[a] ||
        String(items[a].id ?? "").localeCompare(String(items[b].id ?? "")) ||
        items[a].lat - items[b].lat ||
        items[a].lng - items[b].lng,
    );
  const claimed = new Array(items.length).fill(false);
  const groups = [];
  for (const seed of order) {
    if (claimed[seed]) continue;
    const members = [];
    for (let j = 0; j < items.length; j += 1) {
      if (!claimed[j] && haversineKm(items[seed], items[j]) <= radius) {
        claimed[j] = true;
        members.push(items[j]);
      }
    }
    groups.push(members);
  }
  return groups;
}

/**
 * Choose the link radius that yields the best district STRUCTURE for this set:
 * the MOST districts (capped at TARGET_DISTRICTS so a dense city is not
 * over-split), tie-broken by the FEWEST scattered candidates, then the LARGER
 * radius (more cohesive districts). A single fixed radius cannot do this — a
 * concentrated city blobs at 0.35 km and needs a tighter radius to split, while a
 * spread city over-scatters at a tight radius; a nearest-neighbour radius
 * over-splits dense centres. Searching a small radius set and scoring the
 * resulting structure adapts per place without either failure mode. (Verified on
 * live OSM: splits the Tallinn/Montevideo blobs into a real arc while keeping the
 * Lyon/Tbilisi multi-district structure intact.)
 */
function chooseAdaptiveRadius(items, minAreaSize) {
  let best = null;
  for (const r of CANDIDATE_RADII_KM) {
    const groups = groupItemsAtRadius(items, r);
    let districts = 0;
    let scattered = 0;
    for (const g of groups) {
      if (g.length >= minAreaSize) districts += 1;
      else scattered += g.length;
    }
    const eff = Math.min(districts, TARGET_DISTRICTS);
    if (
      !best ||
      eff > best.eff ||
      (eff === best.eff && (scattered < best.scattered || (scattered === best.scattered && r > best.r)))
    ) {
      best = { r, eff, scattered };
    }
  }
  return best ? best.r : DEFAULT_LINK_KM;
}

/**
 * Cluster candidates into COMPACT districts. `linkKm`, when given, is the explicit
 * radius (the knob); otherwise the radius is chosen per place to give the best
 * district structure (chooseAdaptiveRadius).
 */
function clusterCandidatesIntoAreas(candidates, { linkKm, minAreaSize = DEFAULT_MIN_AREA_SIZE } = {}) {
  // Stable input order so the output is deterministic regardless of caller order.
  const items = (Array.isArray(candidates) ? candidates : [])
    .filter(hasCoords)
    .slice()
    .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")) || a.lat - b.lat || a.lng - b.lng);
  if (!items.length) return [];

  const radius = Number.isFinite(linkKm) ? linkKm : chooseAdaptiveRadius(items, minAreaSize);
  return groupItemsAtRadius(items, radius);
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
    // Explicit time signals carry more weight than the type-inferred fallback, so
    // a real time_fit always wins; inference only breaks silence/ties — which is
    // what stops several districts all defaulting to the same daypart.
    for (const band of candidateDayparts(c)) {
      daypartCounts.set(band, (daypartCounts.get(band) || 0) + DAYPART_EXPLICIT_WEIGHT);
    }
    const inferred = inferDaypartFromType(c);
    if (inferred) daypartCounts.set(inferred.band, (daypartCounts.get(inferred.band) || 0) + inferred.strength);
  }
  return {
    size: list.length,
    center: list.length ? { lat: Number(center.lat.toFixed(6)), lng: Number(center.lng.toFixed(6)) } : null,
    dominant_types: topEntries(typeCounts, 3).map((e) => e.key),
    dominant_intents: topEntries(tagCounts, 4).map((e) => e.key),
    daypart_hint: topEntries(daypartCounts, 1).map((e) => e.key)[0] || null,
    // The FULL daypart distribution (band → weight) so the composer can score the
    // day's arc and resolve collisions, instead of only seeing a single argmax.
    daypart_weights: Object.fromEntries(daypartCounts),
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
function summarizePlaceStructure(candidates, { linkKm, minAreaSize = DEFAULT_MIN_AREA_SIZE } = {}) {
  // Pass linkKm THROUGH untouched (no DEFAULT_LINK_KM default here — that silently
  // pinned every caller to a fixed 0.35 km and bypassed adaptation). Forward
  // minAreaSize so the radius search counts the SAME districts this function will.
  const clusters = clusterCandidatesIntoAreas(candidates, { linkKm, minAreaSize });
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
