'use strict';
// Shared source pools for the second-meal rule: the regression tests and the
// before/after evidence (docs/evidence/meal-spacing-20261113) use these exact
// pools with the day-composition fixture composer.
const { record } = require('./day-composition-fixtures');

const at = (id, type, dLat, dLng = 0) => ({ ...record(id, type), lat: 55.6 + dLat, lng: 13 + dLng });

// Seeded synthetic place: the same generator and seed always give the same pool.
// Restaurants cluster in 60% of placements.
function seededPool(city) {
  let seed = 1000 + city * 7919;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const types = [['restaurant', 6], ['pizza', 2], ['museum', 3], ['gallery', 4], ['viewpoint', 2], ['park', 3], ['garden', 1], ['cafe', 4], ['bar', 3]];
  const clusterLat = (rnd() - 0.5) * 0.02, clusterLng = (rnd() - 0.5) * 0.03;
  const rows = [];
  for (const [type, max] of types) {
    const count = Math.floor(rnd() * (max + 1));
    for (let i = 0; i < count; i += 1) {
      const clustered = (type === 'restaurant' || type === 'pizza') && rnd() < 0.6;
      rows.push(at(`${type}-${city}-${i}`, type,
        clustered ? clusterLat + (rnd() - 0.5) * 0.002 : (rnd() - 0.5) * 0.025,
        clustered ? clusterLng + (rnd() - 0.5) * 0.003 : (rnd() - 0.5) * 0.035));
    }
  }
  return rows;
}

module.exports = { at, seededPool };
