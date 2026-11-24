'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createWikimediaClient, cutExcerpt, parseExtractPage, parseEntity, USER_AGENT,
} = require('../server/place-media/wikimedia-client');
const { normalizeMediaRecord, isExcerptText } = require('../server/place-media/record');
const {
  samples, clone, createFixtureFetcher, extractPage, jsonResponse,
} = require('./helpers/place-media-fixtures');

function fakeClock(start = Date.parse('2026-11-24T10:00:00Z')) {
  let now = start;
  return { clock: () => now, advance: ms => { now += ms; }, sleep: async ms => { now += ms; } };
}

test('fetchRecords builds a full record from real Wikidata, Wikipedia and Commons answers', async () => {
  const { fetcher, calls } = createFixtureFetcher();
  const time = fakeClock();
  const client = createWikimediaClient({ fetcher, clock: time.clock, sleep: time.sleep });
  const records = await client.fetchRecords(['Q1331646']);
  const record = records.get('Q1331646');
  assert.deepEqual(normalizeMediaRecord(record), record, 'a valid index record');
  assert.equal(record.checked_on, '2026-11-24');
  assert.deepEqual(record.entity.p31, ['Q3329412']);
  assert.equal(record.photo.via, 'p18');
  assert.equal(record.photo.file_title, 'File:Medelhavsmuseet 2007.jpg');
  assert.equal(record.photo.author, 'Holger Ellgaard');
  assert.deepEqual(record.subtitle, { sv: 'museum i Stockholm', en: 'museum in Stockholm, Sweden' });
  assert.equal(record.about.sv.rev, 59023844);
  assert.equal(record.about.sv.title, 'Medelhavsmuseet');
  assert.ok(record.about.sv.text.startsWith('Medelhavsmuseet är ett svenskt statligt'));
  assert.equal(record.about.en.lang, 'en');
  // Exactly the batched calls, each with our User-Agent; only QIDs and titles go out.
  assert.deepEqual(calls.map(c => new URL(c.url).hostname), ['www.wikidata.org', 'sv.wikipedia.org', 'en.wikipedia.org', 'commons.wikimedia.org']);
  for (const { url, init } of calls) {
    assert.equal(init.headers['User-Agent'], USER_AGENT);
    assert.equal(init.headers['Accept-Encoding'], 'gzip');
    const params = new URL(url).searchParams;
    for (const key of params.keys()) {
      assert.ok(['format', 'formatversion', 'action', 'ids', 'props', 'sitefilter', 'prop', 'iiprop', 'iiextmetadatafilter',
        'iiextmetadatalanguage', 'titles', 'exintro', 'explaintext', 'exlimit', 'ppprop', 'rvprop', 'redirects'].includes(key), key);
    }
  }
  const entityCall = new URL(calls[0].url).searchParams;
  assert.equal(entityCall.get('props'), 'claims|labels|aliases|descriptions|sitelinks');
  assert.equal(new URL(calls[3].url).searchParams.get('iiprop'), 'url|size|mime|sha1|extmetadata');
});

test('batches: wbgetentities ≤50 ids, imageinfo ≤50 titles, extracts ≤20 titles; one request at a time', async () => {
  const entities = {};
  const qids = [];
  for (let i = 0; i < 60; i += 1) {
    const qid = `Q${900000 + i}`;
    qids.push(qid);
    const raw = clone(samples.wbgetentities.entities.Q1331646);
    raw.id = qid;
    raw.claims.P18[0].mainsnak.datavalue.value = `Museum ${i}.jpg`;
    raw.sitelinks = { svwiki: { site: 'svwiki', title: `Museum ${i}` } };
    entities[qid] = raw;
  }
  let active = 0; let maxActive = 0;
  const { fetcher, calls } = createFixtureFetcher({
    entities,
    onCall: async () => { active += 1; maxActive = Math.max(maxActive, active); await new Promise(r => setImmediate(r)); active -= 1; },
  });
  const client = createWikimediaClient({ fetcher });
  await client.fetchRecords(qids);
  const sizes = host => calls.filter(c => new URL(c.url).hostname === host).map(c => {
    const p = new URL(c.url).searchParams;
    return (p.get('ids') || p.get('titles')).split('|').length;
  });
  assert.deepEqual(sizes('www.wikidata.org'), [50, 10]);
  assert.deepEqual(sizes('sv.wikipedia.org'), [20, 20, 20]);
  assert.deepEqual(sizes('commons.wikimedia.org'), [50, 10]);
  assert.equal(maxActive, 1, 'serial: concurrency 1');
});

