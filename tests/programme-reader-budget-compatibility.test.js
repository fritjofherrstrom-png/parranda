"use strict";
const assert = require('node:assert/strict');
const test = require('node:test');
const { hasOfficialProgramArticleSignature, createOfficialProgramArticleProvider } = require('../server/pulse-sources/official-program-article-provider');
const { hasOfficialProgramArticleSignature: hasProgrammeStructure } = require('../server/pulse-sources/official-program-article-rows');
const html = '<html lang="en"><body><section aria-label="Programme Lantern Harbour 2026"><h2>Harbour Town</h2><div><h3>Friday 30/10</h3><div><div><h4>Beacon Hall</h4><span>Quay Road 4</span></div><div><span>18–19</span><span>Music</span></div><div><span>20–21</span><span>Music</span></div></div></div></section></body></html>';
const DEFAULT_BYTES = 1024 * 1024;
function padTo(bytes, character = ' ') {
  const difference = bytes - Buffer.byteLength(html, 'utf8');
  const size = Buffer.byteLength(character, 'utf8');
  assert.equal(difference % size, 0);
  return html + character.repeat(difference / size);
}

test('programme detection cannot advertise a document the default provider refuses by UTF-8 byte budget', async () => {
  assert.equal(hasOfficialProgramArticleSignature(html), true);
  const exact = padTo(DEFAULT_BYTES);
  const oversized = exact + ' ';
  assert.equal(Buffer.byteLength(exact, 'utf8'), DEFAULT_BYTES);
  assert.equal(hasOfficialProgramArticleSignature(exact), true, 'inclusive existing default boundary');
  assert.equal(hasProgrammeStructure(oversized), true, 'valid factual grammar is the reproduction precondition');
  const provider = createOfficialProgramArticleProvider({ endpoint: 'https://programme.example/programme', timezone: 'Europe/Stockholm', sourceLanguage: 'en', fetcher: async () => new Response(oversized) }).create();
  const result = await provider.collect({ date: '2026-10-28' });
  assert.equal(result.collection_status.reason, 'source_payload_invalid', 'the existing default transport really refuses this body');
  assert.equal(hasOfficialProgramArticleSignature(oversized), false, 'do not promote a default-reader-incompatible interface');
});

test('UTF-8 compatibility does not raise transport caps or remove explicitly configured larger-reader support', async () => {
  const multibyte = html + 'é'.repeat(DEFAULT_BYTES / 2);
  assert.ok(multibyte.length < DEFAULT_BYTES, 'character count alone would accept this document');
  assert.ok(Buffer.byteLength(multibyte, 'utf8') > DEFAULT_BYTES);
  assert.equal(hasProgrammeStructure(multibyte), true);
  assert.equal(hasOfficialProgramArticleSignature(multibyte), false);
  const provider = createOfficialProgramArticleProvider({ endpoint: 'https://programme.example/programme', timezone: 'Europe/Stockholm', sourceLanguage: 'en', maxBytes: 2 * DEFAULT_BYTES, fetcher: async () => new Response(multibyte) }).create();
  const result = await provider.collect({ date: '2026-10-28' });
  assert.equal(result.collection_status.status, 'ok');
  assert.equal(result.time_sensitive_events.length, 2, 'the existing configured transport remains supported');
});

