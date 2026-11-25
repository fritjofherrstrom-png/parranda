'use strict';
// Image bytes for place media (docs/PLACE_MEDIA.md, "Image bytes"): only known
// media ids, fixed widths, a disk cache with an LRU cap, honest 404/400/503,
// and a public-access guard that counts only real upstream misses.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { createPlaceMedia, setPlaceMediaForTests } = require('../server/place-media');
const { createWikimediaClient } = require('../server/place-media/wikimedia-client');
const {
  createMediaBytes, setMediaBytesForTests, upstreamUrl, etagFor, MAX_FILE_BYTES, CACHE_SUBDIR,
} = require('../server/place-media/media-bytes');
const { createPublicAccessGuard, UPSTREAM_MISS_ADMISSION, upstreamCostPrefix, routedPath } = require('../server/lib/public-access-guard');
const { createFixtureFetcher } = require('./helpers/place-media-fixtures');

const MEDELHAVS = 'Q1331646';
const ROHSSKA = 'Q3107443';
const UNKNOWN_SHA1 = 'ffffffffffffffffffffffffffffffffffffffff';

function tempDir(t, prefix = 'place-media-bytes-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A real place-media service whose index holds records built (offline) from the fixtures. */
async function seededPlaceMedia(t) {
  const dir = tempDir(t, 'place-media-index-');
  const { fetcher } = createFixtureFetcher();
  const records = await createWikimediaClient({ fetcher, clock: () => Date.parse('2026-11-24T10:00:00Z') })
    .fetchRecords([MEDELHAVS, ROHSSKA]);
  fs.writeFileSync(path.join(dir, 'index-v1.jsonl'), `${[...records.values()].map(record => JSON.stringify(record)).join('\n')}\n`);
  const service = createPlaceMedia({ dir, fetcher: async () => { throw new Error('no wikidata calls in byte tests'); } });
  return { service, medelhavs: service.peek(MEDELHAVS).photo, rohsska: service.peek(ROHSSKA).photo };
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1500, 3)]);

function imageResponse(bytes = JPEG, type = 'image/jpeg', extraHeaders = {}) {
  return new Response(bytes, { status: 200, headers: { 'content-type': type, 'content-length': String(bytes.length), ...extraHeaders } });
}

function upstreamSpy(respond = () => imageResponse()) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init, calls.length);
  };
  return { calls, fetcher };
}

/** A tiny server with only the route (and optionally the guard) in front of a media-bytes instance. */
async function serve(t, mediaBytes, { guardEnv } = {}) {
  const app = express();
  if (guardEnv) app.use(createPublicAccessGuard({ env: guardEnv }));
  app.get('/media/c/:media_id/:w', (request, response, next) => mediaBytes.handle(request, response).catch(next));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (pathname, init) => fetch(`${base}${pathname}`, init);
}

test('upstream thumb URLs are built only from the record, and never ask Commons to upscale', async t => {
  const { medelhavs, rohsska } = await seededPlaceMedia(t);
  assert.equal(upstreamUrl(medelhavs, 250),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Medelhavsmuseet_2007.jpg/250px-Medelhavsmuseet_2007.jpg');
  assert.equal(upstreamUrl(rohsska, 960),
    'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/R%C3%B6hsska_museet.jpg/960px-R%C3%B6hsska_museet.jpg');
  assert.equal(upstreamUrl({ ...medelhavs, width: 900 }, 960), medelhavs.file_url, 'original when it is not wider than asked');
  const longName = `${'Å'.repeat(81)}.jpg`;
  assert.equal(upstreamUrl({ ...medelhavs, file_url: `https://upload.wikimedia.org/wikipedia/commons/d/da/${encodeURIComponent(longName)}` }, 500),
    `https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/${encodeURIComponent(longName)}/500px-thumbnail.jpg`);
  const webp = { ...medelhavs, file_url: 'https://upload.wikimedia.org/wikipedia/commons/d/da/X.webp' };
  assert.equal(upstreamUrl(webp, 250), webp.file_url);
  assert.equal(upstreamUrl({ ...medelhavs, file_url: 'https://evil.example/d/da/X.jpg' }, 250), null);
  assert.equal(upstreamUrl(medelhavs, 300), null);
});

test('unknown media ids are 404 and never fetched: the route is no open proxy', async t => {
  const { service } = await seededPlaceMedia(t);
  const upstream = upstreamSpy();
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher }));
  for (const id of [UNKNOWN_SHA1, 'not-a-sha1', '46ED26391833B2C6F1251831F4FDCE668B4B0321', `${UNKNOWN_SHA1}0`]) {
    const response = await get(`/media/c/${id}/250`);
    assert.equal(response.status, 404, id);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(upstream.calls.length, 0, 'an arbitrary sha1 never reaches Wikimedia');
});

