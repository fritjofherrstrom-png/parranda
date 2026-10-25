"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { composeOpenDataLoaders, createOpenDataLoader } = require('../server/place-candidates/open-data-loader');

// Engine review, 25 Oct 2026: on staging every planner request took the
// rescue path ("background_refresh", "no_answered_map_evidence") and paid the
// full directory wait for a map source that never answered: 11–16 s per
// adjustment. A slow query is not proof of a dead source, so only the place
// whose map primary went silent gets a short grace, for a bounded pause; its
// primary is still started exactly as before.
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const BOUND = 100;
const GRACE = 10;
const PAUSE = 1000;
const A = { lat: 48.5, lng: 8.5 };
const B = { lat: 52.1, lng: 4.3 };
const around = (anchor) => Array.from({ length: 15 }, (_, i) => ({
  id: `directory-${anchor.lat}-${i}`, name: `Visit ${i}`, type: ['museum', 'restaurant', 'park'][i % 3],
  lat: anchor.lat + i * .0001, lng: anchor.lng, sources: [{ provider: 'directory', family: 'open_directory', tier: 'inferred' }],
}));
const mapped = (anchor) => Object.assign([{ id: `osm-${anchor.lat}`, name: 'Mapped park', type: 'park', lat: anchor.lat,
  lng: anchor.lng + .0002, tags: ['park'], sources: [{ provider: 'osm', family: 'map', tier: 'inferred' }] }], { loader_status: 'loaded:1' });
const ids = (rows) => rows.map(row => row.id);

function setup() {
  const primaries = [];
  const loader = composeOpenDataLoaders(() => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    primaries.push(Object.assign(promise, { resolve, reject }));
    return promise;
  }, null, { eager: true, load: (anchor) => around(anchor) }, null,
  { primaryWaitMs: BOUND, silentGraceMs: GRACE, silentPauseMs: PAUSE });
  return { loader, primaries };
}

async function compose(t, loader, anchor, { tickMs = 0 } = {}) {
  let result;
  loader({ ...anchor }).then(value => { result = value; });
  await flush();
  if (tickMs) { t.mock.timers.tick(tickMs); await flush(); }
  return () => result;
}

test('a place whose map went silent gets a short grace, with the same rescue evidence', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { loader, primaries } = setup();
  const first = await compose(t, loader, A, { tickMs: BOUND });
  assert.equal(first().loader_metadata.primary_collection, 'background_refresh');
  const again = await compose(t, loader, A, { tickMs: GRACE - 1 });
  assert.equal(again(), undefined, 'the paused place still gives its map the grace');
  t.mock.timers.tick(1); await flush();
  assert.ok(again(), 'a short grace, not the full wait');
  assert.deepEqual(ids(again()), ids(first()), 'the same rescue evidence as the waited day');
  assert.equal(again().loader_metadata.primary_collection_reason, first().loader_metadata.primary_collection_reason);
  assert.equal(primaries.length, 2, 'the paused place still starts its map query');
});

test('a slow place never pauses another place: its fast valid answer is waited for and merged', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { loader, primaries } = setup();
  await compose(t, loader, A, { tickMs: BOUND });
  const other = await compose(t, loader, B, { tickMs: GRACE + 5 });
  assert.equal(other(), undefined, 'place B is not paused by place A');
  primaries[1].resolve(mapped(B)); await flush();
  assert.ok(other().some(row => row.id === `osm-${B.lat}`), "B's fast valid map answer is merged");
});

test('an answer inside the full bound ends the pause, even from a paused day; a late one does not', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { loader, primaries } = setup();
  await compose(t, loader, A, { tickMs: BOUND });
  const late = await compose(t, loader, A, { tickMs: GRACE });
  assert.ok(late());
  t.mock.timers.tick(BOUND + 20); primaries[1].resolve(mapped(A)); await flush();
  const stillPaused = await compose(t, loader, A, { tickMs: GRACE });
  assert.ok(stillPaused(), 'an answer after the bound does not end the pause');
  t.mock.timers.tick(40); primaries[2].resolve(mapped(A)); await flush();
  const restored = await compose(t, loader, A, { tickMs: GRACE });
  assert.equal(restored(), undefined, 'an answer inside the bound gives the place its full wait back');
  t.mock.timers.tick(20); primaries[3].resolve(mapped(A)); await flush();
  assert.ok(restored().some(row => row.id === `osm-${A.lat}`), 'and the answering map is merged');
});

