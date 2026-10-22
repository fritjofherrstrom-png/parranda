import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { collectAnchorEvents, resolveDefaultEventSupply, eventCacheKey } = require('../../../server/place-candidates/agnostic-event-supply');
const { createSourceCache } = require('../../../server/place-candidates/source-cache');
const { createLiveCompletionStore } = require('../../../server/planner/live-completion');
const { executeLiveEventQuery, shapeCollectedLiveEvents } = require('../../../server/place-candidates/live-event-query');
const { composeAgnosticRouteOutput } = require('../../../server/planner/agnostic-route-output');
const { externalRecord } = require('../../../tests/helpers/planner-reservoir-compare');

export const DATE = '2026-10-25';
export const NOW = '2026-10-25T08:00:00Z';
export const ANCHOR = { lat: 55.6, lng: 13 };

// Source-shaped factual HTML, not live-provider evidence. Every occasion is
// stated explicitly; neither a date range nor a city rule supplies a session.
function sourcePages(includeToday) {
  const dates = ['2026-10-01', ...(includeToday ? [DATE] : []), '2026-10-27', '2026-11-01', '2026-11-10'];
  const entries = [
    { id: 'local', title: 'Local workshop series', point: '55.601, 13.001' },
    { id: 'far', title: 'Far workshop series', point: '55.622, 13.014' },
  ];
  const pages = new Map();
  const articles = entries.map(({ id, title, point }) => {
    const state = { id, title, metadata: { dateRange: { date: dates[0] },
      occasions: dates.map(date => ({ date, time: '12:30 – 15:30', location: 'Town hall' })),
      locations: [{ name: 'Town hall', coordinate: point, adress: 'Main street 4' }] } };
    pages.set(`https://municipality.example/event?id=${id}`, `<div class="sv-se-soleil-eventShowcase" data-cid="p"></div>
      <script>AppRegistry.registerInitialState('p',${JSON.stringify(state)});</script>
      <script>AppRegistry.registerApp({portletId:'p',webAppId:'se.soleil.eventShowcase',requiredLibs:{}});</script>`);
    return `<article class="item-${id}"><a href="/event?id=${id}"><h2>${title}</h2></a>
      <time class="dates-kempox" datetime="2026-10-01">1 oktober – 10 november</time>
      <dl><dt>Tid</dt><dd></dd><dt>Kategori</dt><dd>Workshop</dd><dt>Lokal</dt><dd>Town hall</dd></dl></article>`;
  });
  pages.set('https://municipality.example/calendar', `<main class="sv-se-soleil-eventListingLocal">${articles.join('')}</main>`);
  return pages;
}

export async function sourceFixture({ includeToday = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'parranda-live-integration-'));
  const feed = { id: 'integration-calendar', adapter: 'sitevision_calendar', endpoint: 'https://municipality.example/calendar',
    timezone: 'Europe/Stockholm', bbox: [12.9, 55.5, 13.1, 55.7], source_tier: 'official', source_scoped_pulse: true, detail_limit: 8 };
  const request = { anchor: ANCHOR, now: NOW, selectedDate: DATE };
  // Reproduce the persisted old-policy empty answer at the real cache boundary.
  const key = eventCacheKey(ANCHOR, NOW, [feed.id], 3000, null, DATE, 'tonight');
  await createSourceCache({ namespace: 'agnostic-events-v13', dir: directory }).get(key, async () => ({
    coverage: 'covered', selected_date: DATE, tonight: [], this_week: [],
    acquisition: { source_health: { status: 'healthy', result: 'empty' } },
  }));
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const pages = sourcePages(includeToday), requests = [];
  let collections = 0;
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: 'enabled', PARRANDA_EVENT_READER: 'disabled',
    PARRANDA_EVENT_FEEDS: JSON.stringify([feed]), PARRANDA_CACHE_DIR: directory }, {
    eventReader: null, requestTimeDiscovery: null,
    collectEvents: async args => {
      collections += 1;
      assert.equal(args.eventReader, null);
      return collectAnchorEvents({ ...args, fetcher: async url => {
        await held;
        requests.push(String(url));
        assert.ok(pages.has(String(url)), 'only fixture listing and bounded exact detail URLs');
        return { ok: true, status: 200, text: async () => pages.get(String(url)) };
      } });
    },
  });
  const pending = await supply(request);
  assert.equal(pending.pending, true, 'v13 empty cache cannot hide the v14 producer');
  const completion = createLiveCompletionStore({ now: () => 0 });
  const capability = completion.issue(pending);
  assert.ok(capability, 'the real producer exposes its non-JSON completion read');
  async function settled(read) {
    let result;
    for (let step = 0; step < 20; step += 1) {
      result = await read();
      if (!result?.pending) return result;
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail('fixture producer did not settle');
  }
  return {
    pending: shapeCollectedLiveEvents(pending), capability, completion, release,
    requests, get collections() { return collections; },
    ready: overrides => settled(() => supply({ ...request, ...overrides })),
    async query(payload) {
      return settled(async () => {
        const response = await executeLiveEventQuery({ payload, eventSupply: supply, now: NOW });
        assert.equal(response.status, 200, JSON.stringify({ error: response.body.error, payload }));
        return response.body.live_events.pending ? { pending: true } : response;
      });
    },
    dispose: () => { release(); rmSync(directory, { recursive: true, force: true }); },
  };
}

export async function activityDay(events, capability) {
  const rows = [
    externalRecord('b1', 'Bathing one', 'beach', 55.603, 13.005, ['coast']),
    externalRecord('b2', 'Bathing two', 'beach', 55.605, 13.006, ['coast']),
    externalRecord('food', 'Lunch', 'restaurant', 55.601, 13.001, ['mat']),
    externalRecord('m1', 'Museum one', 'museum', 55.602, 13.002, ['museum']),
    externalRecord('m2', 'Museum two', 'museum', 55.604, 13.002, ['museum']),
    externalRecord('view', 'Lookout', 'viewpoint', 55.608, 13.008, ['utsikt']),
  ];
  rows.at(-1).sources = rows.at(-1).sources.slice(0, 1);
  const composed = await composeAgnosticRouteOutput({ coords: ANCHOR,
    baselineResult: { city: 'agnostic', days: [{ date: DATE, primary_route: null, alternatives: [] }] },
    externalRequested: true, openDataLoader: async () => rows, preferences: ['food', 'culture', 'views'],
    date: DATE, todayIsoDate: DATE, synthesizeVia: 'engine', dayRhythm: 'balanced', distanceMode: 'no_limit',
    trustedTimezone: 'Europe/Stockholm', clock: () => new Date(NOW),
    weatherProvider: async () => ({ condition: 'rain', source: 'fixture', stale: false }) });
  const result = composed.result;
  assert.equal(result.days[0].primary_route.main_stops.filter(stop => stop.type === 'beach').length, 0);
  assert.ok(result.days[0].primary_route.main_stops.some(stop => stop.id === 'view'));
  return { ...result, live_events: events,
    agnostic_route_output_experiment: { ...composed.experiment, promotion: { promote: true },
      intake: { query: 'Testville' }, source_status: { ...composed.experiment.source_status, anchor: ANCHOR } },
    ...(capability ? { live_completion: capability } : {}) };
}
