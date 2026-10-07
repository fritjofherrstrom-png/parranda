const test = require('node:test');
const assert = require('node:assert/strict');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');
const { resolveAgnosticIntake } = require('../server/planner/agnostic-place-intake');

function area(name, city, lat, importance = 0.14, extras = {}) {
  return { name, display_name: `${name}, ${city}, Country`, lat: String(lat), lon: '2.32',
    osm_type: 'relation', osm_id: Math.round(lat * 10000), importance,
    type: 'administrative', addresstype: 'suburb', address: { city, country: 'Country', country_code: 'xx' },
    boundingbox: [lat - .01, lat + .01, 2.31, 2.33].map(String), ...extras };
}
const district = area('Harbour Quarter', 'Example City', 48.85);
const station = area('Harbour Quarter', 'Example City', 48.855, .41, {
  osm_type: 'node', osm_id: 10, display_name: 'Harbour Quarter station, Example City, Country',
  type: 'station', addresstype: 'railway' });
function resolver(rows, urls = []) {
  return createNominatimPlaceResolver({ minIntervalMs: 0, fetcher: async url => {
    urls.push(new URL(url)); return { ok: true, json: async () => rows };
  }});
}

test('qualified district stays the destination ahead of its higher-ranked station', async () => {
  const out = await resolver([station, district])('Harbour Quarter, Example City');
  assert.equal(out.find(x => x.confidence === 'medium').osm_ref, 'relation/488500');
});
test('a city qualifier without a comma still distinguishes a district from its station', async () => {
  const out = await resolver([station, district])('Harbour Quarter Example City');
  assert.equal(out.find(x => x.confidence === 'medium').osm_ref, 'relation/488500');
});
test('a shared full provider label retains source-backed geographic qualifiers', async () => {
  const shared = { ...district, display_name: 'Harbour Quarter, Example City, Mainland Country, 12345, Country' };
  const out = await resolver([station, shared])(shared.display_name);
  assert.equal(out.find(x => x.confidence === 'medium').osm_ref, 'relation/488500');
});
test('qualified venue resolution still works for event-location consumers', async () => {
  const venue = { ...station, name: 'Theatre Hall', display_name: 'Theatre Hall, Example City, Country', type: 'theatre', addresstype: 'amenity', importance: .41 };
  const out = await resolver([venue])('Theatre Hall, Example City');
  assert.equal(out[0].confidence, 'medium');
});
test('every administrative qualifier must match provider-owned address context', async () => {
  const out = await resolver([district])('Harbour Quarter, Other City');
  assert.ok(out.every(x => x.confidence === 'low'));
});
test('provider-owned local-language alias can identify a low-importance district', async () => {
  const out = await resolver([area('Old Harbour', 'Example City', 48.85, .14, { namedetails: { 'name:el': 'Παλαιό Λιμάνι' } })])('Παλαιό Λιμάνι');
  assert.equal(out[0].confidence, 'medium');
});
test('a consented proximity hint resolves one exact local match among distant namesakes', async () => {
  const out = await resolver([district, area('Harbour Quarter', 'Distant City', 51.5)])('Harbour Quarter', { near: { lat: 48.85, lng: 2.32 }, language: 'fr' });
  assert.deepEqual(out.map(x => x.confidence), ['medium', 'low']);
});
test('explicit geographic qualification wins over a proximity hint elsewhere', async () => {
  const remote = area('Harbour Quarter', 'Distant City', 51.5);
  const out = await resolver([district, remote])('Harbour Quarter, Distant City', { near: { lat: 48.85, lng: 2.32 } });
  assert.equal(out.find(x => x.confidence === 'medium').label, 'Harbour Quarter, Distant City, Country');
});
test('nearby competing exact districts remain ambiguous', async () => {
  const out = await resolver([district, area('Harbour Quarter', 'Neighbour City', 48.9)])('Harbour Quarter', { near: { lat: 48.85, lng: 2.32 } });
  assert.equal(out.filter(x => x.confidence === 'medium').length, 2);
});
test('language and bias are forwarded and isolate cached resolution decisions', async () => {
  const urls = []; const r = resolver([district, area('Harbour Quarter', 'Distant City', 51.5)], urls);
  const a = await r('Harbour Quarter', { near: { lat: 48.85, lng: 2.32 }, language: 'fr' });
  const b = await r('Harbour Quarter', { near: { lat: 51.5, lng: 2.32 }, language: 'sv' });
  assert.equal(a.find(x => x.confidence === 'medium').label, district.display_name);
  assert.equal(b.find(x => x.confidence === 'medium').label, 'Harbour Quarter, Distant City, Country');
  assert.equal(urls.length, 2);
  assert.equal(urls[0].searchParams.get('accept-language'), 'fr');
  assert.equal(urls[0].searchParams.get('namedetails'), '1');
  assert.ok(urls[0].searchParams.has('viewbox'));
  assert.equal(urls[0].searchParams.get('bounded'), null);
  assert.equal(urls[0].searchParams.get('q'), 'Harbour Quarter');
});
test('explicit GPS anchor never moves because of a typed query or hint', async () => {
  const out = await resolveAgnosticIntake({ coords: { lat: 10, lng: 20 }, placeQuery: 'Harbour Quarter', placeBias: { lat: 48.85, lng: 2.32 }, placeResolver: () => { throw Error('must not search'); } });
  assert.deepEqual(out.anchor, { lat: 10, lng: 20 });
});
test('source-owned street address can resolve a venue without the venue name in its query', async () => {
  const { resolveEventVenueGeometry } = require('../server/place-candidates/event-venue-resolution');
  const venue = { ...station, name: 'Theatre Hall', display_name: 'Theatre Hall, Example Street, Example City, Country', type: 'theatre', addresstype: 'amenity', address: { road: 'Example Street', house_number: '12', city: 'Example City', country: 'Country' } };
  const out = await resolveEventVenueGeometry([{ id: 'show', address: 'Example Street 12', city: 'Example City', country: 'Country' }], { anchor: { lat: 48.855, lng: 2.32 }, resolver: resolver([venue]) });
  assert.equal(out.summary.resolved_count, 1);
});
test('a station inside the district cannot deduplicate away the district identity', async () => {
 const inside={...station,lat:String(Number(district.lat)+.0005)};
 const out=await resolver([inside,district])('Harbour Quarter, Example City');
 assert.equal(out.find(x=>x.confidence==='medium').osm_ref,'relation/488500');
});
test('unrelated provider geography cannot bypass a qualified destination query', async () => {
 const out=await resolver([area('Provider District','Example City',48.85,.41)])('Nonexistent Quarter, Other City');
 assert.ok(out.every(x=>x.confidence==='low'));
});
test('venue-purpose caching cannot authorize the same unmatched typed-place query', async () => {
 const urls=[];const r=resolver([{...station,name:'Theatre Hall',type:'theatre',addresstype:'amenity'}],urls);
 const venue=await r('Example Street 12, Example City',{purpose:'event_venue'});
 const place=await r('Example Street 12, Example City');
 assert.equal(venue[0].confidence,'medium');assert.equal(place[0].confidence,'low');assert.equal(urls.length,2);
});
