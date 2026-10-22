"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseSelectedPlaceHtmlHours: parse, selectedPlaceHtmlHoursLink: link } = require("../server/place-candidates/selected-place-html-hours");
const fixture = name => fs.readFileSync(path.join(__dirname, "fixtures/selected-place-visit-hours", name), "utf8");
const entry = fixture("gustavianum-entry.html"), detail = fixture("gustavianum-hours.html");
const record = { id: "existing-museum", name: "Gustavianum", type: "museum", website: "https://www.uu.se/gustavianum" };
const detailUrl = "https://www.uu.se/gustavianum/besok-oss/oppettider";
const options = date => ({ date, sourceUrl: detailUrl, entryHtml: entry, entrySourceUrl: record.website });
const fact = (html, date = "2026-10-19") => parse(html, record, options(date));
const page = body => `<html><head><title>Opening hours – Juniper Museum – Owner</title></head><body><a href="/museum">Juniper Museum</a><main><h1>Opening hours</h1>${body}</main></body></html>`;
const other = { name: "Juniper Museum", type: "museum", website: "https://owner.example/museum" };
const english = page("<p><strong>1 September - 31 May</strong></p><ul><li>Monday closed</li><li>Tuesday-Friday 12 PM–5 PM</li><li>Saturday-Sunday 11 AM–5 PM</li></ul><p><strong>1 June - 31 August</strong></p><ul><li>Monday-Sunday 11 AM–5 PM</li></ul>");
const englishFact = date => parse(english, other, { date, sourceUrl: other.website });

test("the owner-derived direct exceptional-hours link is selected from the opening-hours section", () => {
  assert.equal(link(entry, record, record.website), detailUrl);
  assert.equal(link(detail, record, detailUrl), null, "a detail document cannot start a chain");
});

test("the owner-derived Monday closure retains the complete week and a single selected date", () => {
  const result = fact(detail);
  assert.ok(result, "the identified, date-valid owner schedule should be usable");
  assert.equal(result.opening_hours, "Mo off; Tu 12:00-17:00; We 12:00-17:00; Th 12:00-17:00; Fr 12:00-17:00; Sa 11:00-17:00; Su 11:00-17:00");
  assert.deepEqual({ ...result, opening_hours: undefined }, { opening_hours: undefined, url: detailUrl, valid_for_date: "2026-10-19", entry_url: record.website });
  assert.equal(fact(detail, "2026-10-20"), null, "an unexplained Tuesday late-hours rule cannot be silently discarded");
});

test("a source advertising exceptions cannot publish its shorter landing-page schedule", () => {
  assert.equal(parse(entry, record, { date: "2026-10-19", sourceUrl: record.website }), null);
});

test("annual English seasons include their boundaries and wrap across New Year", () => {
  for (const date of ["2026-09-01", "2026-12-28", "2027-01-04", "2027-05-31"]) {
    assert.match(englishFact(date)?.opening_hours || "", /^Mo off;/, date);
  }
  for (const date of ["2026-06-01", "2026-08-31"]) {
    assert.match(englishFact(date)?.opening_hours || "", /^Mo 11:00-17:00;/, date);
  }
});

test("explicit holiday exceptions stay unknown instead of inheriting a weekly open window", () => {
  for (const date of ["2026-10-30", "2026-10-31", "2026-12-24", "2026-12-25", "2026-12-31", "2027-01-01"]) {
    assert.equal(fact(detail, date), null, date);
  }
  assert.ok(fact(detail, "2026-10-29"));
});

test("detail hours require the original page and its exact direct link", () => {
  for (const changes of [{ entryHtml: undefined }, { entryHtml: entry.replace("/gustavianum/besok-oss/oppettider", "/other") },
    { entrySourceUrl: "https://www.uu.se/other" }, { sourceUrl: "https://www.uu.se/other/oppettider" },
    { sourceUrl: detailUrl + "?from=payload" }, { sourceUrl: detailUrl + "#hours" },
    { sourceUrl: "https://user@www.uu.se/gustavianum/besok-oss/oppettider" }]) {
    assert.equal(parse(detail, record, { ...options("2026-10-19"), ...changes }), null, JSON.stringify(changes));
  }
});

test("wrong entity titles, unrelated h1 identities and conflicting breadcrumbs stay unknown", () => {
  assert.equal(fact(detail.replace("Öppettider – Gustavianum –", "Öppettider – Annex –")), null);
  assert.equal(fact(detail.replace('id="h-Oppettider">Öppettider', 'id="h-Oppettider">Annex Museum')), null);
  assert.equal(fact(detail.replace('id="h-Oppettider">Öppettider', 'id="h-Oppettider">Gustavianum Annex')), null);
  assert.equal(fact(detail.replace('href="/gustavianum">Gustavianum', 'href="/gustavianum/annex">Gustavianum')), null);
  assert.equal(parse(detail, { ...record, name: "Gustavianum Annex" }, options("2026-10-19")), null);
});

