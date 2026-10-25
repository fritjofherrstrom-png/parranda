"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { composeOpenDataLoaders } = require('../server/place-candidates/open-data-loader');

// Engine review, 25 Oct 2026: on staging every planner request took the
// rescue path ("background_refresh", "no_answered_map_evidence") and paid the
// full directory wait for a map source that never answered: 11–16 s per
// adjustment. Each composition still starts the map query (it keeps warming
// its cache); only the wait is withheld until the map answers inside it again.
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const anchor = { lat: 48.5, lng: 8.5 };
const BOUND_MS = 100;
const directory = Array.from({ length: 15 }, (_, i) => ({
  id: `directory-${i}`, name: `Visit ${i}`, type: ['museum', 'restaurant', 'park'][i % 3],
  lat: anchor.lat + i * .0001, lng: anchor.lng,
  sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred' }],
}));
const mapped = Object.assign([{ id: 'osm-1', name: 'Mapped park', type: 'park', lat: anchor.lat, lng: anchor.lng + .0002,
  tags: ['park'], sources: [{ provider: 'osm', family: 'map', tier: 'inferred' }] }], { loader_status: 'loaded:1' });

function setup() {
  const primaries = [];
  const loader = composeOpenDataLoaders(() => {
    let resolve;
    primaries.push(new Promise(r => { resolve = r; }));
    primaries[primaries.length - 1].resolve = resolve;
    return primaries[primaries.length - 1];
  }, null, { eager: true, load: () => directory }, null, { primaryWaitMs: BOUND_MS });
  return { loader, primaries };
}

async function compose(t, loader, { tickMs = 0 } = {}) {
  let result;
  loader(anchor).then(value => { result = value; });
  await flush();
  if (tickMs) { t.mock.timers.tick(tickMs); await flush(); }
  return () => result;
}

test('a map source that left the last day at the wait bound gets no wait the next time', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { loader, primaries } = setup();
  const first = await compose(t, loader, { tickMs: BOUND_MS - 1 });
  assert.equal(first(), undefined, 'the first composition still gives the map its bounded chance');
  t.mock.timers.tick(1); await flush();
  assert.equal(first().loader_metadata.primary_collection, 'background_refresh');

  const second = await compose(t, loader);
  t.mock.timers.tick(0); await flush();
  assert.ok(second(), 'a map source that just went silent is not waited for again');
  assert.deepEqual(second().map(row => row.id), directory.map(row => row.id));
  assert.equal(second().loader_metadata.primary_collection_reason, 'no_answered_map_evidence');
  assert.equal(primaries.length, 2, 'the map query is still started, so it keeps warming');
});

test('an answer inside the bound restores the wait; a late answer does not', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { loader, primaries } = setup();
  const first = await compose(t, loader, { tickMs: BOUND_MS });
  assert.ok(first());

  // Silent: the next composition answers at once. Its map query answers late.
  const late = await compose(t, loader);
  t.mock.timers.tick(0); await flush();
  assert.ok(late());
  t.mock.timers.tick(BOUND_MS + 50); primaries[1].resolve(mapped); await flush();
  const stillSilent = await compose(t, loader);
  t.mock.timers.tick(0); await flush();
  assert.ok(stillSilent(), 'an answer after the bound does not bring back the wait');

  // This map query answers inside the bound: the wait returns for the next day.
  t.mock.timers.tick(30); primaries[2].resolve(mapped); await flush();
  const restored = await compose(t, loader, { tickMs: 30 });
  assert.equal(restored(), undefined, 'the restored wait gives the map its chance again');
  primaries[3].resolve(mapped); await flush();
  assert.ok(restored().some(row => row.id === 'osm-1'), 'the answering map is merged with the directory');
});
