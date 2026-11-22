'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rome = require('../server/cities/rome');
const { buildCuratedCatalogPlaceCandidates } = require('../server/place-candidates/curated-catalog-provider');

// Real publisher data, not a generated map point. Eater's acquired primary
// __NEXT_DATA__ /props/pageProps/hydration/responses/3/data/node/mapPoints/10
// names Salumeria Roscioli at Via dei Giubbonari 21 with these coordinates.
// Acquisition hash/provenance is retained in the owned source-evidence receipt.
test('the catalog Roscioli point agrees with the source-owned physical venue before attaching articles', () => {
  const place = buildCuratedCatalogPlaceCandidates(rome).find(row => row.id === 'roscioli-salumeria');
  assert.ok(place, 'the existing real catalog venue is present');
  assert.deepEqual([place.lat, place.lng], [41.894501, 12.473962],
    'the article relation must not rubber-stamp the old, different catalog point');
});