test('the feature switched off answers 404 for every id', async t => {
  const upstream = upstreamSpy();
  const get = await serve(t, createMediaBytes({ placeMedia: () => null, fetcher: upstream.fetcher }));
  assert.equal((await get('/media/c/46ed26391833b2c6f1251831f4fdce668b4b0321/250')).status, 404);
  assert.equal(upstream.calls.length, 0);
});

test('widths other than 250, 500 and 960 are 400', async t => {
  const { service, medelhavs } = await seededPlaceMedia(t);
  const upstream = upstreamSpy();
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher }));
  for (const w of ['300', '0', '2500', 'abc', '250.0', '0250', '-250']) {
    assert.equal((await get(`/media/c/${medelhavs.media_id}/${w}`)).status, 400, w);
  }
  assert.equal(upstream.calls.length, 0);
});

test('a miss fetches the thumb once, serves it with the contract headers, then serves from the disk cache', async t => {
  const { service, medelhavs } = await seededPlaceMedia(t);
  const cacheDir = tempDir(t);
  const upstream = upstreamSpy();
  const bytes = createMediaBytes({ placeMedia: service, cacheDir, fetcher: upstream.fetcher });
  const get = await serve(t, bytes);

  const first = await get(`/media/c/${medelhavs.media_id}/500`);
  assert.equal(first.status, 200);
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), JPEG);
  assert.equal(first.headers.get('content-type'), 'image/jpeg');
  assert.equal(first.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(first.headers.get('etag'), `"${medelhavs.media_id}-500"`);
  assert.equal(first.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(first.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(upstream.calls.length, 1);
  assert.equal(upstream.calls[0].url,
    'https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Medelhavsmuseet_2007.jpg/500px-Medelhavsmuseet_2007.jpg');
  assert.match(upstream.calls[0].init.headers['User-Agent'], /^Parranda\/1\.0 /);
  assert.equal(upstream.calls[0].init.headers.Referer, undefined);
  assert.ok(fs.existsSync(path.join(cacheDir, `${medelhavs.media_id}-500.jpg`)));

  const second = await get(`/media/c/${medelhavs.media_id}/500`);
  assert.equal(second.status, 200);
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), JPEG);
  assert.equal(upstream.calls.length, 1, 'a cache hit makes no upstream call');

  // A restarted process finds the bytes on disk.
  const restartedUpstream = upstreamSpy();
  const restarted = await serve(t, createMediaBytes({ placeMedia: service, cacheDir, fetcher: restartedUpstream.fetcher }));
  const third = await restarted(`/media/c/${medelhavs.media_id}/500`);
  assert.equal(third.status, 200);
  assert.deepEqual(Buffer.from(await third.arrayBuffer()), JPEG);
  assert.equal(restartedUpstream.calls.length, 0);
  assert.equal(bytes.health().hits, 1);
});

test('If-None-Match with the ETag answers 304 without disk or upstream work', async t => {
  const { service, medelhavs } = await seededPlaceMedia(t);
  const upstream = upstreamSpy();
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher }));
  const etag = etagFor(medelhavs.media_id, 250);
  for (const header of [etag, `W/${etag}`, `"other", ${etag}`]) {
    const response = await get(`/media/c/${medelhavs.media_id}/250`, { headers: { 'If-None-Match': header } });
    assert.equal(response.status, 304, header);
    assert.equal(response.headers.get('etag'), etag);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
  }
  assert.equal(upstream.calls.length, 0);
  const other = await get(`/media/c/${medelhavs.media_id}/250`, { headers: { 'If-None-Match': etagFor(medelhavs.media_id, 500) } });
  assert.equal(other.status, 200);
  // An unknown id is 404 even with a matching-looking ETag.
  const unknown = await get(`/media/c/${UNKNOWN_SHA1}/250`, { headers: { 'If-None-Match': etagFor(UNKNOWN_SHA1, 250) } });
  assert.equal(unknown.status, 404);
});

