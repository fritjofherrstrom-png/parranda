import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';
import { LAST_KEY } from '../src/lib/anywhere-storage.mjs';

// Real mounted Planner/card/sheet, controlled transport. These source-shaped
// examples reproduce the reported clutter; they do not establish live coverage.
const FEED = 'Simrishamns kommuns evenemangskalender';
const PERIOD_NOTE = {
  en: 'Check current days and times with the organiser.',
  sv: 'Se aktuella dagar och tider hos arrangören.',
};
const source = { source_label: FEED, source_url: 'https://venue.example/events/autumn',
  source_link_kind: 'page', source_link_host: 'venue.example' };
const period = (id, title, place, extra = {}) => ({
  id, title, place, timezone: 'Europe/Stockholm', ...source,
  geographic_relevance: 'source_scope', source_scope_verified: true,
  time_window: { kind: 'period', starts_on: '2026-10-01', ends_on: '2026-10-31',
    local_start: '09:30', local_end: '15:30' }, ...extra,
});
const reportedRows = [
  period('rosenborg', 'Mötesplats Rosenborg Oktober', 'Stibyvägen 10, Gärsnäs'),
  period('musteri', 'Höstlov på Kiviks Musteri', 'Kiviks Musteri; tel: 0414-719 00, Epost: info@kiviksmusteri.se', {
    sources: [{ attribution: '© Source owner — CC BY 4.0' }],
  }),
  period('sumo', 'SUMO Robot – bygg och tävla', 'Telefonplan, Telefonvägen 30'),
  period('wine', 'Vinprovning under Österlen lyser', 'Sandhammarens vin, Sandhammarvägen 253, 271 77 Löderup'),
];
const health = { status: 'healthy', result: 'events_found', reasons: [], selected_source_count: 1,
  responding_source_count: 1, event_bearing_source_count: 1, accepted_event_count: 4 };
const live = rows => ({ coverage: 'covered', selected_date: '2026-10-27', tonight: rows, this_week: rows,
  acquisition: { source_health: health }, feeds: [{ label: FEED, license: 'CC BY 4.0' }],
  browse: { tonight: { more: [] }, this_week: { more: [] } } });
const day = events => ({ days: [{ date: '2026-10-27', experimental_agnostic_route_applied: true,
  primary_route: { id: '__agnostic_compose__', title: 'Published day', estimated_km: 1,
    main_stops: [{ id: 'a', label: 'Museum', lat: 55.45, lng: 14.18 },
      { id: 'b', label: 'Cafe', lat: 55.451, lng: 14.181 }], legs: [], map_path_points: [] }, alternatives: [] }],
  live_events: events, agnostic_route_output_experiment: { promotion: { promote: true },
    intake: { query: 'Testville' }, source_status: { anchor: { lat: 55.45, lng: 14.18 } } } });
