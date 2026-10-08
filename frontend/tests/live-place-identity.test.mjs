import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveEventQueryPayload } from '../src/lib/live-event-query.mjs';

const response = {
  live_events: { selected_date: '2026-10-08' },
  agnostic_route_output_experiment: {
    source_status: { anchor: { lat: 51.5, lng: 2.32 } },
    intake: { query: 'Fixture Harbour', resolved: {
      lat: 51.5, lng: 2.32, place_ref: 'r12345', selection_id: 'session-receipt',
    } },
  },
};

test('Live carries the published place identity for both place scopes without replacing anchor/date', () => {
  const before = structuredClone(response);
  for (const scope of ['around_place', 'in_place']) {
    const payload = buildLiveEventQueryPayload({ scope, response, preferences: ['culture'] });
    assert.equal(payload.place_ref, 'r12345');
    assert.equal(payload.place_selection, 'session-receipt');
    assert.equal(payload.place_query, 'Fixture Harbour');
    assert.equal(payload.selected_date, '2026-10-08');
    assert.deepEqual(payload.anchor, { lat: 51.5, lng: 2.32 });
    assert.equal('spatial_scope' in payload, false);
  }
  assert.deepEqual(response, before);
});

test('Live position/route scopes do not carry the place identity or receipt', () => {
  for (const scope of ['near_me', 'near_route']) {
    const payload = buildLiveEventQueryPayload({ scope, response,
      nearMeCoords: { lat: 10, lng: 20 },
      routeStops: [{ lat: 51.5, lng: 2.32 }, { lat: 51.501, lng: 2.32 }],
    });
    assert.ok(payload);
    assert.equal('place_ref' in payload, false);
    assert.equal('place_selection' in payload, false);
    assert.equal('place_query' in payload, false);
  }
});

test('Live does not publish a malformed server reference as a valid identity', () => {
  for (const ref of ['R12345', 'r0', 'r0123', 'r12345\n', 'r12345&lat=1', 'r1234567890123', 12345, null]) {
    const invalid = structuredClone(response);
    invalid.agnostic_route_output_experiment.intake.resolved.place_ref = ref;
    const payload = buildLiveEventQueryPayload({ scope: 'around_place', response: invalid });
    assert.equal('place_ref' in payload, false, String(ref));
    assert.equal(payload.place_selection, 'session-receipt');
  }
});