test('Retry-After: later calls fail fast inside the window, or wait for it when allowed', async () => {
  const time = fakeClock();
  let answer429 = true;
  const fetcher = async () => {
    if (answer429) { answer429 = false; return jsonResponse({}, { status: 429, headers: { 'Retry-After': '30' } }); }
    return jsonResponse({ entities: { Q1: { id: 'Q1', missing: '' } } });
  };
  const failFast = createWikimediaClient({ fetcher, clock: time.clock, sleep: time.sleep });
  await assert.rejects(failFast.getEntities(['Q1']).then(r => { if (r.errors.length) throw r.errors[0]; }), { code: 'throttled' });
  const second = await failFast.getEntities(['Q1']);
  assert.equal(second.errors[0].code, 'retry_after', 'inside the Retry-After window nothing is sent');
  time.advance(30_000);
  const third = await failFast.getEntities(['Q1']);
  assert.equal(third.errors.length, 0);
  assert.equal(third.entities.get('Q1').missing, '');

  answer429 = true;
  let sent = 0;
  const counting = async (...args) => { sent += 1; return fetcher(...args); };
  const patient = createWikimediaClient({ fetcher: counting, clock: time.clock, sleep: time.sleep, retryAfterMaxWaitMs: 60_000 });
  const result = await patient.getEntities(['Q1']);
  assert.equal(result.errors.length, 0, 'waited 30 s and retried once');
  assert.equal(sent, 2);
});

test('circuit breaker: 5 failures in a row open it for 10 minutes', async () => {
  const time = fakeClock();
  let sent = 0;
  let healthy = false;
  const fetcher = async () => { sent += 1; return healthy ? jsonResponse({ entities: {} }) : jsonResponse({}, { status: 500 }); };
  const client = createWikimediaClient({ fetcher, clock: time.clock, sleep: time.sleep });
  for (let i = 0; i < 5; i += 1) assert.equal((await client.getEntities(['Q1'])).errors[0].code, 'http');
  assert.equal(sent, 5);
  assert.equal(client.health().breaker_open, true);
  assert.equal((await client.getEntities(['Q1'])).errors[0].code, 'circuit_open');
  assert.equal(sent, 5, 'nothing sent while open');
  time.advance(10 * 60 * 1000 - 1);
  assert.equal((await client.getEntities(['Q1'])).errors[0].code, 'circuit_open');
  time.advance(1);
  healthy = true;
  assert.equal((await client.getEntities(['Q1'])).errors.length, 0);
  assert.equal(sent, 6);
  // 429s count as failures too.
  healthy = false;
  const throttled = createWikimediaClient({ fetcher: async () => jsonResponse({}, { status: 429 }), clock: time.clock, sleep: time.sleep });
  for (let i = 0; i < 5; i += 1) await throttled.getEntities(['Q1']);
  assert.equal(throttled.health().breaker_open, true);
});

test('each call times out after the timeout', async () => {
  const client = createWikimediaClient({ fetcher: () => new Promise(() => {}), timeoutMs: 20 });
  const started = Date.now();
  const { errors } = await client.getEntities(['Q1']);
  assert.equal(errors[0].code, 'timeout');
  assert.ok(Date.now() - started < 1000);
  assert.equal(client.health().timeouts, 1);
});

