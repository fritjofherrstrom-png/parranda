/** Mounted intent round trips. External replies are controlled; this is not native/provider acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';

const calls = h => h.fetchMock.calls.filter(call => call.url.includes('/api/route-recommendations'));
const LAST = 'parranda:anywhere:last';
function composedDay(prefix) {
  const stops = ['vintage-shop', 'museum'].map((type, index) => ({
    id: `${prefix}-${index}`, label: `${prefix} place ${index}`, type,
    lat: 55.6 + index * .001, lng: 13, commitment_eligible: true,
    covered_preferences: [type === 'museum' ? 'culture' : 'second_hand'],
  }));
  return { days: [{ date: '2026-10-16', experimental_agnostic_route_applied: true,
    primary_route: { id: '__agnostic_compose__', main_stops: stops, estimated_km: 1.2,
      legs: [], map_route_points: [], map_path_points: stops.map(({ lat, lng }) => ({ lat, lng })), confidence: 'low' }, alternatives: [],
  }], agnostic_route_output_experiment: {
    intake: { status: 'resolved', resolved: { label: 'Fixture Town', lat: 55.6, lng: 13 } },
    promotion: { promote: true, readiness: 'promotable' },
  } };
}

test('explicit URL priority enters the first compose and remains in the address without a duplicate request', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-16T10:00:00Z') });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Fixture%20Town&prefs=culture,second_hand&prio=second_hand,culture&rhythm=full&lang=en' });
  t.after(() => h.unmount());
  assert.equal(calls(h).length, 1);
  const request = calls(h)[0];
  await h.fetchMock.respond(request, { days: [] });
  assert.deepEqual(request.body.preference_priority, ['second_hand', 'culture']);
  assert.equal(new URL(h.window.location.href).searchParams.get('prio'), 'second_hand,culture');
  const summary = h.container.querySelector("section[aria-label=\"Your day's starting point\"] strong");
  assert.equal(summary.textContent, '1. Second hand · 2. Culture', 'collapsed controls keep explicit dominance visible');
  await h.clock.advance(500);
  assert.equal(calls(h).length, 1, 'adopting the link is not a user adjustment');
});

test('tapping a ranked interest off and on moves it last in the emitted intent', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-16T10:00:00Z') });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Fixture%20Town&prefs=culture,second_hand&prio=culture,second_hand&lang=en' });
  t.after(() => h.unmount());
  await h.fetchMock.respond(calls(h)[0], { days: [] });
  const click = async target => { assert.ok(Boolean(target), 'real requested control exists'); await h.act(() => target.click()); };
  await click([...h.container.querySelectorAll('button')].find(button => button.textContent.trim() === 'Adjust'));
  const chip = () => h.container.querySelector('[data-preference-key="culture"] button[aria-pressed]');
  await click(chip()); await click(chip());
  await h.clock.advance(400);
  const request = calls(h).at(-1);
  await h.fetchMock.respond(request, { days: [] });
  assert.deepEqual(request.body.preferences, ['second_hand', 'culture']);
  assert.deepEqual(request.body.preference_priority, ['second_hand', 'culture']);
  assert.equal(chip().getAttribute('aria-pressed'), 'true');
  assert.equal(calls(h).length, 2, 'two quick taps compose once');
});

test('picking a new interest on an unranked day ranks only that interest', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-16T10:00:00Z') });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Fixture%20Town&prefs=food,culture,views&lang=en' });
  t.after(() => h.unmount());
  await h.fetchMock.respond(calls(h)[0], { days: [] });
  assert.equal(calls(h)[0].body.preference_priority, undefined, 'untouched defaults are unranked');
  const click = async target => { assert.ok(Boolean(target), 'real requested control exists'); await h.act(() => target.click()); };
  await click([...h.container.querySelectorAll('button')].find(button => button.textContent.trim() === 'Adjust'));
  await click(h.container.querySelector('[data-preference-key="fika"] button[aria-pressed]'));
  await h.clock.advance(400);
  const request = calls(h).at(-1);
  await h.fetchMock.respond(request, { days: [] });
  assert.deepEqual(request.body.preference_priority, ['fika']);
  await click([...h.container.querySelectorAll('button')].find(button => button.textContent.trim() === 'Done'));
  const summary = h.container.querySelector("section[aria-label=\"Your day's starting point\"] strong");
  assert.equal(summary.textContent, '1. Coffee · Food & drink · Culture · Views', 'only the pick is numbered');
});

test('completed Clear keeps a real neutral day, and Undo restores the exact prior answer and priority without composing', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-16T10:00:00Z') });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Fixture%20Town&prefs=culture,second_hand&prio=second_hand,culture&lang=en' });
  t.after(() => h.unmount());
  await h.fetchMock.respond(calls(h)[0], composedDay('Ranked'));
  const previous = h.readStorage(LAST);
  assert.equal(previous.safeResponse.days[0].primary_route.main_stops.length, 2);
  const click = async target => { assert.ok(Boolean(target), 'real requested control exists'); await h.act(() => target.click()); };
  await click([...h.container.querySelectorAll('button')].find(button => button.textContent.trim() === 'Adjust'));
  await click([...h.container.querySelectorAll('button')].find(button => button.textContent.trim() === 'Clear the order'));
  await h.clock.advance(400);
  const request = calls(h).at(-1);
  await h.fetchMock.respond(request, composedDay('Neutral'));
  assert.deepEqual(request.body.preferences, ['culture', 'second_hand'], 'clearing never deselects an interest');
  assert.equal(request.body.preference_priority, undefined, 'an unranked day sends no priority');
  const address = new URL(h.window.location.href);
  assert.equal(address.searchParams.get('prio'), null);
  assert.ok(!h.container.querySelector('[aria-label^="Priority "]'), 'no rank numbers remain');
  assert.ok(![...h.container.querySelectorAll('button')].some(button => button.textContent.trim() === 'Clear the order'));
  assert.deepEqual(h.readStorage(LAST).inputs.preferencePriority ?? [], []);
  const routeText = () => h.container.querySelector('ol[aria-label="The stops, in order"]').textContent;
  assert.match(routeText(), /Neutral place 0/);
  assert.doesNotMatch(routeText(), /Ranked place 0/);
  const beforeUndo = calls(h).length;
  await click(h.container.querySelector('button[aria-label="Undo this change"]'));
  await h.clock.advance(1000);
  assert.equal(calls(h).length, beforeUndo, 'restoring the previous answer does not ask the server again');
  assert.deepEqual(h.readStorage(LAST), previous, 'the complete saved response, inputs and ledger are restored');
  assert.equal(new URL(h.window.location.href).searchParams.get('prio'), 'second_hand,culture');
  assert.match(routeText(), /Ranked place 0/);
  assert.doesNotMatch(routeText(), /Neutral place 0/);
});

test('a late Clear response cannot overwrite the ranked composed day restored by Undo', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-16T10:00:00Z') });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Fixture%20Town&prefs=culture,second_hand&prio=second_hand,culture&lang=en' });
  t.after(() => h.unmount());
  await h.fetchMock.respond(calls(h)[0], composedDay('Original'));
  const previous = h.readStorage(LAST);
  const click = async target => { assert.ok(Boolean(target), 'real requested control exists'); await h.act(() => target.click()); };
  await click([...h.container.querySelectorAll('button')].find(button => button.textContent.trim() === 'Adjust'));
  await click([...h.container.querySelectorAll('button')].find(button => button.textContent.trim() === 'Clear the order'));
  await h.clock.advance(400);
  const clear = calls(h).at(-1);
  assert.equal(clear.body.preference_priority, undefined);
  await h.fetchMock.respond(clear, composedDay('Late neutral'), 200, { deferBody: true });
  await click(h.container.querySelector('button[aria-label="Increase priority for Culture"]'));
  await h.clock.advance(400);
  const ranked = calls(h).at(-1);
  assert.notEqual(ranked, clear);
  assert.deepEqual(ranked.body.preference_priority, ['culture', 'second_hand']);
  await h.fetchMock.respond(ranked, composedDay('New ranking'));
  await click(h.container.querySelector('button[aria-label="Undo this change"]'));
  await h.clock.advance(500);
  assert.deepEqual(h.readStorage(LAST), previous);
  const beforeLate = calls(h).length;
  await h.fetchMock.releaseBody(clear);
  await h.clock.advance(1000);
  assert.deepEqual(h.readStorage(LAST), previous, 'the old unranked body cannot replace the restored exact day');
  assert.equal(new URL(h.window.location.href).searchParams.get('prio'), 'second_hand,culture');
  assert.equal(calls(h).length, beforeLate, 'neither Undo nor rejecting the late body composes again');
});

test('an explicitly malformed edit link cannot silently compose an unedited Full day', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Fixture%20Town&edit=null&lang=en' });
  t.after(() => h.unmount());
  if (calls(h)[0]) await h.fetchMock.respond(calls(h)[0], { days: [] });
  assert.equal(calls(h).length, 0, 'presence of invalid edit intent must survive UI intake');
  assert.match(h.text(), /invalid stop edit/i);
});
