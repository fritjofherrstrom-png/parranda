import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

const calls = h => h.fetchMock.calls.filter(call => call.url.startsWith('/api/route-recommendations'));
const button = (h, text) => [...h.container.querySelectorAll('button')].find(node => node.textContent.trim() === text);
const complete = { status: 'complete', pending: 0, completed: 1, failed: 0 };
const partial = { status: 'partial', reason: 'bounded_lifecycle_snapshot', pending: 1, completed: 0, failed: 1 };

function day(completion = partial, error = 'provider_unavailable') {
  return {
    days: [{ date: '2026-10-17', experimental_agnostic_route_applied: true,
      primary_route: { id: '__agnostic_compose__', main_stops: Array.from({ length: 6 }, (_, index) => ({
        id: `museum-${index}`, label: `Museum ${index + 1}`, lat: 55.6 + index * .001, lng: 13,
        type: 'museum', daypart: 'midday', tags: [],
      })), estimated_km: 1.2, legs: [], map_route_points: [], map_path_points: [] }, alternatives: [] }],
    agnostic_route_output_experiment: {
      intake: { status: 'resolved', resolved: { label: 'Testville' } },
      promotion: { promote: true, readiness: 'promotable_limited', qualifying_caps: [] },
      source_status: { status: 'loaded:6', error, collection: { source_completion: completion } },
    },
  };
}

for (const lang of ['en', 'sv']) {
  test(`published six-stop day has quiet, accessible source information in ${lang}`, async t => {
    const h = await mountPlanner({ url: `http://localhost/anywhere?place=Testville&prefs=culture&lang=${lang}`, props: { lang } });
    t.after(() => h.unmount());
    await h.fetchMock.respond(calls(h)[0], day());
    const header = h.container.querySelector('header');
    // One plain sentence, the failure said in it: no bold "missing" headline,
    // no hidden "About the place sources" (iPhone, 23 Oct 2026).
    const sentence = lang === 'en'
      ? 'Not every place could be loaded, so there may be more than the ones shown.'
      : 'Inte alla platser kunde läsas in, så det kan finnas fler än de som visas.';
    const status = [...header.querySelectorAll('[role="status"]')].find(node => node.textContent.trim() === sentence);
    assert.ok(status, 'a usable day explains incomplete source information in ordinary words');
    assert.doesNotMatch(status.closest('section')?.className || status.parentElement.className, /bg-parranda-(?:ember|glow)|border-parranda-(?:ember|glow)/, 'the successful day is not styled as a warning');
    assert.equal(header.querySelector('[role="alert"]'), null);
    assert.match(h.text(), /Museum 6/);
    assert.match(header.textContent, lang === 'en' ? /6 stops/ : /6 stopp/);
    assert.doesNotMatch(header.textContent, /You can use this day|Du kan använda dagen/);
    assert.equal(header.querySelector('details'), null, 'the limitation is said in the sentence, not hidden behind a disclosure');
    const update = button(h, lang === 'en' ? 'Look for more places' : 'Leta efter fler platser');
    assert.ok(update);
    assert.doesNotMatch(update.className, /bg-parranda-ember/, 'looking again is a secondary action beside a valid day');
    assert.equal(update.closest('[role="status"], [aria-live]'), null);
    await h.clock.advance(120000);
    assert.equal(calls(h).length, 1, 'source information does not schedule another acquisition');
    assert.doesNotMatch(h.text(), /still fetching|on their way|automatically in a moment|hämtas fortfarande|är på väg|automatiskt strax/i);
  });
}