test('upstream down and not cached gives a fast 503, and the breaker stops further upstream calls', async t => {
  const { service, medelhavs, rohsska } = await seededPlaceMedia(t);
  const upstream = upstreamSpy(() => { throw new TypeError('fetch failed'); });
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher, breakerThreshold: 2 }));
  const started = Date.now();
  const first = await get(`/media/c/${medelhavs.media_id}/250`);
  assert.equal(first.status, 503);
  assert.ok(Number(first.headers.get('retry-after')) >= 1);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal((await get(`/media/c/${medelhavs.media_id}/500`)).status, 503);
  assert.equal(upstream.calls.length, 2);
  // Breaker open: no more upstream calls, still 503.
  assert.equal((await get(`/media/c/${rohsska.media_id}/250`)).status, 503);
  assert.equal(upstream.calls.length, 2);
  assert.ok(Date.now() - started < 1000);
});

test('a hanging upstream times out into a 503 within the timeout', async t => {
  const { service, medelhavs } = await seededPlaceMedia(t);
  const upstream = upstreamSpy(() => new Promise(() => {}));
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher, timeoutMs: 60 }));
  const started = Date.now();
  const response = await get(`/media/c/${medelhavs.media_id}/250`);
  assert.equal(response.status, 503);
  assert.ok(Date.now() - started < 1000);
});

test('Retry-After from a 429 upstream opens the breaker for that long', async t => {
  const { service, medelhavs, rohsska } = await seededPlaceMedia(t);
  const upstream = upstreamSpy(() => new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }));
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher }));
  const first = await get(`/media/c/${medelhavs.media_id}/250`);
  assert.equal(first.status, 503);
  assert.ok(Number(first.headers.get('retry-after')) >= 119);
  assert.equal((await get(`/media/c/${rohsska.media_id}/250`)).status, 503);
  assert.equal(upstream.calls.length, 1);
});

test('oversize bodies are refused, declared or streamed, and nothing is cached', async t => {
  const { service, medelhavs, rohsska } = await seededPlaceMedia(t);
  const cacheDir = tempDir(t);
  const big = Buffer.concat([JPEG, Buffer.alloc(MAX_FILE_BYTES)]);
  const upstream = upstreamSpy(url => (url.includes('Medelhavs')
    ? imageResponse(big)
    : new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(JPEG));
        for (let i = 0; i < 3; i += 1) controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'image/jpeg' } })));
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir, fetcher: upstream.fetcher }));
  assert.equal((await get(`/media/c/${medelhavs.media_id}/250`)).status, 404);
  assert.equal((await get(`/media/c/${rohsska.media_id}/250`)).status, 404);
  assert.deepEqual(fs.readdirSync(cacheDir), []);
  // A refusal is remembered for a while: no repeat upstream call.
  assert.equal((await get(`/media/c/${medelhavs.media_id}/250`)).status, 404);
  assert.equal(upstream.calls.length, 2);
});

test('non-image responses are refused, by content type and by first bytes', async t => {
  const { service, medelhavs, rohsska } = await seededPlaceMedia(t);
  const cacheDir = tempDir(t);
  const html = Buffer.from('<!doctype html><title>error</title>');
  const upstream = upstreamSpy(url => (url.includes('Medelhavs')
    ? imageResponse(html, 'text/html; charset=utf-8')
    : imageResponse(html, 'image/jpeg')));
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir, fetcher: upstream.fetcher }));
  assert.equal((await get(`/media/c/${medelhavs.media_id}/250`)).status, 404);
  assert.equal((await get(`/media/c/${rohsska.media_id}/250`)).status, 404);
  assert.deepEqual(fs.readdirSync(cacheDir), []);
  const svg = upstreamSpy(() => imageResponse(Buffer.from('<svg/>'), 'image/svg+xml'));
  const svgGet = await serve(t, createMediaBytes({ placeMedia: service, cacheDir, fetcher: svg.fetcher }));
  assert.equal((await svgGet(`/media/c/${medelhavs.media_id}/500`)).status, 404);
});

test('a PNG is served as PNG', async t => {
  const { service, medelhavs } = await seededPlaceMedia(t);
  const upstream = upstreamSpy(() => imageResponse(PNG, 'image/png'));
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher }));
  const response = await get(`/media/c/${medelhavs.media_id}/960`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
});

