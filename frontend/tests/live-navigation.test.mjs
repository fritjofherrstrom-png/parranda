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

async function mountSheet(t, { events = [], more = [], lang = 'en', selected = [], sort = 'for_you' } = {}) {
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
    async click(name) {
      const button = [...container.querySelectorAll('button')].find(node => node.textContent === name || node.getAttribute('aria-label') === name);
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

test('source clocks with seconds retain chronological order and display precision', async t => {
  const h = await mountSheet(t, { sort: 'by_time', events: [
    event('later-clock', '2026-10-15', { time_window: { kind: 'occurrences', dates: ['2026-10-15'], local_start: '19:30:45' } }),
    event('early-clock', '2026-10-15', { time_window: { kind: 'occurrences', dates: ['2026-10-15'], local_start: '09:30:15' } }),
  ] });
  const group = section(h, 'Thu 15 Oct');
  assert.match(group.textContent, /09:30:15/);
  assert.match(group.textContent, /19:30:45/);
  assert.deepEqual([...group.querySelectorAll('li > span:nth-child(2) > span:first-child')].map(node => node.textContent), ['Source early-clock', 'Source later-clock']);
});

// A missing controlled sort toggle or a child-owned reset would break this.
test('manual By time remains selected after supplied events complete and the sheet reopens', async t => {
  const h = await mountSheet(t, { events: [event('later', '2026-10-16')] });
  assert.equal([...h.container.querySelectorAll('button')].filter(node => node.textContent === 'By time').length, 1);
  await h.click('By time');
  await h.update([event('later', '2026-10-16'), event('earlier', '2026-10-15')]);
  assert.equal([...h.container.querySelectorAll('button')].find(node => node.textContent === 'By time').getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...h.container.querySelectorAll('section h4')].map(node => node.textContent), ['Thu 15 Oct', 'Fri 16 Oct']);
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
  assert.deepEqual([...h.container.querySelectorAll('section h4')].map(node => node.textContent), ['Thu 15 Oct', 'Sat 17 Oct']);
  const firstDate = section(h, 'Thu 15 Oct');
  assert.ok(firstDate, 'event timestamp uses the venue date, including across UTC midnight');
  assert.deepEqual([...firstDate.querySelectorAll('li > span:nth-child(2) > span:first-child')].map(node => node.textContent),
    ['Source midnight', 'Source early-browse', 'Source series']);
  assert.match(firstDate.textContent, /01:30/);
  assert.match(section(h, 'Sat 17 Oct').textContent, /Source series/);
  assert.equal(h.container.querySelectorAll('summary').length, 0, 'all dated slots are reachable without a hidden browse disclosure');
});

// Turning a range into a selected-date occurrence or using the viewer zone breaks this.
test('source ranges and missing date evidence stay separate from actual dates', async t => {
  const range = event('range', null, { time_window: { kind: 'period', starts_on: '2026-10-14', ends_on: '2026-10-20' } });
  const daily = event('daily', null, { time_window: { kind: 'daily', starts_on: '2026-10-14', ends_on: '2026-10-20', local_start: '10:00', local_end: '17:00' } });
  const noZone = event('no-zone', null, { timezone: undefined, time_window: { kind: 'continuous', starts_at: '2026-10-15T23:00:00Z' } });
  const invalid = event('invalid', null, { time_window: { kind: 'occurrences', dates: ['2026-02-30'] } });
  const long = event('long-continuous', null, { time_window: { kind: 'continuous', starts_at: '2026-10-15T08:00:00Z', ends_at: '2026-10-17T19:00:00Z' } });
  const h = await mountSheet(t, { events: [range, daily, noZone, invalid, long], sort: 'by_time' });
  assert.deepEqual([...h.container.querySelectorAll('section h4')].map(node => node.textContent), ['Source date ranges', 'Date not specified']);
  assert.match(section(h, 'Source date ranges').textContent, /Source range/);
  assert.match(section(h, 'Source date ranges').textContent, /Source daily/);
  assert.match(section(h, 'Source date ranges').textContent, /Source long-continuous/);
  assert.match(section(h, 'Date not specified').textContent, /Source no-zone/);
  assert.match(section(h, 'Date not specified').textContent, /Source invalid/);
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
  const heading = [...h.container.querySelectorAll('p')].find(node => node.textContent === 'Highlights for your picks');
  assert.match(heading.nextElementSibling.textContent, /Source match/);
  assert.doesNotMatch(heading.nextElementSibling.textContent, /Source partial/);
  assert.ok([...h.container.querySelectorAll('summary')].some(node => node.textContent === '2 occurrences'));
  assert.ok([...h.container.querySelectorAll('summary')].some(node => node.textContent === 'Show 1 more events'));
  assert.equal([...h.container.querySelectorAll('button')].find(node => node.textContent === 'For you')?.getAttribute('aria-pressed'), 'true');
});
