'use strict';
require('./helpers/file-deadline');
require('./helpers/no-live-network');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { collectAnchorEvents, resolveEventFeedRegistry, resolveDefaultEventSupply } = require('../server/place-candidates/agnostic-event-supply');
const { shapeCollectedLiveEvents } = require('../server/place-candidates/live-event-query');
const { LIVE_COLLECTION_READ } = require('../server/planner/live-completion');
const { publicLiveSourceUrls } = require('../server/place-candidates/live-source-destination-evidence');
const { WIX_ROOT, WIX_CHILD, WIX_EVENT, wixTransport, deferred, turn } = require('./published-day-live-publication.test');
const reviewed = require('../config/reviewed-event-feeds.json').find(f => f.id === 'visit-ystad-osterlen-calendar');
const DATE = new Date().toISOString().slice(0,10);
const args = { anchor: { lat: 41.9, lng: 12.49 }, now: `${DATE}T08:00:00Z`, selectedDate: DATE, preferences: ['culture'] };
const feed = { ...reviewed, bbox: [12,41,13,42] }; // Deliberate controlled transport geography, not publisher inventory.
const environment = feeds => ({ PARRANDA_AGNOSTIC_EVENTS: 'enabled', PARRANDA_EVENT_READER: 'disabled', PARRANDA_REQUEST_TIME_EVENT_DISCOVERY: 'disabled', PARRANDA_EVENT_FEEDS: JSON.stringify(feeds) });
const rows = value => [...value.tonight, ...value.this_week, ...value.browse.tonight.more, ...value.browse.this_week.more];
async function collect({ feeds = [feed], wire, before } = {}) {
  return collectAnchorEvents({ ...args, registry: resolveEventFeedRegistry(environment(feeds)),
    venueResolver: async () => [{ label: 'Harbour hall', lat: 41.903, lng: 12.493, confidence: 'high', provenance: 'offline_fixture' }],
    fetcher: async (url, init) => {
      assert.equal(init.headers.Authorization, undefined);
      assert.equal(init.redirect, 'manual');
      if (before) await before(url);
      const original = { ...wixTransport(new URL(url).pathname === '/sitemap.xml' ? WIX_ROOT : url === WIX_CHILD ? WIX_CHILD : WIX_EVENT, args), url };
      return wire ? wire(url, original) : { ...original, url };
    } });
}
function proof(value) { return publicLiveSourceUrls(shapeCollectedLiveEvents(value)); }

