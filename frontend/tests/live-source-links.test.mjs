import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

// Mounted Planner with controlled transport and fixture URLs. It proves how
// every Live surface renders the server's link classification
// (tests/live-event-source-link.test.js); it is not provider or Pi acceptance.
const FEED = 'Visit Example';
const COUNT_FIELDS = ['selected_source_count', 'responding_source_count',
  'event_bearing_source_count', 'empty_source_count', 'failed_source_count',
  'unavailable_source_count', 'raw_event_count', 'normalized_event_count',
  'accepted_event_count', 'surfaced_event_count', 'rejected_event_count'];

function liveEvent(id, title, sourceUrl, link) {
  return {
    id,
    title,
    timezone: 'Europe/Stockholm',
    starts_at: '2026-09-25T17:00:00Z',
    source_label: FEED,
    source_url: sourceUrl,
    ...(link ? { source_link_kind: link[0], source_link_host: link[1] } : {}),
  };
}
// A generic homepage, an ordinary deep link, an unusable URL the server could
// not describe, and a row saved before the classification existed.
const HOME = liveEvent('ev-home', 'Harbour jazz', 'https://museum.example.com/', ['site_home', 'museum.example.com']);
const PAGE = liveEvent('ev-page', 'Late concert', 'https://venue.example/events/late-concert', ['page', 'venue.example']);
const UNUSABLE = liveEvent('ev-relative', 'Relative link', '/events/relative', [null, null]);
const LEGACY = liveEvent('ev-legacy', 'Saved before classification', 'https://legacy.example/events/1', null);
const LOCALE_ROOT = liveEvent('ev-more', 'Gallery night', 'https://gallery.example/sv/', ['site_home', 'gallery.example']);

function liveEvents() {
  const emptyBucket = { ranked_event_count: 0, highlight_count: 0, more_count: 0, hidden_count: 0, more: [] };
  return {
    coverage: 'covered',
    feeds: [{ id: 'visit-example', label: FEED, license: 'CC-BY 4.0', status: 'ok' }],
    acquisition: { source_health: {
      ...Object.fromEntries(COUNT_FIELDS.map((field) => [field, 0])),
      status: 'healthy', result: 'events_found', reasons: [],
      selected_source_count: 1, responding_source_count: 1, event_bearing_source_count: 1, accepted_event_count: 5,
    } },
    tonight: [HOME, PAGE, UNUSABLE, LEGACY],
    this_week: [],
    browse: {
      contract: 'live_event_browse_v1',
      max_rows_per_bucket: 24,
      tonight: { ranked_event_count: 5, highlight_count: 4, more_count: 1, hidden_count: 0, more: [LOCALE_ROOT] },
      this_week: emptyBucket,
    },
  };
}

function composedDay() {
  return { days: [{ experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', title: 'Published day', main_stops: [
      { id: 'a', label: 'Museum', lat: 60.17, lng: 24.94 },
      { id: 'b', label: 'Cafe', lat: 60.172, lng: 24.942 },
      // The walking-validated evening event, as event-route-stop-weave emits it.
      { id: 'live-event-ev-woven', label: 'Quay festival', lat: 60.173, lng: 24.943, daypart: 'evening',
        is_live_event: true, event_id: 'ev-woven', starts_at: '2026-09-25T18:00:00Z', timezone: 'Europe/Helsinki',
        source: { kind: 'live_event_feed', label: FEED, url: 'https://quay-festival.example/',
          link_kind: 'site_home', link_host: 'quay-festival.example' } },
    ], estimated_km: 2, map_path_points: [], legs: [], confidence: 'low',
  }, alternatives: [] }], live_events: liveEvents(),
  agnostic_route_output_experiment: { promotion: { promote: true }, source_status: { anchor: { lat: 60.17, lng: 24.94 } } } };
}