const button = (h, pattern) => [...h.container.querySelectorAll('button')].find(b => pattern.test(b.textContent));
async function click(h, pattern) {
  const control = button(h, pattern); assert.ok(control, `control ${pattern}`);
  await h.act(() => control.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}
async function composed(t, lang, rows = reportedRows) {
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Testville&lang=${lang}` });
  t.after(() => h.unmount()); await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day(live(rows))); await h.clock.advance(50);
  return h;
}
const card = h => [...h.container.querySelectorAll('section')]
  .find(section => /^Live (i|in) Testville/.test(section.querySelector('h2')?.textContent || ''));
const paragraphs = root => [...root.querySelectorAll('p')];
const exactParagraph = (root, text) => paragraphs(root).find(p => p.textContent.trim() === text);
function eventRow(root, title) {
  const heading = [...root.querySelectorAll('h3,h4,h5')].find(h => h.textContent === title);
  assert.ok(heading, `event title is a scannable heading: ${title}`);
  return heading.closest('li');
}

// Regressions caught: flattening title/place/provenance together; attaching the
// period uncertainty to an uppercase time heading; hiding mandatory credits;
// labelling a destination with an unrelated feed; mutating canonical place data.
for (const lang of ['en', 'sv']) test(`${lang} card and sheet separate title, period, place and honest sources`, async t => {
  const original = JSON.stringify(reportedRows);
  const h = await composed(t, lang);
  const saved = h.readStorage(LAST_KEY);
  const check = root => {
    const row = eventRow(root, reportedRows[0].title);
    const timing = paragraphs(row).find(p => p.textContent.includes('09:30–15:30'));
    assert.ok(timing, 'clock is its own readable line');
    assert.match(timing.textContent, lang === 'en' ? /Thu 1 Oct – Sat 31 Oct/ : /tors 1 okt\. – lör 31 okt\./);
    assert.doesNotMatch(timing.textContent, /days per source|dagar enligt källan|daily|dagligen/);
    assert.ok(exactParagraph(row, PERIOD_NOTE[lang]), 'period uncertainty is a separate, visible sentence');
    assert.ok(exactParagraph(row, 'Stibyvägen 10, Gärsnäs'), 'the address has its own line');
    assert.equal(row.querySelector('h3,h4,h5').textContent, reportedRows[0].title, 'source title remains unchanged');
    const link = row.querySelector(`p a[href="${source.source_url}"]`);
    assert.ok(link); assert.equal(link.textContent.replace(/\s*↗$/, ''), 'venue.example');
    const details = [...row.querySelectorAll('details')].find(d => /Source details|Källinformation/.test(d.querySelector('summary')?.textContent));
    assert.ok(details, 'long feed attribution has an explicitly named disclosure');
    assert.match(details.textContent, /via\sSimrishamns kommuns evenemangskalender/);
    assert.equal(link.closest('details'), null, 'destination remains available without expanding attribution');
    assert.ok(exactParagraph(row, lang === 'en' ? 'Approximate location' : 'Ungefärlig plats'));
    const musteri = eventRow(root, reportedRows[1].title);
    assert.ok(exactParagraph(musteri, 'Kiviks Musteri'), 'contact suffix is omitted from the place display');
    assert.doesNotMatch(musteri.textContent, /0414-719|info@kiviksmusteri/);
    const credit = exactParagraph(musteri, '© Source owner — CC BY 4.0');
    assert.ok(credit); assert.equal(credit.closest('details'), null, 'required credit stays visible');
    assert.ok(exactParagraph(eventRow(root, reportedRows[2].title), 'Telefonplan, Telefonvägen 30'), 'venue words are never treated as contacts');
    assert.ok(exactParagraph(eventRow(root, reportedRows[3].title), reportedRows[3].place), 'ordinary address commas stay intact');
  };
  check(card(h));
  await click(h, /See all live|Se allt live/);
  check(h.container.querySelector('[role="dialog"]'));
  assert.deepEqual(h.readStorage(LAST_KEY), saved, 'browsing does not rewrite the day or canonical facts');
  assert.equal(JSON.stringify(reportedRows), original);
});

for (const lang of ['en', 'sv']) test(`${lang} contact cleanup keeps addresses after interior phone and email fields`, async t => {
  const rows = [
    period('interior-phone', 'Musteri programme', 'Kiviks Musteri; tel: 0414-719 00; Kiviks Stora Väg 7, Kivik'),
    period('interior-email', 'Community programme', 'Bygdegården; info@bygdegarden.example; Stibyvägen 10, Gärsnäs; ingång från gården'),
  ];
  const original = JSON.stringify(rows);
  const h = await composed(t, lang, rows);
  const check = root => {
    for (const row of rows) {
      assert.ok(exactParagraph(eventRow(root, row.title), row.place), 'an interior contact cannot hide the following address or entrance');
    }
  };
  check(card(h));
  await click(h, /See all live|Se allt live/);
  check(h.container.querySelector('[role="dialog"]'));
  assert.equal(JSON.stringify(rows), original, 'canonical source places stay unchanged');
});

// Regressions caught: treating daily/explicit dates as uncertain periods and
// claiming programme span is an event recurrence, plus invented unknown clocks.
for (const lang of ['en', 'sv']) test(`${lang} readable timing keeps daily, occurrence, programme and unknown-time meanings`, async t => {
  const rows = [
    { id: 'daily', title: 'Explicit daily opening', ...source, time_window: { kind: 'daily', local_start: '11:00', local_end: '17:00' } },
    { id: 'listed', title: 'Bénka-dí Pingis', ...source, time_window: { kind: 'occurrences', dates: ['2026-10-29'], local_start: '18:00', local_end: '20:00' },
      recurrence: { occurrence_status: 'unconfirmed' } },
    { id: 'programme', title: 'Barndomens allé', ...source, starts_at: '2026-10-30T19:00:00Z', timezone: 'Europe/Stockholm',
      programme: { title: 'Österlen lyser', source_url: source.source_url, starts_on: '2026-10-29', ends_on: '2026-11-01' } },
    { id: 'unknown', title: 'Source event without stated time', ...source },
  ];
  const h = await composed(t, lang, rows);
  const check = root => {
    const daily = eventRow(root, rows[0].title);
    assert.ok(exactParagraph(daily, lang === 'en' ? 'daily 11:00–17:00' : 'dagligen 11:00–17:00'));
    const listed = eventRow(root, rows[1].title);
    assert.ok(exactParagraph(listed, lang === 'en' ? 'Thu 29 Oct 18:00–20:00' : 'tors 29 okt. 18:00–20:00'));
    assert.match(listed.textContent, lang === 'en' ? /Recurring schedule — occurrence unconfirmed/ : /Återkommande schema — tillfället är inte bekräftat/);
    const programme = eventRow(root, rows[2].title);
    assert.match(programme.textContent, /Österlen lyser/);
    assert.match(programme.textContent, /29 (Oct|okt\.)/); assert.match(programme.textContent, /1 nov/i);
    assert.doesNotMatch(programme.textContent, /days per source|dagar enligt källan|Check current days|Se aktuella dagar/);
    const unknown = eventRow(root, rows[3].title);
    assert.doesNotMatch(unknown.textContent, /\d{2}:\d{2}|daily|dagligen|Check current days|Se aktuella dagar/);
    assert.doesNotMatch(root.textContent, /days per source|dagar enligt källan/);
  };
  check(card(h));
  await click(h, /See all live|Se allt live/);
  check(h.container.querySelector('[role="dialog"]'));
});

for (const lang of ['en', 'sv']) test(`${lang} occurrence disclosure also preserves a period's separate uncertainty`, async t => {
  const slot = period('period-slot', 'Programme session', 'Source venue');
  const h = await mountPlanner({ entry: 'components/planner/EventOccurrences.tsx', props: {
    event: { title: 'Programme', occurrences: [slot, { ...slot, id: 'other-slot' }] }, lang,
    selectedDate: '2026-10-27', now: new Date('2026-10-27T08:00:00Z'),
  } });
  t.after(() => h.unmount());
  assert.equal(h.container.querySelectorAll('li').length, 2, 'both original source slots remain reachable');
  for (const row of h.container.querySelectorAll('li')) {
    assert.ok(exactParagraph(row, PERIOD_NOTE[lang]));
    assert.ok(paragraphs(row).some(p => p.textContent.includes('09:30–15:30') && !p.textContent.includes(PERIOD_NOTE[lang])));
  }
});

