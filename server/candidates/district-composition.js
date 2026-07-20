"use strict";

/**
 * Inter-district day composition — the "smart" layer on top of area intelligence.
 *
 * Area intelligence (area-intelligence.js) tells us a place's STRUCTURE: its
 * districts and each district's character. This turns that structure into an
 * actual day: pick the district(s) that best satisfy the user's intents (and the
 * time of day), choose the on-intent stops inside each, and connect complementary
 * districts with honest walking legs. So "type any city → Parranda composes a
 * smart day across the city's real areas" — generic, real-time, no citypack.
 *
 * PURE + DETERMINISTIC: greedy set-cover over derived areas + tag/intent matching.
 * No network, no Math.random, no city-specific data. Output is DATA (ids, tokens,
 * distances) — never prose. Honest about coverage: it reports which requested
 * intents each district covers and which it could not satisfy at all.
 */

const { summarizePlaceStructure, haversineKm } = require("./area-intelligence");

// Generic intent AXES: the canonical experience dimensions. Each maps the many
// surface tokens (OSM tags, Swedish/English synonyms, types) that mean the same
// thing onto one axis, so a request for "views" matches a district dense in
// "utsikt"/"viewpoint"/"scenic". No place names; pure vocabulary.
const INTENT_AXES = {
  second_hand: ["second_hand", "vintage", "vintage-shop", "thrift", "antique", "antiques", "loppis", "retro", "charity"],
  fika: ["fika", "coffee", "cafe", "café", "bakery", "pastry", "ice_cream"],
  food: ["food", "mat", "restaurant", "taverna", "street-food", "street food", "fast_food", "dinner", "lunch", "vin", "öl"],
  views: ["views", "view", "utsikt", "scenic", "viewpoint", "panorama", "golden-hour", "golden hour", "sunset"],
  culture: ["culture", "kultur", "museum", "gallery", "art", "arts_centre", "history", "klassiker", "castle"],
  nightlife: ["nightlife", "kväll", "kvall", "nattliv", "bar", "pub", "evening", "night", "party", "cocktail"],
  green: ["green", "grönt", "gront", "park", "garden", "nature", "promenad", "promenade", "waterfront"],
  market: ["market", "marknad", "marketplace"],
};

const TOKEN_TO_AXIS = (() => {
  const m = new Map();
  for (const [axis, tokens] of Object.entries(INTENT_AXES)) {
    m.set(axis, axis);
    for (const t of tokens) m.set(t, axis);
  }
  return m;
})();

const DAYPART_ORDER = { morning: 0, midday: 1, afternoon: 2, evening: 3 };
const RANK_DAYPART = ["morning", "midday", "afternoon", "evening"];

// A district's daypart lean as a CONTINUOUS score (0=morning .. 3=evening) from
// its full daypart distribution — not a single argmax. This is what stops a
// nightlife district (a few strong-evening bars amid many ambiguous daytime
// types) from reading "midday": the distribution's weighted mean captures the
// real lean. Falls back to the argmax hint, then midday.
function daypartScore(area) {
  const weights = area && area.daypart_weights;
  if (weights && typeof weights === "object") {
    let sum = 0;
    let total = 0;
    for (const [band, weight] of Object.entries(weights)) {
      if (band in DAYPART_ORDER && Number.isFinite(weight) && weight > 0) {
        sum += DAYPART_ORDER[band] * weight;
        total += weight;
      }
    }
    if (total > 0) return sum / total;
  }
  return area && area.daypart_hint in DAYPART_ORDER ? DAYPART_ORDER[area.daypart_hint] : 1;
}

