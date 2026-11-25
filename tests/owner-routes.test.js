'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOwnerCorrectionStore } = require('../server/planner/owner-corrections');
const { createOwnerAuth, hashOwnerKey, parseKeyHash, SECRET_FILE } = require('../server/owner/owner-auth');
const { createPlaceReportStore, MAX_PER_DAY } = require('../server/owner/place-reports');
const { main: ownerKey } = require('../scripts/owner-key');

const KEY = 'correct horse battery staple, but longer';
// Cheap scrypt for tests; real hashes use N=16384.
const KEY_HASH = hashOwnerKey(KEY, { N: 1024 });
const FLAT_SERVICE = 'overture-537a9f68-f791-4e64-9b01-5b66db7aab08';
const silent = { warn: () => {}, error: () => {} };
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'owner-routes-'));

async function startApp(t, { keyHash = KEY_HASH, directory = tempDir(), records, now } = {}) {
  const { buildApp } = require('../server/app');
  const clock = now || (() => Date.now());
  const ownerCorrections = createOwnerCorrectionStore({ directory, logger: silent, now: clock });
  const server = buildApp({
    openDataLoader: async () => records || [],
    ownerCorrections,
    ownerAuth: createOwnerAuth({ keyHash, directory, logger: silent, now: clock }),
    placeReports: createPlaceReportStore({ directory, logger: silent, now: clock }),
    eventSupply: async () => [],
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 18,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
    clock: () => new Date('2026-10-16T08:00:00Z'),
  }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function call(pathname, { method = 'GET', body, origin = base, headers = {}, withCookie = true } = {}) {
    const reply = await fetch(base + pathname, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(origin && method !== 'GET' ? { origin } : {}),
        ...(withCookie && cookie ? { cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = reply.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await reply.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { json = null; }
    return { status: reply.status, body: json, text, headers: reply.headers };
  }
  const signIn = () => call('/api/owner/session', { method: 'POST', body: { key: KEY } });
  return { call, signIn, directory, ownerCorrections, port: server.address().port, cookie: () => cookie, setCookie: value => { cookie = value; } };
}

test('without an owner key every owner path is a plain 404, and reports are not taken', async t => {
  const { call } = await startApp(t, { keyHash: null });
  assert.equal((await call('/owner')).status, 404);
  assert.equal((await call('/api/owner/session')).status, 404);
  assert.equal((await call('/api/owner/corrections')).status, 404);
  assert.equal((await call('/api/owner/session', { method: 'POST', body: { key: KEY } })).status, 404);
  assert.equal((await call('/api/place-reports', { method: 'POST', body: { target: { id: FLAT_SERVICE }, kind: 'other' } })).status, 404);
});

test('a malformed key hash turns the owner off instead of crashing the server', () => {
  assert.equal(createOwnerAuth({ keyHash: 'plaintext-key', directory: tempDir(), logger: silent }), null);
  assert.equal(createOwnerAuth({ keyHash: KEY_HASH, directory: '', logger: silent }), null);
  assert.equal(parseKeyHash(KEY_HASH.replace(/\$1024\$/, '$1000$')), null, 'N must be a power of two');
  assert.equal(parseKeyHash(KEY_HASH.replace(/\$1024\$/, '$1048576$')), null, 'N is capped');
});

test('sign-in: a wrong key is refused, the right key gives an HttpOnly, Strict session cookie', async t => {
  const { call, signIn, directory } = await startApp(t);
  assert.deepEqual((await call('/api/owner/session')).body, { owner: false });
  assert.equal((await call('/api/owner/session', { method: 'POST', body: { key: 'nope' } })).status, 401);
  const reply = await signIn();
  assert.equal(reply.status, 200);
  const cookie = reply.headers.get('set-cookie');
  assert.match(cookie, /^parranda_owner=\d+\.[\w-]+\.[\w-]+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(cookie, /Secure/, 'plain-http localhost cannot keep a Secure cookie');
  assert.deepEqual((await call('/api/owner/session')).body, { owner: true });
  assert.equal(fs.statSync(path.join(directory, SECRET_FILE)).mode & 0o777, 0o600);
  assert.equal((await call('/api/owner/session/end', { method: 'POST' })).status, 200);
  assert.deepEqual((await call('/api/owner/session')).body, { owner: false });
});

test('the session cookie is Secure on a public host', async t => {
  const { port } = await startApp(t);
  // fetch() will not send a foreign Host header; a plain request will.
  const setCookie = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ key: KEY });
    const request = require('node:http').request({ host: '127.0.0.1', port, method: 'POST', path: '/api/owner/session',
      headers: { host: 'parranda.example', origin: 'https://parranda.example', 'content-type': 'application/json',
        'content-length': Buffer.byteLength(body) } }, reply => {
      reply.resume();
      reply.on('end', () => resolve(reply.statusCode === 200 ? String(reply.headers['set-cookie']) : `status ${reply.statusCode}`));
    });
    request.on('error', reject);
    request.end(body);
  });
  assert.match(setCookie, /; Secure/);
});

test('a forged or expired cookie is not the owner', async t => {
  let clock = Date.parse('2026-11-25T12:00:00Z');
  const { call, signIn, cookie, setCookie } = await startApp(t, { now: () => clock });
  await signIn();
  const [name, value] = cookie().split('=');
  const [expires, nonce] = value.split('.');
  setCookie(`${name}=${Number(expires) + 1000}.${nonce}.${value.split('.')[2]}`);
  assert.deepEqual((await call('/api/owner/session')).body, { owner: false }, 'a later expiry breaks the signature');
  setCookie(`${name}=${value}`);
  clock += 31 * 24 * 60 * 60 * 1000;
  assert.deepEqual((await call('/api/owner/session')).body, { owner: false }, 'thirty days later it has run out');
});

test('a session in use past half its life is renewed', async t => {
  let clock = Date.parse('2026-11-25T12:00:00Z');
  const { call, signIn } = await startApp(t, { now: () => clock });
  await signIn();
  assert.equal((await call('/api/owner/session')).headers.get('set-cookie'), null);
  clock += 20 * 24 * 60 * 60 * 1000;
  const renewed = await call('/api/owner/session');
  assert.match(renewed.headers.get('set-cookie') || '', /Max-Age=2592000/);
  clock += 20 * 24 * 60 * 60 * 1000;
  assert.deepEqual((await call('/api/owner/session')).body, { owner: true }, 'the renewed session outlives the first');
});

test('the sixth sign-in try within 15 minutes is refused, even with the right key', async t => {
  const { call } = await startApp(t);
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await call('/api/owner/session', { method: 'POST', body: { key: `wrong-${i}` } })).status, 401);
  }
  const sixth = await call('/api/owner/session', { method: 'POST', body: { key: KEY } });
  assert.equal(sixth.status, 429);
  assert.ok(Number(sixth.headers.get('retry-after')) > 0);
});

