'use strict';
// Real built UI -> local HTTP -> actual composer/publication. Only source/clock
// inputs are controlled. This is NOT live-provider or physical-device acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { buildApp } = require('../server/app');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');
const { rows } = require('./helpers/day-composition-fixtures');
const LAST = 'parranda:anywhere:last';
const EPOCH = new Date('2026-10-16T10:00:00Z').getTime();

function sampleRows() {
  return [...rows('museum', 'museum', 8), ...rows('shop', 'vintage-shop', 8)]
    .map(row => ({ ...row, lat: row.lat + 1, lng: row.lng + 1 }));
}
const current = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), LAST);
const ids = entry => entry?.safeResponse?.days?.[0]?.primary_route?.main_stops?.map(stop => stop.id) || [];

async function waitSaved(page, predicate, argument) {
  await page.waitForFunction(({ key, source, argument }) => {
    const entry = JSON.parse(localStorage.getItem(key) || 'null');
    return entry && new Function('entry', 'argument', `return (${source})(entry, argument)`)(entry, argument);
  }, { key: LAST, source: predicate.toString(), argument }, { timeout: 15000 });
}
async function openAdjust(page) {
  const button = page.getByRole('button', { name: 'Justera', exact: true });
  if (await button.isVisible()) await button.click();
}

