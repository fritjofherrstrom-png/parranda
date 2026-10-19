'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOperatorVisitEnricher } = require('../server/place-candidates/operator-visit-evidence');
const { createSourceCache } = require('../server/place-candidates/source-cache');

const fixtureDir = path.join(__dirname, 'fixtures/selected-place-visit-hours');
const entry = fs.readFileSync(path.join(fixtureDir, 'gustavianum-entry.html'), 'utf8');
const detail = fs.readFileSync(path.join(fixtureDir, 'gustavianum-hours.html'), 'utf8');
const row = { id: 'seasonal-visit', name: 'Gustavianum', type: 'museum', lat: 59.85794448852539,
  lng: 17.63179588317871, website: 'https://www.uu.se/gustavianum',
  sources: [{ provider: 'overture', family: 'open_directory', tier: 'inferred' }] };
const detailUrl = row.website + '/besok-oss/oppettider';
const response = body => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
const options = extra => ({ cache: createSourceCache(), hoursCache: createSourceCache(),
  resolveHost: async () => [{ address: '93.184.216.34', family: 4 }], ...extra });
const context = date => ({ selectedIds: [row.id], date });

test('positive HTML visit evidence is reused only for its frozen absolute day', async () => {
  const calls = [];
  const factory = createOperatorVisitEnricher(options({ fetcher: async url => {
    calls.push(url);
    return response(url === row.website ? entry : detail);
  } }));
  const first = (await factory.forRequest().enrichSelected([row], context('2026-10-19')))[0];
  assert.ok(first.opening_hours?.includes('Mo off'));
  assert.equal(first.opening_hours_source.valid_for_date, '2026-10-19');
  const cached = (await factory.forRequest().enrichSelected([row], context('2026-10-19')))[0];
  assert.deepEqual(cached.opening_hours_source, first.opening_hours_source);
  assert.deepEqual(calls, [row.website, detailUrl]);
  const nextMonday = (await factory.forRequest().enrichSelected([row], context('2026-10-26')))[0];
  assert.equal(nextMonday.opening_hours_source.valid_for_date, '2026-10-26');
  assert.equal(nextMonday.opening_hours_source.url, detailUrl);
  assert.deepEqual(calls, [row.website, detailUrl, row.website, detailUrl], 'a different day cannot inherit a date-specific positive');
  assert.equal(row.opening_hours, undefined, 'the original source record remains untouched');
});

test('expired HTML visit evidence cannot be renewed by an unsuccessful refresh', async () => {
  let now = Date.parse('2026-10-18T08:00:00Z'), failed = false;
  const calls = [];
  const factory = createOperatorVisitEnricher(options({
    now: () => now, hoursCache: createSourceCache({ now: () => now }),
    fetcher: async url => { calls.push(url); return response(failed ? 'No visit facts' : url === row.website ? entry : detail); },
  }));
  assert.ok((await factory.forRequest().enrichSelected([row], context('2026-10-19')))[0].opening_hours);
  now += 6 * 60 * 60 * 1000; failed = true;
  assert.equal((await factory.forRequest().enrichSelected([row], context('2026-10-19')))[0].opening_hours, undefined);
  assert.equal((await factory.forRequest().enrichSelected([row], context('2026-10-19')))[0].opening_hours, undefined);
  assert.deepEqual(calls, [row.website, detailUrl, row.website, row.website]);
});

test('a persisted HTML positive with another date or another entry identity is rejected', async () => {
  for (const changed of [{ valid_for_date: '2026-10-26' }, { entry_url: 'https://www.uu.se/other-institution' },
    { url: 'https://unrelated.example/hours' }, { opening_hours: 'Mo off' }]) {
    const cache = createSourceCache();
    let savedKey;
    const write = cache.set.bind(cache);
    cache.set = (key, value) => { savedKey = key; return write(key, value); };
    let calls = 0;
    const factory = createOperatorVisitEnricher(options({ hoursCache: cache,
      fetcher: async url => { calls++; return response(url === row.website ? entry : detail); },
    }));
    const [first] = await factory.forRequest().enrichSelected([row], context('2026-10-19'));
    assert.ok(first.opening_hours);
    assert.ok(savedKey);
    write(savedKey, { ...cache.peek(savedKey), ...changed });
    const [next] = await factory.forRequest().enrichSelected([row], context('2026-10-19'));
    assert.ok(next.opening_hours);
    assert.equal(next.opening_hours_source.valid_for_date, '2026-10-19');
    assert.equal(next.opening_hours_source.url, detailUrl);
    assert.equal(calls, 4, 'invalid persisted evidence requires a new bounded read, not an identity upgrade');
  }
});

test('HTML evidence requires a valid absolute date and cannot follow an external hours link', async () => {
  for (const date of [undefined, '2026-02-30', '19 October 2026']) {
    const calls = [];
    const factory = createOperatorVisitEnricher(options({ fetcher: async url => { calls.push(url); return response(entry); } }));
    const [result] = await factory.forRequest().enrichSelected([row], context(date));
    assert.equal(result.opening_hours, undefined);
    assert.deepEqual(calls, [row.website]);
  }
  const calls = [];
  const factory = createOperatorVisitEnricher(options({ fetcher: async url => {
    calls.push(url); return response(entry.replace('/gustavianum/besok-oss/oppettider', 'https://unrelated.example/hours'));
  } }));
  const [result] = await factory.forRequest().enrichSelected([row], context('2026-10-19'));
  assert.equal(result.opening_hours, undefined, 'an unresolved explicit exception page cannot be ignored');
  assert.deepEqual(calls, [row.website]);
});

