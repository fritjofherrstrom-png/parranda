"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { collectOfficialProgramRows } = require("../server/pulse-sources/official-program-article-rows");
const { extractOfficialProgramArticle } = require("../server/pulse-sources/official-program-article-normalizer");

const fixture = fs.readFileSync(path.join(__dirname, "fixtures/card-event-programme.html"), "utf8");
function parse(html = fixture, options = {}) {
  return extractOfficialProgramArticle(html, {
    sourceUrl: "https://unrelated.example/schedule?edition=2026",
    timezone: "Europe/Stockholm", sourceLanguage: "sv", referenceDate: "2026-10-27", ...options,
  });
}
function projection(rows) {
  return rows.map((row) => [row.title, row.date_range.start, [row.time.start.hour, row.time.start.minute], row.time.end && [row.time.end.hour, row.time.end.minute], row.venue]);
}

test("collectOfficialProgramRows reads semantic date/venue cards including a clock preceding its h4", () => {
  const result = collectOfficialProgramRows(fixture);
  assert.equal(result.recognized, true, "semantic card programme must reach the existing official row collector");
  assert.equal(result.page_year, 2026);
  assert.equal(result.programme_title, "Program Sjögläntan lyser 2026");
  assert.equal(result.program_section_count, 1);
  assert.equal(result.candidate_row_count, 6);
  assert.equal(result.timed_row_count, 6);
  assert.equal(result.all_day_row_count, 0);
  assert.deepEqual(projection(result.rows), [
    ["Lyktgården", { year: 2026, month: 10, day: 30 }, [17, 30], [18, 0], "Lyktgården, Sjövägen 4, SJÖGLÄNTAN"],
    ["Kvarnboden", { year: 2026, month: 10, day: 30 }, [8, 0], [17, 0], "Kvarnboden, Allégatan 3, SJÖGLÄNTAN"],
    ["Kvarnboden", { year: 2026, month: 10, day: 30 }, [17, 0], [21, 0], "Kvarnboden, Allégatan 3, SJÖGLÄNTAN"],
    ["Ateljé Eken", { year: 2026, month: 10, day: 30 }, [11, 30], [22, 0], "Ateljé Eken, Torget 6, SJÖGLÄNTAN"],
    ["Kvarnboden", { year: 2026, month: 10, day: 31 }, [19, 0], null, "Kvarnboden, Allégatan 3, SJÖGLÄNTAN"],
    ["Vävstugan", { year: 2026, month: 11, day: 1 }, [12, 0], [16, 0], "Vävstugan, Hamngatan 8, SJÖGLÄNTAN"],
  ]);
  assert.ok(result.rows.every((row) => row.area === "SJÖGLÄNTAN" && row.states_daily === false && row.program_marker === result.programme_title));
});

test("normalizer retains explicit context and unknown end time without invented geodata or ad-copy titles", () => {
  const result = parse();
  assert.equal(result.recognized, true);
  assert.equal(result.events.length, 6);
  assert.deepEqual(result.events.map((event) => [event.title, event.starts_at, event.ends_at]), [
    ["Lyktgården", "2026-10-30T16:30:00.000Z", "2026-10-30T17:00:00.000Z"],
    ["Kvarnboden", "2026-10-30T07:00:00.000Z", "2026-10-30T16:00:00.000Z"],
    ["Kvarnboden", "2026-10-30T16:00:00.000Z", "2026-10-30T20:00:00.000Z"],
    ["Ateljé Eken", "2026-10-30T10:30:00.000Z", "2026-10-30T21:00:00.000Z"],
    ["Kvarnboden", "2026-10-31T18:00:00.000Z", undefined],
    ["Vävstugan", "2026-11-01T11:00:00.000Z", "2026-11-01T15:00:00.000Z"],
  ]);
  for (const event of result.events) {
    assert.equal(event.lat, undefined);
    assert.equal(event.lng, undefined);
    assert.equal(event.area, "SJÖGLÄNTAN");
    assert.equal(event.source_url, "https://unrelated.example/schedule?edition=2026");
    assert.deepEqual(event.programme, { title: "Program Sjögläntan lyser 2026", source_url: event.source_url, starts_on: "2026-10-30", ends_on: "2026-11-01" });
  }
});

