'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { gateCommonsPage, stripHtml } = require('../server/place-media/commons-gate');
const {
  normalizeCommonsLicense, isMediaLicenseUrl, isMediaLicenseId, mediaLicenseLabel, MEDIA_LICENSE_IDS,
} = require('../shared/media-licenses.mjs');
const { commonsPage } = require('./helpers/place-media-fixtures');
const { isAuthor } = require('../server/place-media/record');

function withMeta(page, changes) {
  const ii = page.imageinfo[0];
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete ii.extmetadata[key];
    else ii.extmetadata[key] = { value, source: 'commons-desc-page' };
  }
  return page;
}

test('a real CC BY-SA 3.0 photo passes with its real credit and canonical Commons URLs', () => {
  const photo = gateCommonsPage(commonsPage('File:Medelhavsmuseet 2007.jpg'), { via: 'p18' });
  assert.deepEqual(photo, {
    media_id: photo.media_id,
    file_title: 'File:Medelhavsmuseet 2007.jpg',
    file_url: 'https://upload.wikimedia.org/wikipedia/commons/d/da/Medelhavsmuseet_2007.jpg',
    width: 1780, height: photo.height, via: 'p18',
    author: 'Holger Ellgaard', // HTML link and the "edit at Structured Data" icon are stripped
    license: 'CC-BY-SA-3.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/3.0/',
    file_page_url: 'https://commons.wikimedia.org/wiki/File:Medelhavsmuseet_2007.jpg',
  });
  assert.match(photo.media_id, /^[0-9a-f]{40}$/);
  assert.ok(photo.height > 0);
});

test('NonFree files are refused (a Guernica-like local non-free upload)', () => {
  assert.deepEqual(gateCommonsPage(withMeta(commonsPage('File:Medelhavsmuseet 2007.jpg'), { NonFree: 'true' }), { via: 'p18' }),
    { rejected: 'nonfree' });
  // A file that only exists on a Wikipedia (non-free fair use) is not on Commons.
  const local = commonsPage('File:Medelhavsmuseet 2007.jpg');
  local.imagerepository = 'shared';
  assert.deepEqual(gateCommonsPage(local, { via: 'p18' }), { rejected: 'not_commons' });
  const enwiki = commonsPage('File:Medelhavsmuseet 2007.jpg');
  enwiki.imageinfo[0].url = 'https://upload.wikimedia.org/wikipedia/en/d/da/Guernica.jpg';
  assert.deepEqual(gateCommonsPage(enwiki, { via: 'p18' }), { rejected: 'not_commons' });
  assert.deepEqual(gateCommonsPage({ ns: 6, title: 'File:Guernica.jpg', missing: true }, { via: 'p18' }), { rejected: 'missing' });
});

test('GFDL-only, FAL, plain "Attribution", NC and unreadable multi-licences are refused', () => {
  const page = () => commonsPage('File:Röhsska museet.jpg');
  assert.deepEqual(gateCommonsPage(withMeta(page(), { License: 'gfdl', LicenseShortName: 'GFDL', LicenseUrl: 'https://www.gnu.org/copyleft/fdl.html' }), { via: 'p18' }), { rejected: 'license' });
  assert.deepEqual(gateCommonsPage(withMeta(page(), { License: 'fal', LicenseShortName: 'FAL', LicenseUrl: undefined }), { via: 'p18' }), { rejected: 'license' });
  assert.deepEqual(gateCommonsPage(withMeta(page(), { License: 'cc-by-nc-sa-3.0', LicenseShortName: 'CC BY-NC-SA 3.0' }), { via: 'p18' }), { rejected: 'license' });
  // Code and short name disagree: a dual licence we cannot read as one.
  assert.deepEqual(gateCommonsPage(withMeta(page(), { LicenseShortName: 'CC BY-SA 3.0 + GFDL' }), { via: 'p18' }), { rejected: 'license' });
  assert.deepEqual(gateCommonsPage(withMeta(page(), { LicenseShortName: 'CC BY 3.0' }), { via: 'p18' }), { rejected: 'license' });
  // Real file whose only licence statement is "Attribution".
  assert.deepEqual(gateCommonsPage(commonsPage('File:Museum of World Culture Göteborg entrance.jpeg'), { via: 'p18' }), { rejected: 'license' });
  // URL that contradicts the code.
  assert.deepEqual(gateCommonsPage(withMeta(page(), { LicenseUrl: 'https://creativecommons.org/licenses/by-nc/3.0/' }), { via: 'p18' }), { rejected: 'license' });
});

