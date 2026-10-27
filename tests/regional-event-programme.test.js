"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { extractOfficialProgramArticle, hasOfficialProgramArticleSignature } = require("../server/pulse-sources/official-program-article-provider");

const fixture = fs.readFileSync(path.join(__dirname, "fixtures/regional-event-programme.html"), "utf8");
const sourceUrl = "https://osterlenlyser.se/program-2026/";
function parse(html, options = {}) {
  return extractOfficialProgramArticle(html, { sourceUrl, timezone: "Europe/Stockholm", sourceLanguage: "sv", referenceDate: "2026-10-27", ...options });
}
function programme({ title = "Programme Lantern Coast 2026", day = "Friday 30/10", area = "West Quay", rows = "<p><strong>18:00 Candle workshop</strong><br>Book by 25 October. <a href='https://wrong.example/'>Organizer</a></p><p>19:00 Harbour concert<br>Tickets available.</p>" } = {}) {
  return `<h2>${title}</h2><h2>${day}</h2><h3>${area}</h3>${rows}`;
}

test("an unrelated numeric office heading preserves the existing dated-span article grammar", () => {
  const legacy = "<h1>Harbour festival 2026</h1><h2>Programme at Harbour stage</h2><h3>10-12 July</h3><ul><li>18:00 Opening concert</li><li>20:00 Night market</li></ul><h3>13 July</h3><ul><li>19:00 Closing show</li></ul>";
  const control = parse(legacy);
  const mixed = parse(legacy + "<h2>Office closed 30/10</h2><p>Call us tomorrow.</p>");
  assert.equal(control.recognized, true);
  assert.deepEqual(control.events.map((event) => [event.title, event.time_window.kind]), [["Opening concert", "period"], ["Night market", "period"], ["Closing show", "continuous"]]);
  assert.deepEqual(mixed, control);
  assert.deepEqual(parse(legacy + "<h2>Office closed 30/10</h2><h3>Reception</h3><p>Call us tomorrow.</p>"), control);
});

test("a legacy programme title with its own year preserves explicit named-month subheadings", () => {
  const html = "<h1>Harbour festival 2026</h1><h2>Programme at Harbour stage 2026</h2><h3>10-12 July</h3><ul><li>18:00 Opening concert</li><li>20:00 Night market</li></ul><h3>13 July</h3><ul><li>19:00 Closing show</li></ul>";
  for (const suffix of ["", "<h2>Office closed 30/10</h2><h3>Reception</h3><p>Call us tomorrow.</p>"]) {
    const result = parse(html + suffix);
    assert.equal(result.recognized, true);
    assert.deepEqual(result.events.map((event) => [event.title, event.time_window.kind]), [["Opening concert", "period"], ["Night market", "period"], ["Closing show", "continuous"]]);
  }
});

test("observed day and area programme emits local names on all three stated days with exact source context", () => {
  const result = parse(fixture);
  assert.equal(hasOfficialProgramArticleSignature(fixture), true);
  assert.equal(result.recognized, true);
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.events.map((event) => [event.title, event.starts_on, event.area]), [
    ["KM Maskin och Björks Matvagn", "2026-10-30", "Borrby"],
    ["BTK Ajax/Österlen", "2026-10-30", "Borrby"],
    ["Kiviks Hotell Konferens och Spa", "2026-10-31", "Kivik"],
    ["Kiviks Hotell Konferens och Spa", "2026-11-01", "Kivik"],
  ]);
  for (const event of result.events) {
    assert.deepEqual(event.programme, { title: "Programmet Österlen Lyser 2026", source_url: sourceUrl, starts_on: "2026-10-30", ends_on: "2026-11-01" });
    assert.equal(event.source_url, sourceUrl);
    assert.equal(event.place_context, `${event.title}, ${event.area}`);
    assert.equal(event.source_occurrence_id, event.id);
    assert.equal(event.lat, undefined);
    assert.equal(event.lng, undefined);
    assert.ok(!event.title.includes("Förbokning"));
  }
});

test("unrelated English programme uses its own explicit title/year and row first line", () => {
  const result = parse(programme(), { sourceUrl: "https://lantern.example/schedule?edition=2026", sourceLanguage: "en" });
  assert.deepEqual(result.events.map((event) => [event.title, event.starts_at]), [["Candle workshop", "2026-10-30T17:00:00.000Z"], ["Harbour concert", "2026-10-30T18:00:00.000Z"]]);
  assert.deepEqual(result.events[0].programme, { title: "Programme Lantern Coast 2026", source_url: "https://lantern.example/schedule?edition=2026", starts_on: "2026-10-30", ends_on: "2026-10-30" });
});

