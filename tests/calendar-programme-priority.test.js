"use strict";
const assert = require('node:assert/strict');
const test = require('node:test');
const { extractCalendarPageLinks } = require('../server/pulse-sources/calendar-page-locator');

// Observed shape: a site's ordinary event navigation and advent calendar
// consumed its two-page scout allowance before its explicit dated programme.
// This fixture reproduces the grammar, not a named publisher or locality.
test('a dated programme stays inside a two-page discovery prefix ahead of unrelated calendar navigation', () => {
  const links = extractCalendarPageLinks({
    pageUrl: 'https://village.example/',
    html: `<nav><a href="/evenemang/">Evenemang</a></nav>
      <a href="/arets-julkalender/">Årets Julkalender</a>
      <a href="/program-ljushelg-i-hamnbyn-2026/">Se programmet</a>`,
  });
  assert.ok(links.slice(0, 2).some(link => link.url ===
    'https://village.example/program-ljushelg-i-hamnbyn-2026/'),
    'the explicit programme is lost behind the bounded two-page cut');
  assert.ok(links.slice(0, 2).some(link => link.url === 'https://village.example/evenemang/'),
    'ordinary calendar navigation must still have a place');
});

test('programme priority uses generic path evidence across publishers and link languages', () => {
  for (const [path, label] of [
    ['/programme-lantern-weekend-2031/', 'View programme'],
    ['/programa-fiesta-2032/', 'Ver programa'],
    ['/programm-lichterfest-2033/', 'Programm ansehen'],
  ]) {
    const links = extractCalendarPageLinks({ pageUrl: 'https://town.test/', html:
      `<a href="/calendar/">Calendar</a><a href="/advent-calendar/">Christmas calendar</a>
       <a href="${path}">${label}</a>` });
    const programme = links.find(link => link.url === `https://town.test${path}`);
    assert.ok(programme?.reasons.includes('calendar_link_dated_programme'));
    assert.ok(links.slice(0, 2).includes(programme));
  }
});

test('dated submission forms and explicit archives gain no programme-list priority', () => {
  const links = extractCalendarPageLinks({ pageUrl: 'https://town.test/', html:
    `<a href="/programme-form-2031/">Programme submission form</a>
     <a href="/archived-programme-2024/">Archived programme</a>` });
  assert.ok(links.length > 0);
  assert.ok(links.every(link => !link.reasons.includes('calendar_link_dated_programme')));
});

test('programme priority neither follows another origin nor turns event details or PDFs into listing pages', () => {
  const links = extractCalendarPageLinks({ pageUrl: 'https://town.test/', html:
    `<a href="https://other.test/programme-2031/">Programme 2031</a>
     <a href="/events/2031-10-30-lantern-show/">Lantern show programme</a>
     <a href="/programme-2031.pdf">Programme 2031</a>
     <a href="/events/">Events</a>` });
  assert.deepEqual(links.map(link => link.url), ['https://town.test/events/']);
});
