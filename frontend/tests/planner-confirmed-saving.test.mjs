import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';
import { LAST_KEY, SAVED_KEY } from '../src/lib/anywhere-storage.mjs';

const calls = h => h.fetchMock.calls.filter(call => call.url.startsWith('/api/route-recommendations'));
const saveButton = h => h.container.querySelector('button[aria-label="Save this day"]');
const savedButton = h => h.container.querySelector('button[aria-label="Day is saved"]');
const ids = entry => entry.safeResponse.days[0].primary_route.main_stops.map(stop => stop.id);
const click = (h, button) => h.act(() => {
  assert.ok(button, 'the product offers the intended action');
  button.click();
});
function day(date, prefix = 'original') {
  return {
    days: [{ date, experimental_agnostic_route_applied: true, alternatives: [], primary_route: {
      id: '__agnostic_compose__', estimated_km: 1.2, legs: [], confidence: 'low',
      main_stops: [
        { id: `${prefix}-museum`, label: `${prefix} museum`, type: 'museum', lat: 55.6, lng: 13 },
        { id: `${prefix}-cafe`, label: `${prefix} café`, type: 'cafe', lat: 55.601, lng: 13 },
      ], map_route_points: [], map_path_points: [],
    } }],
    agnostic_route_output_experiment: { promotion: { promote: true, readiness: 'promotable' } },
  };
}
async function ready(t) {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&planner=open&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const request = calls(h)[0];
  assert.ok(request);
  await h.fetchMock.respond(request, day(request.body.dates[0]));
  await h.clock.advance(50);
  assert.match(h.text(), /original museum/);
  return h;
}
function rejectSavedWrites(t, h) {
  const prototype = Object.getPrototypeOf(h.window.localStorage);
  const original = prototype.setItem;
  let reject = true;
  prototype.setItem = function (key, value) {
    if (this === h.window.localStorage && key === SAVED_KEY && reject) {
      throw new h.window.DOMException('Storage rejected', 'QuotaExceededError');
    }
    return original.call(this, key, value);
  };
  t.after(() => { prototype.setItem = original; });
  return () => { reject = false; };
}

test('rebuilding the same saved query can save and restore its new accepted stops', async t => {
  const h = await ready(t);
  await click(h, saveButton(h));
  assert.ok(savedButton(h));
  const old = h.readStorage(SAVED_KEY)[0];
  await click(h, [...h.container.querySelectorAll('li button')].find(button => /^Testville · /.test(button.textContent)));
  await click(h, [...h.container.querySelectorAll('button')].find(button => /rebuild for fresh events/.test(button.textContent)));
  await h.clock.advance(600);
  const request = calls(h).at(-1);
  assert.equal(calls(h).length, 2);
  await h.fetchMock.respond(request, day(request.body.dates[0], 'replacement'));
  await h.clock.advance(50);
  assert.equal(h.readStorage(LAST_KEY).id, old.id, 'the new answer has the same query identity');
  assert.deepEqual(ids(h.readStorage(SAVED_KEY)[0]), ['original-museum', 'original-cafe']);
  assert.ok(saveButton(h), 'a different accepted answer is not already saved');
  await click(h, saveButton(h));
  assert.ok(savedButton(h));
  const saved = h.readStorage(SAVED_KEY);
  assert.equal(saved.length, 1, 're-saving the query replaces it without creating duplicate days');
  assert.deepEqual(ids(saved[0]), ['replacement-museum', 'replacement-cafe']);
  const before = calls(h).length;
  await click(h, [...h.container.querySelectorAll('li button')].find(button => /^Testville · /.test(button.textContent)));
  await h.clock.advance(600);
  assert.equal(calls(h).length, before, 'restoring the saved answer must not recompose');
  assert.match(h.text(), /replacement museum/);
  assert.doesNotMatch(h.text(), /original museum/);
});

test('a rejected Save preserves the day and offers an honest explicit retry', async t => {
  const h = await ready(t);
  const allow = rejectSavedWrites(t, h);
  const before = h.readStorage(LAST_KEY);
  const focusedSave = saveButton(h);
  focusedSave.focus();
  await click(h, saveButton(h));
  assert.ok(saveButton(h), 'a failed write must not disable Save or claim Saved');
  assert.equal(savedButton(h), null);
  assert.equal(h.readStorage(SAVED_KEY), null);
  assert.match(h.text(), /could(?: not|n't) save/i);
  assert.equal(h.document.activeElement, focusedSave);
  assert.ok([...h.container.querySelectorAll('[role="status"]')].some(node => /could(?: not|n't) save/i.test(node.textContent)));
  assert.deepEqual(h.readStorage(LAST_KEY), before);
  assert.match(h.text(), /original museum/);
  allow();
  await click(h, saveButton(h));
  assert.ok(savedButton(h));
  assert.deepEqual(ids(h.readStorage(SAVED_KEY)[0]), ['original-museum', 'original-cafe']);
  assert.doesNotMatch(h.text(), /could(?: not|n't) save/i);
  assert.equal(calls(h).length, 1, 'saving and retrying do not ask for another day');
});

test('a rejected removal keeps the persisted saved day visible until a successful retry', async t => {
  const h = await ready(t);
  await click(h, saveButton(h));
  const allow = rejectSavedWrites(t, h);
  const persisted = h.readStorage(SAVED_KEY);
  const remove = () => h.container.querySelector('button[aria-label="Remove"]');
  const focusedRemove = remove();
  focusedRemove.focus();
  await click(h, remove());
  assert.ok(remove(), 'a record still in storage must not disappear from the saved list');
  assert.deepEqual(h.readStorage(SAVED_KEY), persisted);
  assert.ok(savedButton(h));
  assert.match(h.text(), /could(?: not|n't) remove/i);
  assert.equal(h.document.activeElement, focusedRemove);
  allow();
  await click(h, remove());
  assert.equal(remove(), null);
  assert.deepEqual(h.readStorage(SAVED_KEY), []);
  assert.ok(saveButton(h));
  assert.match(h.text(), /original museum/);
  assert.doesNotMatch(h.text(), /could(?: not|n't) remove/i);
  assert.equal(calls(h).length, 1);
});

test('an older saved entry without request inputs can still be saved as the displayed version', async t => {
  const legacy = { id: 'legacy-day', label: 'Testville', place: 'Testville', dateIso: '2026-07-03',
    savedAt: '2026-07-03T10:00:00Z', inputs: null, commitments: null,
    classification: { status: 'composed' }, safeResponse: day('2026-07-03') };
  const h = await mountPlanner({ url: 'http://localhost/anywhere?lang=en', storage: { [LAST_KEY]: legacy } });
  t.after(() => h.unmount());
  await h.clock.advance(100);
  await click(h, saveButton(h));
  assert.deepEqual(ids(h.readStorage(SAVED_KEY)[0]), ['original-museum', 'original-cafe']);
  assert.ok(savedButton(h), 'view metadata must not prevent confirming a legacy snapshot');
  assert.equal(calls(h).length, 0);
});
