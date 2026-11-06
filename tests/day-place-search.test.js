'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const search = args => require('../server/planner/day-place-search').searchDayPlaces(args);
const place = (id, extra = {}) => ({ id, label: 'River Kitchen', type: 'restaurant', candidate_kind: 'real_place',
  lat: 55.6, lng: 13, search_facets: { cuisines: ['indian'] },
  source: { url: 'https://www.openstreetmap.org/node/1' }, ...extra });
const run = (query, candidates = [place('a')], extra = {}) => search({ query, candidates, eligibleIds: new Set(candidates.map(x => x.id)), ...extra });
test('names and source addresses match; supported cuisine/category aliases use factual types', () => {
  assert.equal(run('river').items[0].id, 'a');
  assert.equal(run('INDISKT').items[0].match_kind, 'cuisine');
  assert.equal(run('indian restaurant').items[0].match_kind, 'cuisine');
  assert.equal(run('Indian food').items[0].match_kind, 'cuisine');
  assert.equal(run('restaurang').items[0].match_kind, 'category');
  assert.equal(run('park', [place('p', { type: 'park', search_facets: undefined })]).items[0].id, 'p');
  assert.equal(run('Strandgatan', [place('a', { place_details: { kind: 'restaurant', address: 'Strandgatan 2' } })]).items[0].match_kind, 'address');
  assert.deepEqual(run('indiskt', [place('name', { label: 'Indiskt Indian Kitchen', search_facets: undefined })]).items, []);
  assert.deepEqual(run('absent').items, []);
});
test('search removes duplicates, visible, dismissed, closed and ineligible identities and caps output', () => {
  const candidates = Array.from({ length: 15 }, (_, i) => place(String(i)));
  candidates.push(place('0'), place('closed', { opening_hours: 'Mo-Su off' }));
  const result = run('indiskt', candidates, { visibleIds: ['0'], excludedIds: ['1'], eligibleIds: new Set(candidates.map(x => x.id).filter(id => id !== '2' && id !== 'closed')) });
  assert.equal(result.items.length, 6);
  assert.ok(result.items.every(x => !['0', '1', '2', 'closed'].includes(x.id)));
  assert.equal(new Set(result.items.map(x => x.id)).size, 6);
});
test('safe projection does not export private/raw source fields or fabricate hours', () => {
  const result = run('indiskt', [place('a', { secret: 'private', opening_hours: 'unknown', source: { url: 'javascript:bad' } })]);
  assert.equal(result.coverage, 'available_supply');
  assert.equal(result.items[0].hours_status, 'unknown');
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['hours_status', 'id', 'label', 'match_kind', 'type']);
});
test('shared intent bounds and rejects extra public evidence fields', () => {
  const { normalizeDayPlaceSearch } = require('../shared/day-place-search.mjs');
  assert.deepEqual(normalizeDayPlaceSearch({ query: '  indiskt  ' }), { query: 'indiskt' });
  for (const value of [null, [], 'indiskt', { query: 'a'.repeat(81) }, { query: '  ' }, { query: 'a', lat: 1 }, { query: 'a\u0000b' }]) assert.equal(normalizeDayPlaceSearch(value), null);
});
