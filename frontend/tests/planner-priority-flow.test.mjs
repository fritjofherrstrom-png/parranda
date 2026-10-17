/** Mounted intent round trips. External replies are controlled; this is not native/provider acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';

const calls = h => h.fetchMock.calls.filter(call => call.url.includes('/api/route-recommendations'));

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

test('clearing the order composes unranked interests and leaves no prio in the address to reload', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-16T10:00:00Z') });
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Fixture%20Town&prefs=culture,second_hand&prio=second_hand,culture&lang=en' });
  t.after(() => h.unmount());
  await h.fetchMock.respond(calls(h)[0], { days: [] });
  const click = async target => { assert.ok(Boolean(target), 'real requested control exists'); await h.act(() => target.click()); };
  await click([...h.container.querySelectorAll('button')].find(button => button.textContent.trim() === 'Adjust'));
  await click([...h.container.querySelectorAll('button')].find(button => button.textContent.trim() === 'Clear the order'));
  await h.clock.advance(400);
  const request = calls(h).at(-1);
  await h.fetchMock.respond(request, { days: [] });
  assert.deepEqual(request.body.preferences, ['culture', 'second_hand'], 'clearing never deselects an interest');
  assert.equal(request.body.preference_priority, undefined, 'an unranked day sends no priority');
  const address = new URL(h.window.location.href);
  assert.equal(address.searchParams.get('prio'), null);
  assert.ok(!h.container.querySelector('[aria-label^="Priority "]'), 'no rank numbers remain');
  assert.ok(![...h.container.querySelectorAll('button')].some(button => button.textContent.trim() === 'Clear the order'));
});

test('an explicitly malformed edit link cannot silently compose an unedited Full day', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Fixture%20Town&edit=null&lang=en' });
  t.after(() => h.unmount());
  if (calls(h)[0]) await h.fetchMock.respond(calls(h)[0], { days: [] });
  assert.equal(calls(h).length, 0, 'presence of invalid edit intent must survive UI intake');
  assert.match(h.text(), /invalid stop edit/i);
});
