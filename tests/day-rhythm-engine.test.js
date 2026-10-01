const test = require('node:test');
const assert = require('node:assert/strict');
const {generateRecommendations} = require('../server/route-engine');
const {buildApp} = require('../server/app');
const {requestJson} = require('./helpers/planner-reservoir-compare');

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

test('the public curated-city API carries day rhythm through to engine density', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ok:true, json: async () => ({daily:{time:['2026-10-08'],weathercode:[0],temperature_2m_max:[20]}}), text:async()=>''});
  const server = buildApp().listen(0);
  try {
    const routes = {};
    for (const [rhythm, profile] of [['calm','light'], ['balanced','variation'], ['full','peak'], ['free','peak']]) {
      const response = await requestJson(server, {path:'/api/route-recommendations?lang=en',body:{
        city:'rome',dates:['2026-10-08'],preferences:['food'],day_rhythm:rhythm,
        distance_mode:'no_limit',home_base:{type:'auto'},start:{type:'auto'},end:{type:'auto'},
      }});
      assert.equal(response.status,200);
      const route = response.body.days[0]?.primary_route;
      assert.equal(route?.day_profile,profile,`${rhythm} must reach the curated engine through the API`);
      assert.ok(Number.isFinite(route.estimated_km));
      routes[rhythm] = route;
    }
    assert.ok(routes.calm.main_stops.length < routes.full.main_stops.length,
      'Easy and Full must shape the actual published day, not only echo the chosen label');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    global.fetch = originalFetch;
  }
});
