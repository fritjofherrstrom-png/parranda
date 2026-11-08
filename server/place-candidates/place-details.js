'use strict';

// Closed, type-compatible facts from place sources. Classification can inform
// preference fit independently of source trust and admission.
const KINDS = Object.freeze({
  antiques: 'vintage-shop', second_hand_clothing: 'vintage-shop',
  cafe: 'cafe', coffee_shop: 'cafe', bakery: 'cafe', tea_room: 'cafe',
  brunch: 'restaurant', food_establishment: 'restaurant',
  art_museum: 'museum', history_museum: 'museum',
  art_gallery: 'gallery',
  botanical_garden: 'garden', nature_reserve: 'park',
  bathing_place: 'beach',
  marketplace: 'market', farmers_market: 'market', flea_market: 'market',
  wine_bar: 'bar', cocktail_bar: 'bar', beer_place: 'bar',
});
const OVERTURE_KINDS = Object.freeze({
  antique_store: 'antiques', second_hand_clothing_store: 'second_hand_clothing',
  cafe: 'cafe', coffee_shop: 'coffee_shop', bakery: 'bakery', tea_room: 'tea_room',
  breakfast_and_brunch_restaurant: 'brunch',
  art_museum: 'art_museum', modern_art_museum: 'art_museum',
  asian_art_museum: 'art_museum', contemporary_art_museum: 'art_museum', decorative_arts_museum: 'art_museum',
  art_gallery: 'art_gallery',
  history_museum: 'history_museum', botanical_garden: 'botanical_garden',
  nature_reserve: 'nature_reserve', farmers_market: 'farmers_market', flea_market: 'flea_market',
  market: 'marketplace', public_market: 'marketplace', seafood_market: 'marketplace', flower_market: 'marketplace',
  wine_bar: 'wine_bar', cocktail_bar: 'cocktail_bar', brewery: 'beer_place', beer_bar: 'beer_place', beer_garden: 'beer_place',
});

function normalizeSourcePriceLevel(value) {
  return typeof value === 'string' && /^[$]{1,4}$/.test(value.trim()) ? value.trim() : null;
}

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

module.exports = { normalizePlaceDetails, normalizeSourcePriceLevel, sourcePlaceDetails, OVERTURE_KINDS };