test('the pause is bounded: after it the place is given the full wait again', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { loader, primaries } = setup();
  await compose(t, loader, A, { tickMs: BOUND });
  t.mock.timers.tick(PAUSE); await flush();
  const probe = await compose(t, loader, A, { tickMs: GRACE });
  assert.equal(probe(), undefined, 'after the pause the map is probed with the full wait');
  t.mock.timers.tick(30); primaries[1].resolve(mapped(A)); await flush();
  assert.ok(probe().some(row => row.id === `osm-${A.lat}`));
});

test('an older request cannot undo what a newer one observed, and an abort pauses nothing', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const { loader, primaries } = setup();
  const older = await compose(t, loader, A);
  t.mock.timers.tick(5); await flush();
  const newer = await compose(t, loader, A, { tickMs: 20 });
  primaries[1].resolve(mapped(A)); await flush();
  assert.ok(newer().some(row => row.id === `osm-${A.lat}`), 'the newer day merged its in-bound answer');
  t.mock.timers.tick(BOUND); await flush();
  assert.equal(older().loader_metadata.primary_collection, 'background_refresh', 'the older day still rescued');
  const next = await compose(t, loader, A, { tickMs: GRACE });
  assert.equal(next(), undefined, "the older day's silence did not override the newer answer");
  primaries[2].resolve(mapped(A)); await flush();

  const aborted = await compose(t, loader, B, { tickMs: 5 });
  primaries[3].reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); await flush();
  assert.ok(aborted(), 'an aborted map query settles the day at once');
  const afterAbort = await compose(t, loader, B, { tickMs: GRACE });
  assert.equal(afterAbort(), undefined, 'an abort is not silence: the full wait remains');
  primaries[4].resolve(mapped(B)); await flush();
});

test('concurrent days at a silent place share one provider query; its late answer fills the cache and later days use it', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  let calls = 0, answer;
  const osm = createOpenDataLoader({
    cache: createSourceCache({ now: () => Date.now() }),
    now: () => Date.now(),
    elapsedNow: () => Date.now(),
    fetcher: (_url, init) => {
      calls += 1;
      return new Promise((resolve, reject) => {
        // Varied enough that the loader asks no wider second query.
        answer = () => resolve({ ok: true, json: async () => ({ elements: Array.from({ length: 15 }, (_, i) => ({
          type: 'node', id: 700 + i, lat: A.lat + i / 10000, lon: A.lng,
          tags: { name: `Mapped ${i}`, amenity: ['restaurant', 'cafe', 'bar'][i % 3] } })) }) });
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    },
  });
  const loader = composeOpenDataLoaders(osm, null, { eager: true, load: (anchor) => around(anchor) }, null,
    { primaryWaitMs: BOUND, silentGraceMs: GRACE, silentPauseMs: 60_000 });
  const first = await compose(t, loader, A);
  const second = await compose(t, loader, A, { tickMs: BOUND });
  assert.ok(first() && second(), 'both days answer at the bound');
  assert.equal(calls, 1, 'identical concurrent days share one provider query');
  const published = [ids(first()), ids(second())];

  answer(); await flush();
  const later = await compose(t, loader, A, { tickMs: GRACE });
  assert.ok(later(), 'the paused place answers within its grace');
  assert.ok(later().some(row => String(row.id).startsWith('osm-')), 'the late answer, now cached, joins the later day');
  assert.equal(calls, 1, 'no further provider query: the cache answered');
  assert.deepEqual([ids(first()), ids(second())], published, 'already published days are not changed by the late answer');
});