test('upstream 404/410 is a 404 here', async t => {
  const { service, medelhavs } = await seededPlaceMedia(t);
  const upstream = upstreamSpy(() => new Response('gone', { status: 410 }));
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher }));
  assert.equal((await get(`/media/c/${medelhavs.media_id}/250`)).status, 404);
});

test('at most two upstream fetches run at once, and one key is fetched once', async t => {
  const { service, medelhavs, rohsska } = await seededPlaceMedia(t);
  let active = 0;
  let peak = 0;
  const upstream = upstreamSpy(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 30));
    active -= 1;
    return imageResponse();
  });
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher }));
  const paths = [];
  for (const photo of [medelhavs, rohsska]) for (const w of [250, 500, 960]) paths.push(`/media/c/${photo.media_id}/${w}`);
  paths.push(paths[0], paths[0]);
  const statuses = await Promise.all(paths.map(async p => (await get(p)).status));
  assert.deepEqual(statuses, paths.map(() => 200));
  assert.equal(peak, 2);
  assert.equal(upstream.calls.length, 6, 'concurrent requests for one key share one upstream fetch');
});

test('the disk cache keeps its LRU byte cap', async t => {
  const { service, medelhavs, rohsska } = await seededPlaceMedia(t);
  const cacheDir = tempDir(t);
  const upstream = upstreamSpy();
  const bytes = createMediaBytes({ placeMedia: service, cacheDir, fetcher: upstream.fetcher, maxCacheBytes: JPEG.length * 2 });
  const get = await serve(t, bytes);
  await get(`/media/c/${medelhavs.media_id}/250`);
  await get(`/media/c/${rohsska.media_id}/250`);
  await get(`/media/c/${medelhavs.media_id}/250`); // touch: now most recent
  await get(`/media/c/${rohsska.media_id}/500`); // evicts the least recent (rohsska 250)
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(fs.readdirSync(cacheDir).sort(), [`${medelhavs.media_id}-250.jpg`, `${rohsska.media_id}-500.jpg`].sort());
  assert.ok(bytes.health().cache_bytes <= JPEG.length * 2);
  assert.equal(upstream.calls.length, 3);
});

test('the public-access guard counts only upstream misses on /media/', async t => {
  const { service, medelhavs, rohsska } = await seededPlaceMedia(t);
  const upstream = upstreamSpy();
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher }), {
    guardEnv: { PARRANDA_PUBLIC_GUARD: 'enabled', PARRANDA_PUBLIC_GUARD_MEDIA_MAX: '1', PARRANDA_PUBLIC_GUARD_MAX: '1' },
  });
  assert.equal((await get(`/media/c/${medelhavs.media_id}/250`)).status, 200, 'first miss spends the one allowance');
  for (let i = 0; i < 5; i += 1) assert.equal((await get(`/media/c/${medelhavs.media_id}/250`)).status, 200, 'hits are free');
  for (let i = 0; i < 3; i += 1) {
    const etag = etagFor(medelhavs.media_id, 500);
    assert.equal((await get(`/media/c/${medelhavs.media_id}/500`, { headers: { 'If-None-Match': etag } })).status, 304, '304s are free');
    assert.equal((await get(`/media/c/${UNKNOWN_SHA1}/250`)).status, 404, 'unknown ids are free');
    assert.equal((await get(`/media/c/${medelhavs.media_id}/333`)).status, 400, 'bad widths are free');
  }
  const limited = await get(`/media/c/${rohsska.media_id}/250`);
  assert.equal(limited.status, 429, 'a second miss is over the allowance');
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.equal(upstream.calls.length, 1, 'a refused miss never reaches upstream');
});

