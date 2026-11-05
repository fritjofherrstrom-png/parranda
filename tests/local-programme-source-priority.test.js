"use strict";
const assert = require('node:assert/strict');
const test = require('node:test');
const { feedsFromScout } = require('../server/pulse-sources/request-time-event-discovery');
const { buildScopedEventSourcePlan, GLOBAL_FEED_DESCRIPTOR } = require('../server/place-candidates/agnostic-event-supply');
const reviewed = require('../config/reviewed-event-feeds.json')
  .filter(feed => ['simrishamn-municipal-calendar', 'visit-ystad-osterlen-calendar'].includes(feed.id));
const anchor = { lat: 55.4580331, lng: 14.1808853 };
function detected(id, adapter) {
  const url = `https://${id}.example/programme`;
  return {
    candidate: { id, url, adapter, source_identity: `${id}.example`, status: 'viable_provider_probe', maps_to_existing_provider: true, family: 'venue_calendar' },
    manifest: { id, endpoint: url, adapter, source_identity: `${id}.example`, bbox: [14.1, 55.4, 14.3, 55.5], label: id, review: { robots_status: 'allowed', terms_status: 'unknown' } },
  };
}

test('a dedicated factual programme reaches the one complementary slot without removing regional calendars or widening caps', () => {
  for (const candidates of [
    [detected('listing', 'events_calendar'), detected('dedicated', 'official_program_article')],
    [detected('dedicated', 'official_program_article'), detected('listing', 'events_calendar')],
  ]) {
    const feeds = feedsFromScout({ results: [{ candidates: candidates.map(item => item.candidate) }], manifest_candidates: candidates.map(item => item.manifest) }, { timezone: 'Europe/Stockholm' });
    assert.equal(feeds.length, 2, 'both interfaces must pass the unchanged binding/policy setup');
    assert.ok(feeds.every(feed => feed.status === 'probationary' && feed.pulse_only === true && feed.source_scoped_pulse === false && feed.confidence === 'low'));
    const plan = buildScopedEventSourcePlan({ anchor, now: '2026-10-28T10:00:00Z',
      registry: [...reviewed, ...feeds], maxSources: 4, maxLocalSources: 3,
      globalEnabled: true, globalSource: GLOBAL_FEED_DESCRIPTOR,
      complementarySourceIds: feeds.map(feed => feed.id) });
    assert.equal(plan.length, 4);
    assert.ok(reviewed.every(feed => plan.some(source => source.id === feed.id)), 'keep both regional calendars');
    assert.ok(plan.some(source => source.id === GLOBAL_FEED_DESCRIPTOR.id), 'keep the existing global slot');
    assert.ok(plan.some(source => source.id === 'dedicated'), 'an incidental listing interface must not crowd the dedicated programme out of the bounded complementary slot');
    assert.ok(!plan.some(source => source.id === 'listing'));
  }
});