// Defensive rendering controls for the other eventTiming consumers. These
// mount only the presentation boundary; they do not promote a period into a
// route-eligible occurrence or demonstrate server eligibility.
for (const lang of ['en', 'sv']) test(`${lang} Blitz keeps a period notice outside its metadata line`, async t => {
  const h = await mountPlanner({ entry: 'components/planner/BlitzCard.tsx', props: {
    lang, t: (sv, en) => lang === 'en' ? en : sv, mode: 'typed', anchorLabel: 'Testville',
    dayOnScreen: true, blitz: () => {}, blitzPhase: 'done', sharePositionForBlitz: () => {},
    blitzPositionFailed: false, typedPlaceLabel: 'Testville',
    blitzResult: { state: 'available', best: { ...reportedRows[0], kind: 'live_event',
      source: { label: FEED, url: source.source_url, link_kind: 'page', link_host: 'venue.example' } } },
  } });
  t.after(() => h.unmount());
  assert.ok(exactParagraph(h.container, PERIOD_NOTE[lang]));
  assert.ok(paragraphs(h.container).some(p => p.textContent.includes('09:30–15:30') && !p.textContent.includes(PERIOD_NOTE[lang])));
});

for (const lang of ['en', 'sv']) test(`${lang} route event timing keeps the same separate period notice`, async t => {
  const stop = { ...reportedRows[0], label: reportedRows[0].title, starts_at: '2026-10-01T07:30:00Z',
    is_live_event: true, event_id: 'defensive-render-only',
    source: { label: FEED, url: source.source_url, link_kind: 'page', link_host: 'venue.example' } };
  const h = await mountPlanner({ entry: 'components/planner/StopLine.tsx', props: {
    lang, t: (sv, en) => lang === 'en' ? en : sv, map: null, stale: false,
    routeLineIsSketch: false, dayContextNote: null, split: { core: [], woven: [stop] }, routeStops: [stop],
    legForStop: () => null, mapsPlaceContext: 'Testville', expandedStopKey: null, setExpandedStopKey: () => {},
    expandedCandidateKey: null, setExpandedCandidateKey: () => {}, commitments: {}, selected: [],
    releaseCommitment: () => {}, keepStop: () => {}, dismissStop: () => {}, removeStop: () => {}, commit: () => {},
    eveningEvent: null, selectedDate: '2026-10-27', dayOffset: 0, routeContextSuggestions: [],
    detoursOpen: false, setDetoursOpen: () => {},
  } });
  t.after(() => h.unmount());
  assert.ok(exactParagraph(h.container, PERIOD_NOTE[lang]));
  assert.ok(paragraphs(h.container).some(p => p.textContent.includes('09:30–15:30') && !p.textContent.includes(PERIOD_NOTE[lang])));
});

