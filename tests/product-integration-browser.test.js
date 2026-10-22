'use strict';

// Published results and rendered stops, not candidate counts or request-only
// assertions. Actual HTTP app/handlers, resolver and OSM loader; only external
// source transports are controlled. This is not live-provider acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { createOpenDataLoader } = require('../server/place-candidates/open-data-loader');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');
let browser;
test.before(async () => {
  browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
});
test.after(async () => { await browser?.close(); });

const interests = [
  ['second_hand', 'vintage-shop', 'shop', 'second_hand'],
  ['fika', 'cafe', 'amenity', 'cafe'],
  ['culture', 'museum', 'tourism', 'museum'],
];
const elements = interests.flatMap(([intent, , key, value], group) => Array.from({ length: 9 }, (_, index) => ({
  type: 'node', id: 910000 + group * 100 + index,
  lat: 55.6 + index * .001, lon: 13 + group * .0001,
  // Single map-family supply deliberately exercises the corrected requested
  // role depth, without fabricating corroboration or confirmed human review.
  tags: { name: `Fixture ${intent} ${index}`, [key]: value,
    opening_hours: index === 8 ? 'Mo-Su off' : 'Mo-Su 09:00-22:00' },
})));

for (const [intent, type] of interests) {
  test(`published and rendered single-interest ${intent}: calm < balanced < full with no Add or unrelated filler`, { timeout: 60000 }, async t => {
    let nativeCalls = 0;
    const loader = createOpenDataLoader({ fetcher: async () => {
      nativeCalls++;
      return { ok: true, status: 200, json: async () => ({ elements }) };
    } });
    const resolver = createNominatimPlaceResolver({ fetcher: async () => ({ ok: true, status: 200, json: async () => [{
      display_name: 'Fixturehaven, Fixture Country', name: 'Fixturehaven', lat: '55.6', lon: '13',
      importance: .55, osm_type: 'relation', osm_id: 909090, place_rank: 16, class: 'place', type: 'city',
      address: { city: 'Fixturehaven', country: 'Fixture Country' },
    }] }) });
    const app = buildApp({ openDataLoader: loader, placeResolver: resolver, placeSuggestions: null,
      eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null,
      weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false,
        timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
      // Composition consumes a callable clock. An object silently falls back
      // to wall time, eventually making the fixed selected date a past day.
      clock: () => new Date('2026-10-21T08:00:00Z'),
    });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: 'Europe/Stockholm' });
    t.after(() => context.close());
    await context.route(url => url.origin !== origin, route => route.abort());
    await context.addInitScript(epoch => {
      const NativeDate = window.Date;
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [epoch])); }
        static now() { return epoch; }
      };
    }, new Date('2026-10-21T08:00:00Z').getTime());
    const page = await context.newPage(), requests = [], errors = [], observations = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/route-recommendations') requests.push(request.postDataJSON());
    });
    page.on('response', async response => {
      if (!['/api/route-recommendations', '/api/planner-status'].includes(new URL(response.url()).pathname)) return;
      try { const body = await response.json(); observations.push({ status: response.status(),
        stops: body.days?.[0]?.primary_route?.main_stops?.length,
        blockers: body.agnostic_route_output_experiment?.readiness_blockers }); } catch {}
    });
    t.after(() => t.diagnostic(JSON.stringify({
      inputs: requests.map(({ preferences, dates, day_rhythm }) => ({ preferences, dates, day_rhythm })),
      errors, observations,
    })));
    const counts = [];
    for (const [rhythm, profile, label] of [['calm', 'light', 'Relaxed'], ['balanced', 'variation', 'Balanced'], ['full', 'peak', 'Full']]) {
      const result = page.waitForResponse(async response => {
        if (!['/api/route-recommendations', '/api/planner-status'].includes(new URL(response.url()).pathname) || response.status() !== 200) return false;
        try { return (await response.json()).days?.[0]?.primary_route?.day_profile === profile; } catch { return false; }
      }, { timeout: 15000 });
      if (rhythm === 'calm') {
        await page.goto(`${origin}/anywhere?place=Fixturehaven&prefs=${intent}&day=1&rhythm=calm&lang=en`);
      } else {
        if (rhythm === 'balanced') await page.getByRole('button', { name: 'Adjust', exact: true }).click();
        await page.getByRole('button', { name: label, exact: true }).click();
      }
      const body = await (await result).json(), route = body.days[0].primary_route;
      const stops = route.main_stops, experiment = body.agnostic_route_output_experiment;
      assert.equal(experiment.intake.status, 'resolved');
      assert.equal(experiment.walking_validation.valid, true, 'published route must pass actual walking validation');
      assert.ok(stops.every(stop => stop.type === type), 'only the selected interest supplies the automatic day');
      assert.ok(stops.every(stop => !String(stop.label || stop.name).endsWith(' 8')), 'known closed supply must stay excluded');
      assert.ok(stops.every(stop => stop.selected_day_hours?.windows?.length > 0));
      assert.equal(route.trust_summary.human_verified, false);
      assert.ok(stops.every(stop => stop.provisional === true && stop.trust?.confidence === 'low'));
      assert.equal(new Set(stops.map(stop => stop.id)).size, stops.length);
      const list = page.getByRole('list', { name: 'The stops, in order', exact: true });
      await page.waitForFunction(({ names }) => {
        const rows = [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button')];
        return rows.length === names.length && names.every((name, index) => rows[index].textContent.includes(name));
      }, { names: stops.map(stop => stop.name || stop.label) });
      assert.equal(await list.locator(':scope > li > button').count(), stops.length);
      assert.deepEqual(requests.at(-1).preferences, [intent]);
      assert.equal(requests.at(-1).dates[0], '2026-10-22');
      assert.ok(requests.every(request => !request.pinned_candidate_ids?.length), 'manual Add/pin must not be needed');
      counts.push(stops.length);
    }
    assert.deepEqual(counts, [4, 5, 6]);
    assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify({ intent, published_and_rendered_counts: counts, native_source_calls: nativeCalls,
      real_http: true, provider_boundary: 'controlled; not live acceptance' }));
  });
}