test('excerpts are cut only at a sentence end, 40–320 characters, verbatim', () => {
  const long = 'Gustavianum är Uppsala universitets äldsta bevarade byggnad, uppförd under 1620-talet. ' +
    'Den ligger mittemot Uppsala domkyrka i korsningen Biskopsgatan och Domkyrkoplan i stadsdelen Fjärdingen i Uppsala. ' +
    'Byggnaden inrymmer idag Gustavianum, Uppsala universitetsmuseum och har ännu den anatomiska teatern på taket. ' +
    'Den sista meningen gör texten längre än gränsen tillåter.';
  const cut = cutExcerpt(long);
  assert.ok(cut.length <= 320 && cut.length >= 40);
  assert.ok(long.startsWith(cut), 'verbatim prefix');
  assert.ok(cut.endsWith('på taket.'));
  // Abbreviations and initials are not sentence ends.
  assert.equal(cutExcerpt('Museet visar bl.a. Bachs noter och J. S. Bach själv. Det öppnade 1916 och är väl besökt av många.'),
    'Museet visar bl.a. Bachs noter och J. S. Bach själv. Det öppnade 1916 och är väl besökt av många.');
  assert.equal(cutExcerpt('Kort text.'), null, 'shorter than 40');
  assert.equal(cutExcerpt('A museum without any sentence end at all and it goes on and on'), null);
  assert.equal(cutExcerpt(`${'Word '.repeat(70)}end.`), null, 'no cut within 320');
  assert.equal(cutExcerpt('The museum website is https://example.org and it is open daily for all visitors.'), null);
  assert.equal(cutExcerpt('First paragraph is the one that counts, always and only.\nSecond paragraph never joins it.'),
    'First paragraph is the one that counts, always and only.');
  assert.equal(cutExcerpt(undefined), null);
});

test('disambiguation pages and articles about another item give no excerpt', () => {
  const page = extractPage('sv', 'Medelhavsmuseet');
  assert.ok(parseExtractPage(page, { qid: 'Q1331646', lang: 'sv' }).excerpt);
  assert.deepEqual(parseExtractPage({ ...page, pageprops: { ...page.pageprops, disambiguation: '' } }, { qid: 'Q1331646', lang: 'sv' }),
    { rejected: 'disambiguation' });
  assert.deepEqual(parseExtractPage(page, { qid: 'Q98442027', lang: 'sv' }), { rejected: 'wikibase_item' });
  assert.equal(parseExtractPage({ ...page, revisions: [] }, { qid: 'Q1331646', lang: 'sv' }).rejected, 'revision');
  assert.equal(parseExtractPage({ ns: 0, title: 'X', missing: true }, { qid: 'Q1', lang: 'sv' }).rejected, 'missing');
});

test('fetchRecords drops excerpts whose article is a disambiguation page or names another QID', async () => {
  const { fetcher } = createFixtureFetcher({
    extracts: {
      'sv|Medelhavsmuseet': { ...extractPage('sv', 'Medelhavsmuseet'), pageprops: { wikibase_item: 'Q1331646', disambiguation: '' } },
      'en|Medelhavsmuseet': { ...extractPage('en', 'Medelhavsmuseet'), pageprops: { wikibase_item: 'Q98442027' } },
    },
  });
  const client = createWikimediaClient({ fetcher });
  const record = (await client.fetchRecords(['Q1331646'])).get('Q1331646');
  assert.deepEqual(record.about, {});
  assert.ok(record.photo, 'the photo does not depend on the excerpt');
  assert.deepEqual(client.health().excerpt_rejections, { disambiguation: 1, wikibase_item: 1 });
});

test('a redirected or missing entity becomes a definitive record without facts', async () => {
  const moved = { ...clone(samples.wbgetentities.entities.Q1331646), id: 'Q1331646', redirects: { from: 'Q5555', to: 'Q1331646' } };
  const fetcher = async url => {
    const ids = new URL(url).searchParams.get('ids');
    if (ids) return jsonResponse({ entities: { Q1331646: moved, Q7777: { id: 'Q7777', missing: '' } } });
    return jsonResponse({ query: { pages: [] } });
  };
  const records = await createWikimediaClient({ fetcher }).fetchRecords(['Q5555', 'Q7777']);
  assert.equal(records.get('Q5555').entity, null);
  assert.equal(records.get('Q7777').entity, null);
  assert.equal(records.get('Q7777').photo, null);
  assert.equal(parseEntity('Q5555', moved), null, 'entity id must equal the QID asked for');
});

