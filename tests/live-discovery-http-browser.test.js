'use strict';

// Built UI -> actual Express HTTP handlers -> Linked Events transport replay ->
// real normalizer, composer and publisher. Stable place rows, resolver, weather
// and clock are controlled trusted-server boundaries. This is not live-provider,
// public-cache, deployed-runtime or physical-device acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { createPlaceSuggestions } = require('../server/place-candidates/place-suggestions');
const { collectAnchorEvents, resolveDefaultEventSupply, HELSINKI_LINKED_EVENTS_FEED } = require('../server/place-candidates/agnostic-event-supply');
const { rows } = require('./helpers/day-composition-fixtures');
const { captures } = require('./fixtures/photon-suggestion-language-20261017.json');

const NOW = '2026-10-16T08:00:00Z';
const DATE = '2026-10-17';
const ANCHOR = { lat: 60.17, lng: 24.94 };
const COMPOSE_PATHS = new Set(['/api/route-recommendations', '/api/planner-status']);
const LIVE_PATHS = new Set(['/api/planner-live-completion', '/api/planner-live-route-upgrade']);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const routeStops = body => body.days?.[0]?.primary_route?.main_stops || [];
const eventRows = live => [...(live?.tonight || []), ...(live?.browse?.tonight?.more || [])];
const occurrence = stop => stop.live_occurrence_id || null;
const name = stop => stop.label || stop.name;

function waitForPublished(page, predicate) {
  return page.waitForResponse(async response => {
    if (!COMPOSE_PATHS.has(new URL(response.url()).pathname) || response.status() !== 200) return false;
    try { return predicate(await response.json()); } catch { return false; }
  }, { timeout: 15000 }).then(response => response.json());
}

async function savedDay(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('parranda:anywhere:last') || 'null'));
}

async function assertRenderedDay(page, expectedStops) {
  const coreNames = expectedStops.filter(stop => !stop.is_live_event).map(name);
  const liveNames = expectedStops.filter(stop => stop.is_live_event).map(name);
  await page.waitForFunction(({ coreNames, liveNames }) => {
    const route = document.querySelector('section[aria-label="The route"]');
    const buttons = [...document.querySelectorAll('ol[aria-label="The stops, in order"] > li > button')];
    return buttons.length === coreNames.length && coreNames.every((label, i) => buttons[i].textContent.includes(label)) &&
      liveNames.every(label => route?.textContent.includes(label));
  }, { coreNames, liveNames });
  const route = page.getByRole('region', { name: 'The route', exact: true });
  assert.equal(await route.getByRole('heading', { name: 'Live in your route', exact: true }).count(), liveNames.length);
  const saved = await savedDay(page);
  assert.deepEqual(routeStops(saved?.safeResponse).map(stop => [stop.id, occurrence(stop)]),
    expectedStops.map(stop => [stop.id, occurrence(stop)]), 'the saved day and rendered day must answer the same exact choices');
}