test('a date-specific cached fact cannot masquerade as reusable weekly JSON-LD evidence', async () => {
  const { selectedPlaceHoursKey } = require('../server/place-candidates/selected-place-hours');
  const hoursCache = createSourceCache();
  const key = selectedPlaceHoursKey(row);
  hoursCache.set(key, { identity_key: key, opening_hours: 'Mo off; Tu-Su 10:00-17:00', url: row.website,
    observed_at: new Date().toISOString(), valid_for_date: '2026-10-19' });
  let calls = 0;
  const factory = createOperatorVisitEnricher(options({ hoursCache, fetcher: async () => { calls++; return response('No visit facts'); } }));
  const [result] = await factory.forRequest().enrichSelected([row], context('2026-10-26'));
  assert.equal(result.opening_hours, undefined, 'a Monday-negative from another date is not a weekly source statement');
  assert.equal(calls, 1);
});

test('the linked visit page consumes the original shared deadline instead of starting another wait', async () => {
  let now = 0;
  const calls = [];
  const factory = createOperatorVisitEnricher(options({ now: () => now, fetcher: async url => {
    calls.push(url); now += 7000; return response(entry);
  } }));
  const session = factory.forRequest();
  assert.equal((await session.enrichSelected([row], context('2026-10-19')))[0].opening_hours, undefined);
  assert.equal((await session.enrichSelected([row], context('2026-10-19')))[0].opening_hours, undefined);
  assert.deepEqual(calls, [row.website]);
});

test('vintage and selected checks share one source-owned content hop for the same identity', async () => {
  const calls = [];
  const vintage = { ...row, type: 'vintage-shop' };
  const contact = row.website + '/contact';
  // This transport fixture is a vintage identity, so use an exact h1 rather
  // than borrowing the museum-only institutional description from the capture.
  const withContact = entry.replace('Gustavianum Uppsala universitetsmuseum', row.name)
    .replace('</main>', `<a href="${contact}">Contact</a></main>`);
  const session = createOperatorVisitEnricher(options({ fetcher: async url => {
    calls.push(url);
    return response(url === row.website ? withContact : url === contact ? 'No visit facts' : detail);
  } })).forRequest();
  await session([vintage]);
  const [result] = await session.enrichSelected([vintage], context('2026-10-19'));
  assert.equal(result.opening_hours, undefined, 'a spent contact hop cannot start a second visit-page hop');
  assert.deepEqual(calls, [row.website, contact]);
});

test('the same already-read hours hop can be reused without fetching another document', async () => {
  const calls = [];
  const vintage = { ...row, type: 'vintage-shop' };
  const withDirectHoursLabel = entry.replace('Gustavianum Uppsala universitetsmuseum', row.name)
    .replace('Se våra helgdagar och andra avvikande öppettider', 'Öppettider');
  const session = createOperatorVisitEnricher(options({ fetcher: async url => {
    calls.push(url); return response(url === row.website ? withDirectHoursLabel : detail);
  } })).forRequest();
  await session([vintage]);
  const [result] = await session.enrichSelected([vintage], context('2026-10-19'));
  assert.equal(result.opening_hours_source?.valid_for_date, '2026-10-19');
  assert.deepEqual(calls, [row.website, detailUrl]);
});

test('a cancelled linked-page response cannot fill the cache or cancel another live request', async () => {
  const pending = [];
  let markReady;
  const ready = new Promise(resolve => { markReady = resolve; });
  const calls = [];
  const factory = createOperatorVisitEnricher(options({ fetcher: async (url, { signal }) => {
    calls.push(url);
    if (url === row.website) return response(entry);
    assert.equal(url, detailUrl);
    const work = new Promise(resolve => { pending.push({ resolve, signal }); });
    markReady();
    return work; // Deliberately ignores abort; the real reader must reject late content.
  } }));
  const controller = new AbortController();
  const first = factory.forRequest().enrichSelected([row], { ...context('2026-10-19'), signal: controller.signal });
  await ready;
  const second = factory.forRequest().enrichSelected([row], context('2026-10-19'));
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(first, /abort/i);
  pending[0].resolve(response(detail));
  assert.equal(pending[1].signal.aborted, false);
  pending[1].resolve(response(detail));
  const [live] = await second;
  assert.equal(live.opening_hours_source.valid_for_date, '2026-10-19');
  assert.equal(live.opening_hours_source.url, detailUrl);
  const [cached] = await factory.forRequest().enrichSelected([row], context('2026-10-19'));
  assert.deepEqual(cached.opening_hours_source, live.opening_hours_source);
  assert.deepEqual(calls, [row.website, detailUrl, row.website, detailUrl]);
});