test('photo order: P18 first, then P5775 only for venue entities, then OSM commons; never the Wikipedia page image', async () => {
  const base = clone(samples.wbgetentities.entities.Q1331646);
  // P18 points at a refused file (600 px), P5775 at a good one.
  base.claims.P18[0].mainsnak.datavalue.value = 'Skiss Biologiska stor.jpg';
  base.claims.P5775 = [{ mainsnak: { snaktype: 'value', property: 'P5775', datavalue: { value: 'Röhsska museet.jpg', type: 'string' } }, rank: 'normal' }];
  const museum = createFixtureFetcher({ entities: { Q1331646: base } });
  const museumRecord = (await createWikimediaClient({ fetcher: museum.fetcher }).fetchRecords(['Q1331646'])).get('Q1331646');
  assert.equal(museumRecord.photo, null, 'P5775 is not used for a museum entity; no other candidate');

  const venue = clone(base);
  venue.claims.P31[0].mainsnak.datavalue.value = { 'entity-type': 'item', id: 'Q11707' };
  const restaurant = createFixtureFetcher({ entities: { Q1331646: venue } });
  const venueRecord = (await createWikimediaClient({ fetcher: restaurant.fetcher }).fetchRecords(['Q1331646'])).get('Q1331646');
  assert.equal(venueRecord.photo.via, 'p5775');

  const osm = createFixtureFetcher({ entities: { Q1331646: base } });
  const osmRecord = (await createWikimediaClient({ fetcher: osm.fetcher })
    .fetchRecords(['Q1331646'], { osmCommons: new Map([['Q1331646', 'File:Hafreborg, Simrishamn.jpg']]) })).get('Q1331646');
  assert.equal(osmRecord.photo.via, 'osm_commons');

  const page = createFixtureFetcher({
    entities: { Q1331646: base },
    extracts: { 'sv|Medelhavsmuseet': { ...extractPage('sv', 'Medelhavsmuseet'), pageprops: { wikibase_item: 'Q1331646', page_image_free: 'GUSTAVIANUM_1.jpg' } } },
  });
  const pageRecord = (await createWikimediaClient({ fetcher: page.fetcher }).fetchRecords(['Q1331646'])).get('Q1331646');
  assert.equal(pageRecord.photo, null, 'a page image is never a photo candidate');
  assert.ok(!page.calls.some(call => /GUSTAVIANUM/.test(decodeURIComponent(call.url))), 'not even looked up');
});

test('deprecated P18 is never used; preferred rank goes first', () => {
  const raw = clone(samples.wbgetentities.entities.Q1331646);
  raw.claims.P18 = [
    { mainsnak: { snaktype: 'value', datavalue: { value: 'Old.jpg' } }, rank: 'deprecated' },
    { mainsnak: { snaktype: 'value', datavalue: { value: 'Normal.jpg' } }, rank: 'normal' },
    { mainsnak: { snaktype: 'value', datavalue: { value: 'Best.jpg' } }, rank: 'preferred' },
  ];
  assert.deepEqual(parseEntity('Q1331646', raw).p18, ['File:Best.jpg', 'File:Normal.jpg']);
});

test('a failed Commons lookup leaves the QID out (asked again later), not recorded as photo-less', async () => {
  const fetcher = async (url, init) => {
    if (new URL(url).hostname === 'commons.wikimedia.org') return jsonResponse({}, { status: 500 });
    return createFixtureFetcher().fetcher(url, init);
  };
  const records = await createWikimediaClient({ fetcher }).fetchRecords(['Q1331646']);
  assert.equal(records.has('Q1331646'), false);
});

