/** H1 navigation regression: mounted product, controlled local transport. */
import assert from "node:assert/strict";
import test from "node:test";
import { mountPlanner } from "./helpers/planner-harness.mjs";
import dayPolicy from '../../server/planner/day-composition-policy.js';

const LAST_KEY = "parranda:anywhere:last";
const composeCalls = (h) => h.fetchMock.calls.filter((call) => call.url.startsWith("/api/route-recommendations"));

function publishedDay(dateIso) {
  const stops = [
    { id: "fixture-museum", label: "Fixture museum", lat: 55.6, lng: 13, type: "museum" },
    { id: "fixture-cafe", label: "Fixture café", lat: 55.601, lng: 13, type: "cafe" },
  ];
  return {
    days: [{
      date: dateIso,
      experimental_agnostic_route_applied: true,
      primary_route: {
        id: "__agnostic_compose__",
        main_stops: stops,
        estimated_km: 1.2,
        legs: [],
        map_route_points: [],
        map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })),
        confidence: "low",
      },
      alternatives: [],
    }],
    agnostic_route_output_experiment: {
      intake: { status: "resolved", resolved: { label: "Testville", lat: 55.6, lng: 13 } },
      promotion: { promote: true, readiness: "promotable" },
    },
  };
}

function browserStorage(storage) {
  return Object.fromEntries(Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index);
    const raw = storage.getItem(key);
    try { return [key, JSON.parse(raw)]; } catch { return [key, raw]; }
  }));
}

function stopIds(entry) {
  return entry.safeResponse.days[0].primary_route.main_stops.map((stop) => stop.id);
}

// Capture the emitted link and real storage after the actual language control
// runs. A constructed restore URL would only prove a different entry path.
test("switching language restores the exact published day without another composition", async (t) => {
  let first = await mountPlanner({ url: "http://localhost/anywhere?place=Testville&planner=open&lang=en" });
  let next = null;
  t.after(async () => {
    if (next) await next.unmount();
    if (first) await first.unmount();
  });
  first.document.addEventListener("click", (event) => event.preventDefault());
  await first.clock.advance(500);
  const initialCall = composeCalls(first)[0];
  assert.ok(initialCall, "precondition: the first actual entry composes");
  const selectedDate = initialCall.body.dates[0];
  assert.match(selectedDate, /^\d{4}-\d{2}-\d{2}$/);
  await first.fetchMock.respond(initialCall, publishedDay(selectedDate));
  await first.clock.advance(50);
  const before = first.readStorage(LAST_KEY);
  assert.ok(before && before.safeResponse, "precondition: the published day was remembered");
  assert.deepEqual(stopIds(before), ["fixture-museum", "fixture-cafe"]);

  const link = [...first.container.querySelectorAll('[role="group"] a')]
    .find((element) => element.textContent === "SV");
  assert.ok(link);
  await first.act(() => link.dispatchEvent(new first.window.MouseEvent("click", {
    bubbles: true, cancelable: true, button: 0,
  })));
  const target = new URL(link.getAttribute("href"), first.window.location.href).href;
  const storage = browserStorage(first.window.localStorage);
  const sessionStorage = browserStorage(first.window.sessionStorage);
  await first.unmount();
  first = null;

  next = await mountPlanner({ url: target, storage, sessionStorage, props: { lang: "sv" }, navigationType: "navigate" });
  await next.clock.advance(1500);
  assert.equal(composeCalls(next).length, 0, "changing presentation must not ask the engine for a different day");
  assert.match(next.text(), /Fixture museum/);
  assert.match(next.text(), /Fixture café/);
  assert.match(next.container.querySelector("header h1").textContent, /^En dag i Testville$/);
  const after = next.readStorage(LAST_KEY);
  assert.equal(after.dateIso, before.dateIso, "the absolute selected date is unchanged");
  assert.deepEqual(stopIds(after), stopIds(before));
  assert.deepEqual(after.commitments, before.commitments);
});

