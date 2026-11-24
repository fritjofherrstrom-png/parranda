import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import catalog from '../../server/cities/barcelona/catalog.js';
import { mountPlanner } from './helpers/planner-harness.mjs';
import {
  dayHasPhotos, dayHasPlaceMedia, dayMediaCredits, mediaSrc, mediaSrcSet, normalizeStopAbout, normalizeStopMedia,
  normalizeStopSubtitle, photoCredit, excerptCredit,
} from '../src/lib/place-media.mjs';

// Stops exactly as server/place-media/hydrate.js produces them from real
// Wikidata/Commons/Wikipedia answers (see the fixture's _source).
const HYDRATED = JSON.parse(readFileSync(new URL('./fixtures/place-media/hydrated-stops.json', import.meta.url), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const DATE = '2026-11-17';
const ID = HYDRATED.medelhavsmuseet_sv.media.media_id;
const note = catalog.provenanceById['museu-picasso'].visit_content;
const routes = h => h.fetchMock.calls.filter(call => call.url.includes('route-recommendations'));
const GARDEN = { id: 'garden', label: 'Fixture Garden', type: 'garden', lat: 59.3305, lng: 18.0685, covered_preferences: ['green'] };
const CAFE = { id: 'cafe', label: 'Fixture Café', type: 'cafe', lat: 59.331, lng: 18.069, covered_preferences: ['food'] };
const museum = lang => ({ ...clone(HYDRATED[`medelhavsmuseet_${lang}`]), covered_preferences: ['culture'] });

function answer(stops) {
  const [first] = stops;
  return { days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', estimated_km: 1.2, map_path_points: [], legs: [], main_stops: stops,
  }, alternatives: [] }], agnostic_route_output_experiment: { promotion: { promote: true },
    source_status: { anchor: { lat: first.lat, lng: first.lng } } },
    live_events: { selected_date: DATE, coverage: 'covered', pending: false, tonight: [], this_week: [],
      acquisition: { source_health: { status: 'healthy', result: 'empty' } } } };
}

