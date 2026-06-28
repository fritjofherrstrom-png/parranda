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

  // Visit order: by district daypart when known (morning → evening), else as
  // selected (coverage-priority). Deterministic.
  selected.sort((a, b) => {
    const da = a.area.daypart_hint in DAYPART_ORDER ? DAYPART_ORDER[a.area.daypart_hint] : 99;
    const db = b.area.daypart_hint in DAYPART_ORDER ? DAYPART_ORDER[b.area.daypart_hint] : 99;
    return da - db;
  });

  const areas = selected.map((s) => {
    const members = (s.area.member_ids || []).map((id) => byId.get(id)).filter(Boolean);
    // On-intent stops first (members matching a wanted axis), then the rest.
    const onIntent = members.filter((m) => {
      const ax = tokensToAxes([m.type, ...(Array.isArray(m.tags) ? m.tags : [])]);
      return [...ax].some((a) => wantedSet.has(a));
    });
    const stopsSource = wantedAxes.length && onIntent.length ? onIntent : members;
    return {
      center: s.area.center,
      daypart_hint: s.area.daypart_hint,
      character: s.area.dominant_types,
      covers: s.covers,
      size: s.area.size,
      stop_ids: stopsSource.map((m) => m.id).filter((id) => id != null),
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
