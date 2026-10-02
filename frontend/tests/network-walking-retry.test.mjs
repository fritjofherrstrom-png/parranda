import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

const calls = h => h.fetchMock.calls.filter(c => c.url.startsWith('/api/route-recommendations'));
const failure = reason => ({ days: [], live_events: { pending: true }, place_structure: {
  provenance: 'agnostic_anchor', area_count: 1, district_day: { areas: [] } },
  agnostic_route_output_experiment: { eligibility: { blockers: ['network_walking_unavailable', reason] } } });
const day = { days: [{ date: '2026-09-20', experimental_agnostic_route_applied: true,
  primary_route: { id: '__agnostic_compose__', title: 'Previous day', estimated_km: 2,
    main_stops: ['museum', 'cafe'].map((id, i) => ({ id, label: `Trusted ${id}`, lat: 48 + i * .001, lng: 8,
      type: id, provenance: { attribution: [] } })), legs: [], map_route_points: [], map_path_points: [] }, alternatives: [] }],
  agnostic_route_output_experiment: { promotion: { promote: true } } };
async function click(h, pattern) {
  const b = [...h.container.querySelectorAll('button')].find(b => pattern.test(b.textContent));
  assert.ok(b, `button ${pattern}`); await h.act(() => b.click());
}
for (const retained of [false, true]) test(`walking failure offers single-flight lifecycle retry (${retained ? 'retained' : 'cold'}) with current preferences`, async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Example&lang=en' });
  t.after(() => h.unmount()); await h.clock.advance(500);
  if (retained) {
    await h.fetchMock.respond(calls(h)[0], day);
    await h.clock.advance(50);
    assert.doesNotMatch(h.text(), /Drawing the map/);
    await click(h, /Adjust/); await click(h, /Second hand/); await h.clock.advance(500);
  }
  await h.fetchMock.respond(calls(h).at(-1), failure('network_walking_provider_unavailable'));
  assert.match(h.text(), /walking service.*unavailable/i);
  assert.doesNotMatch(h.text(), /not a reliable route yet/);
  if (retained) {
    assert.match(h.text(), /Trusted museum/);
    assert.match(h.text(), /previous day/);
    assert.doesNotMatch(h.text(), /Drawing the map/, 'the unchanged drawn map must not return to a waiting state');
    assert.equal(h.readStorage('parranda:anywhere:last').inputs.selected.includes('second_hand'), false);
  } else {
    await click(h, /Adjust/); await click(h, /Second hand/);
  }
  const before = calls(h).length;
  const retry = [...h.container.querySelectorAll('button')].find(b => /Try .*again/.test(b.textContent));
  assert.ok(retry);
  await h.act(() => { retry.click(); retry.click(); });
  assert.equal(calls(h).length, before + 1);
  assert.ok(calls(h).at(-1).body.preferences.includes('second_hand'));
  await h.fetchMock.respond(calls(h).at(-1), { planner_lifecycle: { version: 1, state: 'warm_pending', token: 'a'.repeat(48), retry_after_ms: 3000, remaining_ms: 50000, max_polls: 20 } }, 202);
  await h.clock.advance(3000);
  const poll = h.fetchMock.pending().find(c => c.url === '/api/planner-status');
  assert.ok(poll, 'retry uses normal Planner lifecycle');
  await h.fetchMock.respond(poll, failure('network_walking_busy'));
  assert.match(h.text(), /walking service.*busy/i);
  await h.clock.advance(65000);
  assert.equal(calls(h).length, before + 1, 'failure never schedules an automatic storm');
});

test('retained day header keeps its original date while tomorrow inputs fail', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Example&lang=en' });
  t.after(() => h.unmount()); await h.clock.advance(500);
  await h.fetchMock.respond(calls(h)[0], day);
  await click(h, /Adjust/); await click(h, /^Tomorrow$/); await h.clock.advance(500);
  await h.fetchMock.respond(calls(h).at(-1), failure('network_walking_busy'));
  const header = h.container.querySelector('header[aria-busy]');
  assert.ok(header); assert.match(header.textContent, /Today/); assert.doesNotMatch(header.textContent, /Tomorrow/);
});

for (const lang of ['en', 'sv']) for (const [reason, expected] of [
  ['network_walking_unavailable', { en: /could not verify the walking route/i, sv: /kunde inte verifiera gångvägen/i }],
  ['network_walking_invalid_configuration', { en: /configuration.*needs.*corrected/i, sv: /konfiguration.*behöver.*rättas/i }],
  ['network_walking_busy', { en: /walking service.*busy/i, sv: /gångvägstjänsten.*upptagen/i }],
]) test(`${lang} accurate ${reason} copy`, async t => {
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Example&lang=${lang}` });
  t.after(() => h.unmount()); await h.clock.advance(500);
  await h.fetchMock.respond(calls(h)[0], failure(reason));
  assert.match(h.text(), expected[lang]);
  if (reason.endsWith('invalid_configuration')) assert.doesNotMatch(h.text(), /Try .*again|Försök .*igen/);
});
