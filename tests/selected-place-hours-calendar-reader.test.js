'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reader = require('../server/place-candidates/selected-place-html-hours');
const { CALENDAR_CONTRACT, selectedHoursCalendarKey, projectSelectedHoursCalendar } = require('../server/place-candidates/opening-hours-calendar');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/selected-place-visit-hours', name), 'utf8');
const entry = fixture('gustavianum-entry.html'), detail = fixture('gustavianum-hours.html');
const record = { id: 'museum', name: 'Gustavianum', type: 'museum', website: 'https://www.uu.se/gustavianum' };
const options = { sourceUrl: 'https://www.uu.se/gustavianum/besok-oss/oppettider', entryHtml: entry, entrySourceUrl: record.website };
// No fixture or module-load failure: the existing reader cannot publish these
// real source facts. The new reader must expose a date-independent calendar.
const content = (html = detail, rec = record, opts = options) => reader.parseSelectedPlaceHoursCalendar?.(html, rec, opts) || null;
function project(html, date) {
  const facts = content(html);
  return projectSelectedHoursCalendar(facts && { ...facts, contract: CALENDAR_CONTRACT,
    identity_key: selectedHoursCalendarKey(record), observed_at: '2026-10-20T09:00:00.000Z' }, { date, timezone: 'Europe/Stockholm' });
}
test('actual owner date closures become temporal facts, not permanent lifecycle closure', () => {
  for (const date of ['2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01']) {
    const result = project(detail, date);
    assert.equal(result.status, 'closed', date);
    assert.equal(result.eligible, false, date);
    assert.equal(result.selected_day_hours.date, date);
  }
  assert.equal(project(detail, '2027-12-24').status, 'known', 'a 2026 exception cannot be silently renewed');
});
test('explicit holiday hours override the ordinary week without losing source identity', () => {
  const result = project(detail, '2026-10-31');
  assert.equal(result.status, 'known');
  assert.deepEqual(result.selected_day_hours.windows, [{ opens: '12:00', closes: '17:00' }]);
  assert.equal(result.selected_day_hours.source_url, options.sourceUrl);
});
test('annual seasons and unresolved late hours retain their actual scopes', () => {
  assert.equal(project(detail, '2026-10-19').status, 'closed');
  assert.equal(project(detail, '2026-10-20').status, 'unknown');
  assert.equal(project(detail, '2027-06-01').status, 'known', 'winter Tuesday ambiguity cannot leak into summer');
  assert.equal(project(detail, '2027-06-07').status, 'known');
});
const other = { id: 'cafe', name: 'Birch House', type: 'cafe', website: 'https://owner.example/birch' };
const page = body => `<html><head><title>Birch House – Owner</title></head><body><main><h1>Birch House</h1><h2>Opening hours</h2>${body}</main></body></html>`;
function otherDay(body, date) {
  const facts = content(page(body), other, { sourceUrl: other.website });
  return projectSelectedHoursCalendar(facts && { ...facts, contract: CALENDAR_CONTRACT,
    identity_key: selectedHoursCalendarKey(other), observed_at: '2026-10-20T09:00:00.000Z' }, { date, timezone: 'Europe/London' });
}
test('ordinary partial weeks do not manufacture closed days', () => {
  assert.equal(otherDay('<p>Monday 09:00-17:00</p>', '2026-10-19').status, 'known');
  assert.equal(otherDay('<p>Monday 09:00-17:00</p>', '2026-10-20').status, 'unknown');
});
test('explicit absolute validity expires instead of becoming an annual schedule', () => {
  const body = '<p>1 September 2026 - 31 May 2027</p><p>Monday-Sunday 09:00-17:00</p>';
  assert.equal(otherDay(body, '2026-10-21').status, 'known');
  assert.equal(otherDay(body, '2027-10-21').status, 'unknown');
});
test('unscoped years, unresolved closures and unsupported periods never lend ordinary hours', () => {
  for (const qualifier of ['<p>2025</p>', '<div>Closed until further notice</div>', '<p>June 1 through August 31</p>']) {
    const result = otherDay(qualifier + '<p>Monday-Sunday 09:00-17:00</p>', '2026-10-21');
    assert.equal(result.status, 'unknown', qualifier);
  }
});
test('advertised exceptions, foreign identities and service functions stay rejected', () => {
  assert.equal(content(entry, record, { sourceUrl: record.website }), null);
  assert.equal(content(detail, record, { ...options, entryHtml: entry.replace('/gustavianum/besok-oss/oppettider', '/foreign') }), null);
  assert.equal(content(detail, { ...record, name: 'Annex' }), null);
  assert.equal(content(page('<p>Phone opening hours</p><p>Monday-Sunday 09:00-17:00</p>'), other, { sourceUrl: other.website }), null);
});

test('negated closure and another service cannot become a general visit date override', () => {
 for (const row of ['31/10 Not closed', '31/10 Café closed', '31/10 Guided tours 12-17']) {
   const altered = detail.replace('30-31/10 Alla Helgons helg</strong> kl. 12-17', row + '</strong>');
   assert.equal(project(altered, '2026-10-31').status, 'unknown', row);
 }
});

test('unsupported holiday-row qualifiers, service labels and inline years cannot acquire date authority', () => {
 for(const row of ['24-25/12 Jul</strong> Ej stängt', '24-25/12 Butiken</strong> Stängt', '24-25/12 2027 Jul</strong> Stängt']) {
  const altered=detail.replace('24-25/12 Jul</strong> Stängt',row);
  assert.equal(project(altered,'2026-12-24').status,'unknown',row);
  if(row.includes('2027'))assert.equal(project(altered,'2027-12-24').status,'unknown',row);
 }
 const shop=detail.replace('30-31/10 Alla Helgons helg</strong> kl. 12-17','30-31/10 Butiken</strong> kl. 12-17');
 assert.equal(project(shop,'2026-10-31').status,'unknown');
});