test("row prose pointing at another venue cannot inherit its card's address", () => {
  for (const activity of [
    "Konsert på Andra Salen, Ekvägen 5",
    "Concert at Another Hall, Oak Road 5",
    "Concert at Another Hall",
  ]) {
    const html = cards().replace("<span>Music</span>", `<span>${activity}</span>`);
    const rows = collectOfficialProgramRows(html).rows;
    assert.equal(rows.length, 1, "an explicit alternate place must not be published at the card venue");
    assert.equal(rows[0].time.start.hour, 8);
  }
});

test("featured prose cannot point at another venue and inherit the header address", () => {
  const featured = "<div><div><span>Concert at Another Hall</span><span>17:30–18:00</span><h4>Beacon Hall</h4><span>Quay Road 4</span></div></div>";
  const html = cards().replace("<h3>Friday 30/10</h3>", `<h3>Friday 30/10</h3>${featured}`);
  const rows = collectOfficialProgramRows(html).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.time.start.hour !== 17));
});

test("activity objects and titles are not automatically other physical locations", () => {
  for (const activity of [
    "Leverantörer bjuder på sina produkter",
    "Prova på minigolf",
    "Sömnlös i Seattle – gratis, bokning krävs",
    "Sing in English",
  ]) {
    const html = cards().replace("<span>Music</span>", `<span>${activity}</span>`);
    assert.equal(collectOfficialProgramRows(html).rows.length, 2, activity);
  }
});

test("row prose may explicitly retain its own card venue", () => {
  const html = cards().replace("<span>Music</span>", "<span>Music at Beacon Hall</span>");
  assert.equal(collectOfficialProgramRows(html).rows.length, 2);
});

function cards({ title = "Programme Lantern Vale 2026", locality = "Willowmere", day = "Friday 30/10", content = "<div><div><h4>Beacon Hall</h4><span>Quay Road 4</span></div><div><span>8–17</span><span>Open</span></div><div><span>19.00</span><span>Music</span></div></div>" } = {}) {
  return `<section aria-label="${title}"><div><h2>${locality}</h2></div><div><h3>${day}</h3>${content}</div></section>`;
}

test("arbitrary or absent classes and an unrelated named region retain identical atoms", () => {
  const expected = collectOfficialProgramRows(fixture);
  for (const html of [fixture.replace(/class="[^"]*"/g, 'class="unrelated-42"'), fixture.replace(/class="[^"]*"/g, ""), fixture.replace("<section ", '<div role="region" ').replace("</section>", "</div>")]) {
    assert.deepEqual(collectOfficialProgramRows(html), expected);
  }
});

test("programme name and a single explicit title year cannot come from URL, body, footer or reference year", () => {
  for (const title of ["Programme Lantern Vale", "Lantern Vale 2026", "Programme 2026", "Programme Lantern Vale 2025 2026"]) {
    const html = `<h1>Programme Lantern Vale 2026</h1>${cards({ title })}<p>Book by 25 October 2026.</p><footer>2026</footer>`;
    assert.deepEqual(parse(html).events, [], title);
  }
  const noLabel = cards().replace(/ aria-label="[^"]*"/, "").replace("<h2>Willowmere</h2>", "<h2>Programme at Ticket Hall 2026</h2>").replace("</section>", "<p><strong>18.00 False event</strong><br>Book by 25 October 2026.</p></section>");
  assert.deepEqual(parse(noLabel).events, []);
});

test("missing or generic locality cannot be repaired by another region or a footer", () => {
  for (const html of [cards({ locality: "" }), cards({ locality: "Programme" }), cards().replace("<h2>Willowmere</h2>", ""), cards().replace("<h2>Willowmere</h2>", "<h2>Willowmere</h2><h2>Other town</h2>")]) {
    assert.deepEqual(parse(`<h2>Elsewhere</h2>${html}<footer><h2>Willowmere</h2></footer>`).events, []);
  }
});

