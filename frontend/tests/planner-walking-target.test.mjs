import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

// Component evidence with controlled responses, not live-provider acceptance.
// The fields are the server's published shapes: primary_route.walking_target_fit
// (stamped after the evening weave), live_event_stop, pulse_route_interrupt.
const stops = Array.from({ length: 4 }, (_, i) => ({
  id: `stop-${i}`, label: `Published stop ${i + 1}`, lat: 50 + i * .002, lng: 10,
  type: 'museum', provenance: { attribution: [{ provider_id: 'osm', label: 'OSM' }] },
}));

function composedDay({ estimatedKm, fit, extraStops = [], liveEventStop, interrupt } = {}) {
  const primaryRoute = {
    id: '__agnostic_compose__', title: 'Published day', main_stops: [...stops, ...extraStops],
    estimated_km: estimatedKm, map_path_points: [], legs: [], confidence: 'low',
    ...(fit ? { walking_target_fit: fit } : {}),
    ...(liveEventStop ? { live_event_stop: liveEventStop } : {}),
  };
  return {
    days: [{ experimental_agnostic_route_applied: true, primary_route: primaryRoute, alternatives: [] }],
    agnostic_route_output_experiment: { promotion: { promote: true } },
    ...(interrupt ? { pulse_route_interrupt: interrupt } : {}),
  };
}

const fit = (status, estimated_km, target_km = 6) => ({
  status, target_km, estimated_km, target_floor_km: target_km * .6, target_ceiling_km: target_km * 1.18,
});

async function showDay(t, body, lang = 'en') {
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Testville&lang=${lang}` });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], body);
  return h;
}

// The distance line and the sentence the day header prints beside it.
function header(h) {
  return h.container.querySelector('header')?.textContent || '';
}

test('a day longer than the chosen walk says so beside its distance', async t => {
  const h = await showDay(t, composedDay({ estimatedKm: 8.1, fit: fit('longer_than_requested_band', 8.1) }));
  assert.match(header(h), /≈ 8\.1 km on foot/);
  assert.match(header(h), /≈ 8\.1 km — longer than Balanced \(~6 km\)\./);
});

test('the same note reads in Swedish on a Swedish page', async t => {
  const h = await showDay(t, composedDay({ estimatedKm: 2.9, fit: fit('shorter_than_requested_band', 2.9) }), 'sv');
  assert.match(header(h), /≈ 2,9 km till fots/);
  assert.match(header(h), /≈ 2,9 km — kortare än Lagom \(~6 km\)\./);
});

test('a woven event is credited with exactly the distance it added', async t => {
  const woven = { id: 'live-event-ev', event_id: 'ev', is_live_event: true, label: 'Jazz by the quay', lat: 50.01, lng: 10, daypart: 'evening' };
  const h = await showDay(t, composedDay({
    estimatedKm: 10.1,
    fit: fit('longer_than_requested_band', 10.1),
    extraStops: [woven],
    liveEventStop: { event_id: 'ev', leg_km: 2.4, leg_minutes: 29, base_estimated_km: 7.7, removed_closing_leg_km: 0 },
  }), 'sv');
  assert.match(header(h), /4 stopp \+ 1 live-event/);
  assert.match(header(h), /≈ 10,1 km — längre än Lagom \(~6 km\); kvällens evenemang lägger till 2,4 km\./);
});

test('an evening event the route left out is explained with its measured cost', async t => {
  const h = await showDay(t, composedDay({
    estimatedKm: 6.3,
    fit: fit('within_requested_band', 6.3),
    interrupt: {
      contract: 'pulse_route_interrupt_v1', status: 'suggested', route_mutation: false,
      requires_user_action: true, reasons: ['exceeds_requested_walking_target'],
      event: { id: 'ev', title: 'Jazz by the quay' },
      walking_impact: { leg_km: 2.4, auto_weave_limit_km: 2.5, base_estimated_km: 6.3, removed_closing_leg_km: 1.4,
        estimated_km: 7.3, walking_target_km: 6, walking_target_status: 'longer_than_requested_band' },
    },
  }));
  const text = header(h);
  assert.doesNotMatch(text, /live event/, 'the event is not counted as part of the route');
  assert.doesNotMatch(text, /longer than Balanced \(~6 km\)\.$/m);
  assert.match(
    text,
    /The evening event isn't in the route: Jazz by the quay is 2\.4 km from the last stop and would make the day ≈ 7\.3 km, longer than Balanced \(~6 km\)\./,
  );
});

test('a day inside the chosen band gets no extra sentence', async t => {
  const h = await showDay(t, composedDay({ estimatedKm: 6.3, fit: fit('within_requested_band', 6.3) }));
  assert.match(header(h), /≈ 6\.3 km on foot/);
  assert.doesNotMatch(header(h), /longer than|shorter than|isn't in the route/);
});