test('looking for more places keeps its focused action while the published day is held, then says what it found', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&prefs=culture&lang=en' });
  t.after(() => h.unmount());
  await h.fetchMock.respond(calls(h)[0], day());
  const update = button(h, 'Look for more places');
  update.focus();
  await h.act(() => update.dispatchEvent(new h.window.Event('click', { bubbles: true })));
  assert.equal(calls(h).length, 2);
  assert.deepEqual(calls(h)[1].body, calls(h)[0].body, 'update asks the same frozen question');
  assert.equal(update.isConnected, true, 'an explicit update must not unmount its focused action');
  assert.equal(h.document.activeElement, update);
  assert.equal(update.getAttribute('aria-busy'), 'true');
  assert.equal(update.getAttribute('aria-disabled'), 'true');
  assert.equal(update.textContent.trim(), 'Looking for more places …', 'the action says what it is doing');
  assert.ok(update.querySelector('svg[data-ring-mark]'), 'with the one working sign');
  assert.match(h.text(), /Museum 6/);
  await h.act(() => update.dispatchEvent(new h.window.Event('click', { bubbles: true })));
  assert.equal(calls(h).length, 2, 'a busy action cannot duplicate the update');
  await h.fetchMock.respond(calls(h)[1], day(complete, null));
  assert.equal(button(h, 'Look for more places'), undefined);
  assert.doesNotMatch(h.text(), /Not every place/);
  // The result is said, never a silent swap: here nothing new turned up.
  assert.match(h.text(), /Looked for more places: same stops and distance/);
  assert.ok([...h.container.querySelectorAll('button')].some(node => node.getAttribute('aria-label') === 'Undo this change'));
  assert.equal(h.document.activeElement, h.container.querySelector('header h1'), 'removing the completed action leaves focus on the day');
});

test('a failed look keeps the source sentence and enables deliberate recovery', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&prefs=culture&lang=en' });
  t.after(() => h.unmount());
  await h.fetchMock.respond(calls(h)[0], day());
  const update = button(h, 'Look for more places');
  update.focus();
  await h.act(() => update.dispatchEvent(new h.window.Event('click', { bubbles: true })));
  await h.fetchMock.respond(calls(h)[1], {}, 500);
  assert.equal(update.isConnected, true);
  assert.equal(h.document.activeElement, update);
  assert.equal(update.getAttribute('aria-busy'), null);
  assert.equal(update.getAttribute('aria-disabled'), null);
  assert.match(h.text(), /Couldn't update — showing your previous day/);
  assert.match(h.container.querySelector('header').textContent, /Not every place could be loaded/);
  assert.equal(update.textContent.trim(), 'Look for more places');
  assert.match(h.text(), /Museum 6/);
  await h.clock.advance(120000);
  assert.equal(calls(h).length, 2, 'failed recovery does not schedule a retry');
  await h.act(() => update.dispatchEvent(new h.window.Event('click', { bubbles: true })));
  assert.equal(calls(h).length, 3);
  assert.deepEqual(calls(h)[2].body, calls(h)[0].body);
});

test('healthy source update does not take focus from a reader who moved on', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.fetchMock.respond(calls(h)[0], day());
  const update = button(h, 'Look for more places');
  update.focus();
  await h.act(() => update.dispatchEvent(new h.window.Event('click', { bubbles: true })));
  const adjust = button(h, 'Adjust');
  adjust.focus();
  await h.fetchMock.respond(calls(h)[1], day(complete, null));
  assert.equal(h.document.activeElement, adjust);
});

for (const [name, completion, error] of [
  ['primary failure after complete background work', complete, 'provider_unavailable'],
  ['failed background source', { ...complete, failed: 1 }, null],
  ['partial snapshot without a recorded failure', { ...partial, failed: 0, pending: 0 }, null],
]) {
  test(`successful source status preserves ${name}`, async t => {
    const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
    t.after(() => h.unmount());
    await h.fetchMock.respond(calls(h)[0], day(completion, error));
    const header = h.container.querySelector('header').textContent;
    assert.match(header, name.startsWith('partial') ? /Not every place loaded in time/ : /Not every place could be loaded/);
    if (name.startsWith('partial')) assert.doesNotMatch(header, /could be loaded/, 'an unfinished snapshot is not called a failure');
    assert.doesNotMatch(h.text(), /Parranda couldn't build a day here right now|few places to choose between here/);
  });
}

test('healthy complete day has no source recovery action', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.fetchMock.respond(calls(h)[0], day(complete, null));
  assert.doesNotMatch(h.text(), /Not every place/);
  assert.equal(button(h, 'Look for more places'), undefined);
});
