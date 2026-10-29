'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOverpassQuery } = require('../server/place-candidates/open-data-loader');
const { createOverpassEmulator, ANCHOR } = require('./helpers/dense-centre-fixture');

test('the finite source emulator executes compound tag and relation selectors, rather than losing the whole category block', async () => {
  const place = (osmId, category, extra = {}) => ({ osmId, category, name: `Controlled ${osmId}`, ...ANCHOR, ...extra });
  const emulator = createOverpassEmulator([
    place(1, 'second_hand_store', { osmTags: { shop: 'clothes', second_hand: 'only' } }),
    place(2, 'second_hand_store', { osmTags: { shop: 'clothes' } }),
    place(3, 'park', { osmType: 'relation' }),
    place(4, 'restaurant'),
    place(5, 'park', { lat: ANCHOR.lat + 1 }),
  ]);
  const query = buildOverpassQuery({ ...ANCHOR, radiusM: 1500, limit: 150 });
  const body = 'data=' + encodeURIComponent(query);
  const response = await emulator.fetcher('https://controlled.example/interpreter', { body });
  const { elements } = await response.json();
  assert.deepEqual(elements.map(e => e.id).sort(), [1, 3, 4]);
  assert.equal(elements.find(e => e.id === 3).type, 'relation');
  assert.equal(elements.find(e => e.id === 1).tags.second_hand, 'only');
  assert.equal(emulator.stats.calls, 1);
});