test('non-places are not worth text or images: a street gets a record without extra calls', async () => {
  const { fetcher, calls } = createFixtureFetcher();
  const records = await createWikimediaClient({ fetcher }).fetchRecords(['Q11489180']);
  assert.equal(calls.length, 1);
  assert.equal(records.get('Q11489180').photo, null);
  assert.deepEqual(records.get('Q11489180').entity.p31, ['Q79007']);
});

// ---------- review 2026-11-25: hatnotes and maintenance markers ----------

const reviewShapes = require('./fixtures/place-media/review-shapes.json');

test('a svwiki hatnote paragraph is skipped: Rosendals slott gets its own intro, not "För slottet i Helsingborg, se …"', () => {
  const [rosendal, sjohistoriska] = reviewShapes.svwiki_extracts.query.pages;
  const text = cutExcerpt(rosendal.extract);
  assert.ok(text.startsWith('Rosendals slott är en slottsbyggnad på Djurgården i Stockholm'), text);
  assert.ok(rosendal.extract.includes(text), 'verbatim');
  assert.ok(!/Helsingborg, se/.test(text));
  const parsed = parseExtractPage(rosendal, { qid: 'Q59482', lang: 'sv' });
  assert.equal(parsed.excerpt.text, text);
  assert.ok(cutExcerpt(sjohistoriska.extract).startsWith('Statens Sjöhistoriska museum är ett svenskt statligt sjöfartsmuseum'));
});

test('hatnote shapes from the Sweden index never become an excerpt', () => {
  const intro = 'Platsen är en park i centrala staden med gamla träd och en damm. Den anlades på 1800-talet.';
  for (const hatnote of [
    'För slottet i Helsingborg, se Rosendals slott, Helsingborg.',
    'För Varvsberget i Västergötland se Varvsberget (Västergötland).',
    'Ej att förväxla med naturreservatet Lustigkulle-Rågåstjärn i Malingsbo, Smedjebackens kommun.',
    'Denna sida handlar om Charlottenlunds slott i Skåne.',
    'Den här artikeln handlar om slottet Rosendal utanför Helsingborg. För slottet Rosendal i Stockholm, se Rosendals slott Stockholm.',
    'Trolleholm är även namnet på en ort vid Trolleholms slott, se Trolleholm (småort). För fartyget, se M/S Trolleholm.',
    'Se även det traditionsrika värdshuset Zum Franziskaner i centrala München.',
    'Se berggrund för det geologiska begreppet.',
    'För andra reservat med samma namn, se Ekholmen (förgreningssida).',
    'This article is about the palace in Stockholm. For the castle in Helsingborg, see Rosendal Castle.',
    'Not to be confused with Näs Castle, the ruin on Visingsö.',
    'For other uses, see Kungsberget (disambiguation).',
  ]) {
    assert.equal(cutExcerpt(hatnote), null, hatnote);
    assert.equal(cutExcerpt(`${hatnote}\n\n${intro}`), intro, hatnote);
    assert.equal(isExcerptText(hatnote), false, hatnote);
  }
});

test('an excerpt stops before a maintenance marker and never carries one', () => {
  // Real svwiki intro (Fäbodmossen, Q10500671): the second sentence carries "[källa behövs]".
  const fabod = 'Fäbodmossen är ett naturreservat i Uppsala kommun, 5 km väster om Jumkils kyrka och cirka 20 km nordväst om Uppsala. Carl von Linné sägs ha använt området vid sina exkursioner[källa behövs] I områdets norra del går vandringsleden Linnéstigen.';
  assert.equal(cutExcerpt(fabod), 'Fäbodmossen är ett naturreservat i Uppsala kommun, 5 km väster om Jumkils kyrka och cirka 20 km nordväst om Uppsala.');
  // Bältespännarparken (Q10438504): the marker sits in the first sentence, so there is no excerpt.
  assert.equal(cutExcerpt('Bältespännarparken är en cirka 6 000 kvadratmeter[källa behövs] stor del av parken Kungsparken i centrala Göteborg.'), null);
  assert.equal(isExcerptText('Parken är en cirka 6 000 kvadratmeter[källa behövs] stor del av parken.'), false);
  assert.equal(isExcerptText('The park was laid out in 1850.[citation needed] It has a pond and old trees.'), false);
  // Bracketed IPA is part of the text and stays.
  const ipa = 'Almedalen (Swedish pronunciation: [ˈalmɛˈdɑːlɛn]) is a park in the city of Visby on Gotland, Sweden.';
  assert.equal(cutExcerpt(ipa), ipa);
});