test("same-time same-name programme rows retain distinct stable identities in different areas", () => {
  const html = programme({ rows: "<p>18:00 Candle workshop<br>One workshop.</p>" }) + "<h3>East Quay</h3><p>18:00 Candle workshop<br>Another workshop.</p>";
  const events = parse(html).events;
  assert.equal(events.length, 2);
  assert.notEqual(events[0].id, events[1].id);
  assert.notEqual(events[0].source_occurrence_id, events[1].source_occurrence_id);
  assert.deepEqual(events.map((event) => event.id), parse(html).events.map((event) => event.id));
});

test("programme year must be attached to its title, never URL, body deadline or reference date", () => {
  assert.deepEqual(parse(programme({ title: "Programme Lantern Coast" }) + "<p>Book by 25 October 2026.</p>").events, []);
});

test("programme without a day heading cannot use a booking deadline as its event date", () => {
  assert.deepEqual(parse(programme().replace("<h2>Friday 30/10</h2>", "")).events, []);
});

test("a programme missing both title year and day cannot promote booking deadlines into events", () => {
  const html = "<h2>Programme Lantern Coast</h2><h3>West Quay</h3><p><strong>18:00 Harbour music</strong><br>Book by 25 October 2026.</p><p><strong>19:00 Candle workshop</strong><br>Book by 25 October 2026.</p>";
  const result = parse(html, { sourceUrl: "https://festival.example/programme", sourceLanguage: "en" });
  assert.deepEqual(result.events, []);
  assert.equal(result.recognized, false);
});

test("a legacy programme preserves an explicit named-month date and year in its preceding heading", () => {
  const html = "<h1>Harbour festival 30 October 2026</h1><h2>Programme at Harbour stage</h2><h3>West Quay</h3><p><strong>18:00 Opening concert</strong><br>Live music.</p><p><strong>20:00 Closing concert</strong><br>Live music.</p>";
  const result = parse(html, { sourceUrl: "https://festival.example/programme", sourceLanguage: "en" });
  assert.equal(result.recognized, true);
  assert.deepEqual(result.events.map((event) => [event.title, event.starts_on]), [
    ["Opening concert Live music.", "2026-10-30"],
    ["Closing concert Live music.", "2026-10-30"],
  ]);
});

test("preceding prose and incomplete heading dates cannot release malformed regional ownership", () => {
  const rows = "<h2>Programme Lantern Coast</h2><h3>West Quay</h3><p><strong>18:00 Harbour music</strong><br>Book by 25 October 2026.</p><p><strong>19:00 Candle workshop</strong><br>Book by 25 October 2026.</p>";
  for (const prefix of ["<p>Book by 30 October 2026.</p>", "<h1>Harbour festival 30 October</h1>", "<h1>Harbour festival 31 November 2026</h1>", "<h1>Harbour festival 30 October 2026</h1><p>Book by 25 October 2026.</p>"]) {
    assert.deepEqual(parse(prefix + rows, { sourceLanguage: "en" }).events, [], prefix);
  }
});

test("a programme with missing local area cannot fall back to the body booking deadline", () => {
  assert.deepEqual(parse(programme().replace("<h3>West Quay</h3>", "")).events, []);
});

test("an archive document cannot turn a nested dated programme into a current source", () => {
  assert.deepEqual(parse("<h1>Previous editions archive</h1>" + programme()).events, []);
});

test("a second programme title ends the previous programme year scope", () => {
  const html = programme() + programme({ title: "Programme Lantern Coast 2027", day: "30/10", rows: "<p>20:00 Next edition show<br>New edition.</p>" });
  assert.deepEqual(parse(html).events.map((event) => event.title), ["Candle workshop", "Harbour concert"]);
});

test("multiple sessions on a first line fail closed instead of becoming a clock-containing title", () => {
  const html = programme({ rows: "<p><strong>16:00 &amp; 18:00 Workshop</strong><br>Details.</p><p>17:00-18:00 &amp; 19:00-20:00 Concert<br>Details.</p>" });
  assert.deepEqual(parse(html).events, []);
});

test("non-clock range ends and invalid clocks cannot become event names", () => {
  const html = programme({ rows: "<p><strong>18:00-late Harbour restaurant</strong><br>Details.</p><p>18:00-25:00 Candle workshop<br>Details.</p>" });
  assert.deepEqual(parse(html).events, []);
});