async function composed(lang = 'en') {
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Testville&lang=${lang}` });
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], composedDay());
  await h.clock.advance(50);
  return h;
}
const button = (h, pattern) => [...h.container.querySelectorAll('button')].find((b) => pattern.test(b.textContent));
async function click(h, control) {
  assert.ok(control, 'control exists');
  await h.act(() => control.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}
const anchorsTo = (root, href) => [...root.querySelectorAll('a')].filter((a) => a.getAttribute('href') === href);
const linkText = (anchor) => anchor.textContent.replace(/\s*↗$/, '');
// The Live panel's own heading ("Live in Testville"), not the route's woven
// "Live in your route" block.
const livePanel = (h) => [...h.container.querySelectorAll('section')]
  .find((section) => /^Live (i|in) Testville/.test(section.querySelector('p')?.textContent || ''));
const occurrences = (text, pattern) => (text.match(pattern) || []).length;

function assertHonestRows(root, { homepage, page, lang = 'en' }) {
  const [home] = anchorsTo(root, HOME.source_url);
  assert.ok(home, 'the homepage row keeps its exact link');
  assert.equal(linkText(home), homepage);
  assert.equal(home.getAttribute('target'), '_blank');
  assert.match(home.getAttribute('rel') || '', /noopener/);
  const [deep] = anchorsTo(root, PAGE.source_url);
  assert.ok(deep, 'the deep link keeps its exact link');
  assert.equal(linkText(deep), page);
  // Nothing the server could not describe becomes a link, and no feed label is link text.
  assert.equal(anchorsTo(root, UNUSABLE.source_url).length, 0);
  assert.equal(anchorsTo(root, LEGACY.source_url).length, 0);
  for (const anchor of root.querySelectorAll('a')) {
    assert.ok(!anchor.textContent.includes(FEED), `feed label used as link text: ${anchor.textContent}`);
  }
  assert.ok(lang === 'en' || lang === 'sv');
}

test('Live panel and Live sheet say where each link leads; the feed stays attribution', async (t) => {
  const h = await composed('en');
  t.after(() => h.unmount());

  const panel = livePanel(h);
  assert.ok(panel, 'Live panel renders');
  assertHonestRows(panel, { homepage: 'Homepage: museum.example.com (not the event page)', page: 'venue.example' });
  // Each row still names the feed that listed it — as text, beside the link.
  assert.equal(occurrences(panel.textContent, /via\sVisit Example/g), 4);
  assert.match(panel.textContent, /Source: Visit Example · CC-BY 4\.0/);

  await click(h, button(h, /See all live/));
  const sheet = h.container.querySelector('[role="dialog"]');
  assert.ok(sheet, 'Live sheet opens');
  assertHonestRows(sheet, { homepage: 'Homepage: museum.example.com (not the event page)', page: 'venue.example' });
  const [more] = anchorsTo(sheet, LOCALE_ROOT.source_url);
  assert.ok(more, 'the "more" row keeps its exact link');
  assert.equal(linkText(more), 'Homepage: gallery.example (not the event page)');
  assert.match(sheet.textContent, /Source: Visit Example · CC-BY 4\.0/);
});

test('Swedish Live rows call a site root "Startsida … (inte evenemangssidan)"', async (t) => {
  const h = await composed('sv');
  t.after(() => h.unmount());

  const panel = livePanel(h);
  assert.ok(panel, 'Live panel renders');
  assertHonestRows(panel, { homepage: 'Startsida: museum.example.com (inte evenemangssidan)', page: 'venue.example', lang: 'sv' });
  assert.match(panel.textContent, /Källa: Visit Example · CC-BY 4\.0/);
});

test('the route-woven Live stop keeps "Source: feed" apart from where its link leads', async (t) => {
  const h = await composed('en');
  t.after(() => h.unmount());

  const heading = [...h.container.querySelectorAll('p')].find((p) => p.textContent.trim() === 'Live in your route');
  assert.ok(heading, 'the woven event renders as the route extension');
  const block = heading.parentElement;
  const [link] = anchorsTo(block, 'https://quay-festival.example/');
  assert.ok(link, 'the woven stop keeps its exact link');
  assert.equal(linkText(link), 'Homepage: quay-festival.example (not the event page)');
  assert.equal(link.parentElement.textContent.replace(/\s*↗$/, ''),
    'Source: Visit Example · Homepage: quay-festival.example (not the event page)');
  for (const anchor of block.querySelectorAll('a')) assert.ok(!anchor.textContent.includes(FEED));
});

test('a Blitz Live move names its destination instead of a generic "Source" link', async (t) => {
  const h = await composed('en');
  t.after(() => h.unmount());

  await click(h, button(h, /Adjust/));
  await click(h, button(h, /Blitz right now/));
  const call = h.fetchMock.pending().find((c) => c.url.includes('/api/blitz'));
  assert.ok(call, 'Blitz asks the trusted endpoint');
  await h.fetchMock.respond(call, {
    contract: 'anywhere_contextual_blitz_v1',
    status: 'available',
    best_move: {
      kind: 'live_event', event_id: 'live-home', title: 'Harbour concert', lat: 60.171, lng: 24.941,
      starts_at: '2026-09-25T17:00:00Z', timezone: 'Europe/Helsinki',
      source: { label: FEED, url: 'https://harbour.example/en/', type: 'official',
        link_kind: 'site_home', link_host: 'harbour.example' },
    },
    confidence: { level: 'medium' },
  });

  // The Blitz result panel, not the header button that triggers it.
  const section = [...h.container.querySelectorAll('section[aria-live="polite"]')]
    .find((s) => /Blitz right now/.test(s.textContent));
  assert.ok(section, 'the Blitz move renders');
  const [link] = anchorsTo(section, 'https://harbour.example/en/');
  assert.ok(link, 'the Live move keeps its exact link');
  assert.equal(linkText(link), 'Homepage: harbour.example (not the event page)');
  assert.ok(![...section.querySelectorAll('a')].some((a) => /^Source/.test(a.textContent)));
  assert.match(section.textContent, /Visit Example/, 'the listing feed stays visible as attribution');
});
