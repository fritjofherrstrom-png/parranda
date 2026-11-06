'use strict';
const { normalizeDayPlaceSearch } = require('../../shared/day-place-search.mjs');
const { normalizePlaceSearchFacets } = require('../place-candidates/place-search-facets');
const { normalizeSelectedDayHoursFact } = require('../place-candidates/opening-hours');
const fold = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const cuisineAliases = {
  indian: ['indian', 'indiskt', 'indisk', 'indisk mat'], thai: ['thai', 'thaimat', 'thailandskt'],
  italian: ['italian', 'italienskt', 'italiensk'], mexican: ['mexican', 'mexikanskt', 'mexikansk'],
  japanese: ['japanese', 'japanskt', 'japansk'], chinese: ['chinese', 'kinesiskt', 'kinesisk'],
  korean: ['korean', 'koreanskt'], vietnamese: ['vietnamese', 'vietnamesiskt'],
  greek: ['greek', 'grekiskt'], french: ['french', 'franskt'], turkish: ['turkish', 'turkiskt'],
  lebanese: ['lebanese', 'libanesiskt'], spanish: ['spanish', 'spanskt'], ethiopian: ['ethiopian', 'etiopiskt'],
  persian: ['persian', 'persiskt'], pakistani: ['pakistani', 'pakistanskt'], bangladeshi: ['bangladeshi', 'bangladeshiskt'],
  nepalese: ['nepalese', 'nepalesiskt'], swedish: ['swedish', 'svenskt', 'svensk mat'], american: ['american', 'amerikanskt'],
};
const categories = {
  restaurant: ['restaurant', 'restaurants', 'restaurang', 'restauranger', 'food', 'mat'],
  cafe: ['cafe', 'coffee', 'kaffe', 'fika', 'kafe'], museum: ['museum', 'museer'],
  park: ['park', 'parker'], garden: ['garden', 'tradgard'], market: ['market', 'marknad'],
  viewpoint: ['viewpoint', 'views', 'utsikt'], 'vintage-shop': ['vintage', 'second hand', 'loppis'],
};
const findAlias = (table, query) => Object.keys(table).find(key => table[key].some(alias => fold(alias) === query));
function safeUrl(value) { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } }

// Only called with the identity-resolved, reachable, trusted candidate pool.
// Admission and finished-day walking are still enforced on the later edit.
function searchDayPlaces({ query, candidates = [], excludedIds = [], visibleIds = [], eligibleIds = new Set(), candidateHours = null } = {}) {
  const intent = normalizeDayPlaceSearch({ query });
  const result = { query: intent?.query || '', items: [], coverage: 'available_supply' };
  if (!intent || !(eligibleIds instanceof Set)) return result;
  const text = fold(intent.query);
  const cuisine = findAlias(cuisineAliases, text.replace(/\s+(restaurant|restaurang)$/, ''));
  const category = findAlias(categories, text);
  const seen = new Set([...excludedIds, ...visibleIds].map(String));
  const matches = [];
  for (const candidate of candidates) {
    const id = String(candidate?.id || '');
    if (!id || seen.has(id) || !eligibleIds.has(id) || candidate.candidate_kind === 'map_result') continue;
    seen.add(id);
    const label = candidate.label || candidate.name;
    if (typeof label !== 'string' || !label.trim()) continue;
    const address = typeof candidate.place_details?.address === 'string' ? candidate.place_details.address : null;
    const cuisines = normalizePlaceSearchFacets(candidate.search_facets)?.cuisines || [];
    // A cuisine query is a source-fact filter, even if a venue name contains it.
    const kind = cuisine ? (cuisines.includes(cuisine) ? 'cuisine' : null)
      : category ? (candidate.type === category ? 'category' : null)
      : fold(label).includes(text) ? 'name' : address && fold(address).includes(text) ? 'address' : null;
    if (!kind) continue;
    const hours = normalizeSelectedDayHoursFact(candidateHours?.get(id));
    if (hours?.status === 'closed') continue;
    const sourceUrl = safeUrl(candidate.source?.url);
    matches.push({ id, label, type: candidate.type || 'place', match_kind: kind,
      hours_status: hours && hours.status !== 'unknown' ? 'known' : 'unknown', ...(address ? { address } : {}),
      ...(sourceUrl ? { source_url: sourceUrl } : {}), ...(hours ? { selected_day_hours: hours } : {}) });
  }
  matches.sort((a, b) => Number(fold(b.label) === text) - Number(fold(a.label) === text) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  result.items = matches.slice(0, 6);
  return result;
}
module.exports = { searchDayPlaces };
