"use strict";
const assert = require('node:assert/strict');
const test = require('node:test');
const { inspectEventSourcePage } = require('../server/pulse-sources/local-event-source-scout');
const { createRssAtomEventProvider } = require('../server/pulse-sources/rss-atom-event-provider');
const { hasOfficialProgramArticleSignature } = require('../server/pulse-sources/official-program-article-provider');

const pageUrl = 'https://programme.example/';
const feedUrl = new URL('/feed.xml', pageUrl).href;
const detailUrl = new URL('/concert', pageUrl).href;
const html = '<html lang="en"><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body><section aria-label="Programme Lantern Harbour 2026"><h2>Harbour Town</h2><div><h3>Friday 30/10</h3><div><div><h4>Beacon Hall</h4><span>Quay Road 4</span></div><div><span>18–19</span><span>Music</span></div><div><span>20–21</span><span>Music</span></div></div></div></section></body></html>';
const inspect = body => inspectEventSourcePage({ seed: { url: pageUrl }, html: body, context: { place: { name: 'Harbour Town' }, anchor: { lat: 55.46, lng: 14.18 } } });

test('a usable RSS alternative keeps pure page event context beyond the separate programme adapter budget', async () => {
  const xml = `<rss version="2.0"><channel><item><link>${detailUrl}</link></item></channel></rss>`;
  const event = { '@context': 'https://schema.org', '@type': 'Event', name: 'Harbour concert', startDate: '2026-10-30T18:00:00+01:00', endDate: '2026-10-30T19:00:00+01:00', url: detailUrl, location: { name: 'Beacon Hall', geo: { latitude: 55.46, longitude: 14.18 } } };
  const calls = [];
  const provider = createRssAtomEventProvider({ endpoint: feedUrl, sourceLanguage: 'en', fetcher: async url => {
    assert.ok([feedUrl, detailUrl].includes(String(url)));
    calls.push(String(url));
    return new Response(String(url) === feedUrl ? xml : `<script type="application/ld+json">${JSON.stringify(event)}</script>`);
  } }).create();
  const collected = await provider.collect({ date: '2026-10-28' });
  assert.equal(collected.time_sensitive_events.length, 1, 'a real small RSS/detail collection is the positive precondition');
  assert.deepEqual(calls, [feedUrl, detailUrl]);
  assert.equal(inspect(html).rss_interface_decisions[0].decision, 'event_interface');
  const padded = html + ' '.repeat(1024 * 1024);
  assert.ok(Buffer.byteLength(padded, 'utf8') > 1024 * 1024 && Buffer.byteLength(padded, 'utf8') < 2 * 1024 * 1024);
  assert.equal(hasOfficialProgramArticleSignature(padded), false, 'the default programme collector still cannot read this page');
  const result = inspect(padded);
  assert.equal(result.rss_interface_decisions[0].decision, 'event_interface', 'padding cannot erase structural evidence for independently readable RSS');
  assert.ok(result.candidates.some(row => row.adapter === 'rss_atom_event_detail'));
  assert.ok(!result.candidates.some(row => row.adapter === 'official_program_article'), 'RSS context does not restore the incompatible programme interface');
});

test('padding and an RSS link without factual event context remain exploratory', () => {
  const unrelated = '<html lang="en"><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body><h1>Harbour news</h1><p>Ordinary local news and announcements.</p></body></html>';
  for (const body of [unrelated, unrelated + ' '.repeat(1024 * 1024)]) {
    const result = inspect(body);
    assert.equal(result.rss_interface_decisions[0].decision, 'exploratory');
    assert.ok(!result.candidates.some(row => row.adapter === 'rss_atom_event_detail'));
  }
});
