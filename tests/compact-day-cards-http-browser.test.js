'use strict';
// Built UI -> real HTTP handlers -> source normalizers -> actual composition.
// Source rows, resolver, weather and clocks are controlled; this is not fresh
// external-provider, public QA, physical Safari or street-network acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { mapOsmElement } = require('../server/place-candidates/open-data-loader');
const { mapOvertureRow } = require('../server/place-candidates/overture-source');
const { mockStableWeatherFetch } = require('./helpers/planner-reservoir-compare');
const NOW = '2026-10-21T08:00:00Z', DATE = '2026-10-22';
const ANCHOR = { lat: 55.6, lng: 13 };

function sourceRows() {
  return [0, .001, .002, .003, .020, .027].flatMap((delta, index) => {
    const name = `Source Closet ${index}`, lat = ANCHOR.lat + delta;
    return [mapOsmElement({ type: 'node', id: 99800 + index, lat, lon: ANCHOR.lng,
      tags: { name, shop: 'second_hand', 'addr:street': 'Source Street', 'addr:housenumber': String(10 + index) } }),
    mapOvertureRow({ id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`, name,
      lat, lng: ANCHOR.lng, category: 'second_hand_clothing_store', category_hierarchy: ['second_hand_clothing_store'],
      confidence: .998, operating_status: 'open', licenses: ['CDLA-Permissive-2.0'] })];
  });
}

test('built free-text day publishes a compact Relaxed route, useful source facts and durable edits', { timeout: 45000 }, async t => {
  const evidenceDir = process.env.PARRANDA_COMPACT_CARDS_EVIDENCE_DIR;
  const originalFetch = global.fetch;
  global.fetch = mockStableWeatherFetch();
  const records = sourceRows(), posts = [], errors = [], published = [], observations = {};
  const clock = Object.assign(() => new Date(NOW), { now: () => NOW });
  const server = buildApp({ openDataLoader: async () => records, eventSupply: null,
    placeSuggestions: null, sourceCatalog: null, reviewedPlaceSource: null, clock,
    placeResolver: async query => {
      assert.match(query, /Fixture Area/);
      return [{ ...ANCHOR, label: 'Fixture Area', confidence: 'high', provenance: { provider: 'controlled-resolver' } }];
    },
    weatherProvider: async () => ({ condition: 'sun', maxTemp: 20,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); global.fetch = originalFetch; });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: 'Europe/Stockholm' });
  await context.route(url => url.origin !== origin, route => route.abort());
  // Freeze Date only. Playwright's full clock also virtualizes Performance,
  // erasing real navigation entries that distinguish a reload from a new URL.
  await context.addInitScript(epoch => {
    const NativeDate = window.Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [epoch])); }
      static now() { return epoch; }
    };
  }, Date.parse(NOW));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/route-recommendations') posts.push(request.postDataJSON()); });
  page.on('response', async response => {
    if (!['/api/route-recommendations', '/api/planner-status'].includes(new URL(response.url()).pathname)) return;
    try { const body = await response.json(); if (body.days?.[0]?.primary_route) published.push(body); } catch {}
  });
  const nextDay = (predicate) => page.waitForResponse(async response => {
    if (!['/api/route-recommendations', '/api/planner-status'].includes(new URL(response.url()).pathname) || response.status() !== 200) return false;
    try { const body = await response.json(); return !!body.days?.[0]?.primary_route && predicate(body.days[0].primary_route, body); } catch { return false; }
  }, { timeout: 15000 });
  const rendered = async route => {
    await page.waitForFunction(names => {
      const rows = [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button')];
      return rows.length === names.length && names.every((name, index) => rows[index].textContent.includes(name));
    }, route.main_stops.map(stop => stop.label || stop.name));
  };
  const list = page.getByRole('list', { name: 'The stops, in order', exact: true });
  const openAdjust = async () => {
    const adjust = page.getByRole('button', { name: 'Adjust', exact: true });
    if (await adjust.count()) await adjust.click();
  };
  // Real landing field and real navigation: no coordinate or route API injection.
  try {
  await page.goto(origin + '/?lang=en');
  await page.getByRole('combobox').fill('Fixture Area');
  await page.getByRole('button', { name: 'Build my day', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/anywhere' && url.searchParams.get('place') === 'Fixture Area');
  await page.getByRole('button', { name: 'Adjust', exact: true }).click();
  await page.getByRole('button', { name: 'Second hand', exact: true }).waitFor();
  for (const label of ['Food & drink', 'Culture', 'Views']) {
    const chip = page.getByRole('button', { name: label, exact: true });
    if (await chip.getAttribute('aria-pressed') === 'true') await chip.click();
  }
  await page.getByRole('button', { name: 'Second hand', exact: true }).click();
  await page.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  const calmReady = nextDay(route => route.day_profile === 'light' && route.main_stops.length === 4);
  await page.getByRole('button', { name: 'Relaxed', exact: true }).click();
  const calm = (await (await calmReady).json()).days[0].primary_route;
  await rendered(calm);
  assert.deepEqual(calm.main_stops.map(stop => stop.label).sort(), ['Source Closet 0', 'Source Closet 1', 'Source Closet 2', 'Source Closet 3']);
  assert.ok(calm.estimated_km < 1.2, `compact route must remain short, got ${calm.estimated_km}`);
  assert.ok(calm.longest_leg_km < .6);
  assert.deepEqual(posts.at(-1).preferences, ['second_hand']);
  assert.equal(posts.at(-1).place, 'Fixture Area');
  assert.equal(posts.at(-1).lat, undefined); assert.equal(posts.at(-1).lng, undefined);
  assert.equal(posts.at(-1).walking_km_target, undefined);
  assert.deepEqual(posts.at(-1).dates, [DATE]);
  for (const stop of calm.main_stops) {
    const index = Number(stop.label.match(/\d+$/)[0]);
    assert.deepEqual(stop.place_details, { kind: 'second_hand_clothing', address: `Source Street ${10 + index}` });
    assert.equal(stop.summary, null);
  }
  assert.doesNotMatch(await list.innerText(), /Opening hours unavailable/);
  const firstRow = list.locator(':scope > li > button').first();
  await firstRow.click();
  const panel = page.locator('#' + await firstRow.getAttribute('aria-controls'));
  assert.equal((await list.innerText()).match(/Opening hours unavailable/g)?.length, 1);
  assert.match(await panel.innerText(), /Second-hand clothing/);
  assert.match(await panel.innerText(), /Source Street 10/);
  assert.match(await panel.innerText(), /Matches your picks: Second hand/);
  const group = panel.getByRole('group', { name: 'Edit stop', exact: true });
  assert.deepEqual(await group.getByRole('button').allTextContents(), ['Keep this one', 'Replace', 'Remove']);
  assert.equal(await panel.locator('details[open]').count(), 0);
  await panel.locator('summary').click();
  assert.match(await panel.locator('details').innerText(), /overture|OSM|osm/);
  await panel.locator('summary').click();
  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    await list.locator(':scope > li').first().screenshot({ path: path.join(evidenceDir, 'desktop-expanded-card.png') });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  observations.mobile = await panel.evaluate(element => ({
    panelWidth: element.getBoundingClientRect().width, viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    controls: [...element.querySelectorAll('button,a,summary')].map(control => ({ text: control.textContent.trim(),
      width: control.getBoundingClientRect().width, height: control.getBoundingClientRect().height })),
  }));
  assert.ok(observations.mobile.documentWidth <= 391, 'the compact card does not introduce horizontal page overflow');
  assert.ok(observations.mobile.controls.every(control => control.height >= 44 && control.width >= 44), 'compact controls retain real touch targets');
  if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, 'mobile-expanded-card.png') });
  const keptId = calm.main_stops[0].id;
  const keepReady = nextDay(route => route.main_stops.some(stop => stop.id === keptId));
  await panel.getByRole('button', { name: 'Keep this one', exact: true }).click();
  const kept = (await (await keepReady).json()).days[0].primary_route;
  await rendered(kept);
  assert.deepEqual(posts.at(-1).pinned_candidate_ids, [keptId]);
  await page.waitForFunction(id => {
    const entry = JSON.parse(localStorage.getItem('parranda:anywhere:last') || 'null');
    return entry?.commitments?.entries?.[id]?.kind === 'pin' && entry.inputs?.walkKey === 'calm';
  }, keptId);
  observations.beforeReload = await page.evaluate(() => {
    const entry = JSON.parse(localStorage.getItem('parranda:anywhere:last') || 'null');
    return { url: location.href, id: entry?.id, dateIso: entry?.dateIso,
      savedDate: entry?.safeResponse?.days?.[0]?.date,
      inputs: entry?.inputs && { mode: entry.inputs.mode, place: entry.inputs.place,
        placeLabel: entry.inputs.placeLabel, hasPlaceRef: !!entry.inputs.placeRef,
        walkKey: entry.inputs.walkKey, selected: entry.inputs.selected, preferencePriority: entry.inputs.preferencePriority },
      commitments: entry?.commitments, classification: entry?.classification };
  });
  const savedBeforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem('parranda:anywhere:last') || 'null'));
  const { urlEntryCommitments } = await import('../frontend/src/lib/url-entry-commitments.mjs');
  observations.pureReloadVerdict = urlEntryCommitments(savedBeforeReload, { navigationType: 'reload',
    anchor: { place: 'Fixture Area' }, dateIso: DATE, selected: ['second_hand'], walkKey: 'calm', preferencePriority: ['second_hand'] });
  const reloadReady = nextDay(route => route.day_profile === 'light' && route.main_stops.some(stop => stop.id === keptId));
  await page.reload();
  const reloaded = (await (await reloadReady).json()).days[0].primary_route;
  await rendered(reloaded);
  observations.navigationAfterReload = await page.evaluate(() => performance.getEntriesByType('navigation').map(entry => entry.type));
  assert.deepEqual(observations.navigationAfterReload, ['reload']);
  assert.deepEqual(posts.at(-1).pinned_candidate_ids, [keptId]);
  assert.equal(posts.at(-1).day_rhythm, 'calm');
  assert.deepEqual(reloaded.main_stops.map(stop => stop.id), kept.main_stops.map(stop => stop.id));
  assert.match(await list.innerText(), /Kept/);
  assert.doesNotMatch(await list.innerText(), /Opening hours unavailable/);
  if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, 'mobile-reloaded-collapsed.png') });
  await openAdjust();
  const fullReady = nextDay(route => route.day_profile === 'peak' && route.main_stops.length === 6);
  await page.getByRole('button', { name: 'Full', exact: true }).click();
  const full = (await (await fullReady).json()).days[0].primary_route;
  await rendered(full);
  assert.ok(full.estimated_km > calm.estimated_km);
  assert.ok(full.main_stops.every(stop => stop.type === 'vintage-shop'));
  assert.ok(full.main_stops.some(stop => stop.id === keptId));
  const removeIndex = full.main_stops.findIndex(stop => stop.id !== keptId), removedId = full.main_stops[removeIndex].id;
  await list.locator(':scope > li > button').nth(removeIndex).click();
  const removeReady = nextDay(route => route.main_stops.length === 5 && !route.main_stops.some(stop => stop.id === removedId));
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  const removed = (await (await removeReady).json()).days[0].primary_route;
  await rendered(removed);
  assert.deepEqual(removed.main_stops.map(stop => stop.id).sort(), full.main_stops.filter(stop => stop.id !== removedId).map(stop => stop.id).sort());
  assert.equal(posts.at(-1).day_edit.target_stop_count, 5);
  const postsBeforeUndo = posts.length;
  await page.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await rendered(full);
  assert.equal(posts.length, postsBeforeUndo, 'Undo restores the actual published response without recomposition');
  assert.deepEqual(errors, []);
  const receipt = { boundary: 'built UI -> actual HTTP handlers -> controlled raw OSM/Overture mapping and real composer; no product API interception or browser coordinates',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    calm: { stops: calm.main_stops.map(stop => ({ id: stop.id, label: stop.label, place_details: stop.place_details })), km: calm.estimated_km, longest_leg_km: calm.longest_leg_km },
    full: { stop_count: full.main_stops.length, km: full.estimated_km }, keep_reload: true, remove_retains_others: true, undo_without_compose: true,
    unknown_hours_only_in_expansion: true, observations, compose_posts: posts.length, published_responses: published.length, errors };
  if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  t.diagnostic(JSON.stringify(receipt));
  } catch (error) {
    t.diagnostic(JSON.stringify({ observations, posts: posts.map(({ place, dates, preferences, day_rhythm, pinned_candidate_ids, excluded_candidate_ids, day_edit }) => ({ place, dates, preferences, day_rhythm, pinned_candidate_ids, excluded_candidate_ids, day_edit })), published: published.map(body => ({ intake_status: body.agnostic_route_output_experiment?.intake?.status, km: body.days[0].primary_route.estimated_km, ids: body.days[0].primary_route.main_stops.map(stop => stop.id) })), errors }));
    if (evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({ path: path.join(evidenceDir, 'failed-observer.png'), fullPage: true });
      fs.writeFileSync(path.join(evidenceDir, 'failed-observer.html'), await page.content());
    }
    throw error;
  }
});
