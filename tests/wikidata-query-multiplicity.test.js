'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWikidataQuery } = require('../server/place-candidates/wikidata-source');

test('the bounded WDQS query removes identical projected solution rows before LIMIT', () => {
  // A real Paris response filled all 25 rows with the same entity/class/coords.
  // Mapper deduplication is too late to recover the unseen places. This is an
  // external query contract: deduplicate solution rows inside WDQS, retaining
  // the lifecycle verdict and the same query radius, single call and row cap.
  const query = buildWikidataQuery({ lat: 40, lng: 10, radiusKm: 1.5, limit: 25, labelLangs: ['en'] });
  assert.match(query, /^SELECT DISTINCT \?item \?itemLabel \?lat \?lng \?classRoot \?website \?ceased WHERE/);
  assert.match(query, /ORDER BY \?dist\s+LIMIT 25$/);
  assert.match(query, /wikibase:radius "1\.5"/);
  assert.match(query, /wikibase:BestRank/);
});