test('an index record whose excerpt is a hatnote is dropped on load, so it is fetched again', () => {
  const record = { v: 1, qid: 'Q59482', checked_on: '2026-11-24', entity: null, photo: null, subtitle: {},
    about: { sv: { text: 'För slottet i Helsingborg, se Rosendals slott, Helsingborg.', title: 'Rosendals slott', rev: 59142872, lang: 'sv' } } };
  assert.equal(normalizeMediaRecord(record), null);
});

test('gold set: a nature reserve or park whose only image is the Wikipedia page image gets no photo (Stavsbjär, Bältespännarparken)', async () => {
  // Shapes from the Sweden index (2026-11-24): no P18, and PageImages picks the
  // infobox's species or a nearby building.
  for (const [qid, label, p31, pageImage] of [
    ['Q18332839', 'Stavsbjär', 'Q179049', 'Wespenbussard Pernis apivorus 02.jpg'],
    ['Q10438504', 'Bältespännarparken', 'Q22698', 'Göteborg Stora Teatern 2012.jpg'],
  ]) {
    const raw = clone(samples.wbgetentities.entities.Q1331646);
    raw.id = qid;
    raw.labels = { sv: { language: 'sv', value: label } };
    raw.aliases = {};
    raw.sitelinks = { svwiki: { site: 'svwiki', title: label } };
    raw.claims.P31 = [{ mainsnak: { snaktype: 'value', property: 'P31', datavalue: { value: { 'entity-type': 'item', id: p31 }, type: 'wikibase-entityid' } }, rank: 'normal' }];
    delete raw.claims.P18;
    delete raw.claims.P5775;
    const page = createFixtureFetcher({
      entities: { [qid]: raw },
      extracts: { [`sv|${label}`]: { pageid: 1, ns: 0, title: label, extract: `${label} är ett naturreservat i Sverige med gammal skog och rika fågelmarker.`,
        pageprops: { wikibase_item: qid, page_image_free: pageImage }, revisions: [{ revid: 100, parentid: 99 }] } },
      files: { [`File:${pageImage}`]: { ...clone(samples.commons_imageinfo.query.pages[0]), title: `File:${pageImage}` } },
    });
    const record = (await createWikimediaClient({ fetcher: page.fetcher }).fetchRecords([qid])).get(qid);
    assert.ok(record, label);
    assert.equal(record.photo, null, label);
    assert.ok(record.about.sv, `${label} keeps its excerpt`);
  }
});

test('an index record whose photo came from the page image is dropped on load, so it is fetched again', () => {
  const photo = { media_id: '1ca0883b'.padEnd(40, '0'), file_title: 'File:Lobaria pulmonaria 010108c.jpg',
    file_url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Lobaria_pulmonaria_010108c.jpg', width: 1600, height: 1200,
    via: 'page_image', author: 'Bernd Haynold', license: 'CC-BY-SA-3.0', license_url: 'https://creativecommons.org/licenses/by-sa/3.0/',
    file_page_url: 'https://commons.wikimedia.org/wiki/File:Lobaria_pulmonaria_010108c.jpg' };
  const record = { v: 1, qid: 'Q18332839', checked_on: '2026-11-24', entity: null, photo, subtitle: {}, about: {} };
  assert.equal(normalizeMediaRecord(record), null);
  assert.ok(normalizeMediaRecord({ ...record, photo: { ...photo, via: 'p18' } }));
});
