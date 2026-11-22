import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWalkingContinuation } from '../src/lib/walking-continuation.mjs';

const now = Date.UTC(2026, 10, 12, 12);
const stops = Array.from({ length: 9 }, (_, index) => ({
  id: `station-${index}`, label: `Station ${index + 1}`,
  lat: 50 + index * .001, lng: 10 + index * .01,
  ...(index === 6 ? { is_live_event: true } : {}),
}));
const fix = (index = 2, changes = {}) => ({ ...stops[index], accuracy: 10, timestamp: now, ...changes });
const build = changes => buildWalkingContinuation({ stops, position: fix(), enabled: true, now, ...changes });
const sequence = plan => plan.parts.flatMap((part, index) => {
  const url = new URL(part.url);
  const points = [url.searchParams.get('origin'), ...(url.searchParams.get('waypoints')?.split('|') ?? []), url.searchParams.get('destination')];
  assert.equal(url.searchParams.get('travelmode'), 'walking');
  assert.ok((url.searchParams.get('waypoints')?.split('|').length ?? 0) <= 3);
  return index ? points.slice(1) : points;
});
const key = point => `${point.lat},${point.lng}`;

// Preservation controls for the first mounted RED→GREEN slice. No new
// admission, source facts, navigation history or measured walking is inferred.
test('every later station including a woven event survives a mobile-safe split in order', () => {
  const plan = build();
  assert.equal(plan.fromIndex, 2);
  assert.equal(plan.fromStop.id, 'station-2');
  assert.equal(plan.parts.length, 2);
  assert.deepEqual(sequence(plan), stops.slice(2).map(key));
  assert.ok(sequence(plan).includes(key(stops[6])), 'woven event is not a discarded detour');
});

test('a published finish is retained, not replaced by current GPS', () => {
  const destination = { lat: 50.02, lng: 10.1, label: 'Published finish' };
  assert.deepEqual(sequence(build({ destination })), [...stops.slice(2).map(key), key(destination)]);
});

test('a nearby fix still routes through the current station itself', () => {
  const position = fix(2, { lat: stops[2].lat + .0001 });
  assert.deepEqual(sequence(build({ position })), [key(position), ...stops.slice(2).map(key)]);
});

test('the last station offers only a real distinct published finish', () => {
  assert.equal(build({ position: fix(8) }), null);
  const destination = { lat: 50.03, lng: 10.1 };
  assert.deepEqual(sequence(build({ position: fix(8), destination })), [key(stops[8]), key(destination)]);
});

for (const [name, changes] of [
  ['no explicit enablement', { enabled: false }],
  ['truthy enablement is not authorization', { enabled: 'true' }],
  ['first station already has the original whole-day action', { position: fix(0) }],
  ['missing position', { position: null }],
  ['old fix', { position: fix(2, { timestamp: now - 60001 }) }],
  ['future fix', { position: fix(2, { timestamp: now + 5001 }) }],
  ['coarse GPS', { position: fix(2, { accuracy: 121 }) }],
  ['missing accuracy', { position: fix(2, { accuracy: undefined }) }],
  ['negative accuracy', { position: fix(2, { accuracy: -1 }) }],
  ['invalid latitude', { position: fix(2, { lat: 91 }) }],
  ['invalid longitude', { position: fix(2, { lng: 181 }) }],
  ['unplaced published station', { stops: [...stops.slice(0, 5), { label: 'Not placed' }, ...stops.slice(6)] }],
  ['invalid published finish', { destination: { lat: 91, lng: 10 } }],
  ['missing clock', { now: NaN }],
  ['off route', { position: fix(2, { lat: 51, lng: 11 }) }],
  ['on a straight segment is not proof a station prefix may be cut', { position: fix(2, { lat: 50.0025, lng: 10.025 }) }],
  ['ambiguous nearby stations', { stops: stops.map((stop, index) => index === 3 ? { ...stop, lat: stops[2].lat, lng: stops[2].lng } : stop) }],
]) test(`${name} offers no inferred continuation`, () => assert.equal(build(changes), null));

test('the current position, source stations and finish are never mutated', () => {
  const destination = Object.freeze({ lat: 50.03, lng: 10.1 });
  const position = Object.freeze(fix());
  const input = Object.freeze(stops.map(stop => Object.freeze({ ...stop })));
  const before = JSON.stringify({ input, destination, position });
  assert.ok(build({ stops: input, destination, position }));
  assert.equal(JSON.stringify({ input, destination, position }), before);
});

test('a genuinely distinct nearby published finish is not erased by the station proximity zone', () => {
  const destination = { lat: stops[8].lat + .00001, lng: stops[8].lng, label: 'Nearby published finish' };
  const plan = build({ position: fix(8), destination });
  assert.ok(plan, 'a real nearby finish remains an available continuation');
  assert.deepEqual(sequence(plan), [key(stops[8]), key(destination)]);
});

for (const offset of [1, 5000]) test(`the existing ${offset}ms future-clock tolerance is preserved`, () => {
  assert.ok(build({ position: fix(2, { timestamp: now + offset }) }));
});