test("complete clock boundaries reject spaced qualitative ends and malformed clock prefixes", () => {
  for (const timing of ["18:00 - late", "18:00- late", "18:00 to late", "18:00 till late", "18:00 until late", "18:000", "18:00:30", "18:00-20:000"]) {
    const html = programme({ rows: `<p>${timing} Harbour restaurant<br>Details.</p><p>19:00 Closing concert<br>Details.</p>` });
    assert.deepEqual(parse(html).events.map((event) => event.title), ["Closing concert"], timing);
  }
});

test("complete supported clock ranges preserve names beginning with the hour-unit letter", () => {
  for (const connector of ["-", "–", "to", "till", "a", "al", "au", "until"]) {
    const html = programme({ rows: `<p>18:00 ${connector} 20:00 harbour music<br>Details.</p><p>21:00 harbour choir<br>Details.</p>` });
    assert.deepEqual(parse(html).events.map((event) => [event.title, event.starts_at]), [["harbour music", "2026-10-30T17:00:00.000Z"], ["harbour choir", "2026-10-30T20:00:00.000Z"]], connector);
  }
});

test("ambiguous short range connectors are title words unless followed by a complete clock", () => {
  for (const title of ["A tribute to Queen", "a tribute to Queen", "Al fresco music", "Au revoir concert"]) {
    const result = parse(programme({ rows: `<p>18:00 ${title}<br>Details.</p><p>19:00 Closing concert<br>Details.</p>` }));
    assert.equal(result.recognized, true);
    assert.deepEqual(result.events.map((event) => event.title), [title, "Closing concert"]);
  }
});

test("hidden and ignored inline descendants cannot supply programme clocks names or breaks", () => {
  const rows = "<p><strong hidden>18:00 Hidden concert</strong><br>Visible untimed introduction.</p><p><strong aria-hidden='true'>19:00 Hidden workshop</strong><br>Visible untimed introduction.</p><p><script>20:00 Script concert</script><br>Visible introduction.</p><p><style>21:00 Style concert</style><br>Visible introduction.</p><p>22:00 Hidden break<span hidden><br></span> Visible prose.</p>";
  assert.deepEqual(parse(programme({ rows })).events, []);
});

test("heading and first-line text share the descendant visibility boundary", () => {
  const html = programme({ title: "Programme <span hidden>False name </span>Lantern Coast 2026", area: "<span aria-hidden='true'>False area </span>West Quay", rows: "<p>18:00 Visible concert<span hidden> False name</span><br>Details.</p><p>19:00 Visible workshop<script> False name</script><br>Details.</p>" });
  const result = parse(html);
  assert.deepEqual(result.events.map((event) => [event.title, event.area]), [["Visible concert", "West Quay"], ["Visible workshop", "West Quay"]]);
  assert.equal(result.events[0].programme.title, "Programme Lantern Coast 2026");
  assert.deepEqual(parse(programme({ title: "Programme Lantern Coast <span hidden>2026</span>" })).events, []);
  assert.deepEqual(parse(programme({ day: "Friday <span hidden>30/10</span>" })).events, []);
  assert.deepEqual(parse(programme({ area: "<span hidden>West Quay</span>" })).events, []);
});

test("ambiguous numeric headings need independently established day-month order", () => {
  for (const day of ["1/11", "Sunday 1/11", "Sunday 11/1"]) {
    assert.deepEqual(parse(programme({ day })).events, [], day);
  }
  assert.deepEqual(parse(programme({ day: "Sunday 1/2" })).events.map((event) => event.starts_on), ["2026-02-01", "2026-02-01"]);
  const established = programme() + "<h2>Sunday 1/11</h2><h3>East Quay</h3><p>18:00 Closing concert<br>Details.</p>";
  assert.deepEqual(parse(established).events.map((event) => event.starts_on), ["2026-10-30", "2026-10-30", "2026-11-01"]);
});

test("symmetric dates and body text cannot establish numeric ordering for later headings", () => {
  const html = programme({ day: "1/1" }) + "<p>Remember our 30/10 deadline.</p><h2>Sunday 1/11</h2><h3>East Quay</h3><p>18:00 Ambiguous concert<br>Details.</p>";
  assert.deepEqual(parse(html).events.map((event) => event.starts_on), ["2026-01-01", "2026-01-01"]);
  const disagreement = programme({ day: "Saturday 30/10" }) + "<h2>Sunday 1/11</h2><h3>East Quay</h3><p>18:00 Ambiguous concert<br>Details.</p>";
  assert.deepEqual(parse(disagreement).events, []);
});