for (const navigationType of ['reload', 'back_forward']) {
  test(`${navigationType} restores this history answer rather than another tab's latest day`, async (t) => {
    let first = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&planner=open&lang=en' });
    let next = null;
    t.after(async () => {
      if (next) await next.unmount();
      if (first) await first.unmount();
    });
    await first.clock.advance(500);
    const call = composeCalls(first)[0];
    assert.ok(call);
    await first.fetchMock.respond(call, publishedDay(call.body.dates[0]));
    await first.clock.advance(50);
    const before = first.readStorage(LAST_KEY);
    assert.deepEqual(stopIds(before), ['fixture-museum', 'fixture-cafe']);
    const url = first.window.location.href;
    const historyState = JSON.parse(JSON.stringify(first.window.history.state));
    const storage = browserStorage(first.window.localStorage);
    const sessionStorage = browserStorage(first.window.sessionStorage);
    // Same input ID is not the same answer: another tab published a new set.
    const otherAnswer = JSON.parse(JSON.stringify(before));
    otherAnswer.safeResponse.days[0].primary_route.main_stops = [
      { id: 'another-answer', label: 'Another tab stop', lat: 55.602, lng: 13, type: 'museum' },
    ];
    storage[LAST_KEY] = otherAnswer;
    await first.unmount(); first = null;
    next = await mountPlanner({ url, historyState, storage, sessionStorage, navigationType });
    await next.clock.advance(2000);
    assert.equal(composeCalls(next).length, 0, 'this history entry must not compose another answer');
    assert.match(next.text(), /Fixture museum/);
    assert.match(next.text(), /Fixture café/);
    assert.doesNotMatch(next.text(), /Another tab stop/);
    assert.deepEqual(next.readStorage(LAST_KEY), otherAnswer, 'navigation does not rewrite another tab\'s latest entry');
    assert.equal(next.fetchMock.calls.length, 0, 'restoration starts no background acquisition or completion');
  });
}

