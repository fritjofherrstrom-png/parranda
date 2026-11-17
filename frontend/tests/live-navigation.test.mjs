import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// Real mounted sheet and parent-owned controls; fixture evidence only.
const temporary = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.live-navigation-'));
const output = join(temporary, 'sheet.mjs');
await build({
  stdin: { contents: `import LiveSheet from './src/components/planner/LiveSheet'; export default LiveSheet;`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx' },
  bundle: true, outfile: output, format: 'esm', platform: 'neutral', jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
});
const LiveSheet = (await import(output)).default;
test.after(() => rmSync(temporary, { recursive: true, force: true }));

const event = (id, date, extra = {}) => ({ id, title: `Source ${id}`, place: 'Source venue',
  timezone: 'Europe/Stockholm', time_window: { kind: 'occurrences', dates: [date], local_start: '18:00', local_end: '20:00' },
  tags: [], source_url: `https://calendar.example/${id}`, source_label: 'Official calendar', ...extra });

async function mountSheet(t, { events = [], more = [], lang = 'en', selected = [], sort = 'for_you',
  planningDate, planningAvailable = false, onPlanOccurrence } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  let currentEvents = events;
  let currentMore = more;
  let update;
  function Parent() {
    const [mode, setMode] = React.useState(sort);
    const [open, setOpen] = React.useState(true);
    const [, changed] = React.useState(0);
    update = () => changed(value => value + 1);
    return React.createElement(React.Fragment, null,
      React.createElement('button', { onClick: () => setOpen(true) }, 'Open fixture sheet'),
      open && React.createElement(LiveSheet, {
        lang, t: (sv, en) => lang === 'sv' ? sv : en, anchorLabel: 'Fixture area', selected,
        liveDayLabel: 'Selected day', liveSheetTime: 'week', setLiveSheetTime: () => {},
        liveSheetSort: mode, setLiveSheetSort: setMode, onRetry: () => {},
        planningDate, planningAvailable, onPlanOccurrence,
        liveSheetScope: 'around_place', requestLiveSheetScope: () => {},
        aroundPlaceScopeAvailable: true, inPlaceScopeAvailable: true, routeScopeAvailable: false,
        liveQueryPending: false, liveQueryGeoHint: null, liveQueryError: null,
        sheetLiveEvents: { selected_date: '2026-10-14' },
        sheetBuckets: { tonight: [], thisWeek: currentEvents },
        sheetBrowseBuckets: { tonight: [], thisWeek: currentMore },
        sheetPulseState: 'ok', sheetFailure: null, sheetSourceHealth: null, sheetSources: null,
        wovenNames: [], includedInRoute: 'Included in route', liveFailureSentence: () => '',
        dialogRef: { current: null }, closeRef: { current: null }, onClose: () => setOpen(false),
      }));
  }
  await act(() => root.render(React.createElement(Parent)));
  t.after(async () => {
    await act(() => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  });
  return { container,
    async click(name, index = 0) {
      const button = [...container.querySelectorAll('button')].filter(node => node.textContent === name || node.getAttribute('aria-label') === name)[index];
      assert.ok(button, `control '${name}' exists`);
      await act(() => button.dispatchEvent(new dom.window.Event('click', { bubbles: true })));
    },
    async update(events, more = []) {
      currentEvents = events; currentMore = more;
      await act(() => update());
    },
  };
}

const section = (h, label) => [...h.container.querySelectorAll('section')].find(node => node.getAttribute('aria-label') === label);
const cardTitles = container => [...container.querySelectorAll('li > div > :is(h3, h4, h5)')].map(node => node.textContent);
// Source attribution is a separate disclosure; it must neither stand in for
// occurrence navigation nor conceal one of its selectable booking slots.
const navigationDetails = container => [...container.querySelectorAll('details')]
  .filter(node => !/^Source details$/.test(node.querySelector('summary')?.textContent.trim()));
const programSlot = (id, startsAt, extra = {}) => event(id, null, {
  title: 'Source programme', source_provider_id: 'source-calendar', source_url: 'https://calendar.example/programme',
  lat: 59.3, lng: 18.1, time_window: { kind: 'continuous', starts_at: startsAt }, ...extra,
});
const sourceProgram = slots => ({ ...slots[0], display_group_kind: 'source_program', occurrences: slots });

// Flattening a display programme into one card per booking time breaks this.
test('source programmes retain one For you card and disclose same-day slots in one By time card', async t => {
  const slots = [programSlot('morning', '2026-10-15T08:00:00Z'), programSlot('afternoon', '2026-10-15T12:00:00Z'),
    programSlot('following-day', '2026-10-16T08:00:00Z')];
  const earlier = event('earlier', '2026-10-15', { time_window: { kind: 'occurrences', dates: ['2026-10-15'], local_start: '09:00' } });
  const middle = event('middle', '2026-10-15', { time_window: { kind: 'occurrences', dates: ['2026-10-15'], local_start: '12:00' } });
  const h = await mountSheet(t, { events: [sourceProgram(slots), middle, earlier] });
  assert.equal(cardTitles(h.container).filter(title => title === 'Source programme').length, 1);
  assert.equal(navigationDetails(h.container)[0]?.querySelector('summary')?.textContent.trim(), '3 occurrences');
  assert.equal(h.container.querySelector('details ul')?.children.length, 3, 'For you preserves every original booking slot');
  await h.click('By time');
  assert.deepEqual([...h.container.querySelectorAll('section > h3')].map(node => node.textContent), ['Thu 15 Oct', 'Fri 16 Oct']);
  const firstDay = section(h, 'Thu 15 Oct');
  assert.deepEqual(cardTitles(firstDay), ['Source earlier', 'Source programme', 'Source middle'], 'the programme sorts by its first local slot');
  assert.equal(navigationDetails(firstDay)[0]?.querySelector('summary')?.textContent.trim(), '2 occurrences');
  assert.equal(firstDay.querySelector('details ul')?.children.length, 2);
  assert.match(navigationDetails(firstDay)[0].textContent, /10:00/);
  assert.match(navigationDetails(firstDay)[0].textContent, /14:00/);
  const followingDay = section(h, 'Fri 16 Oct');
  assert.deepEqual(cardTitles(followingDay), ['Source programme']);
  assert.equal(navigationDetails(followingDay)[0]?.querySelector('summary')?.textContent.trim(), '1 occurrence');
  assert.equal(followingDay.querySelector('details ul')?.children.length, 1, 'the next date has only its original slot');
  assert.doesNotMatch(followingDay.textContent, /14:00/);
});

// Selecting the representative, changing an occurrence ID, or leaking another
// date's action through a programme disclosure breaks this real click boundary.
test('By time programme disclosure selects each exact eligible slot only on the planned local date', async t => {
  const planned = [];
  const slots = [
    programSlot('first', '2026-10-14T23:30:00Z', { live_choice_eligible: true, occurrence_date: '2026-10-15', live_occurrence_id: `live:2026-10-15:${'a'.repeat(32)}` }),
    programSlot('second', '2026-10-15T12:00:00Z', { live_choice_eligible: true, occurrence_date: '2026-10-15', live_occurrence_id: `live:2026-10-15:${'b'.repeat(32)}` }),
    programSlot('ineligible', '2026-10-15T16:00:00Z', { live_choice_eligible: false, occurrence_date: '2026-10-15', live_occurrence_id: `live:2026-10-15:${'c'.repeat(32)}` }),
    programSlot('next', '2026-10-16T08:00:00Z', { live_choice_eligible: true, occurrence_date: '2026-10-16', live_occurrence_id: `live:2026-10-16:${'d'.repeat(32)}` }),
    programSlot('listed', null, { live_choice_eligible: true, occurrence_date: '2026-10-15', live_occurrence_id: `live:2026-10-15:${'e'.repeat(32)}`,
      time_window: { kind: 'occurrences', dates: ['2026-10-15', '2026-10-16'], local_start: '19:00' } }),
  ];
  const h = await mountSheet(t, { events: [sourceProgram(slots)], sort: 'by_time', planningDate: '2026-10-15',
    planningAvailable: true, onPlanOccurrence: (slot, label) => planned.push({ slot, label }) });
  const selectedDay = section(h, 'Thu 15 Oct');
  assert.equal(selectedDay.querySelectorAll(':scope > ul > li').length, 1, 'the programme itself is one display card');
  assert.equal(navigationDetails(selectedDay)[0]?.querySelectorAll('button').length, 3, 'only individually admitted slots offer actions');
  assert.equal(selectedDay.querySelectorAll(':scope > ul > li > button').length, 0, 'the parent is never selectable');
  assert.equal(section(h, 'Fri 16 Oct').querySelectorAll('button').length, 0, 'listed dates never reuse a selected-day identity on another row');
  await h.click('Plan with this event', 0);
  await h.click('Plan with this event', 1);
  await h.click('Plan with this event', 2);
  assert.equal(planned.length, 3);
  assert.strictEqual(planned[0].slot, slots[0]);
  assert.strictEqual(planned[1].slot, slots[1]);
  assert.strictEqual(planned[2].slot, slots[4]);
  assert.deepEqual(planned.map(item => item.slot.live_occurrence_id), [
    `live:2026-10-15:${'a'.repeat(32)}`, `live:2026-10-15:${'b'.repeat(32)}`, `live:2026-10-15:${'e'.repeat(32)}`,
  ]);
  assert.deepEqual(planned.map(item => item.label), ['Source programme', 'Source programme', 'Source programme']);
});

// The display marker never grants a different venue, publisher, range or an
// unresolved local date permission to collapse into a dated programme card.
test('By time source programmes preserve venue, publisher and unresolved-time boundaries', async t => {
  const base = programSlot('first-boundary', '2026-10-15T08:00:00Z');
  const slots = [base,
    programSlot('other-venue', '2026-10-15T10:00:00Z', { place: 'Other source venue' }),
    programSlot('other-publisher', '2026-10-15T12:00:00Z', { source_provider_id: 'other-calendar', source_url: 'https://other.example/programme', source_label: 'Other calendar' }),
    programSlot('range', null, { time_window: { kind: 'period', starts_on: '2026-10-15', ends_on: '2026-10-17' } }),
    programSlot('no-zone', '2026-10-15T16:00:00Z', { timezone: undefined }),
  ];
  const h = await mountSheet(t, { events: [sourceProgram(slots)], sort: 'by_time' });
  const dated = section(h, 'Thu 15 Oct');
  assert.equal(dated.querySelectorAll(':scope > ul > li').length, 3);
  assert.deepEqual(navigationDetails(dated).map(node => node.querySelector('summary').textContent.trim()), ['1 occurrence', '1 occurrence', '1 occurrence']);
  assert.equal(section(h, 'Source date ranges').querySelectorAll(':scope > ul > li').length, 1);
  assert.equal(section(h, 'Date not specified').querySelectorAll(':scope > ul > li').length, 1);
  assert.equal(navigationDetails(section(h, 'Source date ranges')).length, 0, 'ranges remain their exact source row');
  assert.equal(navigationDetails(section(h, 'Date not specified')).length, 0, 'an absent venue timezone does not acquire a date');
});

test('By time keeps explicit source-series same-date slots as individual navigation cards', async t => {
  const slots = [programSlot('series-first', '2026-10-15T08:00:00Z'), programSlot('series-second', '2026-10-15T12:00:00Z')];
  const h = await mountSheet(t, { events: [{ ...slots[0], source_series_id: 'stated-series', occurrences: slots }], sort: 'by_time' });
  const dated = section(h, 'Thu 15 Oct');
  assert.deepEqual(cardTitles(dated), ['Source programme', 'Source programme']);
  assert.equal(navigationDetails(dated).length, 0, 'an explicit source series keeps its existing By time navigation');
});

test('source clocks with seconds retain chronological order and display precision', async t => {
  const h = await mountSheet(t, { sort: 'by_time', events: [
    event('later-clock', '2026-10-15', { time_window: { kind: 'occurrences', dates: ['2026-10-15'], local_start: '19:30:45' } }),
    event('early-clock', '2026-10-15', { time_window: { kind: 'occurrences', dates: ['2026-10-15'], local_start: '09:30:15' } }),
  ] });
  const group = section(h, 'Thu 15 Oct');
  assert.match(group.textContent, /09:30:15/);
  assert.match(group.textContent, /19:30:45/);
  assert.deepEqual(cardTitles(group), ['Source early-clock', 'Source later-clock']);
});

// A missing controlled sort toggle or a child-owned reset would break this.
test('manual By time remains selected after supplied events complete and the sheet reopens', async t => {
  const h = await mountSheet(t, { events: [event('later', '2026-10-16')] });
  assert.equal([...h.container.querySelectorAll('button')].filter(node => node.textContent === 'By time').length, 1);
  await h.click('By time');
  await h.update([event('later', '2026-10-16'), event('earlier', '2026-10-15')]);
  assert.equal([...h.container.querySelectorAll('button')].find(node => node.textContent === 'By time').getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...h.container.querySelectorAll('section > h3')].map(node => node.textContent), ['Thu 15 Oct', 'Fri 16 Oct']);
  await h.click('Close live');
  await h.click('Open fixture sheet');
  assert.equal([...h.container.querySelectorAll('button')].find(node => node.textContent === 'By time').getAttribute('aria-pressed'), 'true');
  assert.match(section(h, 'Thu 15 Oct').textContent, /Source earlier/);
});

// Flattening only the earliest series row, dropping browse, or sorting by fit breaks this.
test('By time places every supplied series slot and browse row in its actual date group', async t => {
  const first = event('series-first', '2026-10-15', { title: 'Source series' });
  const second = event('series-second', '2026-10-17', { title: 'Source series' });
  const series = { ...first, occurrences: [first, second] };
  const midnight = event('midnight', null, { time_window: { kind: 'continuous', starts_at: '2026-10-14T23:30:00Z', ends_at: '2026-10-15T00:30:00Z' },
    timezone: 'Europe/Stockholm', route_eligible: false });
  const early = event('early-browse', '2026-10-15', { time_window: { kind: 'occurrences', dates: ['2026-10-15'], local_start: '09:00' } });
  const h = await mountSheet(t, { events: [series, midnight], more: [early], sort: 'by_time' });
  assert.deepEqual([...h.container.querySelectorAll('section > h3')].map(node => node.textContent), ['Thu 15 Oct', 'Sat 17 Oct']);
  const firstDate = section(h, 'Thu 15 Oct');
  assert.ok(firstDate, 'event timestamp uses the venue date, including across UTC midnight');
  assert.deepEqual(cardTitles(firstDate),
    ['Source midnight', 'Source early-browse', 'Source series']);
  assert.match(firstDate.textContent, /01:30/);
  assert.match(section(h, 'Sat 17 Oct').textContent, /Source series/);
  assert.equal(navigationDetails(h.container).length, 0, 'all dated slots are reachable without a hidden browse disclosure');
});

// Turning a range into a selected-date occurrence or using the viewer zone breaks this.
test('source ranges and missing date evidence stay separate from actual dates', async t => {
  const range = event('range', null, { time_window: { kind: 'period', starts_on: '2026-10-14', ends_on: '2026-10-20' } });
  const daily = event('daily', null, { time_window: { kind: 'daily', starts_on: '2026-10-14', ends_on: '2026-10-20', local_start: '10:00', local_end: '17:00' } });
  const noZone = event('no-zone', null, { timezone: undefined, time_window: { kind: 'continuous', starts_at: '2026-10-15T23:00:00Z' } });
  const invalid = event('invalid', null, { time_window: { kind: 'occurrences', dates: ['2026-02-30'] } });
  const long = event('long-continuous', null, { time_window: { kind: 'continuous', starts_at: '2026-10-15T08:00:00Z', ends_at: '2026-10-17T19:00:00Z' } });
  const h = await mountSheet(t, { events: [range, daily, noZone, invalid, long], sort: 'by_time' });
  assert.deepEqual([...h.container.querySelectorAll('section > h3')].map(node => node.textContent), ['Source date ranges', 'Date not specified']);
  assert.match(section(h, 'Source date ranges').textContent, /Source range/);
  assert.match(section(h, 'Source date ranges').textContent, /Source daily/);
  assert.match(section(h, 'Source date ranges').textContent, /Source long-continuous/);
  assert.match(section(h, 'Date not specified').textContent, /Source no-zone/);
  assert.match(section(h, 'Date not specified').textContent, /Source invalid/);
});

// A title one level below the nearest heading: under a date (h3) read by
// time groups (h4) it is h5; under a date alone it is h4. Skipped levels or
// a title outranking its group break this.
test('By time titles sit one level below the nearest heading', async t => {
  const RealDate = globalThis.Date;
  const NOW = RealDate.parse('2026-10-15T12:00:00Z'); // 14:00 in Stockholm
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  };
  t.after(() => { globalThis.Date = RealDate; });
  const h = await mountSheet(t, { events: [event('today', '2026-10-15'), event('tomorrow', '2026-10-16')], sort: 'by_time' });
  const today = section(h, 'Thu 15 Oct');
  assert.equal(today.querySelector(':scope > h3')?.textContent, 'Thu 15 Oct');
  assert.deepEqual([...today.querySelectorAll('[data-live-time-group] > h4')].map(node => node.textContent), ['Later today']);
  assert.deepEqual([...today.querySelectorAll('li > div > :is(h3, h4, h5)')].map(node => node.tagName), ['H5']);
  assert.deepEqual([...section(h, 'Fri 16 Oct').querySelectorAll('li > div > :is(h3, h4, h5)')].map(node => node.tagName), ['H4']);
});