module.exports = { collect, proof, args, feed, environment, rows };
if (require.main === module) {
  test('only actual configured catalog/detail collection witnesses exact retained Unicode URL IDs and claims', async () => {
    const value = await collect();
    assert.equal(value.acquisition.source_health.status, 'healthy'); assert.ok(rows(value).length);
    const live = shapeCollectedLiveEvents(value);
    assert.deepEqual([...publicLiveSourceUrls(live)], [WIX_EVENT]);
    assert.equal(publicLiveSourceUrls(JSON.parse(JSON.stringify(live))), null);
    const forged = structuredClone(live); forged.publicSourceUrls = new Set([WIX_EVENT]); forged.public_event = true;
    assert.equal(publicLiveSourceUrls(forged), null);
    assert.equal(JSON.stringify(live).includes('_live_destination_inputs'), false);
    assert.equal(Object.getOwnPropertySymbols(live).length, 0);
  });

  test('raw configured endpoint/prefix tokens cannot be repaired into an approved source declaration', async () => {
    for (const change of [{ endpoint: ` ${WIX_ROOT}` }, { event_path_prefix: ' /evenemang-1/' }]) {
      const value = await collect({ feeds: [{ ...feed, ...change }] });
      assert.ok(rows(value).length, 'ordinary Live remains unchanged by privacy denial');
      assert.equal(proof(value), null, JSON.stringify(change));
    }
  });

  test('normalized duplicate catalog tokens cannot borrow a literal sibling publication witness', async () => {
    const value = await collect({ wire: (url, original) => url === WIX_CHILD ? { ...original,
      text: async () => `<urlset generatedBy="WIX"><url><loc> ${WIX_EVENT}</loc></url><url><loc>${WIX_EVENT}</loc></url></urlset>` } : original });
    assert.ok(rows(value).length);
    assert.equal(proof(value), null, 'the selected original loc was whitespace-prefixed, not literal');
  });
  test('owned memory/disk reuse revalidates originals without renewing bytes, age, health or acquisition', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'live-destination-cache-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    let acquisitions = 0; const settled = deferred();
    const env = { ...environment([feed]), PARRANDA_CACHE_DIR: directory };
    const options = { eventReader: null, requestTimeDiscovery: null, collectEvents: async () => {
      acquisitions++; try { return await collect(); } finally { settled.resolve(); }
    } };
    const supply = resolveDefaultEventSupply(env, options);
    const pending = await supply(args); assert.equal(pending.pending, true);
    await settled.promise; await turn();
    const original = pending[LIVE_COLLECTION_READ]();
    assert.deepEqual([...proof(original)], [WIX_EVENT]);
    const memory = await supply(args); assert.deepEqual([...proof(memory)], [WIX_EVENT]);
    const [file] = await fs.readdir(path.join(directory, 'agnostic-events-v23'));
    const location = path.join(directory, 'agnostic-events-v23', file);
    const bytes = await fs.readFile(location, 'utf8'), stat = await fs.stat(location);
    const disk = JSON.parse(bytes);
    assert.ok(disk.value._live_destination_inputs.claims.length);
    const restarted = resolveDefaultEventSupply(env, { ...options, collectEvents: () => { throw new Error('no reacquisition'); } });
    const restored = await restarted(args);
    assert.deepEqual([...proof(restored)], [WIX_EVENT]);
    assert.deepEqual(restored.acquisition.source_health, original.acquisition.source_health);
    assert.equal(await fs.readFile(location, 'utf8'), bytes); assert.equal((await fs.stat(location)).mtimeMs, stat.mtimeMs);
    // A real new Node process has no factory/detail/frame WeakMaps from above.
    const childSource = `
      require('./tests/helpers/no-live-network');
      const { resolveDefaultEventSupply } = require('./server/place-candidates/agnostic-event-supply');
      const { shapeCollectedLiveEvents } = require('./server/place-candidates/live-event-query');
      const { publicLiveSourceUrls } = require('./server/place-candidates/live-source-destination-evidence');
      const input = JSON.parse(process.argv[1]); let acquisitions = 0;
      const supply = resolveDefaultEventSupply(input.env, { eventReader: null, requestTimeDiscovery: null,
        collectEvents: () => { acquisitions++; throw new Error('restart acquisition forbidden'); } });
      supply(input.args).then(value => {
        const witness = publicLiveSourceUrls(shapeCollectedLiveEvents(value));
        process.stdout.write(JSON.stringify({ acquisitions, pending: Boolean(value.pending), urls: witness ? [...witness] : null,
          health: value.acquisition.source_health }));
      }).catch(error => { process.stderr.write(error.stack); process.exitCode = 1; });
    `;
    const child = require('node:child_process').spawnSync(process.execPath, ['-e', childSource, JSON.stringify({ env, args })],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    const restartedProcess = JSON.parse(child.stdout);
    assert.deepEqual(restartedProcess.urls, [WIX_EVENT]); assert.equal(restartedProcess.acquisitions, 0);
    assert.equal(restartedProcess.pending, false); assert.deepEqual(restartedProcess.health, original.acquisition.source_health);
    assert.equal(await fs.readFile(location, 'utf8'), bytes); assert.equal((await fs.stat(location)).mtimeMs, stat.mtimeMs);
    const changed = resolveDefaultEventSupply({ ...env, ...environment([{ ...feed, label: 'Changed complete source config' }]) }, options);
    const incompatible = await changed(args); assert.ok(rows(incompatible).length); assert.equal(proof(incompatible), null);
    assert.equal(acquisitions, 1);
    assert.equal(await fs.readFile(location, 'utf8'), bytes);
    // Legacy cache entries remain usable but cannot gain authority or trigger a refresh.
    delete disk.value._live_destination_inputs;
    await fs.writeFile(location, JSON.stringify(disk));
    const legacy = await resolveDefaultEventSupply(env, options)(args);
    assert.ok(rows(legacy).length); assert.equal(proof(legacy), null); assert.equal(acquisitions, 1);
    assert.equal(JSON.parse(await fs.readFile(location, 'utf8')).expiresAt, disk.expiresAt);
  });

  test('caller JSON replay through an injected cache or fake collector never gains private source proof', async () => {
    const acquired = await collect(); const replay = JSON.parse(JSON.stringify(acquired));
    const mocked = resolveDefaultEventSupply(environment([feed]), { eventReader: null, requestTimeDiscovery: null,
      eventCache: { peek: () => replay }, collectEvents: () => { throw new Error('not called'); } });
    assert.equal(proof(await mocked(args)), null);
    const done = deferred();
    const replaySupply = resolveDefaultEventSupply(environment([feed]), { eventReader: null, requestTimeDiscovery: null,
      collectEvents: async () => { done.resolve(); return replay; } });
    await replaySupply(args); await done.promise; await turn();
    const copied = await replaySupply(args); assert.ok(rows(copied).length);
    assert.equal(proof(copied), null, 'an owned cache must not adopt fabricated producer provenance');
  });

  test('normalized root child token cannot be authorized by another literal child sibling', async () => {
    const value = await collect({ wire: (url, original) => url === WIX_ROOT ? { ...original,
      text: async () => `<sitemapindex generatedBy="WIX"><sitemap><loc> ${WIX_CHILD}</loc></sitemap><sitemap><loc>${WIX_CHILD}</loc></sitemap></sitemapindex>` } : original });
    assert.ok(rows(value).length); assert.equal(proof(value), null);
  });

  test('private provenance and terminal facts share the original retained graph bound, without a Live failure', async () => {
    const { createLiveCompletionStore } = require('../server/planner/live-completion');
    const value = await collect();
    assert.ok(proof(value));
    value._live_destination_inputs.claims[0].diagnostic = 'x'.repeat(2 * 1024 * 1024);
    const store = createLiveCompletionStore(); let reads = 0;
    const cap = store.issue({ pending: true, [LIVE_COLLECTION_READ]: () => { reads++; return value; } });
    const answer = store.read(cap.token);
    assert.equal(answer.status, 200); assert.ok(rows(answer.body.live_events).length);
    assert.equal(answer.body.live_events.acquisition.source_health.status, 'healthy');
    assert.equal(publicLiveSourceUrls(answer.body.live_events), null, 'over-bound private evidence cannot be retained for publication');
    assert.equal(reads, 1); assert.equal(store.read(cap.token), answer); assert.equal(reads, 1);
  });

  test('strict literal URL grammar refuses unsupported retained wire facts without repairing them', async t => {
    const origin = 'https://www.visitystadosterlen.se';
    const bad = [
      '/evenemang-1/a/0', '/evenemang-1/a/0001', '/evenemang-1/a/123456789012345678901',
      '/evenemang-1/a/101/', '/evenemang-1/a/101?ticket=secret', '/evenemang-1/a/101#private',
      '/evenemang-1/a.b/101', '/evenemang-1/a%2Fb/101', '/evenemang-1/a%252Fb/101',
      '/evenemang-1/%c3%96ppen/101', '/evenemang-1/%41bc/101', '/evenemang-1/-abc/101',
      '/evenemang-1/a%20b/101', '/evenemang-1/a%3Fb/101', '/evenemang-1/a%23b/101',
      '/evenemang-1/a%00b/101', '/evenemang-1/a%5Cb/101', '/evenemang-1/a%ZZ/101',
      '/evenemang-1/' + 'a'.repeat(701) + '/101', '/private/a/101',
    ];
    for (const suffix of bad) await t.test(suffix.slice(0,90), async () => {
      const token = origin + suffix;
      const value = await collect({ wire: (url, original) => url === WIX_CHILD ? { ...original,
        text: async () => `<urlset generatedBy="WIX"><url><loc>${token}</loc></url></urlset>` } : original });
      if (rows(value).length) {
        assert.equal(proof(value), null);
        assert.equal(rows(value)[0].source_url, token.split('#')[0], 'preserve the unchanged ordinary Wix mapper (which already omits fragments), never grant proof for that loss');
        assert.equal(JSON.stringify(value._live_destination_inputs).includes('secret'), false);
      } else assert.equal(value.acquisition.source_health.accepted_event_count, 0, 'ordinary provider path rejected before publication');
    });
  });

  test('userinfo, explicit port, literal Unicode, dot/control/backslash repairs and invalid UTF-8 never witness a retained URL', async () => {
    const tokens = [
      WIX_EVENT.replace('https://www.', 'https://fixture@www.'),
      WIX_EVENT.replace('.se/', '.se:443/'), WIX_EVENT.replace('www.', 'WWW.'),
      WIX_EVENT.replace('%C3%96ppen', 'Öppen'), WIX_EVENT.replace('%C3%96ppen', '%C3%28'),
      WIX_EVENT.replace('%C3%96ppen', '%ED%A0%80'),
      WIX_EVENT.replace('/%C3%96ppen-kultur/', '/prior/../%C3%96ppen-kultur/'),
      WIX_EVENT.replace('ppen-kultur', 'ppen' + String.fromCharCode(92) + 'kultur'),
      WIX_EVENT.replace('ppen-kultur', 'ppen' + String.fromCharCode(10) + 'kultur'),
    ];
    for (const token of tokens) {
      const value = await collect({ wire: (url, original) => url === WIX_CHILD ? { ...original,
        text: async () => `<urlset generatedBy="WIX"><url><loc>${token}</loc></url></urlset>` } : original });
      if (rows(value).length) assert.equal(proof(value), null, 'never adopt a repaired original token');
      else assert.equal(value.acquisition.source_health.accepted_event_count, 0);
      assert.equal(JSON.stringify(value._live_destination_inputs).includes('fixture@'), false);
    }
  });

  test('a URL-valued identity cannot borrow another approved detail destination from the same frame', async () => {
    const other = WIX_EVENT.replace('/101', '/102');
    for (const field of ['id','source_series_id','source_occurrence_id','atom_occurrence_id']) {
      const value = await collect({ wire: (url, original) => url === WIX_CHILD ? { ...original,
        text: async () => `<urlset generatedBy="WIX"><url><loc>${WIX_EVENT}</loc></url><url><loc>${other}</loc></url></urlset>` }
        : url === other ? { ...original, text: async () => (await original.text()).replaceAll('Original public exhibition', 'Second public exhibition') } : original });
      assert.deepEqual([...proof(value)].sort(), [WIX_EVENT, other].sort());
      const row = rows(value).find(row => row.id === WIX_EVENT);
      if (field === 'atom_occurrence_id') row.sources[0].occurrence_id = other;
      else row[field] = other;
      assert.equal(proof(value), null, field);
    }
  });

  test('wrong binding and nonexact completed response refuse proof while keeping ordinary source facts', async () => {
    for (const change of [{ id: 'lookalike-wix' }, { source_identity: 'other.example' }, { endpoint: WIX_ROOT + '?key=secret' }, { adapter: 'wix' }]) {
      const value = await collect({ feeds: [{ ...feed, ...change }] });
      assert.ok(rows(value).length); assert.equal(proof(value), null);
    }
    for (const response of [WIX_EVENT + '?private=secret', WIX_EVENT + '/', null]) {
      const value = await collect({ wire: (url, original) => url === WIX_EVENT ? { ...original, url: response } : original });
      assert.ok(rows(value).length); assert.equal(proof(value), null);
    }
    const root = await collect({ wire: (url, original) => url === WIX_ROOT ? { ...original,
      url: WIX_ROOT + '?other=1' } : original });
    assert.ok(rows(root).length); assert.equal(proof(root), null);
  });

  test('public root urlset can directly publish details without a child sitemap', async () => {
    const value = await collect({ wire: (url, original) => url === WIX_ROOT ? { ...original,
      text: async () => `<urlset generatedBy="WIX"><url><loc>${WIX_EVENT}</loc></url></urlset>` } : original });
    assert.ok(rows(value).length); assert.deepEqual([...proof(value)], [WIX_EVENT]);
  });

  test('unsupported same-URL co-contributor cannot be laundered by the approved constructor', async () => {
    const value = await collect({ feeds: [feed, { ...feed, id: 'unapproved-cocontributor', endpoint: WIX_ROOT + '?alternate=1', source_identity: 'another-publisher.example' }] });
    assert.ok(rows(value).length);
    assert.ok(rows(value)[0].sources.some(atom => atom.provider_id === 'unapproved-cocontributor'));
    assert.equal(proof(value), null);
  });

  test('browse-only and occurrence-only unsupported claims deny the complete retained projection', async () => {
    for (const nested of ['browse', 'occurrence']) {
      const value = await collect();
      assert.ok(proof(value));
      const safe = rows(value)[0], unsafe = structuredClone(safe);
      unsafe.source_provider_id = 'unsupported-copy';
      unsafe.sources[0].provider_id = 'unsupported-copy';
      if (nested === 'browse') {
        value.browse.this_week.more.push(unsafe); value.browse.this_week.more_count++;
      } else safe.occurrences = [structuredClone(safe), unsafe];
      assert.equal(proof(value), null, nested);
    }
  });

  test('commented or HTML-embedded lookalike XML is not actual catalog publication', async () => {
    for (const wrap of [text => text.replace('<url>', '<!--<url>').replace('</url>', '</url>-->'),
      text => `<html><body>${text}</body></html>`]) {
      const value = await collect({ wire: (url, original) => url === WIX_CHILD ? { ...original,
        text: async () => wrap(await original.text()) } : original });
      assert.ok(rows(value).length, 'unchanged ordinary extractor remains outside the privacy policy');
      assert.equal(proof(value), null);
    }
  });

  test('pure detail/sitemap extractors and standalone configured-looking factories never mint publication proof', async () => {
    const { createWixEventSitemapProvider, extractWixEventDetail, extractWixSitemapDocument } = require('../server/pulse-sources/wix-event-sitemap-provider');
    const parsed = extractWixEventDetail(await wixTransport(WIX_EVENT, args).text(), { sourceUrl: WIX_EVENT,
      collectionDate: DATE, timezone: feed.timezone, sourceLanguage: 'sv' });
    assert.equal(parsed.id, WIX_EVENT);
    const factory = createWixEventSitemapProvider({ id: feed.id, endpoint: WIX_ROOT, timezone: feed.timezone,
      eventPathPrefix: feed.event_path_prefix, sourceLanguage: 'sv', status: 'active',
      fetcher: async url => wixTransport(url, args) });
    const standalone = await factory.create({ key: null }).collect({ date: DATE });
    assert.equal(standalone.time_sensitive_events[0].id, WIX_EVENT);
    const { buildScopedEventSourcePlan } = require('../server/place-candidates/agnostic-event-supply');
    const { captureLiveCollectionInputs } = require('../server/place-candidates/live-source-destination-evidence');
    const plan = buildScopedEventSourcePlan({ ...args, registry: resolveEventFeedRegistry(environment([feed])) });
    const unissued = captureLiveCollectionInputs([{ source: plan[0], raw: standalone.time_sensitive_events }]);
    assert.ok(unissued.claims.every(claim => claim.input === null), 'even exact source binding cannot adopt a pure factory raw-record copy');
    const xml = extractWixSitemapDocument(await wixTransport(WIX_CHILD, args).text(), { baseOrigin: 'https://www.visitystadosterlen.se', eventPathPrefix: feed.event_path_prefix });
    assert.equal(xml.eventUrls[0].url, WIX_EVENT);
    assert.equal(publicLiveSourceUrls({ tonight: [parsed], this_week: [] }), null);
  });

  test('owned cache get/peek preserve exact Promise/result/options/receiver and original expiry', async t => {
    const { createSourceCache } = require('../server/place-candidates/source-cache');
    const { ownLiveDestinationCache, readLiveDestinationCache } = require('../server/place-candidates/live-source-destination-evidence');
    const { buildScopedEventSourcePlan } = require('../server/place-candidates/agnostic-event-supply');
    const sourcePlan = buildScopedEventSourcePlan({ ...args, registry: resolveEventFeedRegistry(environment([feed])) });
    const acquired = await collect();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'live-cache-get-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const cacheOptions = { namespace: 'agnostic-events-v20', ttlMs: 123456, dir: directory };
    const cache = ownLiveDestinationCache(createSourceCache(cacheOptions));
    const realGet = cache.get; let originalPromise, receivedOptions, produced = 0;
    cache.get = function (...parameters) {
      assert.equal(this, cache); receivedOptions = parameters[2]; originalPromise = realGet.apply(this, parameters); return originalPromise;
    };
    const reader = readLiveDestinationCache(cache, sourcePlan);
    const controller = new AbortController(), options = { signal: controller.signal, shouldStore: value => value === acquired };
    const promise = reader.get('actual-owned-get', async () => { produced++; return acquired; }, options);
    assert.equal(promise, originalPromise); assert.equal(receivedOptions, options);
    const result = await promise; assert.equal(result, acquired);
    const expiry = cache.inspect('actual-owned-get').expiresAt;
    const target = reader.carry(result, shapeCollectedLiveEvents(result)); assert.deepEqual([...publicLiveSourceUrls(target)], [WIX_EVENT]);
    assert.equal(reader.peek('actual-owned-get'), result); assert.equal(cache.inspect('actual-owned-get').expiresAt, expiry);
    const hit = reader.get('actual-owned-get', () => { throw new Error('no extra provider'); }, options);
    assert.equal(hit, originalPromise); assert.equal(await hit, result); assert.equal(produced, 1);
    assert.equal(cache.inspect('actual-owned-get').expiresAt, expiry);
    const diskFile = path.join(directory, 'agnostic-events-v20', 'actual-owned-get.json');
    const diskBytes = await fs.readFile(diskFile, 'utf8'), diskStat = await fs.stat(diskFile);
    const restartedCache = ownLiveDestinationCache(createSourceCache(cacheOptions));
    const diskReader = readLiveDestinationCache(restartedCache, sourcePlan);
    const diskResult = await diskReader.get('actual-owned-get', () => { throw new Error('restart must not reacquire'); }, options);
    assert.deepEqual([...publicLiveSourceUrls(diskReader.carry(diskResult, shapeCollectedLiveEvents(diskResult)))], [WIX_EVENT]);
    assert.equal(diskReader.peek('actual-owned-get'), diskResult);
    assert.equal(restartedCache.inspect('actual-owned-get').expiresAt, expiry);
    assert.equal(await fs.readFile(diskFile, 'utf8'), diskBytes); assert.equal((await fs.stat(diskFile)).mtimeMs, diskStat.mtimeMs);
    controller.abort();
    const aborted = reader.get('actual-owned-get', () => { throw new Error('not acquired'); }, options);
    assert.equal(aborted, originalPromise); await assert.rejects(aborted, { name: 'AbortError' });
    const failure = new Error('original acquisition error');
    const failed = reader.get('failure', () => { throw failure; }, {});
    assert.equal(failed, originalPromise); await assert.rejects(failed, error => error === failure);
  });

  test('cache bookkeeping never invokes shadowed Promise constructor, species or then accessors', async () => {
    const { createSourceCache } = require('../server/place-candidates/source-cache');
    const { ownLiveDestinationCache, readLiveDestinationCache } = require('../server/place-candidates/live-source-destination-evidence');
    const { buildScopedEventSourcePlan } = require('../server/place-candidates/agnostic-event-supply');
    const plan = buildScopedEventSourcePlan({ ...args, registry: resolveEventFeedRegistry(environment([feed])) });
    const acquired = await collect();
    for (const kind of ['constructor','species','then']) {
      const cache = ownLiveDestinationCache(createSourceCache()), originalGet = cache.get;
      let original, accesses = 0;
      cache.get = function (...parameters) {
        original = originalGet.apply(this, parameters);
        if (kind === 'species') Object.defineProperty(original, 'constructor', { configurable: true,
          value: { get [Symbol.species]() { accesses++; throw new Error('unexpected species hook'); } } });
        else Object.defineProperty(original, kind, { configurable: true,
          get() { accesses++; throw new Error(`unexpected ${kind} hook`); } });
        return original;
      };
      const reader = readLiveDestinationCache(cache, plan);
      const returned = reader.get(`shadow-${kind}`, async () => acquired, { shouldStore: value => value === acquired });
      try { assert.equal(returned, original); assert.equal(accesses, 0, kind); }
      finally { delete original.constructor; delete original.then; assert.equal(await original, acquired); }
    }
  });

  test('unsupported Proxy values and already-settled arrays gain no proof or extra reflective/then reads', async () => {
    const { createSourceCache } = require('../server/place-candidates/source-cache');
    const { ownLiveDestinationCache, readLiveDestinationCache } = require('../server/place-candidates/live-source-destination-evidence');
    const cache = ownLiveDestinationCache(createSourceCache()); let traps = 0;
    const proxy = new Proxy({}, { getOwnPropertyDescriptor() { traps++; throw new Error('unexpected reflection'); } });
    cache.set('proxy', proxy);
    const reader = readLiveDestinationCache(cache, []);
    assert.equal(reader.peek('proxy'), proxy); assert.equal(traps, 0, 'proof must not reflect on unsupported Proxy results');
    const array = [], settled = Promise.resolve(array); let thenReads = 0;
    Object.defineProperty(array, 'then', { configurable: true, get() { thenReads++; throw new Error('second assimilation'); } });
    cache.get = () => settled;
    try {
      assert.equal(reader.get('settled'), settled);
      await Promise.resolve();
      assert.equal(thenReads, 0, 'bookkeeping reactions return void rather than re-assimilating source values');
    } finally { delete array.then; }
    assert.equal(await settled, array);
  });

  test('original completion A retains its producer and preferences when a newer same-key B exists', async () => {
    const { createSourceCache } = require('../server/place-candidates/source-cache');
    const { createLiveCompletionStore } = require('../server/planner/live-completion');
    const generations = []; let count = 0;
    const supply = resolveDefaultEventSupply(environment([feed]), { eventReader: null, requestTimeDiscovery: null,
      // A controlled real zero-TTL cache permits B without changing production TTL.
      eventCache: createSourceCache({ ttlMs: 0 }), collectEvents: async () => {
        const number = ++count, settled = deferred(); generations.push(settled.promise);
        try { return await collect({ wire: (url, original) => url === WIX_EVENT ? { ...original,
          text: async () => (await original.text()).replaceAll('Original public exhibition', `Generation ${number} exhibition`) } : original }); }
        finally { settled.resolve(); }
      } });
    const a = await supply(args), completion = createLiveCompletionStore(), cap = completion.issue(a);
    await generations[0]; await turn();
    const b = await supply({ ...args, preferences: ['nature'] }); await generations[1]; await turn();
    assert.equal(rows(b[LIVE_COLLECTION_READ]())[0].title, 'Generation 2 exhibition');
    const answer = completion.read(cap.token);
    assert.equal(answer.status, 200); assert.equal(rows(answer.body.live_events)[0].title, 'Generation 1 exhibition');
    assert.deepEqual([...publicLiveSourceUrls(answer.body.live_events)], [WIX_EVENT]);
    assert.equal(completion.read(cap.token), answer); assert.equal(count, 2);
  });

  test('SPEC-1 terminal reader Set mutation cannot alter privately retained source authority', async () => {
    const { createLiveCompletionStore } = require('../server/planner/live-completion');
    const value = await collect(), store = createLiveCompletionStore(); let reads = 0;
    const cap = store.issue({ pending: true, [LIVE_COLLECTION_READ]: () => { reads++; return value; } });
    const answer = store.read(cap.token); assert.equal(answer.status, 200);
    const live = answer.body.live_events, first = publicLiveSourceUrls(live);
    assert.deepEqual([...first], [WIX_EVENT]);
    first.clear(); first.add('https://unsupported.example/not-public-evidence');
    assert.deepEqual([...publicLiveSourceUrls(live)], [WIX_EVENT], 'a mutable reader Set is not the private witness');
    assert.equal(publicLiveSourceUrls(JSON.parse(JSON.stringify(live))), null, 'a caller clone has no private witness');
    assert.equal(store.read(cap.token), answer); assert.equal(reads, 1);
  });

  test('SPEC-1 terminal integrity refuses changed claim graphs without JSON expansion or optional hooks', async () => {
    const { createLiveCompletionStore } = require('../server/planner/live-completion');
    for (const kind of ['occurrence', 'getter', 'proxy', 'alias', 'oversized', 'callable', 'fact']) {
      const value = await collect(), store = createLiveCompletionStore();
      const cap = store.issue({ pending: true, [LIVE_COLLECTION_READ]: () => value });
      const answer = store.read(cap.token), live = answer.body.live_events, row = rows(live)[0];
      assert.equal(answer.status, 200); assert.deepEqual([...publicLiveSourceUrls(live)], [WIX_EVENT]);
      let hooks = 0, serializations = 0;
      if (kind === 'occurrence') row.occurrences = [{ ...row, sources: [{ ...row.sources[0], provider_id: 'unproved-occurrence' }] }];
      if (kind === 'getter') Object.defineProperty(row, 'source_url', { enumerable: true, configurable: true,
        get() { hooks++; throw new Error('must not execute a changed accessor'); } });
      if (kind === 'proxy') row.sources.push(new Proxy({}, { ownKeys() { hooks++; throw new Error('must not reflect on a Proxy'); } }));
      if (kind === 'alias') {
        let dag = { marker: 'controlled-private-seam' };
        for (let i = 0; i < 24; i++) dag = { left: dag, right: dag };
        row.diagnostic = dag;
      }
      if (kind === 'oversized') row.diagnostic = 'x'.repeat(3 * 1024 * 1024);
      if (kind === 'callable') Object.defineProperty(row, Symbol('private-diagnostic'), { value() { hooks++; } });
      if (kind === 'fact') row.title = 'Changed after source validation';
      const stringify = JSON.stringify; let witness;
      try {
        JSON.stringify = () => { serializations++; throw new Error('integrity must not expand the public graph as JSON'); };
        witness = publicLiveSourceUrls(live);
      } finally { JSON.stringify = stringify; }
      assert.equal(witness, null, `${kind}: changed results cannot borrow original authority`);
      assert.equal(hooks, 0, `${kind}: no optional accessor/callable/Proxy execution`);
      assert.equal(serializations, 0, `${kind}: no JSON alias expansion`);
      assert.equal(store.read(cap.token), answer, 'legacy synchronous result remains the same ordinary answer');
    }
  });

  test('cache revalidation rejects non-original alias graphs before JSON estimation or cloning', async () => {
    const { createSourceCache } = require('../server/place-candidates/source-cache');
    const { ownLiveDestinationCache, readLiveDestinationCache } = require('../server/place-candidates/live-source-destination-evidence');
    const { buildScopedEventSourcePlan } = require('../server/place-candidates/agnostic-event-supply');
    const plan = buildScopedEventSourcePlan({ ...args, registry: resolveEventFeedRegistry(environment([feed])) });
    const value = await collect(), cache = ownLiveDestinationCache(createSourceCache());
    let dag = { marker: 'not-original-input' }; for (let i = 0; i < 24; i++) dag = { left: dag, right: dag };
    value._live_destination_inputs.claims[0].diagnostic = dag;
    cache.set('alias-negative', value);
    const stringify = JSON.stringify; let serializations = 0;
    JSON.stringify = (input, ...rest) => {
      if (input?.version === 1 && input?.claims) { serializations++; throw new Error('do not expand an alias graph'); }
      return stringify(input, ...rest);
    };
    try {
      const reader = readLiveDestinationCache(cache, plan), result = reader.peek('alias-negative');
      assert.equal(result, value);
      assert.equal(publicLiveSourceUrls(reader.carry(result, shapeCollectedLiveEvents(result))), null);
      assert.equal(serializations, 0, 'validate bounded original input fields without JSON graph expansion');
    } finally { JSON.stringify = stringify; }
  });

  test('real configured multi-detail browse retains complete source coverage and refuses an unsupported browse-only URL', async () => {
    for (const unsupported of [false, true]) {
      const urls = Array.from({ length: 8 }, (_, i) => `https://www.visitystadosterlen.se/evenemang-1/${i === 7 && unsupported ? 'z-event.8' : `event-${i+1}`}/${i+1}`);
      const value = await collect({ wire: (url, original) => url === WIX_CHILD ? { ...original,
        text: async () => `<urlset generatedBy="WIX">${urls.map(loc => `<url><loc>${loc}</loc></url>`).join('')}</urlset>` }
        : urls.includes(url) ? { ...original, text: async () => (await original.text()).replaceAll('Original public exhibition', `Public exhibition ${urls.indexOf(url)+1}`) } : original });
      const live = shapeCollectedLiveEvents(value);
      assert.equal(live.acquisition.source_health.accepted_event_count, 8);
      const more = [...live.browse.tonight.more, ...live.browse.this_week.more];
      assert.ok(more.length > 0, 'actual ranking cap sends accepted rows to browse');
      if (unsupported) {
        assert.ok(more.some(row => row.source_url === urls[7]), 'unsupported retained claim exists only in actual browse');
        assert.equal(publicLiveSourceUrls(live), null);
      } else assert.deepEqual([...publicLiveSourceUrls(live)].sort(), [...urls].sort());
    }
  });

}