test('a typed day restored through language remains editable on its original absolute date after midnight', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T12:00:00Z') });
  let first = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&planner=open&lang=en' });
  let next = null;
  t.after(async () => {
    if (next) await next.unmount();
    if (first) await first.unmount();
  });
  first.document.addEventListener('click', event => event.preventDefault());
  await first.clock.advance(500);
  const initial = composeCalls(first)[0];
  await first.fetchMock.respond(initial, publishedDay(initial.body.dates[0]));
  await first.clock.advance(50);
  const link = [...first.container.querySelectorAll('[role="group"] a')].find(element => element.textContent === 'SV');
  assert.ok(link);
  await first.act(() => link.dispatchEvent(new first.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
  const url = new URL(link.getAttribute('href'), first.window.location.href).href;
  const storage = browserStorage(first.window.localStorage);
  const sessionStorage = browserStorage(first.window.sessionStorage);
  await first.unmount(); first = null;
  t.mock.timers.setTime(new Date('2026-10-25T12:00:00Z').getTime());
  next = await mountPlanner({ url, storage, sessionStorage, props: { lang: 'sv' }, navigationType: 'navigate' });
  await next.clock.advance(500);
  assert.equal(composeCalls(next).length, 0);
  const anchor = next.container.querySelector('section[aria-label="Dagens utgångspunkt"]');
  assert.ok(anchor);
  assert.doesNotMatch(anchor.textContent, /Testville\s*·\s*idag/, 'yesterday must not be labelled today');
  assert.match(anchor.textContent, /24\s+okt/i, 'the original absolute date is visible');
  const adjust = [...next.container.querySelectorAll('button')].find(element => element.textContent.trim() === 'Justera');
  assert.ok(adjust);
  await next.act(() => adjust.dispatchEvent(new next.window.MouseEvent('click', { bubbles: true })));
  assert.equal(composeCalls(next).length, 0, 'opening the controls is not a change');
  const today = [...next.container.querySelectorAll('button')].find(element => element.textContent.trim() === 'Idag');
  assert.equal(today?.getAttribute('aria-pressed'), 'false', 'an old date is not an active Today selection');
  const full = [...next.container.querySelectorAll('button')].find(element => element.textContent.trim() === 'Fylld');
  assert.ok(full);
  await next.act(() => full.dispatchEvent(new next.window.MouseEvent('click', { bubbles: true })));
  await next.clock.advance(500);
  assert.equal(composeCalls(next).length, 1, 'the first explicit edit executes once rather than freezing');
  const edited = composeCalls(next)[0];
  assert.deepEqual(edited.body.dates, initial.body.dates, 'an ordinary edit must not silently move the restored day across midnight');
  assert.equal(edited.body.day_rhythm, 'full');
  await next.fetchMock.respond(edited, publishedDay(edited.body.dates[0]));
  await next.clock.advance(50);
  const todayAfterEdit = [...next.container.querySelectorAll('button')].find(element => element.textContent.trim() === 'Idag');
  assert.ok(todayAfterEdit);
  await next.act(() => todayAfterEdit.dispatchEvent(new next.window.MouseEvent('click', { bubbles: true })));
  await next.clock.advance(500);
  assert.equal(composeCalls(next).length, 2, 'an explicit Today click changes the absolute day even when the old relative offset was also zero');
  assert.deepEqual(composeCalls(next).at(-1).body.dates, ['2026-10-25']);
});

test('Undo after an explicit Today change restores calendar authority for the next ordinary adjustment', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T12:00:00Z') });
  let first = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&planner=open&lang=en' });
  let next = null;
  t.after(async () => {
    if (next) await next.unmount();
    if (first) await first.unmount();
  });
  const click = async (h, label) => {
    const control = [...h.container.querySelectorAll('button')]
      .find(element => element.textContent.trim() === label || element.getAttribute('aria-label') === label);
    assert.ok(Boolean(control), `the actual ${label} control exists`);
    await h.act(() => control.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
  };
  await first.clock.advance(500);
  const initial = composeCalls(first)[0];
  assert.deepEqual(initial.body.dates, ['2026-10-24']);
  await first.fetchMock.respond(initial, publishedDay('2026-10-24'));
  await first.clock.advance(50);
  const link = [...first.container.querySelectorAll('[role="group"] a')].find(element => element.textContent === 'SV');
  assert.ok(link);
  const url = new URL(link.getAttribute('href'), first.window.location.href).href;
  const storage = browserStorage(first.window.localStorage);
  const sessionStorage = browserStorage(first.window.sessionStorage);
  await first.unmount(); first = null;
  t.mock.timers.setTime(new Date('2026-10-25T12:00:00Z').getTime());
  next = await mountPlanner({ url, storage, sessionStorage, props: { lang: 'sv' }, navigationType: 'navigate' });
  await next.clock.advance(500);
  assert.equal(composeCalls(next).length, 0, 'restoring the old day must not compose');
  const previous = next.readStorage(LAST_KEY);
  await click(next, 'Justera');
  await click(next, 'Idag');
  await next.clock.advance(500);
  const today = composeCalls(next).at(-1);
  assert.deepEqual(today.body.dates, ['2026-10-25']);
  await next.fetchMock.respond(today, publishedDay('2026-10-25'));
  await next.clock.advance(50);
  await click(next, 'Ångra ändringen');
  await next.clock.advance(50);
  assert.equal(composeCalls(next).length, 1, 'Undo itself makes no request');
  const restored = next.readStorage(LAST_KEY);
  assert.equal(restored.dateIso, previous.dateIso);
  assert.deepEqual(stopIds(restored), stopIds(previous));
  assert.deepEqual(restored.commitments, previous.commitments);
  const anchor = next.container.querySelector('section[aria-label="Dagens utgångspunkt"]');
  const restoredDateVisible = /24\s+okt/i.test(anchor.textContent);
  const todayIsPressed = [...next.container.querySelectorAll('button')]
    .find(element => element.textContent.trim() === 'Idag')?.getAttribute('aria-pressed');
  await click(next, 'Fylld');
  await next.clock.advance(500);
  const adjusted = composeCalls(next).at(-1);
  assert.deepEqual({ restoredDateVisible, todayIsPressed, dates: adjusted.body.dates },
    { restoredDateVisible: true, todayIsPressed: 'false', dates: ['2026-10-24'] },
    'both the visible date and the next ordinary request belong to the day restored by Undo');
  assert.equal(adjusted.body.day_rhythm, 'full');
  await next.fetchMock.respond(adjusted, publishedDay('2026-10-24'));
  await next.clock.advance(50);
  await click(next, 'Idag');
  await next.clock.advance(500);
  assert.equal(composeCalls(next).length, 3, 'a later explicit Today still changes the date once');
  assert.deepEqual(composeCalls(next).at(-1).body.dates, ['2026-10-25']);
});

test('a near-me language view restores without storing or reusing a position fix', async (t) => {
  const coordsKey = 'parranda:anchor:coords';
  let first = await mountPlanner({
    url: 'http://localhost/anywhere?anchor=near&planner=open&lang=en',
    sessionStorage: { [coordsKey]: { lat: 55.6, lng: 13 } },
  });
  let next = null;
  t.after(async () => {
    if (next) await next.unmount();
    if (first) await first.unmount();
  });
  first.document.addEventListener('click', event => event.preventDefault());
  await first.clock.advance(500);
  const call = composeCalls(first)[0];
  assert.ok(call);
  const response = publishedDay(call.body.dates[0]);
  response.agnostic_route_output_experiment.intake.resolved.label = null;
  response.agnostic_route_output_experiment.source_status = { anchor: { lat: 55.6, lng: 13 } };
  await first.fetchMock.respond(call, response);
  await first.clock.advance(50);
  const before = first.readStorage(LAST_KEY);
  const link = [...first.container.querySelectorAll('[role="group"] a')].find(element => element.textContent === 'SV');
  assert.ok(link);
  assert.ok(new URL(link.href).searchParams.has('view'), 'the accepted near-me answer has a scoped view reference');
  await first.act(() => link.dispatchEvent(new first.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
  assert.equal(first.window.sessionStorage.getItem(coordsKey), null, 'an exact view does not leave a reusable GPS handoff');
  assert.doesNotMatch(link.getAttribute('href'), /[?&](?:lat|lng|coords)=/);
  assert.doesNotMatch(JSON.stringify(first.window.history.state), /"lat"|"lng"|fixture-museum/);
  const url = link.href;
  const storage = browserStorage(first.window.localStorage);
  const sessionStorage = browserStorage(first.window.sessionStorage);
  await first.unmount(); first = null;
  next = await mountPlanner({ url, storage, sessionStorage, props: { lang: 'sv' }, navigationType: 'navigate' });
  await next.clock.advance(1500);
  assert.equal(next.fetchMock.calls.length, 0, 'saved geometry does not authorize a new acquisition');
  assert.match(next.text(), /Fixture museum/);
  assert.match(next.container.querySelector('header h1').textContent, /^En dag nära dig$/);
  assert.deepEqual(stopIds(next.readStorage(LAST_KEY)), stopIds(before));
});

test('a near-me navigation view refuses a stop edit before pending when fresh position consent is absent', async (t) => {
  let first = await mountPlanner({ url: 'http://localhost/anywhere?anchor=near&planner=open&lang=en',
    sessionStorage: { 'parranda:anchor:coords': { lat: 55.6, lng: 13 } } });
  let next = null;
  t.after(async () => { if (next) await next.unmount(); if (first) await first.unmount(); });
  await first.clock.advance(500);
  const initial = composeCalls(first)[0];
  assert.ok(initial);
  const response = publishedDay(initial.body.dates[0]);
  response.agnostic_route_output_experiment.intake.resolved.label = null;
  response.agnostic_route_output_experiment.source_status = { anchor: { lat: 55.6, lng: 13 } };
  await first.fetchMock.respond(initial, response);
  await first.clock.advance(50);
  const url = first.window.location.href;
  const historyState = JSON.parse(JSON.stringify(first.window.history.state));
  const storage = browserStorage(first.window.localStorage);
  const sessionStorage = browserStorage(first.window.sessionStorage);
  assert.equal(sessionStorage['parranda:anchor:coords'], undefined, 'the initial handoff was consumed');
  await first.unmount(); first = null;
  next = await mountPlanner({ url, historyState, storage, sessionStorage, navigationType: 'reload' });
  let positionRequests = 0;
  Object.defineProperty(next.window.navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition() { positionRequests++; },
  } });
  await next.clock.advance(500);
  assert.equal(next.fetchMock.calls.length, 0, 'precondition: exact display does not acquire sources');
  assert.match(next.text(), /Fixture museum/);
  const before = { last: next.readStorage(LAST_KEY), session: browserStorage(next.window.sessionStorage),
    url: next.window.location.href, history: JSON.parse(JSON.stringify(next.window.history.state)) };
  const openStop = async () => {
    const disclosure = [...next.container.querySelectorAll('button[aria-controls]')]
      .find(element => element.textContent.includes('Fixture museum'));
    assert.ok(Boolean(disclosure), 'the actual published stop can be inspected');
    if (disclosure.getAttribute('aria-expanded') !== 'true') {
      await next.act(() => disclosure.dispatchEvent(new next.window.MouseEvent('click', { bubbles: true })));
    }
  };
  await openStop();
  const remove = [...next.container.querySelectorAll('button')].find(element => element.textContent.trim() === 'Remove');
  assert.ok(Boolean(remove));
  await next.act(() => remove.dispatchEvent(new next.window.MouseEvent('click', { bubbles: true })));
  await next.clock.advance(1500);
  await openStop();
  const afterRemove = [...next.container.querySelectorAll('button')].find(element => element.textContent.trim() === 'Remove');
  assert.ok(Boolean(afterRemove));
  assert.notEqual(afterRemove.getAttribute('aria-busy'), 'true', 'a refused position edit must not enter or strand pending state');
  assert.equal(next.fetchMock.calls.length, 0);
  assert.equal(positionRequests, 0, 'only a separate explicit consent action may request position');
  assert.ok([...next.container.querySelectorAll('button')].some(element => element.textContent.trim() === 'Use my location'));
  assert.deepEqual(next.readStorage(LAST_KEY), before.last);
  assert.deepEqual(browserStorage(next.window.sessionStorage), before.session);
  assert.equal(next.window.location.href, before.url);
  assert.deepEqual(next.window.history.state, before.history);
  assert.match(next.text(), /Fixture museum/);
  // Replace shares the same preflight: it is a preservation control after
  // the discriminating Remove regression, not a second invented defect.
  const replace = [...next.container.querySelectorAll('button')].find(element => element.textContent.trim() === 'Replace');
  assert.ok(Boolean(replace));
  await next.act(() => replace.dispatchEvent(new next.window.MouseEvent('click', { bubbles: true })));
  await next.clock.advance(1500);
  assert.notEqual(replace.getAttribute('aria-busy'), 'true');
  assert.equal(next.fetchMock.calls.length, 0);
  assert.equal(positionRequests, 0);
  assert.deepEqual(next.readStorage(LAST_KEY), before.last);
  assert.deepEqual(browserStorage(next.window.sessionStorage), before.session);
  assert.equal(next.window.location.href, before.url);
  assert.deepEqual(next.window.history.state, before.history);
});

test('fresh same-position consent after exact navigation keeps the published date and answered Keep across midnight', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T12:00:00Z') });
  let first = await mountPlanner({ url: 'http://localhost/anywhere?anchor=near&lang=en',
    sessionStorage: { 'parranda:anchor:coords': { lat: 55.6, lng: 13 } } });
  let next = null;
  t.after(async () => { if (next) await next.unmount(); if (first) await first.unmount(); });
  const click = async (h, text) => {
    const control = [...h.container.querySelectorAll('button')].find(element => element.textContent.trim() === text);
    assert.ok(Boolean(control), `the actual ${text} control exists`);
    await h.act(() => control.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  };
  const open = async (h, name) => {
    const control = [...h.container.querySelectorAll('button[aria-controls]')].find(element => element.textContent.includes(name));
    assert.ok(Boolean(control));
    await h.act(() => control.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  };
  await first.clock.advance(500);
  const initial = composeCalls(first)[0];
  assert.ok(initial);
  const answer = () => {
    const result = publishedDay(initial.body.dates[0]);
    result.agnostic_route_output_experiment.intake.resolved.label = null;
    result.agnostic_route_output_experiment.source_status = { anchor: { lat: 55.6, lng: 13 } };
    return result;
  };
  await first.fetchMock.respond(initial, answer());
  await open(first, 'Fixture museum'); await click(first, 'Keep this one');
  await first.clock.advance(500);
  const kept = composeCalls(first).at(-1);
  assert.deepEqual(kept.body.pinned_candidate_ids, ['fixture-museum']);
  await first.fetchMock.respond(kept, answer()); await first.clock.advance(50);
  const saved = first.readStorage(LAST_KEY);
  assert.equal(saved.commitments.entries['fixture-museum'].kind, 'pin');
  const url = first.window.location.href;
  const historyState = JSON.parse(JSON.stringify(first.window.history.state));
  const storage = browserStorage(first.window.localStorage);
  const sessionStorage = browserStorage(first.window.sessionStorage);
  await first.unmount(); first = null;
  t.mock.timers.setTime(new Date('2026-10-25T12:00:00Z').getTime());
  next = await mountPlanner({ url, historyState, storage, sessionStorage, navigationType: 'reload' });
  const requests = [];
  Object.defineProperty(next.window.navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition(success, failure) { requests.push({ success, failure }); },
  } });
  await next.clock.advance(500);
  assert.equal(next.fetchMock.calls.length, 0);
  assert.match(next.text(), /1 place kept/);
  await open(next, 'Fixture café'); await click(next, 'Remove');
  await next.clock.advance(500);
  assert.equal(composeCalls(next).length, 0, 'the refused edit awaits a separate consent action');
  assert.equal(requests.length, 0);
  await click(next, 'Use my location');
  assert.equal(requests.length, 1, 'the user explicitly requested fresh position permission');
  await next.act(() => requests[0].success({ coords: { latitude: 55.6, longitude: 13 } }));
  const resumed = composeCalls(next)[0];
  assert.ok(resumed);
  assert.deepEqual(resumed.body.dates, initial.body.dates, 'fresh position consent must not silently change the exact published calendar day');
  assert.deepEqual(resumed.body.pinned_candidate_ids, ['fixture-museum']);
  assert.equal(resumed.body.day_edit, undefined, 'the refused Remove was never acknowledged or queued');
  await next.fetchMock.respond(resumed, answer()); await next.clock.advance(1000);
  assert.equal(composeCalls(next).length, 1);
  assert.match(next.text(), /1 place kept/);
  assert.doesNotMatch(next.text(), /Your previous kept and dismissed stops could not be carried over/);
  assert.deepEqual(next.readStorage(LAST_KEY).commitments.entries, saved.commitments.entries);
  assert.equal(next.readStorage(LAST_KEY).inputs.coords, undefined);
  assert.equal(next.window.sessionStorage.getItem('parranda:anchor:coords'), null);
});

