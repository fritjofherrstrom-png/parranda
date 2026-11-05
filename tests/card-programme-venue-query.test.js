"use strict";
const assert = require('node:assert/strict');
const test = require('node:test');
const { extractOfficialProgramArticle } = require('../server/pulse-sources/official-program-article-normalizer');
const { normalizeTimeSensitiveSourceEvent } = require('../server/pulse-sources/time-sensitive-event');
const { resolveEventVenueGeometry, buildEventVenueQueries } = require('../server/place-candidates/event-venue-resolution');
const html = '<section aria-label="Programme Lantern Harbour 2026"><h2>Harbour Town</h2><div><h3>Friday 30/10</h3><div><div><h4>Beacon Hall</h4><span>Quay Road 4</span></div><div><span>18–19</span><span>Music</span></div><div><span>20–21</span><span>Music</span></div></div></div></section>';
function normalized() {
  const parsed = extractOfficialProgramArticle(html, { sourceUrl: 'https://programme.example/programme', sourceLanguage: 'en', timezone: 'Europe/Stockholm', referenceDate: '2026-10-28' });
  assert.equal(parsed.events.length, 2);
  return parsed.events.map(row => normalizeTimeSensitiveSourceEvent(row, { now: new Date('2026-10-28T10:00:00Z') }));
}
test('separately stated card address and locality survive the real source-event normalizer', () => {
  for (const row of normalized()) {
    assert.equal(row.address, 'Quay Road 4');
    assert.equal(row.city, 'Harbour Town');
    assert.equal(row.place_context, 'Beacon Hall, Quay Road 4, Harbour Town');
    assert.ok(row.lat == null && row.lng == null, 'source components never invent coordinates');
  }
});

test('the literal separately-addressed venue name reaches unchanged strict geometry gates within one call', async () => {
  for (const candidate of [
    { label: 'Beacon Hall', lat: 55.4581, lng: 14.181, confidence: 'low' },
    { label: 'Beacon Hall Annex', lat: 55.4581, lng: 14.181, confidence: 'low' },
    { label: 'Beacon Hall', lat: 59.3, lng: 18.1, confidence: 'strong' },
  ]) {
    const queries = [];
    const result = await resolveEventVenueGeometry(normalized(), {
      anchor: { lat: 55.458, lng: 14.181 }, radiusM: 3000, limit: 1,
      placeContext: { locality: 'Harbour Town' },
      resolver: async query => { queries.push(query); return query === 'Beacon Hall, Harbour Town' ? [candidate] : []; },
    });
    assert.deepEqual(queries, ['Beacon Hall, Harbour Town']);
    assert.equal(result.summary.attempted_count, 1);
    const accepted = candidate.label === 'Beacon Hall' && candidate.lat < 56;
    assert.equal(result.summary.resolved_count, accepted ? 2 : 0);
  }
});

test('a composite display string alone or a partial address match cannot mint a short venue query', () => {
  for (const event of [
    { place_context: 'Beacon Hall, Quay Road 4, Harbour Town', city: 'Harbour Town' },
    { place_context: 'Beacon Hall, Quay Road 44, Harbour Town', city: 'Harbour Town', address: 'Quay Road 4' },
  ]) assert.ok(!buildEventVenueQueries(event).includes('Beacon Hall, Harbour Town'));
});
