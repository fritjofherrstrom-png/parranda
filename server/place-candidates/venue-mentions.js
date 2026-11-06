'use strict';
const { isDeepStrictEqual } = require('node:util');
const { readVenueMentions } = require('../../shared/venue-mentions.mjs');
const { isApprovedVenueArticleUrl, publicVenueMentionUrls } = require('./venue-mention-policy');

// Only this internal, reviewed corpus is a producer. Normalizing public JSON,
// copying source labels or setting human_verified must not mint article facts.
const corpus = JSON.parse(JSON.stringify(require('./reviewed-venue-mentions.json')));
const venues = corpus.version === 1 && corpus.policy_revision === 'reviewed-venue-articles-v1' && Array.isArray(corpus.venues) ? corpus.venues : [];
const fold = value => typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim() : '';
function distanceMetres(a, b) {
  const rad = value => value * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function samePhysicalVenue(place, venue, requireSourceIdentity) {
  if (!place || place.is_structural === true || typeof place.lat !== 'number' || !Number.isFinite(place.lat) || Math.abs(place.lat) > 90 ||
      typeof place.lng !== 'number' || !Number.isFinite(place.lng) || Math.abs(place.lng) > 180) return false;
  const name = fold(place.label || place.name);
  if (![venue.label, ...venue.aliases].some(alias => fold(alias) === name) || distanceMetres(place, venue) > 25) return false;
  const address = place.source_address;
  const street = address && (address.street || address.road);
  const house = address && (address.house_number ?? address.housenumber);
  if (house != null && !((typeof house === 'string' && house.trim()) || (typeof house === 'number' && Number.isFinite(house)))) return false;
  if ((street != null && fold(street) !== fold(venue.address.street)) || (house != null && fold(String(house)) !== fold(venue.address.house_number))) return false;
  let exactDisplayedAddress = false;
  const expected = fold(`${venue.address.street} ${venue.address.house_number}`);
  // Every supplied representation must agree; precedence must not hide a veto.
  for (const displayedAddress of [place.address, place.place_details?.address]) {
    if (displayedAddress == null) continue;
    const actual = fold(displayedAddress);
    if (actual !== expected && !actual.startsWith(`${expected} `)) return false;
    exactDisplayedAddress = true;
  }
  const catalog = venue.catalog_binding;
  const exactAddress = Boolean(fold(street) && fold(String(house ?? '')) &&
    fold(street) === fold(venue.address.street) && fold(String(house)) === fold(venue.address.house_number)) || exactDisplayedAddress;
  if (!requireSourceIdentity) return [place.id, place.candidate_id, place.place_id].includes(catalog.id) || exactAddress;
  const exactCatalog = place.city === catalog.city && place.id === catalog.id && place.source?.kind === 'city_catalog' && place.source?.id === catalog.source_id;
  // An unaddressed namesake near the same point is not enough outside the
  // independently known catalog identity. Address ownership is source-side.
  return exactCatalog || exactAddress;
}
function relations(venue, place) {
  const rows = venue.articles.map(article => ({
    venue_id: venue.id,
    venue_binding: { label: place.label || place.name, lat: place.lat, lng: place.lng },
    ...JSON.parse(JSON.stringify(article)),
  }));
  return rows.every(row => isApprovedVenueArticleUrl(row.article_url)) && readVenueMentions(rows, place).length === rows.length ? rows : [];
}
function reviewedVenueMentionsForPlace(place) {
  const matches = venues.filter(venue => samePhysicalVenue(place, venue, true));
  return matches.length === 1 ? relations(matches[0], place) : [];
}
/** Revalidate transported metadata against independent source facts, not flags.
 * Used after role/engine JSON copies where catalog source IDs are not retained.
 * The original physical binding must remain exact; no cross-branch transfer.
 */
function venueMentionsMatchPlace(place, value) {
  const rows = readVenueMentions(value, place);
  if (!Array.isArray(value) || rows.length !== value.length) return false;
  if (!rows.length) return true;
  const venue = venues.find(item => item.id === rows[0].venue_id);
  if (!venue || !samePhysicalVenue(place, venue, false)) return false;
  const expected = relations(venue, place);
  return rows.every(row => expected.some(approved => isDeepStrictEqual(row, approved)));
}
function copyReviewedVenueMentions(place, value) {
  return venueMentionsMatchPlace(place, value) ? JSON.parse(JSON.stringify(value)) : [];
}
module.exports = { reviewedVenueMentionsForPlace, venueMentionsMatchPlace, copyReviewedVenueMentions, publicVenueMentionUrls };