for (const moved of [false, true]) test(moved
  ? 'preservation: fresh consent at another position refuses the navigation day\'s old edit and choices explicitly'
  : 'fresh consent on the same published position retains an already applied shorter day instead of discarding its edit', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T12:00:00Z') });
  let first = await mountPlanner({ url: 'http://localhost/anywhere?anchor=near&lang=en',
    sessionStorage: { 'parranda:anchor:coords': { lat: 55.6, lng: 13 } } });
  let next = null;
  t.after(async () => { if (next) await next.unmount(); if (first) await first.unmount(); });
  const click = async (h, text) => {
    const control = [...h.container.querySelectorAll('button')].find(element => element.textContent.trim() === text);
    assert.ok(Boolean(control), `the actual ${text} control exists`);
    await h.act(() => control.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  };
  const open = async (h, name) => {
    const control = [...h.container.querySelectorAll('button[aria-controls]')].find(element => element.textContent.includes(name));
    assert.ok(Boolean(control));
    await h.act(() => control.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  };
  await first.clock.advance(500);
  const initial = composeCalls(first)[0];
  assert.ok(initial);
  const all = [...publishedDay(initial.body.dates[0]).days[0].primary_route.main_stops,
    { id: 'fixture-park', label: 'Fixture park', lat: 55.602, lng: 13, type: 'park' }];
  const answer = (stops = all, edit = null, anchor = { lat: 55.6, lng: 13 }) => {
    const result = publishedDay(initial.body.dates[0]);
    result.days[0].primary_route.main_stops = stops;
    result.days[0].primary_route.map_path_points = stops.map(({ lat, lng }) => ({ lat, lng }));
    result.agnostic_route_output_experiment.intake.resolved.label = null;
    result.agnostic_route_output_experiment.source_status = { anchor };
    if (edit) result.agnostic_route_output_experiment.day_edit = dayPolicy.dayEditOutcome(edit, stops);
    return result;
  };
  await first.fetchMock.respond(initial, answer());
  await open(first, 'Fixture museum'); await click(first, 'Keep this one'); await first.clock.advance(500);
  await first.fetchMock.respond(composeCalls(first).at(-1), answer());
  await open(first, 'Fixture park'); await click(first, 'Remove'); await first.clock.advance(500);
  const removal = composeCalls(first).at(-1);
  assert.equal(removal.body.day_edit.target_stop_count, 2);
  assert.deepEqual(removal.body.pinned_candidate_ids, ['fixture-museum']);
  const remaining = all.filter(stop => stop.id !== 'fixture-park');
  await first.fetchMock.respond(removal, answer(remaining, removal.body.day_edit)); await first.clock.advance(50);
  const saved = first.readStorage(LAST_KEY);
  assert.equal(saved.inputs.dayEdit.target_stop_count, 2, 'precondition: authoritative applied shorter extent is durable');
  const url = first.window.location.href;
  const historyState = JSON.parse(JSON.stringify(first.window.history.state));
  const storage = browserStorage(first.window.localStorage);
  const sessionStorage = browserStorage(first.window.sessionStorage);
  await first.unmount(); first = null;
  t.mock.timers.setTime(new Date('2026-10-25T12:00:00Z').getTime());
  next = await mountPlanner({ url, historyState, storage, sessionStorage, navigationType: 'reload' });
  const requests = [];
  Object.defineProperty(next.window.navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition(success, failure) { requests.push({ success, failure }); },
  } });
  await next.clock.advance(500);
  assert.equal(next.fetchMock.calls.length, 0);
  await open(next, 'Fixture café'); await click(next, 'Remove'); await next.clock.advance(500);
  assert.equal(next.fetchMock.calls.length, 0);
  await click(next, 'Use my location');
  assert.equal(requests.length, 1);
  const granted = { lat: moved ? 55.601 : 55.6, lng: 13 };
  await next.act(() => requests[0].success({ coords: { latitude: granted.lat, longitude: granted.lng } }));
  const resumed = composeCalls(next)[0];
  assert.ok(resumed);
  assert.deepEqual(resumed.body.dates, initial.body.dates, 'the calendar-date correction remains intact');
  if (moved) {
    assert.equal(resumed.body.day_edit, undefined, 'new geography cannot borrow the old applied extent');
    assert.equal(resumed.body.pinned_candidate_ids, undefined);
    assert.equal(resumed.body.excluded_candidate_ids, undefined);
    assert.match(next.text(), /Your previous kept and dismissed stops could not be carried over/);
  } else {
    assert.deepEqual(resumed.body.day_edit, saved.inputs.dayEdit, 'fresh same-position consent must retain the applied edit rather than silently grow the day');
    assert.deepEqual(resumed.body.pinned_candidate_ids, ['fixture-museum']);
    assert.ok(resumed.body.excluded_candidate_ids.includes('fixture-park'));
  }
  await next.fetchMock.respond(resumed, moved ? answer(all, null, granted) : answer(remaining, resumed.body.day_edit));
  await next.clock.advance(1000);
  assert.equal(composeCalls(next).length, 1);
  if (moved) {
    assert.equal(next.readStorage(LAST_KEY).inputs.dayEdit, undefined);
    assert.equal(next.readStorage(LAST_KEY).commitments, null);
    assert.match(next.text(), /Your previous kept and dismissed stops could not be carried over/);
  } else {
    assert.deepEqual(next.readStorage(LAST_KEY).inputs.dayEdit, saved.inputs.dayEdit);
    assert.deepEqual(stopIds(next.readStorage(LAST_KEY)), ['fixture-museum', 'fixture-cafe']);
    assert.doesNotMatch(next.text(), /Your previous kept and dismissed stops could not be carried over/);
  }
});