test("closed programme day scope rejects invalid dates, weekday disagreement and unsafely stated headings", () => {
  for (const day of ["31/11", "29/2", "Saturday 30/10", "Friday 30/10 or 31/10", "Book by 30/10", "Blursday 30/10"]) {
    assert.deepEqual(parse(programme({ day })).events, [], day);
  }
  assert.equal(parse(programme({ day: "30/10" })).events.length, 2);
  assert.equal(parse(programme({ title: "Programme Lantern Coast 2024", day: "Thursday 29/2" })).events.length, 2);
});

test("date and area scopes reset at each heading, rejecting rows after invalid or unrelated scope", () => {
  const html = programme() + "<h2>Saturday 31/11</h2><p>18:00 Invalid day<br>Text.</p><h2>Sunday 1/11</h2><p>19:00 Missing area<br>Text.</p><h3>East Quay</h3><p>20:00 Closing concert<br>Text.</p><h2>Contact</h2><h3>West Quay</h3><p>21:00 Office hours<br>Text.</p>";
  assert.deepEqual(parse(html).events.map((event) => event.title), ["Candle workshop", "Harbour concert", "Closing concert"]);
});

test("a Contact subheading ends regional scope before booking office hours", () => {
  const html = programme() + "<h4>Contact</h4><p>09:00-17:00 Booking office<br>Call us for tickets.</p>";
  assert.deepEqual(parse(html).events.map((event) => [event.title, event.starts_on, event.area]), [
    ["Candle workshop", "2026-10-30", "West Quay"],
    ["Harbour concert", "2026-10-30", "West Quay"],
  ]);
});

test("Contact headings cannot reopen programme scope through later office day and area headings", () => {
  for (const tag of ["h2", "h3", "h4"]) {
    const html = programme() + `<${tag}>Contact</${tag}><h2>Saturday 31/10</h2><h3>Reception</h3><p>09:00-17:00 Booking office<br>Call us.</p><p>10:00-16:00 Ticket desk<br>Call us.</p>`;
    assert.deepEqual(parse(html).events.map((event) => event.title), ["Candle workshop", "Harbour concert"], tag);
  }
});

test("office dates after a stop heading cannot establish earlier ambiguous programme date order", () => {
  const html = programme({ day: "Sunday 1/11" }) + "<h4>Contact</h4><h2>Friday 30/10</h2><h3>Reception</h3><p>09:00-17:00 Booking office<br>Call us.</p>";
  assert.deepEqual(parse(html).events, []);
});

test("unsupported non-stop subheadings require a fresh area within the same programme day", () => {
  const html = programme() + "<h4>Visitor information</h4><p>09:00-17:00 Booking office<br>Call us.</p><h3>East Quay</h3><p>20:00 Closing concert<br>Details.</p>";
  assert.deepEqual(parse(html).events.map((event) => [event.title, event.starts_on, event.area]), [
    ["Candle workshop", "2026-10-30", "West Quay"],
    ["Harbour concert", "2026-10-30", "West Quay"],
    ["Closing concert", "2026-10-30", "East Quay"],
  ]);
});

test("free prose, missing first-line name, missing break and trailing prose are not programme titles", () => {
  const html = programme({ rows: "<p>We welcome everybody.<br>18:00 False concert</p><p>18:00<br>Unnamed concert</p><p>19:00 Concert without structural break</p><p><strong>20:00 Proper workshop</strong> Full descriptive prose and a deadline 25 October.<br>More detail.</p><p>21:00 Closing music<br>Book before 25 October.</p>" });
  assert.deepEqual(parse(html).events.map((event) => event.title), ["Proper workshop", "Closing music"]);
});

test("malformed clocks in a programme with no day cannot fall back to booking deadlines", () => {
  for (const clock of ["18:00-late", "18:00 - late", "18:000"]) {
    const html = `<h2>Programme Lantern Coast 2026</h2><h3>West Quay</h3>
      <p><strong>${clock} Harbour restaurant</strong><br>Book by 25 October.</p>
      <p><strong>19:00-late Candle workshop</strong><br>Book by 25 October.</p>`;
    assert.equal(parse(html).recognized, false, clock);
    assert.deepEqual(parse(html).events, [], clock);
  }
});

test("old explicit editions retain their stated dates instead of adopting the current reference year", () => {
  const result = parse(programme({ title: "Programme Lantern Coast 2025", day: "Thursday 30/10" }));
  assert.deepEqual(result.events.map((event) => event.starts_on), ["2025-10-30", "2025-10-30"]);
  assert.equal(result.events[0].local_significance.current_year_evidence, false);
});