test("a date-like unsupported seasonal heading cannot lend an earlier season's complete week", () => {
  const unsupported = english.replace("1 June - 31 August", "June 1 through August 31");
  assert.equal(parse(unsupported, other, { date: "2026-10-19", sourceUrl: other.website }), null);
});

test("a hidden exception page is not a public direct-link proof", () => {
  const hidden = entry.replace('<a href="/gustavianum/besok-oss/oppettider"', '<a hidden href="/gustavianum/besok-oss/oppettider"');
  assert.equal(link(hidden, record, record.website), null);
  assert.equal(parse(detail, record, { ...options("2026-10-19"), entryHtml: hidden }), null);
});

test("the real owner header identity and breadcrumb navigation do not disappear with navigation facts", () => {
  // The reduced fixtures already retain header/nav identity and a hero before
  // main. Add the owner's hero container and breadcrumb list, without moving
  // an identity link into the fact scope or nesting header/nav elements.
  const wrappedEntry = entry.replace('<h1 class="jumbotron-header">Gustavianum Uppsala universitetsmuseum</h1>', '<div><h1>Gustavianum Uppsala universitetsmuseum</h1></div>');
  const wrappedDetail = detail.replace('<nav><a href="/gustavianum">Gustavianum</a></nav>', '<nav aria-label="Du är här"><ol><li><a href="/gustavianum">Gustavianum</a></li><li>Öppettider</li></ol></nav>');
  assert.equal(link(wrappedEntry, record, record.website), detailUrl);
  assert.ok(parse(wrappedDetail, record, { ...options("2026-10-19"), entryHtml: wrappedEntry }));
  const onlyNavigationFacts = wrappedDetail.replace('<main>', '<nav aria-label="Site menu">').replace('</main>', '</nav>');
  assert.equal(parse(onlyNavigationFacts, record, { ...options("2026-10-19"), entryHtml: wrappedEntry }), null);
});

test("ambiguous or unsafe hours links do not select a different same-domain place", () => {
  for (const href of ["https://other.example/hours", "/other-museum/hours", "/gustavianum/besok-oss/oppettider?x=1", "//user@www.uu.se/gustavianum/hours", "/gustavianum/hours#today"]) {
    assert.equal(link(entry.replace("/gustavianum/besok-oss/oppettider", href), record, record.website), null, href);
  }
  const ambiguous = entry.replace("</div></main>", '<a href="/gustavianum/other-hours">Avvikande öppettider</a></div></main>');
  assert.equal(link(ambiguous, record, record.website), null);
  const nav = entry.replace('<h2>Öppettider</h2>', '<nav><a href="/gustavianum/other-hours">Opening hours</a></nav><h2>Öppettider</h2>');
  assert.equal(link(nav, record, record.website), detailUrl);
});

test("partial, duplicate and conflicting weeks cannot invent unstated closures", () => {
  for (const body of [english.replace("<li>Monday closed</li>", ""),
    english.replace("<li>Monday closed</li>", "<li>Monday closed</li><li>Monday 10 AM–5 PM</li>"),
    english.replace("1 June - 31 August", "1 September - 31 May"),
    english.replace("Tuesday-Friday 12 PM–5 PM", "Tuesday-Friday by appointment")]) {
    assert.equal(parse(body, other, { date: "2026-10-19", sourceUrl: other.website }), null);
  }
});

test("service hours do not stand in for general museum hours", () => {
  for (const service of ["Café opening hours", "Guided tours", "Goods intake", "Member meetings"]) {
    const body = english.replace("<h1>Opening hours</h1>", `<h1>Opening hours</h1><h2>${service}</h2>`);
    assert.equal(parse(body, other, { date: "2026-10-19", sourceUrl: other.website }), null, service);
  }
});

test("a named museum cannot borrow a qualified service or branch h1", () => {
  for (const suffix of ["Café", "Annex", "East branch"]) {
    const qualified = english.replace('<h1>Opening hours</h1>', `<h1>Juniper Museum ${suffix}</h1><h2>Opening hours</h2>`);
    assert.equal(parse(qualified, other, { date: "2026-10-19", sourceUrl: other.website }), null, suffix);
  }
});

test("a paragraph service label cannot relabel the following week as museum hours", () => {
  const cafe = english.replace('<h1>Opening hours</h1>', '<h1>Opening hours</h1><p>Café opening hours</p>');
  assert.equal(parse(cafe, other, { date: "2026-10-19", sourceUrl: other.website }), null);
  const cafeEntry = entry.replace('<h2>Öppettider</h2>', '<h2>Öppettider</h2><p>Café opening hours</p>');
  assert.equal(link(cafeEntry, record, record.website), null);
  assert.equal(parse(detail, record, { ...options("2026-10-19"), entryHtml: cafeEntry }), null);
});

