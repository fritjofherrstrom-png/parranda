'use strict';

// Display facts only. A source category cannot add preference coverage, raise
// trust, or stand in for a description of a particular business's assortment.
const KINDS = Object.freeze({
  antiques: 'vintage-shop', second_hand_clothing: 'vintage-shop',
  coffee_shop: 'cafe', bakery: 'cafe', tea_room: 'cafe',
  art_museum: 'museum', history_museum: 'museum',
  botanical_garden: 'garden', nature_reserve: 'park',
  farmers_market: 'market', flea_market: 'market',
});
const OVERTURE_KINDS = Object.freeze({
  antique_store: 'antiques', second_hand_clothing_store: 'second_hand_clothing',
  coffee_shop: 'coffee_shop', bakery: 'bakery', tea_room: 'tea_room',
  art_museum: 'art_museum', modern_art_museum: 'art_museum',
  history_museum: 'history_museum', botanical_garden: 'botanical_garden',
  nature_reserve: 'nature_reserve', farmers_market: 'farmers_market', flea_market: 'flea_market',
});

function normalizePlaceDetails(value, type) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  if (typeof value.kind === 'string' && Object.hasOwn(KINDS, value.kind) && KINDS[value.kind] === type) out.kind = value.kind;
  if (typeof value.address === 'string' && value.address.trim().length <= 160 &&
      !/[\u0000-\u001f\u007f]/.test(value.address) && value.address.trim()) out.address = value.address.trim();
  return Object.keys(out).length ? out : null;
}

function sourcePlaceDetails(record, type) {
  const value = { ...normalizePlaceDetails(record?.place_details, type) };
  const address = record?.source_address;
  if (typeof address?.street === 'string' && typeof address?.house_number === 'string' &&
      address.street.trim() && address.house_number.trim() &&
      address.street.length <= 120 && address.house_number.length <= 24) {
    value.address = `${address.street.trim()} ${address.house_number.trim()}`;
  }
  return normalizePlaceDetails(value, type);
}

module.exports = { normalizePlaceDetails, sourcePlaceDetails, OVERTURE_KINDS };