test('files with Restrictions are refused', () => {
  assert.deepEqual(gateCommonsPage(withMeta(commonsPage('File:Röhsska museet.jpg'), { Restrictions: 'trademarked' }), { via: 'p18' }),
    { rejected: 'restrictions' });
});

test('SVG and other non-photo types are refused; so are small originals', () => {
  const svg = commonsPage('File:Röhsska museet.jpg');
  svg.imageinfo[0].mime = 'image/svg+xml';
  assert.deepEqual(gateCommonsPage(svg, { via: 'p18' }), { rejected: 'mime' });
  const gif = commonsPage('File:Röhsska museet.jpg');
  gif.imageinfo[0].mime = 'image/gif';
  assert.deepEqual(gateCommonsPage(gif, { via: 'p18' }), { rejected: 'mime' });
  // Real 600 px original.
  assert.deepEqual(gateCommonsPage(commonsPage('File:Skiss Biologiska stor.jpg'), { via: 'p18' }), { rejected: 'size' });
});

test('maps, plans, logos, flags, coats of arms and diagrams are refused by title', () => {
  for (const title of ['File:Coat of arms of Lund.jpg', 'File:Lunds vapen.jpg', 'File:Karta över Visby.jpg', 'File:Gustavianum plan.png',
    'File:Röhsska logo.png', 'File:Flag of Sweden.jpg', 'File:Diagram of the museum.jpg', 'File:Stadtplan Wien.jpg']) {
    const page = commonsPage('File:Röhsska museet.jpg');
    page.title = title;
    page.imageinfo[0].descriptionurl = `https://commons.wikimedia.org/wiki/${encodeURI(title.replace(/ /g, '_'))}`;
    assert.deepEqual(gateCommonsPage(page, { via: 'p18' }), { rejected: 'not_a_photo' }, title);
  }
  // Words that merely contain those letters are fine.
  const ok = commonsPage('File:Röhsska museet.jpg');
  ok.title = 'File:Planetarium Mapleton.jpg';
  ok.imageinfo[0].descriptionurl = 'https://commons.wikimedia.org/wiki/File:Planetarium_Mapleton.jpg';
  assert.equal(gateCommonsPage(ok, { via: 'p18' }).rejected, undefined);
});

test('CC BY without an author is refused; "Own work" is not an author', () => {
  // Real Castelo de São Jorge file: empty Artist and Credit (made wide enough to reach the author check).
  const castelo = commonsPage('File:Castelo Sao Jorge Lisboa 1.JPG');
  castelo.imageinfo[0].width = 1600;
  assert.deepEqual(gateCommonsPage(castelo, { via: 'p18' }), { rejected: 'author' });
  const ownWork = withMeta(commonsPage('File:Röhsska museet.jpg'), { Attribution: undefined, Artist: undefined, Credit: '<span class="int-own-work" lang="en">Own work</span>' });
  assert.deepEqual(gateCommonsPage(ownWork, { via: 'p18' }), { rejected: 'author' });
});

test('an author that starts like a URL, is too long or has control characters is refused', () => {
  for (const artist of ['https://example.org/me', 'http://flickr.com/x', 'www.example.org', '//example.org/me', 'x'.repeat(201), 'Jane\u0007Doe']) {
    const page = withMeta(commonsPage('File:Exterior Medicinhistoriska museet Göteborg.jpg'), { Artist: artist });
    assert.deepEqual(gateCommonsPage(page, { via: 'p18' }), { rejected: 'author' }, artist);
  }
});

