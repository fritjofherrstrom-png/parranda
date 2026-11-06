'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rome = require('../server/cities/rome');
const { buildCuratedCatalogPlaceCandidates } = require('../server/place-candidates/curated-catalog-provider');
const { candidateProvenance } = require('../server/candidates/candidate-pool');

function realPlace() {
  return buildCuratedCatalogPlaceCandidates(rome).find(row => row.id === 'roscioli-salumeria');
}

test('the actual candidate provenance carries the two reviewed articles for the exact real venue', () => {
  const candidate = realPlace();
  assert.ok(candidate);
  const provenance = candidateProvenance(candidate, {});
  assert.ok(Array.isArray(provenance.venue_mentions) && provenance.venue_mentions.length === 2,
    'reviewed article relations must reach the actual provenance producer');
  assert.deepEqual(provenance.venue_mentions.map(row => row.publisher), ['Eater', 'Condé Nast Traveller']);
  assert.deepEqual(provenance.venue_mentions.map(row => row.article_url), [
    'https://www.eater.com/maps/best-restaurants-rome-italy',
    'https://www.cntraveller.com/gallery/best-restaurants-in-rome',
  ]);
  assert.ok(provenance.venue_mentions.every(row => row.relation_kind === 'listed'));
  assert.ok(provenance.venue_mentions.every(row => row.sponsorship === 'unknown' && row.independence === 'unknown'));
  assert.ok(provenance.venue_mentions.every(row => row.venue_binding.label === candidate.label && row.venue_binding.lat === candidate.lat && row.venue_binding.lng === candidate.lng));
  assert.equal(candidate.trust.source_tier, 'curated', 'the presentation relation does not change source trust');
});

const { readVenueMentions } = require('../shared/venue-mentions.mjs');
const { venueMentionsMatchPlace, publicVenueMentionUrls } = require('../server/place-candidates/venue-mentions');

test('sparse relation arrays are not a valid bounded display value', () => {
  assert.deepEqual(readVenueMentions(new Array(1), realPlace()), [], 'sparse metadata must be refused, not treated as a valid article slot');
});

test('a review timestamp must represent the actual calendar date, not Date.parse normalization', () => {
  const place = realPlace();
  const rows = candidateProvenance(place, {}).venue_mentions;
  rows[0].verified_at = '2026-02-30T10:00:00.000Z';
  assert.equal(readVenueMentions(rows, place).length, 0, 'an impossible review date must not normalize into a fabricated verification day');
});

for (const [name, change] of [
  ['unreviewed magazine flag', place => ({ ...place, id: 'lullaby-vintage', city: 'barcelona', label: 'Lullaby Vintage', human_verified: true, operator_reviewed_source: true, venue_mentions: [{ publisher: 'Invented publisher', verified: true }] })],
  ['different branch street', place => ({ ...place, source_address: { street: 'A different street', house_number: '21' } })],
  ['conflicting published address', place => ({ ...place, address: 'A different street 21' })],
  ['conflicting nested address', place => ({ ...place, place_details: { address: 'A different street 21' } })],
  ['matching flat address masking a conflicting nested address', place => ({ ...place, address: 'Via dei Giubbonari 21', place_details: { address: 'A different street 21' } })],
  ['different house number', place => ({ ...place, source_address: { street: 'Via dei Giubbonari', house_number: '22' } })],
  ['array-valued house number', place => ({ ...place, source_address: { street: 'Via dei Giubbonari', house_number: [21] } })],
  ['different physical point', place => ({ ...place, lat: 41.8957, lng: 12.4729 })],
  ['unaddressed external namesake', place => ({ ...place, id: 'external:1', source: { kind: 'open_geo_source', id: 'forged-label' } })],
  ['structural item', place => ({ ...place, is_structural: true })],
]) test(`${name} cannot produce reviewed article relations`, () => {
  assert.equal(candidateProvenance(change(realPlace()), {}).venue_mentions, undefined);
});

test('an independently addressed external record can match the same reviewed physical venue without a city branch', () => {
  const place = { ...realPlace(), id: 'external:1', city: 'any-place', source: { kind: 'open_geo_source' },
    source_address: { street: 'Via dei Giubbonari', house_number: '21' } };
  assert.equal(candidateProvenance(place, {}).venue_mentions.length, 2);
});

for (const [name, addresses] of [
  ['flat', { address: 'Via dei Giubbonari 21' }],
  ['nested', { place_details: { address: 'Via dei Giubbonari 21' } }],
  ['both', { address: 'Via dei Giubbonari 21', place_details: { address: 'Via dei Giubbonari 21' } }],
]) test(`matching ${name} display addresses preserve the reviewed relations`, () => {
  const place = { ...realPlace(), ...addresses };
  const rows = candidateProvenance(place, {}).venue_mentions;
  assert.equal(rows.length, 2);
  assert.equal(venueMentionsMatchPlace(place, rows), true);
});

test('copied public mention claims do not add or alter reviewed source facts', () => {
  const place = realPlace();
  const baseline = candidateProvenance(place, {}).venue_mentions;
  const claimed = { ...place, venue_mentions: [{ publisher: 'Invented publisher', verified: true }],
    provenance: { venue_mentions: [{ article_url: 'https://attacker.example/claim' }] } };
  assert.deepEqual(candidateProvenance(claimed, {}).venue_mentions, baseline);
});

test('JSON transport is revalidated without renewing review dates or changing the real relations', () => {
  const place = realPlace();
  const original = candidateProvenance(place, {}).venue_mentions;
  const copied = JSON.parse(JSON.stringify(original));
  assert.equal(venueMentionsMatchPlace(place, copied), true);
  assert.deepEqual(copied, original);
  for (const [key, value] of [
    ['publisher', 'Invented publisher'], ['article_title', 'Unattested title'],
    ['article_url', 'https://www.eater.com/maps/a-different-article'], ['relation_kind', 'recommended'],
    ['published_on', '2026-11-06'], ['venue_id', 'venue:another-branch'],
  ]) {
    const changed = structuredClone(copied); changed[0][key] = value;
    assert.equal(venueMentionsMatchPlace(place, changed), false, key);
  }
  const moved = { ...place, label: 'Another physical venue' };
  assert.equal(venueMentionsMatchPlace(moved, copied), false);
});

test('actual unreviewed catalog provenance is not upgraded to an article relation', () => {
  const barcelona = require('../server/cities/barcelona');
  const place = buildCuratedCatalogPlaceCandidates(barcelona).find(row => row.id === 'lullaby-vintage');
  assert.ok(place);
  assert.equal(candidateProvenance(place, {}).venue_mentions, undefined);
});

test('the bounded display contract keeps two articles from one publisher instead of collapsing to provider attribution', () => {
  // Controlled display-shape variant, not a new approved publisher relation.
  const place = realPlace();
  const rows = candidateProvenance(place, {}).venue_mentions;
  rows[1].publisher_id = rows[0].publisher_id;
  rows[1].publisher = rows[0].publisher;
  assert.equal(readVenueMentions(rows, place).length, 2);
  assert.equal(venueMentionsMatchPlace(place, rows), false, 'display compatibility is not server source certification');
});

test('the article destination policy is independent and cannot be mutated through a returned Set', () => {
  const first = publicVenueMentionUrls();
  first.add('https://attacker.example/claim');
  assert.equal(publicVenueMentionUrls().has('https://attacker.example/claim'), false);
  assert.equal(publicVenueMentionUrls().size, 2);
});
