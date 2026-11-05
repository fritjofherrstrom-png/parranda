'use strict';
require('./helpers/no-live-network');
require('./helpers/file-deadline');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveDefaultEventSupply, collectAnchorEvents } = require('../server/place-candidates/agnostic-event-supply');
const { LIVE_COLLECTION_READ } = require('../server/planner/live-completion');
const { shapeCollectedLiveEvents } = require('../server/place-candidates/live-event-query');
const { publicLiveSourceUrls } = require('../server/place-candidates/live-source-destination-evidence');

const SOURCE_URL = 'https://organizer.example/fixture-concert';
const FEED = { id: 'fixture-localized-api', label: 'Fixture calendar', adapter: 'localized_events_api',
  endpoint: 'https://events.example/api/public-v1/events/', bbox: [17.6, 59.15, 18.45, 59.6],
  timezone: 'Europe/Stockholm', source_language: 'sv', source_tier: 'official', confidence: 'medium',
  source_family: 'official_tourism_open_api', source_identity: 'events.example', page_size: 20,
  status: 'active', runtime_policy: 'bounded_refresh' };
const ARGS = { anchor: { lat: 59.326, lng: 18.072 }, now: '2026-10-27T10:00:00Z',
  selectedDate: '2026-10-27', preferences: ['culture'], time: 'tonight' };
const ROW = { id: 'fixture-concert', title: { sv: 'Fixture-konsert' }, external_website_url: SOURCE_URL,
  venue_name: 'Fixture-scenen', address: 'Exempelgatan 1, Stockholm',
  location: { latitude: 59.326, longitude: 18.072 }, start_date: '2026-10-27', end_date: '2026-10-27',
  start_time: '19:00:00', end_time: '21:00:00', categories: [{ title: 'Music', slug: 'music', subcategories: [] }] };
const proof = value => { const urls = publicLiveSourceUrls(shapeCollectedLiveEvents(value)); return urls ? [...urls] : null; };

async function seed(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'generic-intermediate-sharing-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const env = { PARRANDA_AGNOSTIC_EVENTS: 'enabled', PARRANDA_EVENT_READER: 'disabled',
    PARRANDA_REQUEST_TIME_EVENT_DISCOVERY: 'disabled', PARRANDA_EVENT_FEEDS: JSON.stringify([FEED]),
    PARRANDA_CACHE_DIR: directory };
  let finish, transports = 0;
  const settled = new Promise(resolve => { finish = resolve; });
  const supply = resolveDefaultEventSupply(env, { eventReader: null, requestTimeDiscovery: null,
    collectEvents: async options => {
      try { return await collectAnchorEvents({ ...options, fetcher: async url => {
        transports++;
        return { ok: true, status: 200, url: String(url), text: async () => JSON.stringify({ results: [ROW], next: null }) };
      } }); } finally { finish(); }
    } });
  const pending = await supply(ARGS);
  await settled; await new Promise(resolve => setImmediate(resolve));
  const original = pending[LIVE_COLLECTION_READ]();
  assert.deepEqual(proof(original), [SOURCE_URL]);
  assert.equal(transports, 1);
  const namespaces = await fs.readdir(directory);
  const namespace = namespaces.find(name => /^agnostic-event-source-v\d+$/.test(name));
  assert.ok(namespace, 'the actual intermediate source snapshot was persisted');
  const [file] = await fs.readdir(path.join(directory, namespace));
  return { env, original, location: path.join(directory, namespace, file) };
}

// A different period intentionally misses the outer event-view cache while
// reading the same source-owned calendar snapshot. No provider is consulted.
function restart(env) {
  const script = `require('./tests/helpers/no-live-network');
const {resolveDefaultEventSupply,collectAnchorEvents}=require('./server/place-candidates/agnostic-event-supply');
const {LIVE_COLLECTION_READ}=require('./server/planner/live-completion');
const {shapeCollectedLiveEvents}=require('./server/place-candidates/live-event-query');
const {publicLiveSourceUrls}=require('./server/place-candidates/live-source-destination-evidence');
(async()=>{const {env,args}=JSON.parse(process.argv[1]);let finish,transports=0,collections=0;
const settled=new Promise(resolve=>finish=resolve);
const supply=resolveDefaultEventSupply(env,{eventReader:null,requestTimeDiscovery:null,collectEvents:async options=>{
collections++;try{return await collectAnchorEvents({...options,fetcher:async()=>{transports++;throw Error('unexpected acquisition');}});}finally{finish();}}});
const first=await supply({...args,time:'this_week'});if(first.pending){await settled;await new Promise(resolve=>setImmediate(resolve));}
const value=first.pending?first[LIVE_COLLECTION_READ]():first;const urls=publicLiveSourceUrls(shapeCollectedLiveEvents(value));
console.log(JSON.stringify({urls:urls?[...urls]:null,transports,collections,health:value.acquisition.source_health,
sourceUrls:[...value.tonight,...value.this_week].map(row=>row.source_url)}));
})().catch(error=>{console.error(error);process.exitCode=1;});`;
  const child = spawnSync(process.execPath, ['-e', script, JSON.stringify({ env, args: ARGS })], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test('a new process retains public destination authority on an owned intermediate calendar cache hit across periods', async t => {
  const { env, original } = await seed(t);
  const value = restart(env);
  assert.equal(value.transports, 0, 'the existing source snapshot must not be reacquired');
  assert.equal(value.collections, 1, 'precondition: the other period missed the outer event-view snapshot');
  assert.deepEqual(value.health, original.acquisition.source_health);
  assert.ok(value.sourceUrls.includes(SOURCE_URL), 'the same actual event survived the disk cache');
  assert.deepEqual(value.urls, [SOURCE_URL]);
});

test('changing a cached intermediate row cannot mint public destination authority', async t => {
  const { env, location } = await seed(t);
  const cached = JSON.parse(await fs.readFile(location, 'utf8'));
  cached.value.time_sensitive_events[0].source_url = 'https://organizer.example/changed-event';
  await fs.writeFile(location, JSON.stringify(cached));
  const value = restart(env);
  assert.equal(value.transports, 0);
  assert.equal(value.urls, null);
});

test('an injected intermediate cache cannot confer the owned calendar snapshot authority', async t => {
  const { location } = await seed(t);
  const cached = JSON.parse(await fs.readFile(location, 'utf8')).value;
  const result = await collectAnchorEvents({ ...ARGS, registry: [FEED],
    sourceCollectionCache: { get: async () => cached },
    fetcher: async () => { throw Error('unexpected acquisition'); } });
  assert.equal(result.acquisition.source_health.result, 'events_found');
  assert.equal(proof(result), null);
});