for (const lang of ['en', 'sv']) test(`${lang} event title opens its classified source and distinguishes a homepage`, async t => {
  const rows = [
    period('linked-page', 'Concert at the venue', 'Venue'),
    period('home-only', 'Comedy night', 'Venue', { source_url: 'https://venue.example/', source_link_kind: 'site_home' }),
    period('no-link', 'Event without a source link', 'Venue', { source_url: undefined, source_link_kind: undefined, source_link_host: undefined }),
  ];
  const h = await composed(t, lang, rows);
  const check = root => {
    const pageTitle = eventRow(root, rows[0].title).querySelector('h3 a,h4 a,h5 a');
    assert.equal(pageTitle?.getAttribute('href'), source.source_url);
    const homeRow = eventRow(root, rows[1].title);
    const homeTitle = homeRow.querySelector('h3 a,h4 a,h5 a');
    assert.equal(homeTitle?.getAttribute('href'), 'https://venue.example/');
    assert.match(homeTitle?.getAttribute('aria-label') || '', lang === 'en' ? /homepage/i : /startsida/i);
    assert.match(homeRow.textContent, lang === 'en' ? /not the event page/ : /inte evenemangssidan/);
    assert.equal(eventRow(root, rows[2].title).querySelector('h3 a,h4 a,h5 a'), null);
  };
  check(card(h));
  await click(h, /See all live|Se allt live/);
  check(h.container.querySelector('[role="dialog"]'));
});
