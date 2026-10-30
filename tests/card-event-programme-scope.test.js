"use strict";
const assert = require('node:assert/strict');
const test = require('node:test');
const { extractOfficialProgramArticle } = require('../server/pulse-sources/official-program-article-normalizer');
const card = (name, address) => `<div><div><h4>${name}</h4><span>${address}</span></div><div><span>18–19</span><span>Music</span></div><div><span>20–21</span><span>Music</span></div></div>`;
const initial = `<h2>First Town</h2><div><h3>Friday 30/10</h3>${card('First Hall', 'Main Road 4')}</div>`;
const region = content => `<section aria-label="Programme Lantern Festival 2026">${content}</section>`;
const parse = html => extractOfficialProgramArticle(html, { sourceUrl: 'https://unrelated.example/schedule', timezone: 'Europe/Stockholm', sourceLanguage: 'en', referenceDate: '2026-10-27' });

test('own programme, year, locality, day and card remain readable', () => {
  const result = parse(region(initial));
  assert.equal(result.recognized, true);
  assert.equal(result.events.length, 2);
  assert.ok(result.events.every(event => event.area === 'First Town' && event.lat === undefined && event.lng === undefined));
});

test('a later locality heading closes the single-locality grammar, even when hidden', () => {
  for (const attribute of ['', ' hidden']) {
    const result = parse(region(initial + `<h2${attribute}>Second Town</h2><div><h3>Saturday 31/10</h3>${card('Second Hall', 'Hill Road 8')}</div>`));
    assert.equal(result.events.length, 2, 'retain the first town but never borrow it across the h2 boundary');
    assert.ok(result.events.every(event => event.title === 'First Hall' && event.area === 'First Town'));
  }
});

test('archive headings close both factual rows and date-order evidence', () => {
  for (const level of ['h2', 'h3', 'h4']) {
    const html = region(initial + `<${level}>Previous editions archive 2025</${level}><div><h3>31/10</h3>${card('Old Hall', 'Old Road 2')}</div>`);
    const result = parse(html);
    assert.equal(result.events.length, 2, 'only the current first-town rows survive');
    assert.ok(result.events.every(event => event.title === 'First Hall'));
  }
});

test('an archive semantic ancestor or owning heading cannot authorize current programme facts', () => {
  for (const html of [
    `<section aria-label="Previous editions archive">${region(initial)}</section>`,
    `<article aria-label="Archive 2025"><div>${region(initial)}</div></article>`,
    `<section><h2>Previous editions archive 2025</h2><div>${region(initial)}</div></section>`,
  ]) assert.deepEqual(parse(html).events, []);
});

test('a later independently scoped archive does not invalidate an earlier current programme', () => {
  const html = `<section>${region(initial)}<section aria-label="Previous editions archive"><h2>Archive 2025</h2></section></section>`;
  assert.equal(parse(html).events.length, 2);
});