test("same-main sibling holiday exceptions cannot disappear at an hours heading boundary", () => {
  const sibling = english.replace('<h1>Opening hours</h1>', '<h1>Juniper Museum</h1><h2>Opening hours</h2>')
    .replace('</main>', '<h2>Holiday exceptions</h2><p>2026</p><p>25/12 Closed</p></main>');
  assert.equal(parse(sibling, other, { date: "2026-12-25", sourceUrl: other.website }), null);
});

test("an explicit year before an annual-looking season cannot be discarded", () => {
  for (const year of ["2025", "2026"]) {
    const dated = english.replace('<h1>Opening hours</h1>', `<h1>Opening hours</h1><p>${year}</p>`);
    assert.equal(parse(dated, other, { date: "2026-10-19", sourceUrl: other.website }), null, year);
  }
});

test("unsupported dated or indefinite closure prose cannot become a weekly open visit", () => {
  for (const notice of ["Closed for renovation 25 October 2026", "Closed for renovation 25 October", "Closed until further notice", "Opening exceptions may apply"]) {
    const closed = english.replace('</main>', `<p>${notice}</p></main>`);
    assert.equal(parse(closed, other, { date: "2026-10-25", sourceUrl: other.website }), null, notice);
  }
});

test("visible conditions outside supported assertion blocks cannot be discarded", () => {
  for (const notice of [
    '<div>Closed for renovation 25 October 2026</div>',
    '<span>Closed until further notice</span>',
    'Closed for renovation 25 October',
    '<div>Café opening hours</div>',
    '<div>2025</div>',
  ]) {
    const body = english.replace('</main>', `${notice}</main>`);
    assert.equal(parse(body, other, { date: '2026-10-25', sourceUrl: other.website }), null, notice);
  }
  const cafeEntry = entry.replace('</main>', '<div>Café opening hours</div></main>');
  assert.equal(link(cafeEntry, record, record.website), null, 'unscoped service labels cannot authorize an hours hop');
  assert.equal(parse(detail, record, { ...options('2026-10-19'), entryHtml: cafeEntry }), null);
  const currentStatus = entry.replace('</main>', '<div><span>Stängt</span><span>Öppnar 20 okt kl 12.00</span></div></main>');
  assert.equal(link(currentStatus, record, record.website), detailUrl, 'an undated current-status badge does not prevent checking the actual linked schedule');
  assert.ok(parse(detail, record, { ...options('2026-10-19'), entryHtml: currentStatus }));
});

test("inline markup cannot split a visible service or closure condition past the reader", () => {
  for (const notice of ['<div>Guided <span>tours</span></div>', '<div>Gui<span>ded</span> tours</div>',
    '<div><span>Guided </span><span>tours</span></div>', '<div>Caf<span>é</span> opening hours</div>',
    '<p>Caf<span>éets</span> öppettider</p>']) {
    assert.equal(parse(english.replace('</main>', notice + '</main>'), other,
      { date: '2026-10-25', sourceUrl: other.website }), null, notice);
    const qualifiedEntry = entry.replace('</main>', notice + '</main>');
    assert.equal(link(qualifiedEntry, record, record.website), null, notice);
    assert.equal(parse(detail, record, { ...options('2026-10-19'), entryHtml: qualifiedEntry }), null, notice);
  }
  assert.equal(parse(english.replace('</main>', '<div>Cl<span>osed</span> until further notice</div></main>'),
    other, { date: '2026-10-25', sourceUrl: other.website }), null);
});

test("inline markup preserves the actual weekday text in a complete supported week", () => {
  const split = english.replace('Monday closed', 'Mon<span>day</span> closed');
  assert.match(parse(split, other, { date: '2026-10-19', sourceUrl: other.website })?.opening_hours || '', /^Mo off;/);
});

test("hours-heading and skipped-paragraph boundaries cannot merge away an unsupported condition", () => {
  const afterHeading = entry.replace('<h2>Öppettider</h2>', '<h2>Öppettider</h2><span>Café opening hours</span>');
  assert.equal(link(afterHeading, record, record.website), null);
  assert.equal(parse(detail, record, { ...options('2026-10-19'), entryHtml: afterHeading }), null);
  const closed = detail.replace('id="h-Oppettider">Öppettider</h1>', 'id="h-Oppettider">Öppettider</h1><span>Closed until further notice</span>');
  assert.equal(fact(closed), null);
  const aroundParagraph = entry.replace('</main>', '<span>Café</span><p>Visit information</p><span>opening hours</span></main>');
  assert.equal(link(aroundParagraph, record, record.website), null);
});

test("malformed dates, oversized documents and missing main scopes remain unknown", () => {
  for (const date of [undefined, "2026-02-30", "2026-10-19T12:00:00Z", "19 October 2026"]) assert.equal(parse(detail, record, options(date)), null);
  assert.equal(fact(detail.replace(/main/g, "aside")), null);
  assert.equal(fact("x".repeat(512 * 1024 + 1)), null);
});
