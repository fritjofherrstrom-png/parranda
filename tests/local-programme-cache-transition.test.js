"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestTimeEventDiscovery } = require('../server/pulse-sources/request-time-event-discovery');

for (const legacy of [6, 7]) test(`corrected programme selection cannot reuse a legacy v${legacy} six-hour found-source answer`, async () => {
  let searches = 0;
  const keys = [];
  const prefix = `rt-discovery-v${legacy}:`;
  const discover = createRequestTimeEventDiscovery({
    cache: { get: async (key, producer) => {
      keys.push(key);
      if (key.startsWith(prefix)) return {
        status: 'found', reason: null,
        feeds: [{ id: 'legacy-calendar', adapter: 'ical', endpoint: 'https://legacy.example/calendar.ics' }],
      };
      return producer();
    } },
    sourceSearch: async () => { searches++; return { status: 'complete', seeds: [] }; },
  });
  const result = await discover({ anchor: { lat: 55.46, lng: 14.18 },
    placeLabel: 'Harbour Village, Sweden', placeContext: { locality: 'Harbour Village', country_code: 'se' } });
  assert.equal(searches, 1, 'old found sources must not suppress corrected programme selection');
  assert.ok(keys.every(key => !key.startsWith(prefix)));
  assert.deepEqual(result.feeds, []);
  assert.equal(result.status, 'empty');
});