test('Attribution wins over Artist; "I, <user>" credits the user', () => {
  const rohsska = gateCommonsPage(commonsPage('File:Röhsska museet.jpg'), { via: 'p18' });
  assert.equal(rohsska.author, 'Henrik Sendelbach');
  const hafreborg = gateCommonsPage(commonsPage('File:Hafreborg, Simrishamn.jpg'), { via: 'osm_commons' });
  assert.equal(hafreborg.author, 'Jorchr');
  assert.equal(hafreborg.license_url, 'https://creativecommons.org/licenses/by-sa/3.0/', 'http upgraded to https');
});

test("Commons' no-author placeholder is not a credit; talk-page signatures keep only the name", () => {
  // Real Artist values seen in the Sweden index build (2026-11-24).
  const placeholder = 'No machine-readable author provided. Kalle1~commonswiki assumed (based on copyright claims).';
  const ccBy = withMeta(commonsPage('File:Exterior Medicinhistoriska museet Göteborg.jpg'), { Artist: placeholder, Credit: undefined });
  assert.deepEqual(gateCommonsPage(ccBy, { via: 'p18' }), { rejected: 'author' }, 'CC BY needs a real author');
  const pd = withMeta(commonsPage('File:Ørstedsparken sommer 1.jpg'), { Artist: placeholder, Credit: undefined, Attribution: undefined });
  assert.equal(gateCommonsPage(pd, { via: 'p18' }).author, null, 'PD keeps the photo without the guessed author');
  for (const [artist, name] of [
    ['<a href="//commons.wikimedia.org/wiki/User:Mats_Halldin">Mats Halldin</a> 15:22, 28 March 2007 (UTC)', 'Mats Halldin'],
    ['Kristian Peters -- Fabelfroh 10:24, 12 January 2007 (UTC)', 'Kristian Peters -- Fabelfroh'],
    ['Walter Siegmund (talk)', 'Walter Siegmund'],
  ]) {
    const page = withMeta(commonsPage('File:Exterior Medicinhistoriska museet Göteborg.jpg'), { Artist: artist });
    assert.equal(gateCommonsPage(page, { via: 'p18' }).author, name, artist);
  }
  // The same placeholder for the source lands in Credit; it is no author either.
  const sourcePlaceholder = 'No machine-readable source provided. Own work assumed (based on copyright claims).';
  const credit = withMeta(commonsPage('File:Exterior Medicinhistoriska museet Göteborg.jpg'), { Artist: undefined, Credit: sourcePlaceholder });
  assert.deepEqual(gateCommonsPage(credit, { via: 'p18' }), { rejected: 'author' });
  // A record (or a shared day) carrying a placeholder as an author is refused too.
  assert.equal(isAuthor(placeholder), false);
  assert.equal(isAuthor(sourcePlaceholder), false);
});

test('Credit is the last fallback for the author', () => {
  const page = withMeta(commonsPage('File:Exterior Medicinhistoriska museet Göteborg.jpg'), { Artist: undefined });
  const photo = gateCommonsPage(page, { via: 'p18' });
  assert.equal(photo.author, 'Från Medicinhistoriska museets samlingar');
  assert.equal(photo.license, 'CC-BY-4.0');
});

test('public domain and CC0 need no author', () => {
  const pd = withMeta(commonsPage('File:Ørstedsparken sommer 1.jpg'), { Artist: undefined, Credit: undefined, Attribution: undefined });
  const photo = gateCommonsPage(pd, { via: 'p18' });
  assert.equal(photo.author, null);
  assert.equal(photo.license, 'PD');
  assert.equal(photo.license_url, null);
  const cc0 = gateCommonsPage(commonsPage('File:Mendelssohn-Remise.Hof.1.jpg'), { via: 'p18' });
  assert.equal(cc0.license, 'CC0-1.0');
  assert.equal(cc0.license_url, 'https://creativecommons.org/publicdomain/zero/1.0/deed.en');
});

