"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestTimeEventDiscovery } = require('../server/pulse-sources/request-time-event-discovery');

test('corrected programme discovery cannot reuse a legacy six-hour found-source answer', async () => {
  let searches = 0;
  const keys = [];
  const discover = createRequestTimeEventDiscovery({
    cache: { get: async (key, producer) => {
      keys.push(key);
      if (key.startsWith('rt-discovery-v6:')) return {
        status: 'found', reason: null,
        feeds: [{ id: 'legacy-calendar', adapter: 'ical', endpoint: 'https://legacy.example/calendar.ics' }],
      };
      return producer();
    } },
    sourceSearch: async () => { searches++; return { status: 'complete', seeds: [] }; },
  });
  const result = await discover({ anchor: { lat: 55.46, lng: 14.18 },
    placeLabel: 'Harbour Village, Sweden', placeContext: { locality: 'Harbour Village', country_code: 'se' } });
  assert.equal(searches, 1, 'old found sources must not suppress the corrected programme search');
  assert.ok(keys.every(key => !key.startsWith('rt-discovery-v6:')));
  assert.deepEqual(result.feeds, []);
  assert.equal(result.status, 'empty');
});
