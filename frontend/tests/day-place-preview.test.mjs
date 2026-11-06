import test from 'node:test';
import assert from 'node:assert/strict';
const moduleUnderTest = () => import('../src/lib/day-place-preview.mjs');
const stops = [{ id: 'museum', label: 'Museum' }, { id: 'lunch', label: 'Lunch', type: 'restaurant' }];
const entry = { dateIso: '2026-10-16', inputs: { selected: ['culture'], walkKey: 'balanced' }, safeResponse: { days: [{ primary_route: { main_stops: stops } }] } };
test('preview builds exact chosen edit from frozen day, without source facts or input mutation', async () => {
  const { buildDayPlacePayload } = await moduleUnderTest();
  const commitments = { museum: { kind: 'pin', label: 'Museum' }, dismissed: { kind: 'exclude', label: 'No' } };
  const before = JSON.stringify({ entry, commitments });
  const result = buildDayPlacePayload({ anchor: { place: 'Fixture Town', placeRef: 'r123' }, entry, commitments,
    candidate: { id: 'chosen', label: 'Chosen' } });
  assert.equal(result.edit.action, 'add');
  assert.deepEqual(result.edit.retained_candidate_ids, ['museum', 'lunch']);
  assert.deepEqual(result.payload.pinned_candidate_ids.sort(), ['chosen', 'museum']);
  assert.deepEqual(result.payload.preferences, ['culture']);
  assert.deepEqual(result.payload.dates, ['2026-10-16']);
  assert.ok(!result.payload.excluded_candidate_ids.includes('chosen'));
  assert.equal(JSON.stringify({ entry, commitments }), before);
  const replacement = buildDayPlacePayload({ anchor: { place: 'Fixture Town' }, entry, commitments, candidate: { id: 'chosen', label: 'Chosen' }, replaceId: 'lunch' });
  assert.equal(replacement.edit.replacement_candidate_id, 'chosen');
  assert.deepEqual(replacement.edit.retained_candidate_ids, ['museum']);
  assert.ok(replacement.payload.excluded_candidate_ids.includes('lunch'));
  assert.throws(() => buildDayPlacePayload({ anchor: { place: 'Town' }, entry, commitments, candidate: { id: 'chosen' }, replaceId: 'museum' }));
});
test('preview transport uses lifecycle and strips capabilities before returning an answer', async () => {
  const { requestDayPlace } = await moduleUnderTest();
  const controller = new AbortController();
  let call;
  const result = await requestDayPlace({ payload: { place: 'Town' }, lang: 'en', signal: controller.signal,
    fetcher: async (url, init) => { call = { url, init }; return { ok: true, status: 200, json: async () => ({ days: [], live_completion: { token: 'secret' } }) }; } });
  assert.match(call.url, /include_day_snapshot=1/);
  assert.equal(call.init.headers.Prefer, 'respond-async');
  assert.equal(result.body.live_completion, undefined);
});
