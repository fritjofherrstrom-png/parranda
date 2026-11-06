'use strict';

// Source-owned search facts, never ratings, preference coverage or admission.
const CUISINES = Object.freeze(['indian', 'thai', 'italian', 'mexican', 'japanese',
  'chinese', 'korean', 'vietnamese', 'greek', 'french', 'turkish', 'lebanese',
  'spanish', 'ethiopian', 'persian', 'pakistani', 'bangladeshi', 'nepalese',
  'swedish', 'american']);
const allowed = new Set(CUISINES);
const primaryCuisines = Object.freeze({
  ...Object.fromEntries(CUISINES.map(key => [`${key}_restaurant`, key])),
  north_indian_restaurant: 'indian', south_indian_restaurant: 'indian',
});

function normalizePlaceSearchFacets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => key !== 'cuisines') ||
      !Array.isArray(value.cuisines) || value.cuisines.length > 12 ||
      value.cuisines.some(key => !allowed.has(key))) return null;
  const cuisines = [...new Set(value.cuisines)].sort();
  return cuisines.length ? { cuisines } : null;
}

function overturePlaceSearchFacets(primaryCategory) {
  const cuisine = Object.hasOwn(primaryCuisines, primaryCategory) ? primaryCuisines[primaryCategory] : null;
  return cuisine ? { cuisines: [cuisine] } : null;
}

function osmPlaceSearchFacets(tags) {
  if (typeof tags?.cuisine !== 'string' || tags.cuisine.length > 256 ||
      !['restaurant', 'fast_food', 'cafe', 'bar', 'pub'].includes(tags.amenity)) return null;
  const cuisines = tags.cuisine.split(';').map(key => key.trim()).filter(key => allowed.has(key));
  return normalizePlaceSearchFacets({ cuisines });
}

module.exports = { CUISINES, normalizePlaceSearchFacets, overturePlaceSearchFacets, osmPlaceSearchFacets };