// Deriving tags from title/preferences or truncating stated date lists breaks this.
test('By time retains all source-listed dates and renders tags only from supplied event tags', async t => {
  const stated = event('listed', null, { title: 'Source list', tags: ['Konsert', '  Jazz  '],
    time_window: { kind: 'occurrences', dates: ['2026-10-17', '2026-10-15'], local_start: '18:00' },
    matched_preferences: ['museums'], preference_match: 'strong', requested_preferences: ['museums'] });
  const guessed = event('guessed', '2026-10-16', { title: 'Jazz concert', tags: [], matched_preferences: ['museums'], preference_match: 'strong' });
  const h = await mountSheet(t, { events: [stated, guessed], selected: ['culture'], sort: 'by_time' });
  assert.ok(section(h, 'Thu 15 Oct'), 'the first stated date has its own section');
  assert.match(section(h, 'Thu 15 Oct').textContent, /Source list/);
  assert.match(section(h, 'Sat 17 Oct').textContent, /Source list/);
  // The source's own tags, in the page's language where they are a common category (live-tags.mjs).
  assert.deepEqual([...section(h, 'Thu 15 Oct').querySelector('[role="list"][aria-label="Tags"]').children].map(node => node.textContent), ['Concerts', 'Jazz']);
  assert.equal(section(h, 'Fri 16 Oct').querySelector('[aria-label="Tags"]'), null);
});