test("cards require their own visible venue and address, not a neighbouring venue's authority", () => {
  for (const change of [
    (s) => s.replace("<h4>Lyktgården</h4>", "<h4></h4>"),
    (s) => s.replace("<span>Sjövägen 4</span>", ""),
    (s) => s.replace("<span>Sjövägen 4</span>", "<span hidden>Sjövägen 4</span>"),
    (s) => s.replace("<h4>Lyktgården</h4>", '<h4 aria-hidden="true">Lyktgården</h4>'),
  ]) {
    const rows = collectOfficialProgramRows(change(fixture)).rows;
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.title !== "Lyktgården"));
  }
});

test("whole hours are fields, never permissively mined from prose or malformed clock strings", () => {
  for (const clock of ["17 &amp; 19", "17.00 &amp; 19.00", "8–late", "8–25", "25–26", "18.000", "18:00:30", "8–17:000", "18:60–19", "17–8", "17–17", "Open 8–17", "8–17 maybe", "8", "Fre 10–21, lör–sön 10–19"]) {
    const html = cards().replace("<span>8–17</span>", `<span>${clock}</span>`);
    assert.deepEqual(collectOfficialProgramRows(html).rows.map((row) => [row.time.start.hour, row.time.end]), [[19, null]], clock);
  }
  const html = cards().replace("<div><span>8–17</span><span>Open</span></div>", "<div>8–17 Open</div>");
  assert.equal(collectOfficialProgramRows(html).rows.length, 1);
});

test("invalid dates, weekday disagreement, booking headings and multiple dates fail closed", () => {
  for (const day of ["31/11", "29/2", "Saturday 30/10", "Blursday 30/10", "Friday 30/10 or 31/10", "Book by 30/10", "", "30/10 2025"]) {
    assert.deepEqual(parse(cards({ day })).events, [], day);
  }
  assert.equal(parse(cards({ title: "Programme Lantern Vale 2024", day: "Thursday 29/2" })).events.length, 2);
});

test("numeric date order needs independent valid h3 evidence in this programme only", () => {
  for (const day of ["1/11", "Sunday 1/11", "Sunday 11/1"]) {
    assert.deepEqual(parse(cards({ day })).events, [], day);
  }
  assert.equal(parse(cards({ day: "Sunday 1/2" })).events.length, 2);
  assert.equal(parse(cards({ day: "1/1" })).events.length, 2);
  assert.deepEqual(parse(cards({ day: "Sunday 1/11" }) + "<h3>Friday 30/10</h3><footer>30/10</footer>").events, []);
  assert.deepEqual(parse(cards({ day: "Sunday 1/11" }).replace("</section>", "<p>Book by 30/10.</p></section>")).events, []);
});

test("an invalid or unsupported day resets scope and whole-weekend prose is not expanded", () => {
  const html = fixture.replace("<span>Lördag</span><span>31/10</span>", "<span>Lördag</span><span>31/11</span>");
  const rows = collectOfficialProgramRows(html).rows;
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.date_range.start.day !== 31));
  assert.ok(rows.every((row) => row.title !== "Ljusboden"));
  const orphan = cards().replace("</section>", "<div><div><div><h4>Orphan room</h4><span>No Day Street 2</span></div><div><span>20–21</span><span>Open</span></div></div></div></section>");
  assert.equal(collectOfficialProgramRows(orphan).rows.length, 2);
});

test("hidden and ignored ancestors cannot establish programme facts or legacy fallback", () => {
  for (const wrap of [
    (s) => `<div hidden>${s}</div>`, (s) => `<div aria-hidden="true">${s}</div>`,
    (s) => `<div style="display: none !important">${s}</div>`, (s) => `<div style="visibility:hidden">${s}</div>`,
    (s) => `<div inert>${s}</div>`,
    ...["script", "style", "nav", "footer", "header", "template"].map((tag) => (s) => `<${tag}>${s}</${tag}>`),
  ]) assert.deepEqual(parse(wrap(cards())).events, []);
});

test("invisible inline descendants cannot provide a locality, day, venue, address or time", () => {
  for (const html of [
    cards({ locality: '<span hidden>Willowmere</span>' }),
    cards({ day: 'Friday <span aria-hidden="true">30/10</span>' }),
    cards().replace("<h4>Beacon Hall</h4>", "<h4><span hidden>Beacon Hall</span></h4>"),
    cards().replace("<span>Quay Road 4</span>", "<span><span hidden>Quay Road 4</span></span>"),
    cards().replace("<span>8–17</span>", "<span><span hidden>8–17</span></span>").replace("<span>19.00</span>", "<span><script>19.00</script></span>"),
  ]) assert.deepEqual(parse(html).events, []);
});