// Given the score-sorted districts, assign each a DISTINCT daypart forming a
// morning→evening arc. Each band is bounded so it leaves room for the districts
// BEFORE it (>= its index) and AFTER it (<= 3 - remaining), which distributes a
// mid-range cluster across the available bands (centered) instead of pushing
// everything up into the evening cap and colliding. Order-preserving + strictly
// increasing, so the rendered day always reads as a progression.
function assignCoherentDayparts(sortedScores) {
  const n = sortedScores.length;
  const bands = [];
  let prev = -1;
  for (let i = 0; i < n; i += 1) {
    const lo = i; // room for the i districts already placed before this one
    const hi = 3 - (n - 1 - i); // room for the districts still to come after it
    let band = Math.round(sortedScores[i]);
    band = Math.max(lo, Math.min(hi, band));
    band = Math.min(Math.max(band, prev + 1), hi);
    bands.push(RANK_DAYPART[Math.max(0, Math.min(3, band))]);
    prev = band;
  }
  return bands;
}

function norm(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

// Map a set of surface tokens (tags/types/intent words) to canonical axes.
function tokensToAxes(tokens) {
  const out = new Set();
  for (const t of Array.isArray(tokens) ? tokens : []) {
    const axis = TOKEN_TO_AXIS.get(norm(t));
    if (axis) out.add(axis);
  }
  return out;
}

function contextLocalFeelRank(candidate) {
  if (Number.isFinite(candidate?.local_feel_rank)) {
    return Math.max(0, Math.min(3, candidate.local_feel_rank));
  }
  return candidate?.chain === true ? 2 : 0;
}

// District candidates are secondary place evidence, not route stops. Prefer
// independent local evidence without erasing an honestly sparse fallback: a
// chain remains only when it contributes an intent axis no local candidate in
// the same area covers (or when the area has no local candidates at all).
function preferLocalContextCandidates(candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const localRows = rows.filter((candidate) => contextLocalFeelRank(candidate) < 2);
  if (!localRows.length) return rows;

  const localAxes = new Set(
    localRows.flatMap((candidate) => [
      ...tokensToAxes([candidate?.type, ...(Array.isArray(candidate?.tags) ? candidate.tags : [])]),
    ]),
  );
  return rows.filter((candidate) => {
    if (contextLocalFeelRank(candidate) < 2) return true;
    const axes = tokensToAxes([
      candidate?.type,
      ...(Array.isArray(candidate?.tags) ? candidate.tags : []),
    ]);
    return [...axes].some((axis) => !localAxes.has(axis));
  });
}

/**
 * Compose a day across a place's districts.
 * @param {object[]} candidates  any candidate set (curated + open-data), each {id,lat,lng,type,tags,time_fit}
 * @param {object} opts  { intents[], maxAreas=2, linkKm, minAreaSize }
 * @returns {{
 *   areas: object[],         // selected districts in visit order, each with role/covers/stops/daypart
 *   legs: object[],          // honest inter-district walking legs (distance_km only, no ETA)
 *   covered_intents: string[],
 *   missing_intents: string[],
 *   structure: object,       // the full derived structure (for inspect)
 * }}
 */
function composeDistrictDay(candidates, { intents = [], maxAreas = 2, linkKm, minAreaSize } = {}) {
  const structure = summarizePlaceStructure(candidates, { linkKm, minAreaSize });
  const byId = new Map((Array.isArray(candidates) ? candidates : []).map((c) => [c.id, c]));

  const wantedAxes = [...tokensToAxes(intents)];
  const wantedSet = new Set(wantedAxes);

  // Per area: which wanted axes its character covers.
  const scored = structure.areas.map((area) => {
    const areaAxes = tokensToAxes([...(area.dominant_intents || []), ...(area.dominant_types || [])]);
    const covers = wantedAxes.filter((ax) => areaAxes.has(ax));
    return { area, areaAxes, covers };
  });

  // Greedy set-cover: repeatedly take the area that adds the most still-uncovered
  // wanted axes (tiebreak: bigger/denser area, then deterministic by center).
  const covered = new Set();
  const selected = [];
  const remaining = scored.slice();
  while (selected.length < Math.max(1, maxAreas) && remaining.length) {
    remaining.sort((a, b) => {
      const ga = a.covers.filter((ax) => !covered.has(ax)).length;
      const gb = b.covers.filter((ax) => !covered.has(ax)).length;
      return (
        gb - ga ||
        b.area.size - a.area.size ||
        (a.area.center && b.area.center ? a.area.center.lat - b.area.center.lat || a.area.center.lng - b.area.center.lng : 0)
      );
    });
    const next = remaining.shift();
    const gain = next.covers.filter((ax) => !covered.has(ax));
    // After the first pick, only add an area that contributes NEW coverage (a
    // complementary district), or — if no intents requested — the next densest.
    if (selected.length > 0 && wantedAxes.length && gain.length === 0) break;
    gain.forEach((ax) => covered.add(ax));
    selected.push(next);
  }

  // Visit order: by each district's CONTINUOUS daypart lean (morning → evening),
  // tie-broken deterministically. Then relabel the sequence as a coherent arc so
  // no two districts share a daypart and a nightlife district reads evening.
  selected.sort((a, b) => {
    const da = daypartScore(a.area);
    const db = daypartScore(b.area);
    if (da !== db) return da - db;
    return (b.area.size || 0) - (a.area.size || 0);
  });
  const coherentDayparts = assignCoherentDayparts(selected.map((s) => daypartScore(s.area)));

  const areas = selected.map((s, index) => {
    const members = (s.area.member_ids || []).map((id) => byId.get(id)).filter(Boolean);
    // On-intent stops first (members matching a wanted axis), then the rest.
    const onIntent = members.filter((m) => {
      const ax = tokensToAxes([m.type, ...(Array.isArray(m.tags) ? m.tags : [])]);
      return [...ax].some((a) => wantedSet.has(a));
    });
    const matchedStops = wantedAxes.length && onIntent.length ? onIntent : members;
    const stopsSource = preferLocalContextCandidates(matchedStops);
    return {
      center: s.area.center,
      // The coherent arc daypart (distinct across the day), not the raw per-district
      // argmax — so the rendered day reads morning → evening.
      daypart_hint: coherentDayparts[index] || s.area.daypart_hint,
      character: s.area.dominant_types,
      covers: s.covers,
      size: s.area.size,
      stop_ids: stopsSource.map((m) => m.id).filter((id) => id != null),
      // A few concrete, on-intent place NAMES so the UI can show an actual
      // itinerary ("Taverna A · Mokka · Mirador") instead of a bare "3 stops".
      // Names only; no prose, no fabrication (empty when a member has no name).
      stop_names: stopsSource
        .map((m) => String((m && (m.name || m.label || m.title)) || "").trim())
        .filter(Boolean)
        .slice(0, 4),
      // Map-drawable points plus source-owned quality facts used by optional
      // route context. These facts never promote a candidate into the route.
      stops: stopsSource
        .filter((m) => m && Number.isFinite(m.lat) && Number.isFinite(m.lng))
        .map((m) => ({
          id: m.id != null ? m.id : null,
          name: String((m.name || m.label || m.title) || "").trim() || null,
          lat: m.lat,
          lng: m.lng,
          type: String(m.type || "").trim() || null,
          tags: Array.isArray(m.tags) ? m.tags.slice() : [],
          chain: m.chain === true,
          brand: String(m.brand || "").trim() || null,
          local_feel_rank: Number.isFinite(m.local_feel_rank) ? m.local_feel_rank : null,
          candidate_origin: String(m.candidate_origin || "").trim() || null,
        })),
    };
  });

  // Honest inter-district legs (distance only — never a fabricated ETA).
  const legs = [];
  for (let i = 1; i < areas.length; i += 1) {
    const a = areas[i - 1].center;
    const b = areas[i].center;
    legs.push({ from_area: i - 1, to_area: i, distance_km: a && b ? Number(haversineKm(a, b).toFixed(2)) : null });
  }

  const coveredIntents = [...covered];
  const missingIntents = wantedAxes.filter((ax) => !covered.has(ax));

  return { areas, legs, covered_intents: coveredIntents, missing_intents: missingIntents, structure };
}

module.exports = {
  composeDistrictDay,
  tokensToAxes,
  INTENT_AXES,
};