test('the real scout keeps an oversized publisher\'s usable interface while a readable programme reaches the unchanged mixed source slot', async () => {
  const { scoutLocalEventSources } = require('../server/pulse-sources/local-event-source-scout');
  const { feedsFromScout } = require('../server/pulse-sources/request-time-event-discovery');
  const { buildScopedEventSourcePlan, GLOBAL_FEED_DESCRIPTOR } = require('../server/place-candidates/agnostic-event-supply');
  const large = html.replace('<body>', '<head><link rel="alternate" type="text/calendar" href="/calendar.ics"></head><body>') + ' '.repeat(DEFAULT_BYTES);
  assert.ok(Buffer.byteLength(large, 'utf8') > DEFAULT_BYTES && Buffer.byteLength(large, 'utf8') < 2 * DEFAULT_BYTES);
  assert.equal(hasProgrammeStructure(large), true);
  const calls = [];
  const result = await scoutLocalEventSources({
    place: { name: 'Harbour Town', label: 'Harbour Town' },
    anchor: { lat: 55.4580331, lng: 14.1808853 },
    seeds: [{ url: 'https://oversized.example/' }, { url: 'https://compact.example/' }],
    maxSeeds: 2, maxLinkedPagesPerSeed: 0, maxLinkedPages: 0,
    fetcher: async url => {
      calls.push(String(url));
      const parsed = new URL(url);
      if (parsed.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n', { headers: { 'content-type': 'text/plain' } });
      assert.equal(parsed.pathname, '/', 'no extra detail fetch to compensate for the large page');
      return new Response(parsed.hostname === 'oversized.example' ? large : html, { headers: { 'content-type': 'text/html' } });
    },
  });
  const feeds = feedsFromScout(result, { timezone: 'Europe/Stockholm' });
  const compact = feeds.find(feed => feed.source_identity === 'compact.example');
  const oversized = feeds.find(feed => feed.source_identity === 'oversized.example');
  assert.equal(compact?.adapter, 'official_program_article');
  assert.equal(oversized?.adapter, 'ical', 'an impossible programme must not replace this publisher\'s usable interface');
  assert.ok(feeds.every(feed => feed.status === 'probationary' && feed.pulse_only === true && feed.confidence === 'low'));
  assert.equal(calls.filter(url => !url.endsWith('/robots.txt')).length, 2);
  const reviewed = require('../config/reviewed-event-feeds.json').filter(feed => ['simrishamn-municipal-calendar', 'visit-ystad-osterlen-calendar'].includes(feed.id));
  const plan = buildScopedEventSourcePlan({ anchor: { lat: 55.4580331, lng: 14.1808853 }, now: '2026-10-28T10:00:00Z', registry: [...reviewed, ...feeds], maxSources: 4, maxLocalSources: 3, globalEnabled: true, globalSource: GLOBAL_FEED_DESCRIPTOR, complementarySourceIds: feeds.map(feed => feed.id) });
  assert.equal(plan.length, 4);
  assert.ok(reviewed.every(feed => plan.some(source => source.id === feed.id)));
  assert.ok(plan.some(source => source.id === GLOBAL_FEED_DESCRIPTOR.id));
  assert.ok(plan.some(source => source.id === compact.id));
  assert.ok(!plan.some(source => source.id === oversized.id));
});

test('a persisted v22 incompatible-interface pool cannot suppress reacquisition and old bytes stay untouched', async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { createSourceCache } = require('../server/place-candidates/source-cache');
  const { resolveDefaultEventSupply, eventCacheKey, HELSINKI_LINKED_EVENTS_FEED } = require('../server/place-candidates/agnostic-event-supply');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-budget-cache-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const request = { anchor: { lat: 60.17, lng: 24.94 }, now: '2026-10-28T08:00:00Z' };
  const key = eventCacheKey(request.anchor, request.now, [HELSINKI_LINKED_EVENTS_FEED.id], 3000);
  await createSourceCache({ namespace: 'agnostic-events-v22', dir }).get(key, async () => ({ coverage: 'covered', tonight: [], this_week: [], acquisition: { source_health: { status: 'partial', result: 'unknown' } }, stale_incompatible_interface: true }));
  const oldFile = path.join(dir, 'agnostic-events-v22', fs.readdirSync(path.join(dir, 'agnostic-events-v22'))[0]);
  const before = fs.readFileSync(oldFile, 'utf8');
  let count = 0;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: 'enabled', PARRANDA_CACHE_DIR: dir, PARRANDA_EVENT_FEEDS: JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]) }, {
    requestTimeDiscovery: null,
    collectEvents: async () => { count++; return { coverage: 'covered', tonight: [], this_week: [], acquisition: { source_health: { status: 'healthy', result: 'empty' } } }; },
  });
  assert.equal((await supply(request)).pending, true, 'an old incompatible-interface pool must not answer for corrected reader reachability');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, 1);
  assert.equal(fs.readFileSync(oldFile, 'utf8'), before, 'including original expiry');
  assert.equal((await supply(request)).pending, undefined);
  assert.equal(count, 1, 'the corrected cache is reusable');
});
