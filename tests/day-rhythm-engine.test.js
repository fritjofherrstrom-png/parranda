const test = require('node:test');
const assert = require('node:assert/strict');
const {generateRecommendations} = require('../server/route-engine');

test('a curated city composes a calm day by density, not a requested kilometer total', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ok:true, json: async () => ({daily:{time:['2026-09-29'],weathercode:[0],temperature_2m_max:[20]}}), text:async()=>''});
  try {
    const result = await generateRecommendations({city:'rome',dates:['2026-09-29'],
      homeBase:{type:'auto'},start:{type:'auto'},end:{type:'auto'},
      walkingKmTarget:8,distanceMode:'no_limit',dayRhythm:'calm',preferences:['food']});
    const route = result.days[0]?.primary_route;
    assert.ok(route?.main_stops?.length >= 2);
    assert.equal(route.day_profile,'light');
    assert.ok(Number.isFinite(route.estimated_km));
  } finally { global.fetch = originalFetch; }
});
