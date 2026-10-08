'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNominatimPlaceResolver } = require('../server/place-candidates/place-resolver');
const { resolveAgnosticIntake } = require('../server/planner/agnostic-place-intake');

const row = { osm_type: 'node', osm_id: 12345, lat: '51.5', lon: '2.32',
  category: 'place', type: 'village', addresstype: 'village',
  name: 'Fixture Harbour', display_name: 'Fixture Harbour, Fixture Country',
  address: { village: 'Fixture Harbour', country: 'Fixture Country', country_code: 'xx' },
};
function fixture(data) {
  const paths = [];
  const resolver = createNominatimPlaceResolver({ minIntervalMs: 0, sleep: async () => {},
    fetcher: async url => {
      paths.push(new URL(url).pathname);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => data };
    },
  });
  return { resolver, paths };
}

test('missing provider coordinates never become zero geography, cached absence, or a fallback search', async () => {
  const { resolver, paths } = fixture([{ ...row, lat: null, lon: null }]);
  assert.equal((await resolver.lookupRef('n12345')).status, 'unavailable');
  assert.equal((await resolver.lookupRef('n12345')).status, 'unavailable');
  assert.equal(paths.length, 2, 'invalid provider data must not be cached as a successful lookup');
  const result = await resolveAgnosticIntake({ placeRef: 'n12345', placeQuery: 'Fixture Harbour', placeResolver: resolver });
  assert.equal(result.anchor, null);
  assert.deepEqual(result.intake.blockers, ['place_ref_unavailable']);
  assert.deepEqual(paths, ['/lookup', '/lookup', '/lookup'], 'a malformed row never initiates /search');
});
