'use strict';
const { isDeepStrictEqual } = require('node:util');
const { normalizeVisitContent } = require('../../shared/visit-content.mjs');

// Explicitly authored catalog notes, not arbitrary catalog rationale, provider
// prose, request flags or a general permission to republish a linked article.
// Lookup is lazy to avoid importing the city registry during its construction.
let approved;
function notes() {
  if (approved) return approved;
  const index = new Map();
  const { cityConfigs } = require('../cities');
  for (const config of Object.values(cityConfigs)) {
    if (!['public', 'beta', 'preview'].includes(config.visibility || 'public')) continue;
    for (const item of config.catalog?.allItems || []) {
      const provenance = config.catalog?.provenanceById?.[item.id];
      if (provenance?.needs_human_verification !== false || !provenance.source_url ||
          item.structuralRouteAnchor || item.kind === 'district-group') continue;
      const content = normalizeVisitContent(provenance.visit_content);
      if (!content || !Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
      // The note's exact reviewed page belongs to the existing catalog source.
      // The exact destination is approved only in visit_content.source_url.
      try {
        if (new URL(content.source_url).origin !== new URL(provenance.source_url).origin) continue;
      } catch { continue; }
      if (index.has(item.id)) { index.set(item.id, null); continue; }
      index.set(item.id, Object.freeze({ id: item.id, type: item.kind, lat: item.lat, lng: item.lng,
        content: Object.freeze({ ...content, text: Object.freeze(content.text) }) }));
    }
  }
  approved = index;
  return index;
}
function bound(entry, stop) {
  return entry && stop && stop.is_live_event !== true && entry.id === stop.id && entry.type === stop.type &&
    entry.lat === stop.lat && entry.lng === stop.lng;
}
function visitContentForStop(stop) {
  const entry = notes().get(stop?.id);
  return bound(entry, stop) ? { ...entry.content, text: { ...entry.content.text } } : null;
}
function hydrateVisitContent(route) {
  if (!Array.isArray(route?.main_stops)) return;
  route.main_stops = route.main_stops.map(stop => {
    const { visit_content: ignored, ...clean } = stop;
    const content = visitContentForStop(stop);
    return content ? { ...clean, visit_content: content } : clean;
  });
}
function visitContentMatchesStop(stop, value) {
  const entry = notes().get(stop?.id);
  return Boolean(bound(entry, stop) && isDeepStrictEqual(entry.content, value));
}
function isApprovedVisitSourceUrl(value) {
  return typeof value === 'string' && [...notes().values()].some(entry => entry?.content.source_url === value);
}
module.exports = { hydrateVisitContent, visitContentForStop, visitContentMatchesStop, isApprovedVisitSourceUrl };