// Moving partial matches into picks or changing server rank breaks this.
test('For you preserves relevance groups, ranked order, browse and source occurrence disclosure', async t => {
  const match = event('match', '2026-10-17', { preference_match: 'strong', requested_preferences: ['museums'], matched_preferences: ['museums'] });
  const partial = event('partial', '2026-10-15', { preference_match: 'partial', requested_preferences: ['museums'], partial_preferences: ['museums'] });
  const slots = [event('s1', '2026-10-15'), event('s2', '2026-10-17')];
  const h = await mountSheet(t, { events: [partial, match, { ...slots[0], title: 'Source series', occurrences: slots }],
    more: [event('browse', '2026-10-16')], selected: ['culture'] });
  const heading = [...h.container.querySelectorAll('h3')].find(node => node.textContent === 'Highlights for your picks');
  assert.match(heading.nextElementSibling.textContent, /Source match/);
  assert.doesNotMatch(heading.nextElementSibling.textContent, /Source partial/);
  assert.ok([...h.container.querySelectorAll('summary')].some(node => node.textContent === '2 occurrences'));
  assert.ok([...h.container.querySelectorAll('summary')].some(node => node.textContent === 'Show 1 more events'));
  assert.equal([...h.container.querySelectorAll('button')].find(node => node.textContent === 'For you')?.getAttribute('aria-pressed'), 'true');
});