test('the guard hands /media/ an admission check only when enabled, and leaves other paths alone', () => {
  assert.equal(upstreamCostPrefix('/media/c/x/250'), '/media/');
  assert.equal(upstreamCostPrefix('/mediax'), null);
  assert.equal(upstreamCostPrefix('/api/geocode'), null);
  const run = (env, requestPath) => {
    const request = { path: requestPath, headers: {}, socket: { remoteAddress: '203.0.113.7' } };
    let nexted = false;
    createPublicAccessGuard({ env })(request, { status() { throw new Error('no refusal expected'); } }, () => { nexted = true; });
    return { request, nexted };
  };
  const enabled = run({ PARRANDA_PUBLIC_GUARD: 'enabled', PARRANDA_PUBLIC_GUARD_MEDIA_MAX: '2' }, '/media/c/abc/250');
  assert.equal(enabled.nexted, true);
  const admit = enabled.request[UPSTREAM_MISS_ADMISSION];
  assert.equal(typeof admit, 'function');
  assert.equal(admit().allowed, true);
  assert.equal(admit().remaining, 1, 'one request counts at most once');
  const disabled = run({}, '/media/c/abc/250');
  assert.equal(disabled.nexted, true);
  assert.equal(disabled.request[UPSTREAM_MISS_ADMISSION], undefined);
  const health = run({ PARRANDA_PUBLIC_GUARD: 'enabled' }, '/api/health');
  assert.equal(health.request[UPSTREAM_MISS_ADMISSION], undefined);
});