test('writes need the session and a same-site Origin', async t => {
  const { call, signIn } = await startApp(t);
  const hide = { action: 'hide', target: { id: FLAT_SERVICE, label: 'Flat Service' }, reason: 'Property manager' };
  assert.equal((await call('/api/owner/corrections', { method: 'POST', body: hide })).status, 401);
  assert.equal((await call('/api/owner/corrections')).status, 401);
  await signIn();
  assert.equal((await call('/api/owner/corrections', { method: 'POST', body: hide, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/owner/corrections', { method: 'POST', body: hide, origin: null })).status, 403);
  assert.equal((await call('/api/owner/session', { method: 'POST', body: { key: KEY }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/owner/corrections', { method: 'POST', body: { ...hide, reason: '' } })).body.error, 'reason_required');
  const added = await call('/api/owner/corrections', { method: 'POST', body: hide });
  assert.equal(added.status, 201);
  assert.match(added.body.correction.id, /^c_/);
  assert.equal((await call('/api/owner/corrections')).body.corrections.length, 1);
  const revoked = await call(`/api/owner/corrections/${added.body.correction.id}/revoke`, { method: 'POST', body: { reason: 'Was right' } });
  assert.equal(revoked.status, 200);
  assert.equal((await call(`/api/owner/corrections/${added.body.correction.id}/revoke`, { method: 'POST', body: {} })).status, 404);
  assert.equal((await call('/api/owner/corrections')).body.corrections.length, 0);
  assert.equal((await call('/api/owner/corrections')).headers.get('cache-control'), 'no-store');
});

test('a hide written through the API leaves the day at once, and the public answer never says why', async t => {
  const { rows } = require('./helpers/day-composition-fixtures');
  const records = [...rows('museum', 'museum', 8), ...rows('shop', 'vintage-shop', 6)]
    .map(record => ({ ...record, lat: record.lat + 1, lng: record.lng + 1 }));
  const { call, signIn } = await startApp(t, { records });
  const { buildAnywherePayload } = await import('../frontend/src/lib/anywhere-payload.mjs');
  const body = buildAnywherePayload({ coords: { lat: 56.6, lng: 14 }, dates: ['2026-10-17'],
    preferences: ['second_hand', 'culture'], preferencePriority: ['second_hand', 'culture'], dayRhythm: 'full' });
  const day = async () => (await call('/api/route-recommendations?lang=en', { method: 'POST', body, withCookie: false })).text;
  const before = await day();
  const shop = JSON.parse(before).days[0].primary_route.main_stops.map(stop => stop.id).find(id => id.startsWith('shop-'));
  assert.ok(shop);
  await signIn();
  await call('/api/owner/corrections', { method: 'POST', body: { action: 'hide', target: { id: shop }, reason: 'Secret reason 42' } });
  const after = await day();
  assert.equal(after.includes(shop), false);
  assert.equal(after.includes('Secret reason 42'), false);
});

test('reports: stored without changing anything, grouped with a count, comments only for the owner', async t => {
  const { rows } = require('./helpers/day-composition-fixtures');
  const records = rows('museum', 'museum', 8).map(record => ({ ...record, lat: record.lat + 1, lng: record.lng + 1 }));
  const { call, signIn } = await startApp(t, { records });
  const report = (kind, extra = {}) => call('/api/place-reports', { method: 'POST', withCookie: false,
    body: { target: { id: FLAT_SERVICE, label: 'Flat Service', source: 'overture' }, kind, ...extra } });
  const first = await report('wrong_type', { comment: 'It is a <b>property manager</b>' });
  assert.equal(first.status, 202);
  assert.deepEqual(first.body, { status: 'received' }, 'the comment never comes back publicly');
  await report('wrong_type');
  await report('wrong_hours', { hours: 'Tu-Sa 10-18' });
  assert.equal((await report('made_up')).status, 400);
  assert.equal((await report('other', { comment: 'x'.repeat(281) })).body.error, 'bad_comment');
  assert.equal((await call('/api/place-reports', { method: 'POST', withCookie: false, body: { target: { id: '../etc' }, kind: 'other' } })).body.error, 'bad_target');

  assert.equal((await call('/api/owner/reports')).status, 401);
  await signIn();
  const { queue } = (await call('/api/owner/reports')).body;
  assert.deepEqual(queue.map(group => [group.kind, group.count]), [['wrong_type', 2], ['wrong_hours', 1]]);
  assert.equal(queue[0].notes[0].comment, 'It is a <b>property manager</b>', 'kept as text, escaping is the page\'s job');
  assert.equal(queue[0].target.label, 'Flat Service');
  assert.equal(queue[1].notes[0].hours, 'Tu-Sa 10-18');
  assert.equal(JSON.stringify(queue).includes('report_ids'), false);
  assert.equal((await call('/api/owner/corrections')).body.corrections.length, 0, 'a report never corrects by itself');

  const dismissed = await call('/api/owner/reports/resolve', { method: 'POST', body: { target_id: FLAT_SERVICE, kind: 'wrong_hours', resolution: 'dismissed' } });
  assert.deepEqual(dismissed.body, { resolved: 1 });
  assert.equal((await call('/api/owner/reports/resolve', { method: 'POST', body: { target_id: FLAT_SERVICE, kind: 'wrong_hours', resolution: 'dismissed' } })).status, 404);

  const made = await call('/api/owner/corrections', { method: 'POST', body: {
    action: 'hide', target: { id: FLAT_SERVICE, label: 'Flat Service' }, reason: 'Property manager', from_report: { kind: 'wrong_type' } } });
  assert.equal(made.body.resolved_reports, 2, 'making it a correction closes the reports it answers');
  assert.deepEqual((await call('/api/owner/reports')).body.queue, []);
});

test('a filled honeypot and the eleventh report in an hour get the same thanks and are not stored', async t => {
  const { call, signIn } = await startApp(t);
  const report = extra => call('/api/place-reports', { method: 'POST', withCookie: false,
    body: { target: { id: FLAT_SERVICE }, kind: 'closed', ...extra } });
  assert.deepEqual((await report({ website: 'http://spam.example' })).body, { status: 'received' });
  for (let i = 0; i < 10; i += 1) assert.equal((await report()).status, 202);
  const eleventh = await report();
  assert.equal(eleventh.status, 202);
  assert.deepEqual(eleventh.body, { status: 'received' });
  await signIn();
  assert.equal((await call('/api/owner/reports')).body.queue[0].count, 10);
});

test('the report store stops at the daily total and starts again the next day', () => {
  let clock = Date.parse('2026-11-25T23:00:00Z');
  const store = createPlaceReportStore({ directory: tempDir(), now: () => clock, logger: silent });
  for (let i = 0; i < MAX_PER_DAY; i += 1) assert.equal(store.submit({ target: { id: `osm-node-${i}` }, kind: 'other' }).stored, true);
  assert.deepEqual(store.submit({ target: { id: 'osm-node-x' }, kind: 'other' }), { stored: false, reason: 'daily_cap' });
  clock += 2 * 60 * 60 * 1000;
  assert.equal(store.submit({ target: { id: 'osm-node-x' }, kind: 'other' }).stored, true);
});

test('the owner page is served with a strict policy and no cache', async t => {
  const { call } = await startApp(t);
  const page = await call('/owner');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.text, /type="password"/);
  assert.equal((await call('/owner/owner.js')).status, 200);
});

test('scripts/owner-key.js makes a key and a hash that sign in', () => {
  const lines = [];
  ownerKey(['--n', '1024'], { log: line => lines.push(line) });
  const key = lines.find(line => line.startsWith('Key: ')).slice(5);
  const hash = lines.find(line => line.startsWith('PARRANDA_OWNER_KEY_HASH=')).split('=')[1];
  assert.ok(key.length >= 40);
  const auth = createOwnerAuth({ keyHash: hash, directory: tempDir(), logger: silent });
  assert.equal(auth.verifyKey(key), true);
  assert.equal(auth.verifyKey(`${key}x`), false);
});