test('ordinary HTTP browser day preserves the second source occurrence through selection, Remove, Undo and reload', { timeout: 45000 }, async t => {
  const { assertExactNavigation } = await import('../frontend/tests/helpers/exact-navigation-observation.mjs');
  const requests = [], responses = [], liveRequests = [], sourceRequests = [], resolverRequests = [], suggestionRequests = [], errors = [];
  let partialPlaceSupply = false, nativeSuggestion = null, completed = false, coldCompletionToken = null;
  const records = [...rows('culture', 'museum', 7), ...rows('views', 'viewpoint', 2)]
    .map(record => ({ ...record, lat: record.lat + 4.57, lng: record.lng + 11.94 }));
  const rawEvents = ['first', 'second'].map((id, index) => ({ id: `choice-${id}`, name: { en: `Source concert ${id}` },
    start_time: `${DATE}T${18 + index}:00:00Z`, end_time: `${DATE}T${20 + index}:00:00Z`,
    location: { position: { coordinates: [24.941 + index * .001, 60.171] }, name: { en: 'Source venue' } },
    info_url: { en: `https://example.org/concert-${id}` }, data_source: 'controlled-transport',
    keywords: [{ name: { en: 'music' } }] }));
  const makeSupply = (transportGate = null) => resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: 'enabled',
    PARRANDA_EVENT_FEEDS: JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]),
    PARRANDA_REQUEST_TIME_EVENT_DISCOVERY: 'disabled', PARRANDA_EVENT_READER: 'disabled',
  }, { requestTimeDiscovery: null, eventReader: null,
    collectEvents: options => collectAnchorEvents({ ...options, fetcher: async input => {
      const url = new URL(String(input));
      sourceRequests.push(url.href);
      assert.equal(url.origin, 'https://api.hel.fi');
      assert.equal(url.pathname, '/linkedevents/v1/event/');
      if (transportGate) await transportGate.promise;
      return { ok: true, json: async () => ({ data: structuredClone(rawEvents) }) };
    } }),
  });
  let currentSupply = makeSupply();
  const suggestions = createPlaceSuggestions({ minIntervalMs: 0, fetcher: async input => {
    const url = new URL(String(input));
    suggestionRequests.push(url.href);
    const capture = url.searchParams.get('lang') === 'en' ? captures.en : captures.default;
    return { ok: true, json: async () => url.searchParams.get('q') === 'Göteborg'
      ? structuredClone(capture.response) : { features: [] } };
  } });
  const server = buildApp({ eventSupply: args => currentSupply(args), placeSuggestions: suggestions,
    openDataLoader: async () => Object.assign(structuredClone(records), { loader_status: `loaded:${records.length}`,
      ...(partialPlaceSupply ? { loader_error: 'controlled_place_source_failed', loader_metadata: {
        source_completion: { status: 'partial', completed: 1, pending: 1, failed: 1 },
      } } : {}) }),
    placeResolver: async (query, context) => {
      resolverRequests.push({ query, language: context?.language });
      assert.equal(query, 'Helsinki', 'free text must reach the trusted resolver without adopting an autocomplete receipt');
      return [{ ...ANCHOR, label: 'Helsinki', confidence: 'high', provenance: { provider: 'controlled-resolver' } }];
    },
    reviewedPlaceSource: null, sourceCatalog: null,
    // The composer reads the clock as a function; an object with only now()
    // let the composition fall back to the wall clock (same fix as #623).
    clock: Object.assign(() => new Date(NOW), { now: () => NOW }),
    weatherProvider: async () => ({ condition: 'sun', timezone_resolution: {
      timezone: 'Europe/Helsinki', timezone_source: 'weather_provider_auto', utc_offset_seconds: 10800 } }),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, timezoneId: 'Europe/Helsinki' });
  // Only unrelated external browser assets are aborted. No product API is replaced.
  await context.route(url => url.origin !== origin, route => route.abort());
  // Keep native navigation timing: URL-entry recovery distinguishes an actual
  // reload through PerformanceNavigationTiming. Playwright's full clock mock
  // replaces that API, so freeze Date only, as day-composition-browser does.
  await context.addInitScript(epoch => {
    const NativeDate = window.Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [epoch])); }
      static now() { return epoch; }
    };
  }, new Date(NOW).getTime());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/route-recommendations') requests.push(request.postDataJSON());
    if (LIVE_PATHS.has(pathname)) liveRequests.push({ pathname, token: request.postDataJSON()?.token });
  });
  page.on('response', async response => {
    const pathname = new URL(response.url()).pathname;
    if (!COMPOSE_PATHS.has(pathname) && !LIVE_PATHS.has(pathname)) return;
    try {
      const body = await response.json();
      const published = body.result || body;
      responses.push({ pathname, status: response.status(), date: published.days?.[0]?.date,
        stops: routeStops(published).map(stop => ({ id: stop.id, name: name(stop), occurrence_id: occurrence(stop) })),
        completion: published.agnostic_route_output_experiment?.source_status?.collection?.source_completion,
        live_pending: body.live_events?.pending, live_completion_state: body.live_completion?.state,
        live_route_upgrade_state: body.live_route_upgrade?.state,
        live_choices: published.agnostic_route_output_experiment?.live_event_choices });
    } catch { /* A cancelled response is not a published observation. */ }
  });
  const evidenceDir = process.env.PARRANDA_LIVE_HTTP_BROWSER_EVIDENCE_DIR;
  const checkpoints = [];
  async function capture(label) {
    const saved = await savedDay(page);
    checkpoints.push({ label, url: page.url(), navigation_type: await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.type),
      entry_id: saved?.id, commitments: saved?.commitments,
      place: saved?.inputs?.place, date: saved?.dateIso, selected: saved?.inputs?.selected,
      rhythm: saved?.inputs?.walkKey, stops: routeStops(saved?.safeResponse).map(stop => ({ id: stop.id, name: name(stop), occurrence_id: occurrence(stop) })) });
    if (evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({ path: path.join(evidenceDir, `${label}.png`), fullPage: true });
    }
  }
  t.after(async () => {
    const receipt = { outcome: completed ? 'PASS' : 'FAIL', boundary: 'built UI -> actual local HTTP -> real source normalizer/composer/publisher; controlled stable rows/resolver/weather/clock and event transport',
      excluded: ['live external providers', 'public cache', 'deployment', 'physical device'],
      runtime: { node: process.version, arch: process.arch, intended: 'Node 22 / arm64' },
      checkpoints, nativeSuggestion, requests: requests.map(input => ({ ...input,
        ...(input.place_selection ? { place_selection: '<server-issued receipt>' } : {}),
      })), responses, live_requests: liveRequests.map(({ pathname, token }) => ({ pathname, same_cold_producer: token === coldCompletionToken })),
      sourceRequests, resolverRequests, suggestionRequests, errors };
    if (evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, 'journey-receipt.json'), JSON.stringify(receipt, null, 2));
    }
    assert.deepEqual(errors, [], 'built UI must not raise browser exceptions');
    t.diagnostic(JSON.stringify({ real_http: true, checkpoints: checkpoints.map(({ label, stops }) => ({ label, count: stops.length })),
      compose_posts: requests.length, event_transport_calls: sourceRequests.length, node: process.version, arch: process.arch }));
  });

  await page.goto(`${origin}/?lang=en`);
  await page.waitForFunction(() => !document.querySelector('[role=combobox]')?.closest('astro-island')?.hasAttribute('ssr'));
  const field = page.getByRole('combobox', { name: 'Type a city or place' });
  const suggestionResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/place-suggestions');
  await field.fill('Göteborg');
  await page.getByRole('option').first().waitFor();
  const native = await (await suggestionResponse).json();
  assert.equal(native.choices[0].title, 'Göteborg');
  assert.equal(native.choices[0].place_ref, 'n25930131');
  assert.equal(native.choices[0].query, 'Göteborg, Västra Götalands län, Sverige');
  assert.ok(native.choices[0].selection_id, 'the real suggestion handler issues source-owned choice identity');
  nativeSuggestion = { title: native.choices[0].title, place_ref: native.choices[0].place_ref,
    query: native.choices[0].query, kind: native.choices[0].kind };
  assert.match(await page.getByRole('option').first().innerText(), /^Göteborg/);
  assert.equal(new URL(suggestionRequests[0]).searchParams.get('lang'), null);
  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: path.join(evidenceDir, 'native-query-english-city-first.png'), fullPage: true });
  }
  await field.fill('Helsinki');
  await page.getByRole('button', { name: 'Build my day', exact: true }).click();
  const anchor = page.getByRole('region', { name: "Your day's starting point", exact: true });
  await anchor.getByRole('button', { name: 'Adjust', exact: true }).click();
  const fullResponse = waitForPublished(page, body => routeStops(body).length === 6 && body.days?.[0]?.date === DATE);
  for (const label of ['Food & drink', 'Views']) {
    const button = anchor.getByRole('button', { name: label, exact: true });
    if (await button.getAttribute('aria-pressed') === 'true') await button.click();
  }
  if (await anchor.getByRole('button', { name: 'Culture', exact: true }).getAttribute('aria-pressed') !== 'true')
    await anchor.getByRole('button', { name: 'Culture', exact: true }).click();
  // The merged pick-order UI must carry its explicit prefix alongside the
  // exact Live occurrence, including ordinary and cold completion reloads.
  await anchor.getByRole('button', { name: 'Culture', exact: true }).click();
  await anchor.getByRole('button', { name: 'Culture', exact: true }).click();
  await anchor.getByRole('button', { name: 'Tomorrow', exact: true }).click();
  await anchor.getByRole('button', { name: 'Full', exact: true }).click();
  const full = await fullResponse;
  assert.equal(full.days[0].date, DATE);
  assert.equal(full.agnostic_route_output_experiment.context?.time?.now?.slice(0, 10), NOW.slice(0, 10),
    'the published composition must use the controlled clock, not the wall date');
  assert.deepEqual(requests.at(-1).preferences, ['culture']);
  assert.deepEqual(requests.at(-1).preference_priority, ['culture']);
  assert.equal(requests.at(-1).day_rhythm, 'full');
  assert.deepEqual(requests.at(-1).dates, [DATE]);
  assert.deepEqual(full.agnostic_route_output_experiment.source_status.anchor, ANCHOR);
  await assertRenderedDay(page, routeStops(full));
  await anchor.getByRole('button', { name: 'Done', exact: true }).click();
  assert.ok(requests.length > 0 && resolverRequests.length > 0);
  assert.equal(requests[0].place_selection, undefined, 'ordinary entry must not select the earlier Göteborg suggestion');
  assert.ok(requests.every(input => input.place === 'Helsinki' && input.lat === undefined && input.lng === undefined),
    'later adjustments may reuse the actual resolver-issued Helsinki receipt but never client-injected coordinates');
  await capture('published-culture-full');

  await page.getByRole('button', { name: 'See all live', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Live events', exact: true });
  await sheet.getByRole('listitem').filter({ hasText: 'Source concert second' })
    .getByRole('button', { name: 'Plan with this event', exact: true }).waitFor();
  // A healthy first opening can use its published Live rows. Reopening asks the
  // ordinary scope endpoint, letting the receipt bind the clicked row to that
  // endpoint's exact source-backed occurrence without intercepting its response.
  await sheet.getByRole('button', { name: 'Close live', exact: true }).click();
  const liveResponse = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== '/api/live-events' || response.status() !== 200) return false;
    try { return (await response.json()).live_events?.pending !== true; } catch { return false; }
  });
  await page.getByRole('button', { name: 'See all live', exact: true }).click();
  const second = sheet.getByRole('listitem').filter({ hasText: 'Source concert second' });
  await second.getByRole('button', { name: 'Plan with this event', exact: true }).waitFor();
  // Read identity from the actual sheet-query HTTP response, never construct it.
  const live = (await (await liveResponse).json()).live_events;
  const chosen = eventRows(live).find(event => event.title === 'Source concert second');
  assert.match(chosen?.live_occurrence_id || '', /^live:2026-10-17:[a-f0-9]{32}$/);
  assert.equal(chosen.live_choice_eligible, true);
  const chosenId = chosen.live_occurrence_id;
  const selectedResponse = waitForPublished(page, body => routeStops(body).some(stop => occurrence(stop) === chosenId));
  await second.getByRole('button', { name: 'Plan with this event', exact: true }).click();
  const selected = await selectedResponse, selectedStops = routeStops(selected);
  assert.equal(selectedStops.length, 6, 'the live event belongs inside Full’s six total stops');
  assert.equal(selectedStops.filter(stop => stop.is_live_event).length, 1);
  assert.equal(occurrence(selectedStops.at(-1)), chosenId);
  assert.equal(name(selectedStops.at(-1)), 'Source concert second');
  assert.equal(selected.agnostic_route_output_experiment.live_event_choices.honored_count, 1);
  assert.equal(selected.agnostic_route_output_experiment.walking_validation.valid, true);
  assert.deepEqual(requests.at(-1).live_event_choices, [{ occurrence_id: chosenId, action: 'keep' }]);
  assert.deepEqual(requests.at(-1).preference_priority, ['culture']);
  await assertRenderedDay(page, selectedStops);
  await capture('selected-second-six-total');
  const selectedEntry = await savedDay(page);

  const removed = selectedStops.find(stop => !stop.is_live_event);
  const stopList = page.getByRole('list', { name: 'The stops, in order', exact: true });
  await stopList.locator(':scope > li > button').filter({ hasText: name(removed) }).click();
  const removedResponse = waitForPublished(page, body => body.agnostic_route_output_experiment?.day_edit?.status === 'applied' && routeStops(body).length === 5);
  await stopList.getByRole('button', { name: 'Remove', exact: true }).click();
  const edited = await removedResponse, editedStops = routeStops(edited);
  assert.ok(!editedStops.some(stop => stop.id === removed.id));
  assert.equal(occurrence(editedStops.at(-1)), chosenId);
  assert.deepEqual(editedStops.map(stop => stop.id), selectedStops.filter(stop => stop.id !== removed.id).map(stop => stop.id));
  await assertRenderedDay(page, editedStops);
  await capture('remove-stable-five-total');
  const postsBeforeUndo = requests.length;
  await page.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await assertRenderedDay(page, selectedStops);
  assert.deepEqual(await savedDay(page), selectedEntry, 'Undo restores the exact prior response, inputs and commitment snapshot');
  await delay(700); // Beyond the actual 400ms auto-compose debounce.
  assert.equal(requests.length, postsBeforeUndo, 'Undo must restore the exact prior day without a compose POST');
  await capture('undo-exact-six-total');

  const postsBeforeReload = requests.length;
  const exactReload = await assertExactNavigation({ page, navigate: () => page.reload(), expectedEntry: selectedEntry,
    readComposeCount: () => requests.length });
  const reloaded = exactReload.safeResponse;
  assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.type), 'reload',
    'the clock fixture must preserve native reload evidence');
  await assertRenderedDay(page, routeStops(reloaded));
  await capture('ordinary-reload-observed');
  assert.equal(requests.length, postsBeforeReload, 'ordinary reload restores the exact accepted answer without another compose');
  assert.deepEqual(exactReload.commitments, selectedEntry.commitments);
  assert.deepEqual(routeStops(reloaded).map(stop => stop.id), selectedStops.map(stop => stop.id));
  await assertRenderedDay(page, selectedStops);
  const restored = await savedDay(page);
  assert.equal(restored.inputs.place, 'Helsinki');
  assert.equal(restored.dateIso, DATE);
  assert.deepEqual(restored.inputs.selected, ['culture']);
  assert.deepEqual(restored.inputs.preferencePriority, ['culture']);
  assert.equal(restored.inputs.walkKey, 'full');
  await delay(700);
  await assertRenderedDay(page, selectedStops); // A late old response must not replace it.
  await capture('ordinary-reload-same-choice');

  // Drop only the private provider caches, as after a server restart. An
  // explicit interest change (not display-only reload) must carry Keep into
  // one cold HTTP compose, then follow that
  // request's producer capability instead of treating not-yet-collected as a
  // missing event or starting another composition to retry the same question.
  const transportGate = deferred();
  t.after(() => transportGate.resolve());
  currentSupply = makeSupply(transportGate);
  const postsBeforeColdReload = requests.length, sourcesBeforeColdReload = sourceRequests.length;
  const readsBeforeColdReload = liveRequests.length;
  const confirmedBeforeColdReload = await savedDay(page);
  const coldResponse = page.waitForResponse(async response => {
    if (!COMPOSE_PATHS.has(new URL(response.url()).pathname) || response.status() !== 200) return false;
    try { return (await response.json()).live_events?.pending === true; } catch { return false; }
  });
  const pendingCompletionResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/planner-live-completion' && response.status() === 202);
  const upgradeResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/planner-live-route-upgrade' && response.status() === 200);
  await anchor.getByRole('button', { name: 'Adjust', exact: true }).click();
  await anchor.getByRole('button', { name: 'Views', exact: true }).click();
  const cold = await (await coldResponse).json();
  assert.equal(cold.live_events.pending, true);
  assert.equal(cold.live_completion?.route_upgrade, 'explicit_request');
  assert.ok(cold.live_completion?.token, 'the original cold HTTP response owns its completion capability');
  coldCompletionToken = cold.live_completion.token;
  assert.ok(routeStops(cold).every(stop => !stop.is_live_event), 'pending supply cannot fabricate a live choice before the source answers');
  assert.equal(cold.agnostic_route_output_experiment.live_event_choices.honored_count, 0);
  assert.deepEqual(requests.at(-1).live_event_choices, [{ occurrence_id: chosenId, action: 'keep' }]);
  assert.deepEqual(requests.at(-1).preference_priority, ['culture', 'views'], 'the explicit newly picked interest appends to the retained Culture prefix');
  assert.deepEqual(requests.at(-1).preferences, ['culture', 'views']);
  assert.deepEqual(requests.at(-1).dates, [DATE], 'the explicit cold adjustment keeps the restored absolute date');
  await pendingCompletionResponse;
  assert.deepEqual(await savedDay(page), confirmedBeforeColdReload,
    'pending acquisition must leave the exact last confirmed day intact');
  await capture('cold-explicit-adjustment-original-producer-pending');
  transportGate.resolve();
  const upgraded = await (await upgradeResponse).json();
  assert.equal(upgraded.live_route_upgrade?.state, 'applied');
  const upgradedStops = routeStops(upgraded.result);
  assert.equal(upgradedStops.length, 6);
  assert.equal(occurrence(upgradedStops.at(-1)), chosenId);
  assert.equal(upgraded.result.agnostic_route_output_experiment.live_event_choices.honored_count, 1);
  await assertRenderedDay(page, upgradedStops);
  await delay(700);
  assert.equal(requests.length, postsBeforeColdReload + 1, 'cold explicit choice completion must use the original compose, without another POST');
  assert.equal(sourceRequests.length, sourcesBeforeColdReload + 1, 'one deferred native producer owns the cold collection');
  const coldReads = liveRequests.slice(readsBeforeColdReload);
  assert.ok(coldReads.some(read => read.pathname === '/api/planner-live-completion'));
  assert.equal(coldReads.filter(read => read.pathname === '/api/planner-live-route-upgrade').length, 1);
  assert.ok(coldReads.every(read => read.token === coldCompletionToken), 'every completion and upgrade read must belong to the original producer');
  await capture('cold-explicit-adjustment-original-upgrade-six-total');

  partialPlaceSupply = true;
  const partialResponse = waitForPublished(page, body => body.agnostic_route_output_experiment?.source_status?.collection?.source_completion?.status === 'partial');
  // Removing Views is another explicit input change. Display-only reload must
  // not reacquire sources merely because the server's private caches changed.
  await anchor.getByRole('button', { name: 'Views', exact: true }).click();
  const partial = await partialResponse;
  assert.deepEqual(requests.at(-1).dates, [DATE]);
  assert.deepEqual(requests.at(-1).preferences, ['culture']);
  assert.deepEqual(requests.at(-1).preference_priority, ['culture']);
  assert.deepEqual(requests.at(-1).live_event_choices, [{ occurrence_id: chosenId, action: 'keep' }]);
  assert.equal(partial.agnostic_route_output_experiment.source_status.collection.source_completion.failed, 1);
  assert.equal(routeStops(partial).length, 6);
  assert.equal(occurrence(routeStops(partial).at(-1)), chosenId);
  await assertRenderedDay(page, routeStops(partial));
  // One plain sentence and one action (iPhone, 23 Oct 2026): no hidden
  // "About the place sources", no "Update the day" that could swap stops silently.
  const quiet = page.getByText('Not every place could be loaded, so there may be more than the ones shown.', { exact: true });
  await quiet.waitFor();
  assert.equal(await quiet.getAttribute('role'), 'status');
  assert.equal(await quiet.locator('xpath=..').getAttribute('role'), null);
  const update = page.getByRole('button', { name: 'Look for more places', exact: true });
  assert.equal(await update.isVisible(), true);
  assert.ok(!(await update.getAttribute('class')).includes('bg-parranda-ember'), 'looking again is a secondary action');
  assert.equal(await page.getByRole('button', { name: 'Try again', exact: true }).count(), 0);
  await capture('partial-source-quiet-info');
  assert.ok(sourceRequests.length > 0, 'the raw source transport was actually consumed');
  completed = true;
});
