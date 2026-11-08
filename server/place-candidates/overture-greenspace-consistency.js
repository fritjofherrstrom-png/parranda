'use strict';

// A directory's park category can describe a residential service whose name
// contains Park, not a visitor greenspace. Withhold only a specific care-service
// page bound to that record's identity; a care-related name/domain alone is not
// a contradiction. No lookup, replacement type, closure or new authority.
const CARE_SERVICE_PATHS = new Set([
  'aldreomsorg', 'aldreboende', 'trygghetsboende', 'seniorboende',
  'plejehjem', 'sykehjem', 'care-home', 'care-homes', 'nursing-home',
  'nursing-homes', 'assisted-living', 'senior-living', 'retirement-home',
  'retirement-homes',
]);
const GENERIC_GREENSPACE_WORDS = new Set([
  'park', 'parks', 'parken', 'garden', 'gardens', 'tradgard', 'tradgarden',
]);

function folded(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function words(value) {
  return folded(value).match(/[\p{L}\p{N}]+/gu) || [];
}

// A nested service index such as senior-living is not a facility identity,
// even when the same generic service words also occur in the record's name.
const CARE_SERVICE_WORDS = new Set([...CARE_SERVICE_PATHS].flatMap(words));

function hasGreenspaceCareFacilityConflict(record) {
  if (!record || !['park', 'garden'].includes(record.type) ||
      typeof record.name !== 'string' || record.name.length > 500 ||
      typeof record.website !== 'string' || record.website.length > 2048) return false;
  let url;
  try { url = new URL(record.website); } catch (_) { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;

  let segments;
  try {
    segments = url.pathname.split('/').filter(Boolean).map(segment => folded(decodeURIComponent(segment)));
  } catch (_) { return false; }
  // Scope must precede the particular facility. A service index, hostname,
  // query string or fragment is not a bound facility page.
  if (!segments.slice(0, -1).some(segment => CARE_SERVICE_PATHS.has(segment))) return false;
  const leafWords = new Set(words(segments.at(-1)));
  const identityWords = [...new Set(words(record.name))]
    .filter(word => word.length >= 4 && !GENERIC_GREENSPACE_WORDS.has(word) && !CARE_SERVICE_WORDS.has(word));
  const urlWords = new Set([...words(url.hostname), ...leafWords]);
  const supported = identityWords.filter(word => urlWords.has(word));
  // Require two distinct identity atoms, including a meaningful facility atom
  // in the leaf, rather than a generic Park match or an organization footer.
  return supported.length >= 2 && supported.some(word => leafWords.has(word));
}

module.exports = { hasGreenspaceCareFacilityConflict };
