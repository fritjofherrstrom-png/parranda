'use strict';

const { buildCuratedCatalogPlaceCandidates } = require('../place-candidates/curated-catalog-provider');
const { haversineKm } = require('../candidates/area-intelligence');

// The registry and catalog are server-owned. A public label never chooses a
// pack: individual real places must be inside the same bounded local aperture
// used by broad place suppliers. Keep their original catalog identity/trust.
const MAX_RADIUS_KM = 5;
function nearbyCuratedSupply({ configs, anchor, date, excludedIds = [] }) {
  if (!Number.isFinite(anchor?.lat) || !Number.isFinite(anchor?.lng)) return [];
  const excluded = new Set(excludedIds);
  const out = [];
  for (const config of Object.values(configs || {})) {
    if (!['public', 'beta', 'preview'].includes((config.visibility || 'public'))) continue;
    const originals = new Map((config.catalog?.allItems || []).map(item => [item.id, item]));
    for (const candidate of buildCuratedCatalogPlaceCandidates(config, { includeStructural: false })) {
      if (excluded.has(candidate.id) || !Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lng)) continue;
      if (haversineKm(anchor, candidate) > MAX_RADIUS_KM) continue;
      const original = originals.get(candidate.id);
      const weekday = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? new Date(`${date}T12:00:00Z`).getUTCDay() : null;
      if (weekday !== null && original?.closedWeekdays?.includes(weekday)) continue;
      out.push(candidate);
    }
  }
  return out;
}
module.exports = { nearbyCuratedSupply, MAX_RADIUS_KM };