test('buildApp registers GET /media/c/:media_id/:w', async t => {
  const { service, medelhavs } = await seededPlaceMedia(t);
  const { buildApp } = require('../server/app');
  const upstream = upstreamSpy();
  setPlaceMediaForTests(service);
  setMediaBytesForTests(createMediaBytes({ cacheDir: path.join(tempDir(t), CACHE_SUBDIR), fetcher: upstream.fetcher }));
  t.after(() => { setPlaceMediaForTests(undefined); setMediaBytesForTests(undefined); });
  const server = buildApp({
    openDataLoader: null, placeSuggestions: null, eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null,
    walkingRouter: null, walkingConfig: null,
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ok = await fetch(`${base}/media/c/${medelhavs.media_id}/250`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${base}/media/c/${UNKNOWN_SHA1}/250`)).status, 404);
  assert.equal((await fetch(`${base}/media/c/${medelhavs.media_id}/251`)).status, 400);
  setPlaceMediaForTests(null);
  assert.equal((await fetch(`${base}/media/c/${medelhavs.media_id}/250`)).status, 404, 'feature off');
  assert.equal(upstream.calls.length, 1);
});

test('sw.js serves /media/ network-first from a bounded cache and drops 404/410', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(source, /const MEDIA_CACHE_MAX_ENTRIES = 200;/);
  assert.match(source, /url\.pathname\.startsWith\("\/media\/"\)\) \{\s*event\.respondWith\(networkFirstMedia\(request\)\)/);
  assert.ok(source.indexOf('networkFirstMedia(request))') < source.indexOf('event.respondWith(cacheFirst(request))'),
    'the media rule runs before the generic same-origin cache-first rule');
  assert.match(source, /response\.status === 404 \|\| response\.status === 410\) \{\s*await cache\.delete\(request\)/);
  assert.match(source, /key !== CACHE_NAME && key !== MEDIA_CACHE_NAME/);
});

// ---------- review 2026-11-25: spelling of the path, fail closed, global pacing ----------

test('a case-variant or trailing-slash path meets the same media allowance (Express routes them alike)', async t => {
  const { service, medelhavs, rohsska } = await seededPlaceMedia(t);
  const upstream = upstreamSpy();
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher }), {
    guardEnv: { PARRANDA_PUBLIC_GUARD: 'enabled', PARRANDA_PUBLIC_GUARD_MEDIA_MAX: '1' },
  });
  assert.equal((await get(`/media/c/${medelhavs.media_id}/250`)).status, 200);
  assert.equal((await get(`/media/c/${rohsska.media_id}/250`)).status, 429);
  assert.equal((await get(`/MEDIA/c/${rohsska.media_id}/250`)).status, 429, 'upper case is the same route and the same allowance');
  assert.equal((await get(`/Media/c/${medelhavs.media_id}/500`)).status, 429);
  assert.equal(upstream.calls.length, 1, 'no second upstream call');
  assert.equal(upstreamCostPrefix('/MEDIA/c/x/250'), '/media/');
  assert.equal(routedPath('/API/Geocode/'), '/api/geocode');
});

test('the guard counts upstream-cost API paths however they are spelled', () => {
  const env = { PARRANDA_PUBLIC_GUARD: 'enabled', PARRANDA_PUBLIC_GUARD_MAX: '1' };
  const guard = createPublicAccessGuard({ env });
  const statuses = [];
  for (const requestPath of ['/api/geocode', '/API/geocode', '/api/Geocode/']) {
    const request = { path: requestPath, headers: {}, socket: { remoteAddress: '203.0.113.7' } };
    const response = { status(code) { statuses.push(code); return this; }, set() { return this; }, json() { return this; }, once() {} };
    guard(request, response, () => statuses.push('next'));
  }
  assert.deepEqual(statuses, ['next', 429, 429]);
});

test('with the guard on, a miss that arrives without an admission check never goes upstream (fail closed)', async t => {
  const { service, medelhavs } = await seededPlaceMedia(t);
  const upstream = upstreamSpy();
  const get = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher, guardEnabled: () => true }));
  const refused = await get(`/media/c/${medelhavs.media_id}/250`);
  assert.equal(refused.status, 503);
  assert.equal(refused.headers.get('cache-control'), 'no-store');
  assert.equal(upstream.calls.length, 0);
  const open = await serve(t, createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher, guardEnabled: () => false }));
  assert.equal((await open(`/media/c/${medelhavs.media_id}/250`)).status, 200, 'guard off: the route serves as before');
});

test('upstream starts are paced for the whole process, so one client cannot provoke the 429 that blocks everyone', async t => {
  const { service, medelhavs, rohsska } = await seededPlaceMedia(t);
  // A Wikimedia-like upstream: more than 2 starts inside 200 ms answers 429 (Retry-After 11).
  const starts = [];
  const upstream = upstreamSpy(() => {
    const at = Date.now();
    starts.push(at);
    if (starts.filter(time => at - time < 200).length > 2) return new Response('', { status: 429, headers: { 'retry-after': '11' } });
    return imageResponse();
  });
  const bytes = createMediaBytes({ placeMedia: service, cacheDir: tempDir(t), fetcher: upstream.fetcher,
    startBurst: 2, startIntervalMs: 400, maxQueueWaitMs: 500, guardEnabled: () => false });
  const get = await serve(t, bytes);
  // One client asks for six cold thumbnails at once.
  const keys = [medelhavs, rohsska].flatMap(photo => [250, 500, 960].map(w => `/media/c/${photo.media_id}/${w}`));
  const results = await Promise.all(keys.map(key => get(key)));
  const statuses = results.map(response => response.status);
  assert.ok(statuses.filter(status => status === 200).length >= 2, statuses.join(','));
  assert.ok(statuses.every(status => status === 200 || status === 503), statuses.join(','));
  assert.equal(bytes.health().breaker_open, false, 'the breaker never opened');
  assert.ok(bytes.health().paced_out >= 1, 'starts beyond the queue wait are fast 503s, not upstream calls');
  assert.equal(upstream.calls.length, statuses.filter(status => status === 200).length, 'no upstream 429 was ever provoked');
  // Another viewer, a moment later, still gets an uncached photo.
  await new Promise(resolve => setTimeout(resolve, 900));
  const missing = keys.find((key, index) => statuses[index] === 503);
  assert.equal((await get(missing)).status, 200);
});

test('after an index rebuild, a shared day\'s old photo still loads over HTTP while new days get the new one (Hermes #715 F1)', async t => {
  const { service, medelhavs, rohsska } = await seededPlaceMedia(t);
  const { appendRetainedPhotos } = require('../server/place-media');
  const record = service.peek(MEDELHAVS);
  appendRetainedPhotos(service.dir, [medelhavs]);
  fs.writeFileSync(path.join(service.dir, 'index-v1.jsonl'), `${JSON.stringify({ ...record, photo: rohsska })}\n`);
  const rebuilt = createPlaceMedia({ dir: service.dir, fetcher: async () => { throw new Error('offline'); } });
  const bytes = createMediaBytes({ placeMedia: rebuilt, cacheDir: tempDir(t), fetcher: upstreamSpy().fetcher });
  const get = await serve(t, bytes);
  for (const width of [250, 500]) assert.equal((await get(`/media/c/${medelhavs.media_id}/${width}`)).status, 200, `old photo at ${width}`);
  assert.equal((await get(`/media/c/${rohsska.media_id}/500`)).status, 200);
  assert.equal((await get(`/media/c/${UNKNOWN_SHA1}/500`)).status, 404, 'still no open proxy');
});
