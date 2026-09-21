import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

// Component evidence with controlled responses, not live-provider acceptance.
const stops = Array.from({ length: 6 }, (_, i) => ({
  id: `stop-${i}`, label: `Published stop ${i + 1}`, lat: 50 + i * .001, lng: 10,
  type: 'museum', provenance: { attribution: [{ provider_id: 'osm', label: 'OSM' }] },
}));
function response(points) {
  return {
    days: [{ experimental_agnostic_route_applied: true, primary_route: {
      id: '__agnostic_compose__', title: 'Published day', main_stops: points,
      estimated_km: 2, map_path_points: [], legs: [], confidence: 'low',
    }, alternatives: [] }],
    agnostic_route_output_experiment: { promotion: { promote: true } },
  };
}
const links = h => [...h.container.querySelectorAll('a[href*="google.com/maps/dir/"]')];

test('Planner presents consecutive parts and estimate copy, excluding display-only ideas', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const body = response(stops);
  body.place_structure = { provenance: 'agnostic_anchor', area_count: 1, areas: [], district_day: {
    areas: [{ stops: [{ id: 'idea', name: 'Display-only idea', lat: 50.002, lng: 10.001 }] }],
  } };
  await h.fetchMock.respond(h.fetchMock.pending()[0], body);
  const routeLinks = links(h);
  assert.equal(routeLinks.length, 2);
  assert.match(routeLinks[0].textContent, /Open part 1 of 2 in Maps/);
  assert.match(routeLinks[1].textContent, /Open part 2 of 2 in Maps/);
  const first = new URL(routeLinks[0].href).searchParams;
  const last = new URL(routeLinks[1].href).searchParams;
  assert.equal(first.get('origin'), '50,10');
  assert.equal(first.get('destination'), last.get('origin'));
  assert.equal(last.get('destination'), '50.005,10');
  assert.ok(routeLinks.every(link => !decodeURIComponent(link.href).includes('10.001')));
  assert.match(h.text(), /Distances and walking times are estimates/);
  assert.match(h.text(), /Open the parts in order/);
});

test('Planner keeps the explicit coordinate anchor at both ends of a multipart day', async t => {
  const h = await mountPlanner({
    url: 'http://localhost/anywhere?anchor=near&planner=open&lang=en',
    sessionStorage: { 'parranda:anchor:coords': { lat: 50.01, lng: 10.02 } },
  });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const call = h.fetchMock.pending()[0];
  assert.ok(call, 'coordinate entry composes');
  await h.fetchMock.respond(call, response(stops));
  const routeLinks = links(h);
  assert.equal(new URL(routeLinks[0].href).searchParams.get('origin'), '50.01,10.02');
  assert.equal(new URL(routeLinks.at(-1).href).searchParams.get('destination'), '50.01,10.02');
});

test('a short complete route retains one Maps action', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], response(stops.slice(0, 2)));
  assert.equal(links(h).length, 1);
  assert.match(links(h)[0].textContent, /Open route in Maps/);
  assert.doesNotMatch(h.text(), /Open the parts in order/);
});

test('incomplete route shows an explicit individual-place fallback', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], response([stops[0], { id: 'missing', label: 'Unplaced stop' }, stops[1]]));
  assert.equal(links(h).length, 0);
  assert.match(h.text(), /The whole route cannot be opened in Maps/);
});

test('published start and end accompany the exact stops instead of shortening the handoff', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const body = response(stops.slice(0, 4));
  body.days[0].primary_route.map_route_points = [
    { role: 'start', label: 'Published start', lat: 49.99, lng: 10 },
    ...stops.slice(0, 4),
    { role: 'end', label: 'Published end', lat: 50.02, lng: 10 },
  ];
  await h.fetchMock.respond(h.fetchMock.pending()[0], body);
  const routeLinks = links(h);
  assert.equal(new URL(routeLinks[0].href).searchParams.get('origin'), '49.99,10');
  assert.equal(new URL(routeLinks.at(-1).href).searchParams.get('destination'), '50.02,10');
  assert.match(h.text(), /Published start/);
  assert.match(h.text(), /Published end/);
});