function launchOptions() {
  return { headless: true,
    ...(process.env.PARRANDA_TEST_CHROMIUM ? { executablePath: process.env.PARRANDA_TEST_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] };
}

test('native composed day preserves dominance, removal/reload, replacement, refusal, sharing and date scope', { timeout: 120000 }, async t => {
  const { assertExactNavigation } = await import('../frontend/tests/helpers/exact-navigation-observation.mjs');
  let available = sampleRows();
  const resolver = createNominatimPlaceResolver({ fetcher: async () => ({ ok: true, status: 200, json: async () => [{
    display_name: 'Fixturehaven, Fixture Country', name: 'Fixturehaven', lat: '56.6', lon: '14', importance: .55,
    osm_type: 'relation', osm_id: 909090, place_rank: 16, class: 'place', type: 'city',
    address: { city: 'Fixturehaven', country: 'Fixture Country' },
  }] }) });
  const app = buildApp({ openDataLoader: async () => structuredClone(available), placeResolver: resolver,
    placeSuggestions: null, eventSupply: null, sourceCatalog: null, reviewedPlaceSource: null,
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false,
      timezone_resolution: { timezone: 'Europe/Stockholm', timezone_source: 'weather_provider_auto', utc_offset_seconds: 7200 } }),
    clock: () => new Date('2026-10-16T08:00:00Z'),
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const browser = await chromium.launch(launchOptions());
  t.after(() => browser.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const requests = [], replies = [], errors = [], stages = [];
  const makeContext = async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'sv-SE', timezoneId: 'Europe/Stockholm',
      permissions: ['clipboard-read', 'clipboard-write'] });
    await context.route(url => url.origin !== origin, route => route.abort());
    await context.addInitScript(epoch => {
      const NativeDate = window.Date;
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [epoch])); }
        static now() { return epoch; }
      };
    }, EPOCH);
    return context;
  };
  const context = await makeContext(); t.after(() => context.close());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname !== '/api/route-recommendations') return;
    const body = request.postDataJSON();
    requests.push({ preferences: body.preferences, priority: body.preference_priority,
      action: body.day_edit?.action, cap: body.day_edit?.target_stop_count,
      preserve: body.day_edit?.preserve_retained, dates: body.dates });
  });
  page.on('response', async response => {
    const pathname = new URL(response.url()).pathname;
    if (!['/api/route-recommendations', '/api/planner-status'].includes(pathname)) return;
    try {
      const body = await response.json();
      replies.push({ pathname, status: response.status(), stops: body.days?.[0]?.primary_route?.main_stops?.length,
        edit: body.agnostic_route_output_experiment?.day_edit?.status,
        reason: body.agnostic_route_output_experiment?.day_edit?.reason,
        promote: body.agnostic_route_output_experiment?.promotion?.promote });
    } catch { /* response may be aborted by an explicit newer intent */ }
  });
  const evidence = process.env.PARRANDA_COMPOSITION_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  try {
    await page.goto(`${origin}/anywhere?place=Fixturehaven&prefs=second_hand,culture&prio=second_hand,culture&day=1&rhythm=full&lang=sv`);
    await waitSaved(page, entry => entry.safeResponse?.days?.[0]?.primary_route?.main_stops?.length === 6);
    let saved = await current(page);
    const countMuseums = entry => entry.safeResponse.days[0].primary_route.main_stops.filter(stop => stop.type === 'museum').length;
    assert.ok(countMuseums(saved) < 3, 'second hand is the stronger first interest');
    stages.push('published-six-with-second-hand-dominance');
    await openAdjust(page);
    // Ranking is the pick order: tapping Second hand off and on moves it after Kultur.
    const secondHand = page.locator('[data-preference-key="second_hand"] button[aria-pressed]');
    await secondHand.click(); await secondHand.click();
    await waitSaved(page, entry => entry.inputs.preferencePriority?.[0] === 'culture' &&
      entry.inputs.selected?.length === 2 && entry.inputs.selected.includes('second_hand'));
    saved = await current(page);
    assert.ok(countMuseums(saved) > 3, 'the native priority click changes actual published content');
    stages.push('native-priority-changes-content');
    // The compact summary may wrap on narrow screens, but its whole message
    // and native Undo target must remain readable and operable together.
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const undo = page.getByRole('button', { name: 'Ångra ändringen', exact: true });
      const layout = await undo.evaluate(button => {
        const card = button.parentElement;
        const text = card.querySelector('p');
        const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height }; };
        return { card: box(card), button: box(button), text: box(text),
          content: text.textContent, overflow: card.scrollWidth > card.clientWidth,
          clipped: ['hidden', 'clip'].includes(getComputedStyle(text).overflowY) };
      });
      assert.ok(layout.button.height >= 44);
      assert.ok(layout.button.right <= layout.card.right && layout.text.right <= layout.button.left);
      assert.equal(layout.overflow, false);
      assert.equal(layout.clipped, false);
      assert.match(layout.content, /stopp bytt/);
    }
    if (evidence) await page.locator('section[aria-label="Dagens utgångspunkt"]').screenshot({ path: path.join(evidence, 'priority-mobile.png') });

    const beforeClear = structuredClone(saved);
    await openAdjust(page);
    await page.getByRole('button', { name: 'Rensa ordningen', exact: true }).click();
    await waitSaved(page, entry => (entry.inputs.preferencePriority || []).length === 0 &&
      entry.safeResponse?.days?.[0]?.primary_route?.main_stops?.length === 6);
    saved = await current(page);
    assert.deepEqual(saved.inputs.selected, beforeClear.inputs.selected, 'Clear keeps both selected interests');
    assert.equal(requests.at(-1).priority, undefined, 'the completed Clear request is neutral');
    await page.waitForURL(url => !url.searchParams.has('prio'));
    assert.equal(new URL(page.url()).searchParams.has('prio'), false);
    assert.equal(saved.safeResponse.agnostic_route_output_experiment.walking_validation.valid, true);
    assert.ok(countMuseums(saved) >= 2 && countMuseums(saved) <= 3, 'the actual composer replaces dominance with a neutral mix');
    const beforeClearUndoRequests = requests.length;
    await page.getByRole('button', { name: 'Ångra ändringen', exact: true }).click();
    await waitSaved(page, (entry, previous) => entry.id === previous.id &&
      JSON.stringify(entry.safeResponse) === JSON.stringify(previous.safeResponse), beforeClear);
    assert.deepEqual(await current(page), beforeClear, 'Undo restores the exact previously composed response, inputs and ledger');
    await page.waitForURL(url => url.searchParams.get('prio') === 'culture,second_hand');
    assert.equal(new URL(page.url()).searchParams.get('prio'), 'culture,second_hand');
    await page.waitForTimeout(500);
    assert.equal(requests.length, beforeClearUndoRequests, 'Undo after completed Clear makes no fresh compose');
    stages.push('native-clear-completion-and-exact-undo-without-compose');

    await openAdjust(page);
    await page.getByRole('button', { name: 'Rensa ordningen', exact: true }).click();
    await waitSaved(page, entry => (entry.inputs.preferencePriority || []).length === 0 &&
      entry.safeResponse?.days?.[0]?.primary_route?.main_stops?.length === 6);
    const neutral = await current(page);
    const beforeNeutralReload = requests.length;
    await assertExactNavigation({ page, navigate: () => page.reload(), expectedEntry: neutral,
      readComposeCount: () => requests.length, listName: 'Stoppen i ordning' });
    await waitSaved(page, entry => (entry.inputs.preferencePriority || []).length === 0 &&
      entry.safeResponse?.days?.[0]?.primary_route?.main_stops?.length === 6);
    saved = await current(page);
    assert.equal(requests.length, beforeNeutralReload, 'ordinary reload restores the accepted neutral answer without HTTP composition');
    assert.equal(new URL(page.url()).searchParams.has('prio'), false);
    assert.deepEqual(saved.inputs.preferencePriority ?? [], []);
    assert.deepEqual(saved, neutral, 'neutral priority, original date and complete result remain authoritative');
    assert.ok(countMuseums(saved) >= 2 && countMuseums(saved) <= 3);
    await openAdjust(page);
    assert.equal(await page.getByRole('button', { name: 'Rensa ordningen', exact: true }).count(), 0);
    stages.push('native-clear-completion-and-exact-neutral-reload');
    // Preserve the positive cold-intake control in an actually empty profile,
    // rather than mistaking reload of an accepted answer for a fresh request.
    const fresh = await makeContext(); t.after(() => fresh.close());
    const freshPage = await fresh.newPage(), freshRequests = [];
    freshPage.on('request', request => {
      if (new URL(request.url()).pathname === '/api/route-recommendations') freshRequests.push(request.postDataJSON());
    });
    await freshPage.goto(page.url());
    await waitSaved(freshPage, entry => !entry.inputs.preferencePriority?.length &&
      entry.safeResponse?.days?.[0]?.primary_route?.main_stops?.length === 6);
    assert.equal(freshRequests.length, 1, 'empty profile submits one real HTTP acquisition');
    assert.equal(freshRequests[0].preference_priority, undefined);
    assert.deepEqual(freshRequests[0].dates, [neutral.dateIso]);
    assert.deepEqual(freshRequests[0].preferences, neutral.inputs.selected);
    stages.push('native-fresh-profile-neutral-http-acquisition');

    // Continue the existing removal/share journey from its culture-first state.
    // Ranking is the pick order: tapping Kultur off and on ranks it first.
    const kultur = page.locator('[data-preference-key="culture"] button[aria-pressed]');
    await kultur.click(); await kultur.click();
    await waitSaved(page, entry => entry.inputs.preferencePriority?.[0] === 'culture' &&
      entry.inputs.selected?.length === 2 && entry.inputs.selected.includes('second_hand'));
    saved = await current(page);
    const beforeRemoval = ids(saved);
    const list = page.locator('ol[aria-label="Stoppen i ordning"]');
    await list.locator(':scope > li > button').first().click();
    const removeBox = await page.getByRole('button', { name: 'Ta bort', exact: true }).boundingBox();
    const replaceBox = await page.getByRole('button', { name: 'Byt', exact: true }).boundingBox();
    assert.ok(removeBox && replaceBox && Math.abs(removeBox.y - replaceBox.y) <= 1, 'mobile edit controls share a row');
    assert.ok(removeBox.height >= 44 && replaceBox.height >= 44);
    if (evidence) await list.locator(':scope > li').first().screenshot({ path: path.join(evidence, 'stop-actions-mobile.png') });
    await page.getByRole('button', { name: 'Ta bort', exact: true }).click();
    await waitSaved(page, entry => entry.inputs.dayEdit?.target_stop_count === 5);
    saved = await current(page);
    assert.deepEqual(new Set(ids(saved)), new Set(beforeRemoval.slice(1)));
    assert.equal(saved.safeResponse.agnostic_route_output_experiment.walking_validation.valid, true);
    stages.push('native-remove-six-to-five');
    const removedIds = ids(saved);
    const requestsBeforeReload = requests.length;
    await assertExactNavigation({ page, navigate: () => page.reload(), expectedEntry: saved,
      readComposeCount: () => requests.length, listName: 'Stoppen i ordning' });
    await page.waitForFunction(() => document.querySelectorAll('ol[aria-label="Stoppen i ordning"] > li > button').length === 5);
    assert.equal(requests.length, requestsBeforeReload, 'reload displays the accepted applied removal without replay');
    saved = await current(page);
    assert.deepEqual(new Set(ids(saved)), new Set(removedIds));
    assert.equal(requests.at(-1).cap, 5);
    stages.push('native-reload-preserves-five');

    const beforeReplace = ids(saved);
    await list.locator(':scope > li > button').first().click();
    await page.getByRole('button', { name: 'Byt', exact: true }).click();
    await waitSaved(page, (entry, old) => {
      const currentIds = entry.safeResponse?.days?.[0]?.primary_route?.main_stops?.map(stop => stop.id) || [];
      return currentIds.length === 5 && !currentIds.includes(old[0]) && old.slice(1).every(id => currentIds.includes(id));
    }, beforeReplace);
    saved = await current(page);
    assert.equal(saved.inputs.dayEdit.action, 'remove', 'the applied state is idempotent, not a replayable replacement command');
    stages.push('native-similar-replace-keeps-five');
    const beforeRefusal = ids(saved);
    available = available.filter(record => beforeRefusal.includes(record.id));
    await list.locator(':scope > li > button').first().click();
    await page.getByRole('button', { name: 'Byt', exact: true }).click();
    await page.getByText('Inget liknande stopp kunde bekräftas.', { exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(ids(await current(page)), beforeRefusal);
    await page.getByRole('button', { name: 'Ångra ändringen', exact: true }).click();
    assert.deepEqual(ids(await current(page)), beforeRefusal);
    available = sampleRows();
    stages.push('native-refusal-preserves-day-and-undo');

    // These controlled rows have no producer-owned public-destination witness.
    // H1 must refuse exact sharing, never substitute the former inputs-only URL.
    const beforeShare = await current(page), beforeShareRequests = requests.length;
    await page.getByText('Exakt delning är inte tillgänglig för den här dagen. Dagen och dina andra val finns kvar.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Dela dagen', exact: true }).count(), 0);
    assert.equal(await page.locator('a[href*="share="]').count(), 0);
    assert.deepEqual(await current(page), beforeShare);
    assert.equal(requests.length, beforeShareRequests);
    stages.push('native-exact-share-refuses-unattested-fixture-without-input-fallback');
    // Keep the old positive intent-bearing acquisition as a separate fresh
    // request, explicitly not clipboard/exact-sharing acceptance.
    const freshIntent = new URL(page.url());
    freshIntent.searchParams.delete('view');
    assert.equal(freshIntent.searchParams.get('prio'), 'culture');
    assert.equal(JSON.parse(freshIntent.searchParams.get('edit')).target_stop_count, 5);
    assert.equal(freshIntent.searchParams.has('place_selection'), false);
    const other = await makeContext(); t.after(() => other.close());
    const sharedPage = await other.newPage();
    const freshEditRequests = [];
    sharedPage.on('request', request => {
      if (new URL(request.url()).pathname === '/api/route-recommendations') freshEditRequests.push(request.postDataJSON());
    });
    await sharedPage.goto(freshIntent.href);
    await waitSaved(sharedPage, entry => entry.inputs.dayEdit?.target_stop_count === 5 && entry.inputs.preferencePriority?.[0] === 'culture');
    assert.deepEqual(new Set(ids(await current(sharedPage))), new Set(beforeRefusal));
    assert.equal(freshEditRequests.length, 1);
    assert.deepEqual(freshEditRequests[0].dates, [beforeShare.dateIso]);
    assert.equal(freshEditRequests[0].day_edit.target_stop_count, 5);
    stages.push('native-fresh-profile-edited-intent-http-acquisition-not-share');

    await openAdjust(page);
    await page.getByRole('button', { name: 'Idag', exact: true }).click();
    await waitSaved(page, entry => entry.dateIso === '2026-10-16' && !entry.inputs.dayEdit);
    assert.equal(requests.at(-1).cap, undefined, 'another date must not inherit the old removal cap');
    assert.deepEqual(requests.at(-1).dates, ['2026-10-16']);
    await page.waitForURL(url => !url.searchParams.has('edit'));
    assert.equal(new URL(page.url()).searchParams.has('edit'), false, 'reload must not revive the foreign date edit');
    stages.push('native-date-change-clears-edit');

    for (let remaining = 5; remaining >= 0; remaining--) {
      await list.locator(':scope > li > button').first().click();
      await page.getByRole('button', { name: 'Ta bort', exact: true }).click();
      await waitSaved(page, (entry, expected) => entry.inputs.dayEdit?.target_stop_count === expected &&
        (entry.safeResponse?.days?.[0]?.primary_route?.main_stops?.length || 0) === expected, remaining);
    }
    await page.getByText('Dagen är tom', { exact: true }).waitFor({ state: 'visible' });
    const empty = await current(page), beforeEmptyReload = requests.length;
    assert.equal(empty.classification.status, 'edited_empty');
    assert.equal(empty.safeResponse.days[0].primary_route, null);
    assert.equal(empty.safeResponse.agnostic_route_output_experiment.manual_edit_published, true);
    stages.push('native-removal-to-intentional-zero');
    await assertExactNavigation({ page, navigate: () => page.reload(), expectedEntry: empty,
      readComposeCount: () => requests.length, listName: 'Stoppen i ordning' });
    await page.getByText('Dagen är tom', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(requests.length, beforeEmptyReload, 'deliberate emptiness restores without a compose or refill');
    assert.equal(requests.at(-1).cap, 0);
    assert.equal((await current(page)).inputs.dayEdit.target_stop_count, 0);
    assert.equal(await page.locator('a[href*="/maps/dir/"]').count(), 0);
    stages.push('native-zero-reload-does-not-refill');
    await page.getByRole('button', { name: 'Börja om', exact: true }).click();
    await waitSaved(page, entry => !entry.inputs.dayEdit && entry.safeResponse?.days?.[0]?.primary_route?.main_stops?.length === 6);
    assert.equal(requests.at(-1).cap, undefined);
    const requestsBeforeUndo = requests.length;
    await page.getByRole('button', { name: 'Ångra ändringen', exact: true }).click();
    await page.getByText('Dagen är tom', { exact: true }).waitFor({ state: 'visible' });
    assert.equal((await current(page)).id, empty.id);
    await page.waitForTimeout(500); // Observe past the product's normal 400ms debounce.
    assert.equal(requests.length, requestsBeforeUndo, 'Undo restores the empty answer without another compose');
    stages.push('native-explicit-start-over-and-undo-to-zero');
    assert.deepEqual(errors, []);
  } catch (error) {
    if (evidence) {
      try {
        await page.screenshot({ path: path.join(evidence, 'failure-viewport.png') });
        fs.writeFileSync(path.join(evidence, 'failure-page.txt'), await page.locator('body').innerText());
      } catch { /* evidence capture must not replace the original failure */ }
    }
    throw error;
  } finally {
    const receipt = { boundary: 'actual built UI and local HTTP/composer; controlled source/clock; not live providers',
      browser: browser.version(), stages, requests, replies, errors };
    if (evidence) fs.writeFileSync(path.join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2));
    t.diagnostic(JSON.stringify(receipt));
  }
});