test('a ported CC BY-SA 3.0 de keeps its real URL', () => {
  const page = withMeta(commonsPage('File:Röhsska museet.jpg'), {
    License: 'cc-by-sa-3.0-de', LicenseShortName: 'CC BY-SA 3.0 de', LicenseUrl: 'http://creativecommons.org/licenses/by-sa/3.0/de/deed.en',
  });
  const photo = gateCommonsPage(page, { via: 'p18' });
  assert.equal(photo.license, 'CC-BY-SA-3.0');
  assert.equal(photo.license_url, 'https://creativecommons.org/licenses/by-sa/3.0/de/deed.en');
  // A port without its URL is never guessed.
  assert.deepEqual(gateCommonsPage(withMeta(commonsPage('File:Röhsska museet.jpg'), {
    License: 'cc-by-sa-3.0-de', LicenseShortName: 'CC BY-SA 3.0 de', LicenseUrl: undefined }), { via: 'p18' }), { rejected: 'license' });
  // A port the URL does not name is refused.
  assert.deepEqual(gateCommonsPage(withMeta(commonsPage('File:Röhsska museet.jpg'), {
    License: 'cc-by-sa-3.0-de', LicenseShortName: 'CC BY-SA 3.0 de', LicenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/' }), { via: 'p18' }), { rejected: 'license' });
});

test('missing sha1, foreign description page or unknown via are refused', () => {
  const noSha = commonsPage('File:Röhsska museet.jpg');
  delete noSha.imageinfo[0].sha1;
  assert.deepEqual(gateCommonsPage(noSha, { via: 'p18' }), { rejected: 'sha1' });
  const otherPage = commonsPage('File:Röhsska museet.jpg');
  otherPage.imageinfo[0].descriptionurl = 'https://commons.wikimedia.org/wiki/File:Something_else.jpg';
  assert.deepEqual(gateCommonsPage(otherPage, { via: 'p18' }), { rejected: 'not_commons' });
  assert.deepEqual(gateCommonsPage(commonsPage('File:Röhsska museet.jpg'), { via: 'p154' }), { rejected: 'via' });
  // The Wikipedia page image is no route to a photo any more.
  assert.deepEqual(gateCommonsPage(commonsPage('File:Röhsska museet.jpg'), { via: 'page_image' }), { rejected: 'via' });
});

test('stripHtml drops hidden duplicates, tags and entities', () => {
  assert.equal(stripHtml('Unknown author<span style="display: none;">Unknown author</span>'), 'Unknown author');
  assert.equal(stripHtml('<a href="//x">Jane &amp; John</a>&nbsp; Doe'), 'Jane & John Doe');
  assert.equal(stripHtml(undefined), '');
});

test('media-licenses: one list, normalisation and URL checks', () => {
  assert.deepEqual([...MEDIA_LICENSE_IDS].sort(), ['CC-BY-1.0', 'CC-BY-2.0', 'CC-BY-2.5', 'CC-BY-3.0', 'CC-BY-4.0',
    'CC-BY-SA-1.0', 'CC-BY-SA-2.0', 'CC-BY-SA-2.5', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0', 'CC0-1.0', 'PD']);
  assert.equal(isMediaLicenseId('GFDL'), false);
  assert.equal(mediaLicenseLabel('CC-BY-SA-4.0'), 'CC BY-SA 4.0');
  assert.deepEqual(normalizeCommonsLicense({ code: 'cc-by-2.0', shortName: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0' }),
    { id: 'CC-BY-2.0', url: 'https://creativecommons.org/licenses/by/2.0/' });
  assert.deepEqual(normalizeCommonsLicense({ code: 'cc-by-4.0' }), { id: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' });
  assert.equal(normalizeCommonsLicense({ code: '', shortName: 'Attribution' }), null);
  assert.equal(normalizeCommonsLicense({ code: 'cc-by-sa-3.0', url: 'javascript:alert(1)' }), null);
  assert.equal(isMediaLicenseUrl('CC-BY-SA-3.0', 'https://creativecommons.org/licenses/by-sa/3.0/de/'), true);
  assert.equal(isMediaLicenseUrl('CC-BY-SA-3.0', 'https://creativecommons.org/licenses/by/3.0/'), false);
  assert.equal(isMediaLicenseUrl('PD', null), true);
  assert.equal(isMediaLicenseUrl('CC-BY-4.0', 'https://evil.example/licenses/by/4.0/'), false);
});

// ---------- review 2026-11-25: placeholders and footnote links are not credits ----------

const reviewShapes = require('./fixtures/place-media/review-shapes.json');
function reviewPage(title) {
  const page = reviewShapes.commons_imageinfo.query.pages.find(row => row.title === title);
  if (!page) throw new Error(`no review page ${title}`);
  return { ...JSON.parse(JSON.stringify(page)), ns: 6, imagerepository: 'local' };
}

test('"Unknown author" is no credit: a CC BY 3.0 photo with only that placeholder is refused (Sundbyholms slott)', () => {
  // Live metadata: Artist "Unknown author<span hidden>…", Credit a mynewsdesk URL.
  assert.deepEqual(gateCommonsPage(reviewPage('File:Sundbyholms slott.jpg'), { via: 'p18' }), { rejected: 'author' });
  // The same placeholder on a public-domain file keeps the photo without an author.
  const pd = withMeta(commonsPage('File:Ørstedsparken sommer 1.jpg'), {
    Artist: 'Unknown author<span style="display: none;">Unknown author</span>', Credit: undefined, Attribution: undefined });
  assert.equal(gateCommonsPage(pd, { via: 'p18' }).author, null);
  for (const placeholder of ['Unknown author', 'Unknown', 'Anonymous', 'Okänd', 'Okänd Okänd', 'Okänd fotograf', 'unbekannt',
    'Unknown illustrator and xylographer', 'Unknown photographer.']) {
    assert.equal(isAuthor(placeholder), false, placeholder);
    const ccBy = withMeta(commonsPage('File:Exterior Medicinhistoriska museet Göteborg.jpg'), { Artist: placeholder, Credit: undefined });
    assert.deepEqual(gateCommonsPage(ccBy, { via: 'p18' }), { rejected: 'author' }, placeholder);
  }
  // Names that merely contain such a word still credit someone.
  for (const name of ['Fotograf okänd, 1913, (Fotonummer F 49340) Stockholms stadsmuseum', 'Anonym user 1', 'C316097', 'J 1982']) {
    assert.equal(isAuthor(name), true, name);
  }
  assert.equal(gateCommonsPage(reviewPage('File:Hässelby strandbad 1913.jpg'), { via: 'p18' }).author,
    'Fotograf okänd, 1913, (Fotonummer F 49340) Stockholms stadsmuseum');
});

test('a footnote link in Credit is no author: a PD photo keeps author null, never "[1]" (Astridmuseum)', () => {
  const photo = gateCommonsPage(reviewPage('File:Astridmuseum.jpg'), { via: 'p18' });
  assert.equal(photo.rejected, undefined);
  assert.equal(photo.license, 'PD');
  assert.equal(photo.author, null);
  // A URL-only Credit no longer refuses a public-domain photo either.
  const urlCredit = withMeta(commonsPage('File:Ørstedsparken sommer 1.jpg'), {
    Artist: undefined, Attribution: undefined, Credit: '<a href="https://example.org/x">https://example.org/x</a>' });
  assert.equal(gateCommonsPage(urlCredit, { via: 'p18' }).author, null);
  // …but it never stands in for a CC credit.
  const ccUrl = withMeta(commonsPage('File:Exterior Medicinhistoriska museet Göteborg.jpg'), {
    Artist: undefined, Credit: '<a class="external autonumber" href="https://example.org/x">[1]</a>' });
  assert.deepEqual(gateCommonsPage(ccUrl, { via: 'p18' }), { rejected: 'author' });
  for (const value of ['[1]', '[12]', 'A', '.', '1']) assert.equal(isAuthor(value), false, value);
});