test("hidden or invalid day headings cannot prove order for an otherwise ambiguous visible day", () => {
  const html = fixture.replace("<h3><span>Fredag</span><span>30/10</span></h3>", "<h3 hidden>Friday 30/10</h3>").replace("<h3><span>Lördag</span><span>31/10</span></h3>", "<h3>Saturday 31/11</h3>");
  assert.deepEqual(parse(html).events, []);
});

test("archive document and programme labels cannot masquerade as current sources", () => {
  assert.deepEqual(parse("<h1>Previous editions archive</h1>" + cards()).events, []);
  assert.deepEqual(parse(cards({ title: "Programme Lantern Vale archive 2026" })).events, []);
  const result = parse(cards({ title: "Programme Lantern Vale 2025", day: "Thursday 30/10" }));
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].starts_on, "2025-10-30");
  assert.equal(result.events[0].local_significance.current_year_evidence, false);
});

test("Contact closes row and date-order scope before later booking office cards", () => {
  const html = cards().replace("</section>", '<h3>Contact</h3><div><h3>Saturday 31/10</h3><div><div><h4>Ticket office</h4><span>Office Street 9</span></div><div><span>9–17</span><span>Bookings</span></div></div></div></section>');
  assert.equal(collectOfficialProgramRows(html).rows.length, 2);
  assert.deepEqual(parse(html.replace("Friday 30/10", "Sunday 1/11")).events, []);
});

test("an untimed featured card cannot borrow a sibling clock outside its own card", () => {
  const content = '<div><span>Opening</span><h4>Beacon Hall</h4><span>Quay Road 4</span></div><div><span>8–17</span><span>Stray clock</span></div>';
  assert.deepEqual(parse(cards({ content })).events, []);
});

test("a semantic label alone does not steal a legacy paragraph programme with an h4 venue", () => {
  const legacy = '<h1>Harbour festival 30 October 2026</h1><h2>Programme at Harbour stage</h2><h4>Beacon Hall</h4><p>18:00 Opening concert<br>Music.</p><p>19:00 Closing concert<br>Music.</p>';
  const expected = collectOfficialProgramRows(legacy);
  assert.equal(expected.rows.length, 2);
  assert.deepEqual(collectOfficialProgramRows(`<section aria-label="Programme Lantern Vale 2026">${legacy}</section>`), expected);
});

test("an untimed featured header cannot fuse with an orphan clock under an outer wrapper", () => {
  const content = '<div><div><span>Opening</span><h4>Beacon Hall</h4><span>Quay Road 4</span></div><div><span>8–17</span><span>Stray clock</span></div></div>';
  assert.deepEqual(parse(cards({ content })).events, []);
});

test("numeric order from a separate nested semantic region cannot authorize this programme", () => {
  const html = cards({ day: "Sunday 1/11" }).replace("</section>", '<section aria-label="Office dates"><h3>Friday 30/10</h3></section></section>');
  assert.deepEqual(parse(html).events, []);
});

test("a stop or unsupported heading inside a branch cannot leave the previous day active", () => {
  const content = '<div><div><h4>Beacon Hall</h4><span>Quay Road 4</span></div><h5>Visitor information</h5><div><span>8–17</span><span>Bookings</span></div></div>';
  assert.deepEqual(parse(cards({ content })).events, []);
});

test("a hidden day boundary cannot lend the preceding date to later visible cards", () => {
  const laterCard = '<div><div><h4>Later Hall</h4><span>Hill Road 7</span></div><div><span>20–21</span><span>Music</span></div></div>';
  const html = cards().replace("</div></section>", `<h3 hidden>Saturday 31/10</h3>${laterCard}</div></section>`);
  const rows = collectOfficialProgramRows(html).rows;
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.title === "Beacon Hall"));
});

test("other containers cannot repair missing programme year, date or locality", () => {
  const first = cards({ title: "Programme Lantern Vale" });
  assert.deepEqual(parse(first + cards()).events, []);
  assert.deepEqual(parse(cards({ day: "Sunday 1/11" }) + cards()).events, []);
});