async function mounted(t, lang, stops) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(DATE + 'T10:00:00Z') });
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Fixture%20Town&lang=${lang}`, props: { lang } });
  t.after(() => h.unmount());
  await h.fetchMock.respond(routes(h)[0], answer(stops));
  return h;
}
const rows = h => [...h.container.querySelectorAll('ol button[aria-controls]')];
const row = (h, name) => rows(h).find(b => b.textContent.includes(name));
async function open(h, name) {
  const target = row(h, name);
  assert.ok(target, `row ${name} exists`);
  await h.act(() => target.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  return h.container.querySelector('#' + target.getAttribute('aria-controls'));
}
const click = (h, el) => h.act(() => el.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));

/** Every URL any element would load as an image, style or media. */
function imageRequests(root) {
  const urls = [];
  for (const el of root.querySelectorAll('img, source, video, audio, picture, image, input[type=image], link')) {
    for (const attr of ['src', 'href', 'poster', 'xlink:href']) if (el.getAttribute(attr)) urls.push(el.getAttribute(attr));
    for (const part of (el.getAttribute('srcset') || '').split(',')) if (part.trim()) urls.push(part.trim().split(/\s+/)[0]);
  }
  for (const el of root.querySelectorAll('[style]')) for (const m of el.getAttribute('style').matchAll(/url\(\s*['"]?([^'")]+)/g)) urls.push(m[1]);
  return urls;
}

for (const lang of ['sv', 'en']) {
  test(`${lang}: a day with photos gives every row a tile; the open stop shows figure, kicker, excerpt and credits before its facts`, async t => {
    const h = await mounted(t, lang, [museum(lang), GARDEN]);
    // Rows: one photo tile, one quiet glyph tile, station and chevron kept.
    const museumRow = row(h, 'Medelhavsmuseet');
    const gardenRow = row(h, 'Fixture Garden');
    const tile = museumRow.querySelector('[data-stop-photo="tile"] img');
    assert.ok(tile, 'the photo stop has a tile');
    assert.equal(tile.getAttribute('src'), `/media/c/${ID}/250`);
    assert.equal(tile.getAttribute('alt'), '', 'the row tile is decorative');
    assert.equal(tile.getAttribute('width'), '56');
    assert.equal(tile.getAttribute('height'), '56');
    assert.match(tile.parentElement.className, /\bh-14\b.*\bw-14\b/, 'a fixed 56×56 box: no layout shift');
    assert.match(tile.parentElement.className, /bg-parranda-fill/, 'placeholder until the image arrives');
    assert.match(tile.className, /motion-safe:transition-opacity/, 'the fade is off under reduced motion');
    assert.ok(gardenRow.querySelector('[data-stop-photo="glyph"]'), 'a row without a photo gets the quiet glyph tile');
    assert.equal(gardenRow.querySelector('img'), null);
    for (const r of [museumRow, gardenRow]) {
      const children = [...r.children];
      assert.match(children[0].className, /rounded-full/, 'the station still leads the row');
      assert.equal(children.at(-1).tagName.toLowerCase(), 'svg', 'the chevron still ends the row');
      assert.ok(children.at(-2).querySelector('[data-stop-photo]'), 'the tile sits between the name and the chevron');
    }

    const panel = await open(h, 'Medelhavsmuseet');
    const figure = panel.querySelector('figure[data-stop-photo="figure"]');
    assert.ok(figure);
    assert.equal(panel.firstElementChild, figure, 'the photo opens the panel');
    const img = figure.querySelector('img');
    assert.equal(img.getAttribute('alt'), lang === 'sv' ? 'Foto av Medelhavsmuseet' : 'Photo of Medelhavsmuseet');
    assert.equal(img.getAttribute('src'), `/media/c/${ID}/500`);
    assert.equal(img.getAttribute('srcset'), `/media/c/${ID}/500 500w, /media/c/${ID}/960 960w`);
    assert.match(img.parentElement.className, /aspect-\[3\/2\]/, 'a fixed 3:2 box');
    const credit = figure.querySelector('figcaption');
    assert.equal(credit.querySelector('[data-photo-credit]').textContent,
      `${lang === 'sv' ? 'Foto' : 'Photo'}: Holger Ellgaard · CC BY-SA 3.0 · Wikimedia Commons`);
    const links = [...credit.querySelectorAll('a')];
    assert.deepEqual(links.map(a => a.getAttribute('href')), [
      'https://commons.wikimedia.org/wiki/File:Medelhavsmuseet_2007.jpg',
      'https://creativecommons.org/licenses/by-sa/3.0/',
      'https://commons.wikimedia.org/wiki/File:Medelhavsmuseet_2007.jpg',
    ]);
    for (const a of links) assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
    assert.match(credit.querySelector('[data-photo-credit]').className, /truncate/, 'one line with an ellipsis');
    const expand = credit.querySelector('button[aria-expanded="false"]');
    await click(h, expand);
    assert.match(credit.textContent, lang === 'sv' ? / · beskuren$/ : / · cropped$/, 'a tap expands and says the photo is cropped');

    const about = panel.querySelector('[data-stop-about]');
    assert.equal(about.previousElementSibling, figure, 'kicker and excerpt follow the photo');
    const kicker = about.firstElementChild;
    assert.equal(kicker.textContent, lang === 'sv' ? 'museum i Stockholm' : 'museum in Stockholm, Sweden');
    assert.equal(kicker.getAttribute('lang'), lang);
    const quote = about.querySelector('blockquote[data-stop-excerpt]');
    assert.equal(quote.getAttribute('lang'), lang);
    assert.equal(quote.textContent, museum(lang).about.text, 'the excerpt is verbatim');
    assert.match(quote.className, /border-l-2 border-parranda-ember/);
    assert.match(quote.querySelector('p').className, /line-clamp-4/);
    const excerptCredit = quote.parentElement.querySelector(':scope > p');
    assert.match(excerptCredit.textContent, lang === 'sv'
      ? /^Utdrag ur Wikipedia \(svenska\) · CC BY-SA 4\.0/ : /^Excerpt from Wikipedia \(English\) · CC BY-SA 4\.0/);
    assert.deepEqual([...excerptCredit.querySelectorAll('a')].map(a => a.getAttribute('href')),
      [museum(lang).about.article_url, 'https://creativecommons.org/licenses/by-sa/4.0/']);
    const more = [...excerptCredit.querySelectorAll('button')].find(b => b.textContent === (lang === 'sv' ? 'Mer' : 'More'));
    assert.ok(more, 'a long excerpt offers "Mer"');
    await click(h, more);
    assert.doesNotMatch(quote.querySelector('p').className, /line-clamp-4/);
    // The existing facts come after the sourced words.
    const facts = [...panel.children].find(el => /Öppettider saknas|Opening hours unavailable/.test(el.textContent));
    assert.ok(facts && (about.compareDocumentPosition(facts) & h.window.Node.DOCUMENT_POSITION_FOLLOWING));

    // About this day and map: every photo and excerpt with full credit, plus Wikidata.
    const credits = h.container.querySelector('[data-day-credits]');
    assert.ok(credits);
    assert.equal(credits.closest('details')?.querySelector('summary')?.textContent,
      lang === 'sv' ? 'Om dagen och kartan' : 'About this day and map');
    assert.match(credits.textContent, lang === 'sv' ? /Foton och texter/ : /Photos and text/);
    assert.match(credits.textContent, lang === 'sv'
      ? /Medelhavsmuseet.*Foto: Holger Ellgaard · CC BY-SA 3\.0 · Wikimedia Commons · beskuren/
      : /Medelhavsmuseet.*Photo: Holger Ellgaard · CC BY-SA 3\.0 · Wikimedia Commons · cropped/);
    assert.match(credits.textContent, lang === 'sv'
      ? /Utdrag ur Wikipedia \(svenska\): Medelhavsmuseet · CC BY-SA 4\.0/
      : /Excerpt from Wikipedia \(English\): Medelhavsmuseet · CC BY-SA 4\.0/);
    assert.match(credits.textContent, lang === 'sv' ? /Platsdata från Wikidata \(CC0\)/ : /Place data from Wikidata \(CC0\)/);
    assert.doesNotMatch(credits.textContent, /Fixture Garden/, 'stops without media are not credited');

    for (const url of imageRequests(h.container)) assert.match(url, /^\/media\/c\/[0-9a-f]{40}\/(250|500|960)$/, `same-origin image: ${url}`);
    assert.equal(routes(h).length, 1, 'reading media never recomposes');
  });
}

test('a day without photos renders no tile, no figure and no credits', async t => {
  const plain = museum('en');
  for (const key of ['wikidata_id', 'media', 'subtitle', 'about']) delete plain[key];
  const h = await mounted(t, 'en', [plain, GARDEN]);
  assert.equal(h.container.querySelector('[data-stop-photo]'), null);
  assert.equal(h.container.querySelector('[data-day-credits]'), null);
  const panel = await open(h, 'Medelhavsmuseet');
  assert.equal(panel.querySelector('figure, [data-stop-about]'), null);
  assert.equal(h.container.querySelectorAll('img').length, 0);
  assert.doesNotMatch(h.text(), /Wikimedia|Wikipedia|Wikidata/);
});

test('a day with an excerpt but no photo keeps rows as they were and still credits the excerpt', async t => {
  const textOnly = museum('en');
  delete textOnly.media;
  const h = await mounted(t, 'en', [textOnly, GARDEN]);
  assert.equal(h.container.querySelector('[data-stop-photo]'), null, 'tiles only on a day with ≥1 photo');
  const panel = await open(h, 'Medelhavsmuseet');
  assert.equal(panel.querySelector('figure'), null);
  assert.ok(panel.querySelector('blockquote[data-stop-excerpt]'));
  const credits = h.container.querySelector('[data-day-credits]');
  assert.match(credits.textContent, /Excerpt from Wikipedia \(English\): Medelhavsmuseet/);
  assert.doesNotMatch(credits.textContent, /Wikimedia Commons/);
});

test('sv: an English excerpt waits behind "Visa beskrivningen på engelska" and is never translated', async t => {
  // Röhsska as the server sends it to a Swedish reader whose record only has an English excerpt.
  const stop = { ...clone(HYDRATED.rohsska_sv), about: clone(HYDRATED.rohsska_en.about), covered_preferences: ['culture'] };
  const h = await mounted(t, 'sv', [stop, CAFE]);
  const panel = await open(h, 'Röhsska museet');
  assert.equal(panel.querySelector('blockquote'), null, 'the other-language excerpt is not shown up front');
  assert.doesNotMatch(panel.textContent, /design, fashion and applied arts/);
  const reveal = [...panel.querySelectorAll('button')].find(b => b.textContent === 'Visa beskrivningen på engelska');
  assert.ok(reveal);
  assert.equal(reveal.getAttribute('aria-expanded'), 'false');
  await click(h, reveal);
  const quote = panel.querySelector('blockquote[data-stop-excerpt]');
  assert.equal(quote.getAttribute('lang'), 'en');
  assert.equal(quote.textContent, HYDRATED.rohsska_en.about.text);
  assert.match(quote.parentElement.textContent, /Utdrag ur Wikipedia \(engelska\) · CC BY-SA 4\.0/);
  // The photo file name is percent-encoded and stays a Commons file page.
  assert.equal(panel.querySelector('figcaption a').getAttribute('href'), 'https://commons.wikimedia.org/wiki/File:R%C3%B6hsska_museet.jpg');
});

test('a curated visit note wins over the Wikipedia excerpt', async t => {
  const stop = { ...museum('en'), visit_content: note };
  const h = await mounted(t, 'en', [stop, GARDEN]);
  const panel = await open(h, 'Medelhavsmuseet');
  assert.ok(panel.querySelector('figure'), 'the photo still shows');
  assert.match(panel.querySelector('[data-stop-about]').textContent, /museum in Stockholm, Sweden/, 'the kicker still shows');
  assert.equal(panel.querySelector('blockquote'), null);
  assert.doesNotMatch(panel.textContent, /ancient objects from the Mediterranean/);
  assert.match(panel.querySelector('details').textContent, /Picasso’s early work/, 'the curated note is the text');
  assert.doesNotMatch(h.container.querySelector('[data-day-credits]').textContent, /Wikipedia/);
});

test('forged media on a stop renders nothing: no tile, no credit, no foreign link', async t => {
  const forged = museum('en');
  forged.media = { ...forged.media, file_page_url: 'javascript:alert(1)' };
  forged.about = { ...forged.about, article_url: 'https://evil.example/w/index.php?oldid=1' };
  forged.subtitle = { ...forged.subtitle, subject_qid: 'Q1' };
  const h = await mounted(t, 'en', [forged, GARDEN]);
  assert.equal(h.container.querySelector('[data-stop-photo], [data-day-credits]'), null);
  const panel = await open(h, 'Medelhavsmuseet');
  assert.equal(panel.querySelector('figure, blockquote, [data-stop-about]'), null);
  assert.equal(h.container.querySelectorAll('img').length, 0);
  for (const a of h.container.querySelectorAll('a[href]')) assert.doesNotMatch(a.getAttribute('href'), /^javascript:|evil\.example/i);
});

test('a shared day shows the same photos and credits', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(DATE + 'T10:00:00Z') });
  const REF = 'c'.repeat(48);
  const h = await mountPlanner({ url: `http://localhost/anywhere?snapshot=${REF}&lang=en` });
  t.after(() => h.unmount());
  const intake = { mode: 'place', status: 'resolved', resolved: { label: 'Testville', lat: 59.33, lng: 18.07, place_ref: 'r123', confidence: 'high' } };
  const result = { days: [{ date: DATE, experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', main_stops: [museum('en'), GARDEN], estimated_km: 1, legs: [], confidence: 'low' } }],
  agnostic_route_output_experiment: { synthesized_via: 'agnostic_compose_engine', route_mutation: true, eligibility: { eligible: true },
    intake, promotion: { promote: true },
    pinned_candidates: { requested_count: 0, honored_count: 0, unhonored_count: 0, unhonored: [] } } };
  await h.fetchMock.respond(h.fetchMock.calls[0], {
    version: 1, ref: REF, created_at: DATE + 'T09:00:00Z', expires_at: '2026-11-18T10:00:00Z', language: 'en',
    intent: { dateIso: DATE, place: 'Testville', placeLabel: 'Testville', placeRef: 'r123', mode: 'typed',
      selected: ['culture', 'green'], walkKey: 'balanced', excludedCandidateIds: [], pinnedCandidateIds: [], liveEventChoices: [] },
    result,
  });
  assert.equal(row(h, 'Medelhavsmuseet').querySelector('[data-stop-photo="tile"] img')?.getAttribute('src'), `/media/c/${ID}/250`);
  assert.ok(row(h, 'Fixture Garden').querySelector('[data-stop-photo="glyph"]'));
  assert.match(h.container.querySelector('[data-day-credits]')?.textContent || '', /Photo: Holger Ellgaard · CC BY-SA 3\.0 · Wikimedia Commons/);
  for (const url of imageRequests(h.container)) assert.match(url, /^\/media\/c\//);
});

// ---------- normalizers ----------

test('normalizers accept exactly what the server hydrates', () => {
  for (const key of ['medelhavsmuseet_sv', 'medelhavsmuseet_en', 'rohsska_sv', 'rohsska_en']) {
    const stop = HYDRATED[key];
    assert.deepEqual(normalizeStopMedia(stop), stop.media, key);
    assert.deepEqual(normalizeStopSubtitle(stop), stop.subtitle, key);
    assert.deepEqual(normalizeStopAbout(stop), stop.about, key);
  }
  assert.equal(dayHasPhotos([GARDEN, HYDRATED.medelhavsmuseet_sv]), true);
  assert.equal(dayHasPhotos([GARDEN, CAFE]), false);
  assert.equal(dayHasPhotos(null), false);
  assert.equal(dayHasPlaceMedia([GARDEN]), false);
  assert.deepEqual(dayMediaCredits([GARDEN, HYDRATED.medelhavsmuseet_sv]).map(r => r.name), ['Medelhavsmuseet']);
});

test('normalizers refuse forged or odd objects whole', () => {
  const base = HYDRATED.medelhavsmuseet_en;
  const withMedia = patch => ({ ...base, media: { ...base.media, ...patch } });
  const withAbout = patch => ({ ...base, about: { ...base.about, ...patch } });
  const media = [
    withMedia({ file_page_url: 'javascript:alert(1)' }),
    withMedia({ file_page_url: 'https://evil.example/wiki/File:X.jpg' }),
    withMedia({ file_page_url: 'https://commons.wikimedia.org/wiki/File:X.jpg?x=1' }),
    withMedia({ media_id: 'abc' }),
    withMedia({ media_id: '../../etc/passwd' }),
    withMedia({ media_id: ID.toUpperCase() }),
    withMedia({ subject_qid: 'Q42' }),
    withMedia({ license: 'GFDL' }),
    withMedia({ license: 'CC-BY-SA-4.0' }),
    withMedia({ license_url: 'https://creativecommons.org/licenses/by/3.0/' }),
    withMedia({ license_url: 'javascript:alert(1)' }),
    withMedia({ author: null }),
    withMedia({ author: 'https://example.com/me' }),
    withMedia({ author: 'Bad\u0007author' }),
    withMedia({ width: 640 }),
    withMedia({ width: '1780' }),
    withMedia({ modified: undefined }),
    withMedia({ kind: 'video' }),
    withMedia({ version: 2 }),
    withMedia({ via: 'p154' }),
    withMedia({ checked_on: '2026-02-30' }),
    { ...base, media: [base.media] },
    { ...base, wikidata_id: 'not-a-qid' },
    { ...base, wikidata_id: undefined },
    { ...base, is_live_event: true },
  ];
  for (const stop of media) assert.equal(normalizeStopMedia(stop), null, JSON.stringify(stop.media).slice(0, 120));
  const about = [
    withAbout({ article_url: 'javascript:alert(1)' }),
    withAbout({ article_url: 'https://sv.wikipedia.org/w/index.php?oldid=1' }),
    withAbout({ article_url: 'https://en.wikipedia.org/wiki/Medelhavsmuseet' }),
    withAbout({ text: 'Short.' }),
    withAbout({ text: 'Read all about it at https://example.com before you go there today.' }),
    withAbout({ text: base.about.text.replace(/\.$/, '') }),
    withAbout({ license: 'CC-BY-SA-3.0' }),
    withAbout({ lang: 'fr' }),
    withAbout({ article_title: 'A [[link]]' }),
    withAbout({ subject_qid: 'Q42' }),
    { ...base, visit_content: note },
  ];
  for (const stop of about) assert.equal(normalizeStopAbout(stop), null, JSON.stringify(stop.about).slice(0, 120));
  assert.equal(normalizeStopSubtitle({ ...base, subtitle: { ...base.subtitle, source: 'wikipedia' } }), null);
  assert.equal(normalizeStopSubtitle({ ...base, subtitle: { ...base.subtitle, text: 'see www.example.com' } }), null);
  assert.equal(normalizeStopSubtitle({ ...base, subtitle: { ...base.subtitle, text: 'x'.repeat(81) } }), null);
});

test('image URLs are same-origin and only at served widths', () => {
  const media = normalizeStopMedia(HYDRATED.medelhavsmuseet_en);
  assert.equal(mediaSrc(media, 250), `/media/c/${ID}/250`);
  assert.equal(mediaSrc(media, 300), null);
  assert.equal(mediaSrc({ media_id: 'https://upload.wikimedia.org/x' }, 250), null);
  assert.equal(mediaSrc(null, 250), null);
  assert.equal(mediaSrcSet(media), `/media/c/${ID}/500 500w, /media/c/${ID}/960 960w`);
});

test('credit strings: public domain needs no author and has no licence link; ports keep their own URL', () => {
  const base = HYDRATED.medelhavsmuseet_sv;
  const pd = normalizeStopMedia({ ...base, media: { ...base.media, author: null, license: 'PD', license_url: null } });
  assert.ok(pd);
  assert.deepEqual(photoCredit(pd, 'sv'), { lead: 'Foto', author: null, authorHref: pd.file_page_url, license: 'Allmän egendom',
    licenseHref: null, source: 'Wikimedia Commons', sourceHref: pd.file_page_url, modified: 'beskuren' });
  assert.equal(photoCredit(pd, 'en').license, 'Public domain');
  const ported = normalizeStopMedia({ ...base, media: { ...base.media, license_url: 'https://creativecommons.org/licenses/by-sa/3.0/de/' } });
  assert.equal(photoCredit(ported, 'en').licenseHref, 'https://creativecommons.org/licenses/by-sa/3.0/de/');
  const about = normalizeStopAbout(HYDRATED.medelhavsmuseet_en);
  assert.deepEqual(excerptCredit(about, 'sv'), { lead: 'Utdrag ur', source: 'Wikipedia (engelska)', sourceHref: about.article_url,
    license: 'CC BY-SA 4.0', licenseHref: 'https://creativecommons.org/licenses/by-sa/4.0/' });
});
