'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rome = require('../server/cities/rome');
const { buildCuratedCatalogPlaceCandidates } = require('../server/place-candidates/curated-catalog-provider');
const { candidateProvenance } = require('../server/candidates/candidate-pool');
const { budget } = require('../server/planner/published-day-fields');
const { publicVenueMentionUrls } = require('../server/place-candidates/venue-mentions');

function actualStop() {
  const place = buildCuratedCatalogPlaceCandidates(rome).find(row => row.id === 'roscioli-salumeria');
  return { id: place.id, label: place.label, lat: place.lat, lng: place.lng,
    provenance: candidateProvenance(place, {}) };
}
function project(stop) {
  // Real immutable source policy, not a Set populated from the claimed stop.
  return budget({ publicSourceUrls: publicVenueMentionUrls() }).copy('Stop', stop);
}

test('the closed public Stop projection retains the real reviewed article relations', () => {
  const stop = actualStop();
  const projected = project(stop);
  assert.ok(projected.provenance.venue_mentions?.length === 2,
    'reviewed article relations must survive the actual closed Stop projector');
  assert.deepEqual(projected.provenance.venue_mentions, stop.provenance.venue_mentions);
});

test('article destinations use only their field-specific independent policy, not the general source witness bag', () => {
  const stop = actualStop();
  const privacy = { publicSourceUrls: new Set() };
  const projected = budget(privacy).copy('Stop', stop);
  assert.deepEqual(projected.provenance.venue_mentions, stop.provenance.venue_mentions);
  assert.equal(privacy.publicSourceUrls.size, 0, 'article policy must not enlarge the retained source witness bag');
  const unrelated = actualStop();
  delete unrelated.provenance.venue_mentions;
  unrelated.website = stop.provenance.venue_mentions[0].article_url;
  assert.throws(() => budget(privacy).copy('Stop', unrelated), /unattested url/,
    'a reviewed article destination is not generic website/source authority');
});

for (const [name, mutate] of [
  ['changed title', stop => { stop.provenance.venue_mentions[0].article_title = 'Unreviewed praise'; }],
  ['recommended-by escalation', stop => { stop.provenance.venue_mentions[0].relation_kind = 'recommended'; }],
  ['invented publication date', stop => { stop.provenance.venue_mentions[0].published_on = '2026-11-06'; }],
  ['known URL on another venue', stop => { stop.label = 'Other branch'; stop.provenance.venue_mentions.forEach(row => { row.venue_binding.label = stop.label; }); }],
  ['an unaddressed different branch ID', stop => { stop.id = 'another-branch'; }],
  ['conflicting physical address', stop => { stop.address = 'A different street 21'; }],
  ['matching flat address masking a conflicting nested address', stop => { stop.address = 'Via dei Giubbonari 21'; stop.place_details = { address: 'A different street 21' }; }],
  ['copied body hash with a different article', stop => { stop.provenance.venue_mentions[0].article_url = 'https://www.eater.com/maps/a-different-article'; }],
  ['oversized list', stop => { stop.provenance.venue_mentions = Array.from({ length: 9 }, () => stop.provenance.venue_mentions[0]); }],
]) test(`the public projector refuses ${name}, even with the real publisher policy`, () => {
  const stop = actualStop(); mutate(stop);
  assert.throws(() => project(stop));
});

test('a legacy stop without references remains portable and has no synthetic credibility field', () => {
  const stop = actualStop(); delete stop.provenance.venue_mentions;
  const projected = project(stop);
  assert.equal(projected.provenance.venue_mentions, undefined);
  assert.equal(projected.id, stop.id);
});
