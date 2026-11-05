import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mountPlanner } from './helpers/planner-harness.mjs';
import { LAST_KEY, SAVED_KEY } from '../src/lib/anywhere-storage.mjs';
import { parsePublishedDay } from '../src/lib/published-day.mjs';
import decision from '../../anywhere-render-decision.js';
const require = createRequire(import.meta.url);
const { setup, request, accepted, assertLiveFacts, eventRows, WIX_EVENT } = require('../../tests/published-day-live-publication.test.js');
const { mockStableWeatherFetch } = require('../../tests/helpers/planner-reservoir-compare.js');
const button = (h, pattern) => [...h.container.querySelectorAll('button')].find(b => pattern.test(b.getAttribute('aria-label') || b.textContent));
const click = (h, element) => h.act(() => { assert.ok(element, 'real control exists'); element.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
async function relay(h, server, call) {
  const clientFetch = global.fetch;
  let response;
  try { global.fetch = mockStableWeatherFetch(); response = await request(server, call); }
  finally { global.fetch = clientFetch; }
  await h.act(() => call.resolveResponse(new Response(JSON.stringify(response.body), { status: response.status })));
  return response.body;
}

test('legacy completion without a snapshot keeps its omitted fields and cannot Share', async t => {
  const backend = await setup(t);
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Roma&prefs=culture&lang=en' });
  try {
    const call = h.fetchMock.calls[0];
    // A real non-opted server envelope models the unchanged legacy contract.
    const legacyUrl = new URL(call.url, 'http://localhost'); legacyUrl.searchParams.delete('include_day_snapshot');
    const clientFetch = global.fetch;
    let original;
    try { global.fetch = mockStableWeatherFetch(); original = await request(backend.server, { ...call, url: legacyUrl.pathname + legacyUrl.search }); }
    finally { global.fetch = clientFetch; }
    assert.equal(original.body.day_snapshot, undefined);
    await h.fetchMock.respond(call, original.body);
    await backend.complete();
    await h.clock.advance(2000);
    const terminal = await relay(h, backend.server, h.fetchMock.calls.find(c => c.url === '/api/planner-live-completion'));
    assert.equal(terminal.day_snapshot, undefined);
    const upgrade = h.fetchMock.calls.find(c => c.url === '/api/planner-live-route-upgrade');
    if (upgrade) await relay(h, backend.server, upgrade);
    assert.equal(Object.hasOwn(h.readStorage(LAST_KEY).safeResponse, 'day_snapshot'), false, 'legacy envelopes must not acquire new fields');
    assert.ok(!button(h, /^Share/));
  } finally { await h.unmount(); }
});

test('mounted original pending → real configured healthy empty → completion HTTP/store/GET → Share → empty recipient', async t => {
  const backend = await setup(t);
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Roma&prefs=culture&lang=en' });
  let href, original, terminal, envelope, remembered;
  try {
    const call = h.fetchMock.calls[0];
    assert.equal(new URL(call.url, 'http://localhost').searchParams.get('include_day_snapshot'), '1');
    original = await relay(h, backend.server, call);
    accepted(original);
    assert.equal(original.days[0].date, call.body.dates[0], 'fixture follows actual emitted absolute date');
    assert.equal(original.live_events.pending, true);
    assert.equal(original.day_snapshot.state, 'unavailable');
    assert.ok(!button(h, /^Share/) || button(h, /^Share/).disabled, 'pending original cannot Share');
    await h.clock.advance(2000);
    const pending = h.fetchMock.calls.find(c => c.url === '/api/planner-live-completion');
    assert.ok(pending, 'actual original capability is followed');
    const poll = await relay(h, backend.server, pending);
    assert.equal(poll.live_completion.state, 'pending');
    assert.equal(backend.counts().puts, 0);
    await backend.complete();
    await h.clock.advance(3000);
    const completion = h.fetchMock.calls.filter(c => c.url === '/api/planner-live-completion').at(-1);
    terminal = await relay(h, backend.server, completion);
    assert.equal(terminal.live_events.acquisition.source_health.status, 'healthy');
    assert.equal(terminal.live_events.acquisition.source_health.result, 'empty');
    assert.equal(terminal.day_snapshot?.state, 'ready', 'real original terminal publication, not a synthesized sidecar');
    const upgrade = h.fetchMock.calls.find(c => c.url === '/api/planner-live-route-upgrade');
    if (upgrade) {
      const answer = await relay(h, backend.server, upgrade);
      assert.equal(answer.live_route_upgrade.state, 'not_eligible');
    }
    remembered = h.readStorage(LAST_KEY);
    assert.deepEqual(remembered.safeResponse.days, original.days);
    assert.deepEqual(remembered.safeResponse.live_events, terminal.live_events);
    assert.equal(JSON.stringify(remembered).includes(original.live_completion.token), false);
    assert.equal(JSON.stringify(remembered).includes('live_completion'), false);
    assert.ok(button(h, /^Share/) && !button(h, /^Share/).disabled, 'Share binds visible route plus installed terminal Live');
    const copied = [];
    Object.defineProperty(h.window.navigator, 'clipboard', { value: { writeText: async s => copied.push(s) } });
    await click(h, button(h, /^Share/));
    assert.equal(copied.length, 1);
    href = copied[0];
    assert.equal(href, `http://localhost/anywhere?snapshot=${terminal.day_snapshot.ref}&lang=en`);
    const disk = JSON.parse(await readFile(join(backend.directory, 'published-days-v1', `${terminal.day_snapshot.ref}.json`), 'utf8'));
    assert.equal(JSON.stringify(disk).includes(original.live_completion.token), false);
    assert.equal(backend.counts().puts, 1);
  } finally { await h.unmount(); }
  const counts = backend.counts();
  const recipient = await mountPlanner({ url: href });
  try {
    assert.equal(recipient.window.localStorage.length, 0);
    const [get] = recipient.fetchMock.calls;
    assert.equal(get.method, 'GET'); assert.equal(get.body, null);
    assert.equal(get.url, `/api/shared-days/${terminal.day_snapshot.ref}`);
    envelope = await relay(recipient, backend.server, get);
    assert.ok(parsePublishedDay(envelope, { ref: terminal.day_snapshot.ref, decision }), 'real client parser accepts real terminal snapshot');
    const entry = recipient.readStorage(LAST_KEY);
    assert.deepEqual(entry.safeResponse.days[0].primary_route.main_stops.map(s => s.id), original.days[0].primary_route.main_stops.map(s => s.id));
    assert.deepEqual(entry.safeResponse.days[0].primary_route.map_path_points, original.days[0].primary_route.map_path_points);
    assert.deepEqual(entry.safeResponse, envelope.result, 'exact closed portable answer, not recomposition');
    assertLiveFacts(entry.safeResponse.live_events, terminal.live_events);
    assert.deepEqual(entry.inputs.selected, remembered.inputs.selected);
    assert.equal(entry.inputs.walkKey, remembered.inputs.walkKey);
    assert.equal(entry.inputs.placeRef, original.agnostic_route_output_experiment.intake.resolved.place_ref);
    assert.equal(entry.inputs.place, envelope.intent.place);
    assert.deepEqual(entry.commitments?.entries ?? {}, remembered.commitments?.entries ?? {});
    assert.deepEqual(entry.commitments?.refusals ?? [], remembered.commitments?.refusals ?? []);
    assert.equal(entry.dateIso, original.days[0].date);
    assert.match(recipient.text(), /Saved day/);
    await recipient.clock.advance(6000);
    assert.equal(recipient.fetchMock.calls.length, 1);
    assert.deepEqual(backend.counts(), counts, 'no new resolver/load/route/supply/collector on completion/GET/restore');
    t.diagnostic(JSON.stringify({ date: entry.dateIso, stops: entry.safeResponse.days[0].primary_route.main_stops.map(s => s.id), health: entry.safeResponse.live_events.acquisition.source_health, counts, evidence: 'mounted-jsdom-real-http-not-native-browser; healthy-empty-only' }));
  } finally { await recipient.unmount(); }
});

test('mounted original pending → real configured NONEMPTY public catalog → completion HTTP/store/GET → Share → empty recipient', async t => {
  const backend = await setup(t, { wix: true });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Roma&prefs=culture&lang=en' });
  let href, original, terminal, envelope, remembered;
  try {
    const call = h.fetchMock.calls[0];
    assert.equal(new URL(call.url, 'http://localhost').searchParams.get('include_day_snapshot'), '1');
    original = await relay(h, backend.server, call);
    accepted(original);
    assert.equal(original.days[0].date, call.body.dates[0], 'fixture follows actual emitted absolute date');
    assert.equal(original.live_events.pending, true);
    assert.equal(original.day_snapshot.state, 'unavailable');
    assert.ok(!button(h, /^Share/) || button(h, /^Share/).disabled, 'pending original cannot Share');
    await h.clock.advance(2000);
    const pending = h.fetchMock.calls.find(c => c.url === '/api/planner-live-completion');
    assert.ok(pending, 'actual original capability is followed');
    const poll = await relay(h, backend.server, pending);
    assert.equal(poll.live_completion.state, 'pending');
    assert.equal(backend.counts().puts, 0);
    await backend.complete();
    await h.clock.advance(3000);
    const completion = h.fetchMock.calls.filter(c => c.url === '/api/planner-live-completion').at(-1);
    terminal = await relay(h, backend.server, completion);
    assert.equal(terminal.live_events.acquisition.source_health.status, 'healthy');
    assert.equal(terminal.live_events.acquisition.source_health.result, 'events_found');
    const event = [...terminal.live_events.tonight, ...terminal.live_events.this_week][0];
    assert.ok(event, 'actual source-backed event retained before testing publication');
    assert.equal(event.id, WIX_EVENT); assert.equal(event.source_url, WIX_EVENT);
    assert.equal(event.sources[0].url, WIX_EVENT);
    assert.equal(event.route_eligible, false, 'source period without explicit sessions cannot anchor a route');
    assert.equal(event.time_window.kind, 'period');
    assert.equal(backend.counts().transports, 3);
    assert.ok(backend.counts().venueLookups > 0);
    assert.equal(terminal.day_snapshot?.state, 'ready', 'real original terminal publication, not a synthesized sidecar');
    const upgrade = h.fetchMock.calls.find(c => c.url === '/api/planner-live-route-upgrade');
    assert.ok(upgrade, 'the actual default client still requests its authorized upgrade');
    const answer = await relay(h, backend.server, upgrade);
    assert.equal(answer.live_route_upgrade.state, 'not_eligible', 'source period is honest non-route-eligible evidence');
    const beforeShare = backend.counts();
    remembered = h.readStorage(LAST_KEY);
    assert.deepEqual(remembered.safeResponse.days, original.days);
    assert.deepEqual(remembered.safeResponse.live_events, terminal.live_events);
    assert.equal(JSON.stringify(remembered).includes(original.live_completion.token), false);
    assert.equal(JSON.stringify(remembered).includes('live_completion'), false);
    assert.ok(button(h, /^Share/) && !button(h, /^Share/).disabled, 'Share binds visible route plus installed terminal Live');
    const copied = [];
    Object.defineProperty(h.window.navigator, 'clipboard', { value: { writeText: async s => copied.push(s) } });
    await click(h, button(h, /^Share/));
    assert.equal(copied.length, 1);
    assert.deepEqual(backend.counts(), beforeShare, 'Share itself never reacquires or republishes');
    href = copied[0];
    assert.equal(href, `http://localhost/anywhere?snapshot=${terminal.day_snapshot.ref}&lang=en`);
    const disk = JSON.parse(await readFile(join(backend.directory, 'published-days-v1', `${terminal.day_snapshot.ref}.json`), 'utf8'));
    assert.equal(JSON.stringify(disk).includes(original.live_completion.token), false);
    assert.equal(backend.counts().puts, 1);
  } finally { await h.unmount(); }
  const counts = backend.counts();
  const recipient = await mountPlanner({ url: href });
  try {
    assert.equal(recipient.window.localStorage.length, 0);
    const [get] = recipient.fetchMock.calls;
    assert.equal(get.method, 'GET'); assert.equal(get.body, null);
    assert.equal(get.url, `/api/shared-days/${terminal.day_snapshot.ref}`);
    envelope = await relay(recipient, backend.server, get);
    assert.ok(parsePublishedDay(envelope, { ref: terminal.day_snapshot.ref, decision }), 'real client parser accepts real terminal snapshot');
    const entry = recipient.readStorage(LAST_KEY);
    assert.deepEqual(entry.safeResponse.days[0].primary_route.main_stops.map(s => s.id), original.days[0].primary_route.main_stops.map(s => s.id));
    assert.deepEqual(entry.safeResponse.days[0].primary_route.map_path_points, original.days[0].primary_route.map_path_points);
    assert.deepEqual(entry.safeResponse, envelope.result, 'exact closed portable answer, not recomposition');
    assertLiveFacts(entry.safeResponse.live_events, terminal.live_events);
    assert.deepEqual(entry.inputs.selected, remembered.inputs.selected);
    assert.equal(entry.inputs.walkKey, remembered.inputs.walkKey);
    assert.equal(entry.inputs.placeRef, original.agnostic_route_output_experiment.intake.resolved.place_ref);
    assert.equal(entry.inputs.place, envelope.intent.place);
    assert.deepEqual(entry.commitments?.entries ?? {}, remembered.commitments?.entries ?? {});
    assert.deepEqual(entry.commitments?.refusals ?? [], remembered.commitments?.refusals ?? []);
    assert.equal(entry.dateIso, original.days[0].date);
    assert.match(recipient.text(), /Saved day/);
    await recipient.clock.advance(6000);
    assert.equal(recipient.fetchMock.calls.length, 1);
    assert.deepEqual(backend.counts(), counts, 'no new resolver/load/route/supply/collector on completion/GET/restore');
    t.diagnostic(JSON.stringify({ date: entry.dateIso, stops: entry.safeResponse.days[0].primary_route.main_stops.map(s => s.id), health: entry.safeResponse.live_events.acquisition.source_health, counts, evidence: 'mounted-jsdom-real-http-not-native-browser; nonempty-public-wix-controlled-geodata' }));
  } finally { await recipient.unmount(); }
});

for (const cause of ['intent', 'navigation', 'restore', 'new-result', 'unmount']) test(`real ready snapshot body arriving after ${cause} cannot change LAST, URL or Share`, async t => {
  const backend = await setup(t);
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Roma&prefs=culture&lang=en' });
  let unmounted = false;
  try {
    await relay(h, backend.server, h.fetchMock.calls[0]);
    if (cause === 'restore') await click(h, button(h, /^Save this day/));
    await backend.complete();
    await h.clock.advance(2000);
    const read = h.fetchMock.calls.find(c => c.url === '/api/planner-live-completion');
    const terminal = await request(backend.server, read);
    assert.equal(terminal.body.day_snapshot.state, 'ready', 'actual committed response is held at body consumption');
    await h.fetchMock.respond(read, terminal.body, terminal.status, { deferBody: true });
    const storage = h.window.localStorage;
    if (cause === 'navigation') await h.act(() => h.window.dispatchEvent(new h.window.Event('pagehide')));
    else if (cause === 'restore') {
      const saved = h.readStorage(SAVED_KEY)[0];
      await click(h, [...h.container.querySelectorAll('button')].find(b => b.textContent.startsWith(saved.label) && b.textContent.includes(' · ')));
    } else if (cause === 'unmount') { await h.unmount(); unmounted = true; }
    else {
      await click(h, button(h, /^Adjust$/)); await click(h, button(h, /^Full/));
      if (cause === 'new-result') {
        await h.clock.advance(450);
        const newer = h.fetchMock.calls.filter(c => c.url.startsWith('/api/route-recommendations')).at(-1);
        const next = await relay(h, backend.server, newer);
        assert.equal(next.day_snapshot.state, 'ready');
        assert.notEqual(next.day_snapshot.ref, terminal.body.day_snapshot.ref, 'different answer, distinct immutable ref');
      }
    }
    assert.equal(read.aborted, true);
    const before = storage.getItem(LAST_KEY), url = unmounted ? null : h.window.location.href;
    const shareBefore = unmounted ? null : Boolean(button(h, /^Share/));
    await h.act(() => read.releaseBody());
    assert.equal(storage.getItem(LAST_KEY), before);
    assert.equal(storage.getItem(LAST_KEY).includes(terminal.body.day_snapshot.ref), false);
    if (!unmounted) {
      assert.equal(h.window.location.href, url);
      assert.equal(Boolean(button(h, /^Share/)), shareBefore);
    }
  } finally { if (!unmounted) await h.unmount(); }
});

test('a later actual applied upgrade cannot reuse the previous events-only Share or mutate its immutable record', async t => {
  let nonempty = false;
  const today = new Date().toISOString().slice(0,10);
  const backend = await setup(t, { rows: options => nonempty ? eventRows(options) : [],
    appOptions: { clock: { now: () => `${today}T10:00:00.000Z` } } });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Roma&prefs=culture&lang=en' });
  try {
    const first = await relay(h, backend.server, h.fetchMock.calls[0]);
    await backend.complete(); await h.clock.advance(2000);
    const completed = await relay(h, backend.server, h.fetchMock.calls.find(c => c.url === '/api/planner-live-completion'));
    assert.equal(completed.day_snapshot.state, 'ready');
    const firstUpgrade = h.fetchMock.calls.find(c => c.url === '/api/planner-live-route-upgrade');
    if (firstUpgrade) await relay(h, backend.server, firstUpgrade);
    const copied = [];
    Object.defineProperty(h.window.navigator, 'clipboard', { value: { writeText: async value => copied.push(value) } });
    await click(h, button(h, /^Share/));
    assert.ok(copied[0].includes(completed.day_snapshot.ref));
    const oldFile = join(backend.directory, 'published-days-v1', `${completed.day_snapshot.ref}.json`);
    const oldBytes = await readFile(oldFile, 'utf8');
    nonempty = true;
    await click(h, button(h, /^Adjust$/)); await click(h, button(h, /^Tomorrow/)); await h.clock.advance(450);
    const call = h.fetchMock.calls.filter(c => c.url.startsWith('/api/route-recommendations')).at(-1);
    assert.notEqual(call.body.dates[0], first.days[0].date, 'new explicit date authorizes its own source collection');
    const original = await relay(h, backend.server, call);
    assert.equal(original.live_events.pending, true);
    await backend.complete();
    const counts = backend.counts();
    await h.clock.advance(2000);
    const terminal = await relay(h, backend.server, h.fetchMock.calls.filter(c => c.url === '/api/planner-live-completion').at(-1));
    assert.equal(terminal.day_snapshot.state, 'unavailable');
    const upgrade = await relay(h, backend.server, h.fetchMock.calls.filter(c => c.url === '/api/planner-live-route-upgrade').at(-1));
    assert.equal(upgrade.live_route_upgrade.state, 'applied');
    assert.ok(h.text().includes('Original concert'));
    assert.ok(!button(h, /^Share/));
    assert.match(h.text(), /Exact sharing is unavailable/);
    assert.equal(JSON.stringify(h.readStorage(LAST_KEY)).includes(completed.day_snapshot.ref), false);
    assert.equal(h.window.location.href.includes(completed.day_snapshot.ref), false);
    assert.equal(await readFile(oldFile, 'utf8'), oldBytes, 'old record/ref remains byte-identical');
    assert.deepEqual(backend.counts(), counts, 'completion and upgrade add no acquisition or publication');
    assert.equal(counts.puts, 1);
  } finally { await h.unmount(); }
});

for (const failure of ['store', 'unsupported-url']) test(`real terminal ${failure} leaves visible Live usable with truthful sharing refusal`, async t => {
  const date = new Date().toISOString().slice(0,10);
  const backend = await setup(t, failure === 'store' ? { put: () => { throw new Error('controlled put failure'); } }
    : { rows: eventRows, appOptions: { clock: { now: () => `${date}T10:00:00.000Z` } } });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Roma&prefs=culture&lang=en' });
  try {
    const original = await relay(h, backend.server, h.fetchMock.calls[0]);
    await backend.complete(); await h.clock.advance(2000);
    const terminal = await relay(h, backend.server, h.fetchMock.calls.find(c => c.url === '/api/planner-live-completion'));
    assert.equal(terminal.day_snapshot.state, 'unavailable');
    assert.equal(terminal.live_events.acquisition.source_health.status, 'healthy');
    assert.deepEqual(h.readStorage(LAST_KEY).safeResponse.live_events, terminal.live_events);
    assert.deepEqual(h.readStorage(LAST_KEY).safeResponse.days, original.days);
    assert.ok(!button(h, /^Share/));
    assert.match(h.text(), /Exact sharing is unavailable/);
    const upgrade = h.fetchMock.calls.find(c => c.url === '/api/planner-live-route-upgrade');
    assert.ok(upgrade);
    const result = await relay(h, backend.server, upgrade);
    if (failure === 'unsupported-url') {
      assert.equal(result.live_route_upgrade.state, 'applied', 'actual engine upgrade remains functional');
      assert.ok(h.readStorage(LAST_KEY).safeResponse.days[0].primary_route.main_stops.some(s => s.event_id === 'roma-original-concert'));
      assert.ok(h.text().includes('Original concert'));
      assert.ok(!button(h, /^Share/), 'applied route never inherits an events-only ref');
      assert.match(h.text(), /Exact sharing is unavailable/);
      assert.equal(backend.counts().puts, 0);
    } else {
      assert.equal(result.live_route_upgrade.state, 'not_eligible');
      assert.equal(backend.counts().puts, 1);
    }
  } finally { await h.unmount(); }
});