for (const storageFailure of ['quota', 'unavailable']) {
  test(`a published day never falls back to input-only language navigation when session storage is ${storageFailure}`, async (t) => {
    const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&planner=open&lang=en' });
    t.after(() => h.unmount());
    h.document.addEventListener('click', event => event.preventDefault());
    await h.clock.advance(500);
    const call = composeCalls(h)[0];
    assert.ok(call, 'precondition: a fresh accepted request is outstanding');
    if (storageFailure === 'quota') {
      const setItem = h.window.Storage.prototype.setItem;
      const session = h.window.sessionStorage;
      h.window.Storage.prototype.setItem = function (key, value) {
        if (this === session) throw new h.window.DOMException('Fixture quota', 'QuotaExceededError');
        return setItem.call(this, key, value);
      };
    } else {
      Object.defineProperty(h.window, 'sessionStorage', { configurable: true,
        get() { throw new h.window.DOMException('Fixture unavailable storage', 'SecurityError'); },
      });
    }
    await h.fetchMock.respond(call, publishedDay(call.body.dates[0]));
    await h.clock.advance(100);
    const before = h.readStorage(LAST_KEY);
    assert.deepEqual(stopIds(before), ['fixture-museum', 'fixture-cafe']);
    const control = [...h.container.querySelectorAll('nav [role="group"] a, nav [role="group"] button, nav [role="group"] [role="link"]')]
      .find(element => element.textContent === 'SV');
    assert.ok(control);
    assert.equal(control.getAttribute('href'), null, 'a failed exact-view write must not expose a fresh-composition language URL');
    assert.ok(control.matches(':disabled, [aria-disabled="true"]'), 'the unavailable language action is explicit');
    assert.match(h.text(), /Language switching is unavailable because this browser could not keep this exact day/);
    await h.act(() => control.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
    await h.clock.advance(1500);
    assert.equal(composeCalls(h).length, 1, 'the refused action never composes another answer');
    assert.match(h.text(), /Fixture museum/);
    assert.deepEqual(h.readStorage(LAST_KEY), before, 'published and remembered day survive the refusal');
  });
}

test('a successful exact-view write does not announce a storage failure before its publication effect', async (t) => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&planner=open&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const call = composeCalls(h)[0];
  assert.ok(call);
  let failedNoticeAppeared = false;
  const observer = new h.window.MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.textContent?.includes('Language switching is unavailable because this browser could not keep this exact day')) {
        failedNoticeAppeared = true;
      }
    }
  });
  observer.observe(h.container, { childList: true, subtree: true });
  t.after(() => observer.disconnect());
  await h.fetchMock.respond(call, publishedDay(call.body.dates[0]));
  await h.clock.advance(100);
  assert.match(h.text(), /Fixture museum/);
  const link = [...h.container.querySelectorAll('nav [role="group"] a')].find(element => element.textContent === 'SV');
  assert.ok(new URL(link.href).searchParams.has('view'));
  assert.equal(failedNoticeAppeared, false, 'an unattempted write is not a failed write to announce');
});
