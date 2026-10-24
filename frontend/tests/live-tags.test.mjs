import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { liveTagLabel, liveTagLabels } from '../src/lib/live-tags.mjs';

// A Swedish page showed the source's English categories ("Eat & Drink",
// "Exhibitions") as Live tags (7fb8c10 design-system audit).

test('common categories read in the page language, either way round', () => {
  assert.equal(liveTagLabel('Eat & Drink', 'sv'), 'Mat & dryck');
  assert.equal(liveTagLabel('Exhibitions', 'sv'), 'Utställningar');
  assert.equal(liveTagLabel('music', 'sv'), 'Musik');
  assert.equal(liveTagLabel('Musik', 'en'), 'Music');
  assert.equal(liveTagLabel('  Udstillinger ', 'en'), 'Exhibitions');
  // Combined categories as recorded from a public calendar on 7fb8c10.
  assert.equal(liveTagLabel('Guided tours & Lectures', 'sv'), 'Visningar & föredrag');
  assert.equal(liveTagLabel('Stage & Film', 'sv'), 'Scen & film');
  assert.equal(liveTagLabel('Sports & Wellbeing', 'sv'), 'Sport & hälsa');
});

test('a tag that is not a known category keeps the source words exactly', () => {
  assert.equal(liveTagLabel('Haymarket Sessions', 'sv'), 'Haymarket Sessions');
  assert.equal(liveTagLabel('Konstrunda', 'en'), 'Konstrunda');
  // Ambiguous words are not guessed at.
  for (const word of ['club', 'bio', 'tour', 'arts']) assert.equal(liveTagLabel(word, 'sv'), word);
});

test('one category from two sources is one tag', () => {
  assert.deepEqual(liveTagLabels(['Music', 'musik', 'Jazz', 'Music'], 'sv'), ['Musik', 'Jazz']);
  assert.deepEqual(liveTagLabels(null, 'en'), []);
});

test('the sheet names its tags as a list, not with aria-label on a plain span', () => {
  const sheet = readFileSync(new URL('../src/components/planner/LiveSheet.tsx', import.meta.url), 'utf8');
  assert.match(sheet, /liveTagLabels\(liveEventTags\(ev\), lang\)/);
  assert.doesNotMatch(sheet, /<span aria-label=\{t\("Taggar", "Tags"\)\}/);
  assert.match(sheet, /<span role="list" aria-label=\{t\("Taggar", "Tags"\)\}/);
  assert.match(sheet, /<span role="listitem" key=\{tag\}/);
});

test('catch-all placeholders name no category and are not shown; real tags stay', () => {
  // Ticketmaster's "Miscellaneous" and "Undefined" read as noise beside real
  // tags (QA, Berlin, 23 Oct 2026). "Arts & Theatre" has no existing
  // translation ("arts" is deliberately not guessed), so it stays as written.
  assert.equal(liveTagLabel('Miscellaneous', 'sv'), '');
  assert.equal(liveTagLabel('undefined', 'en'), '');
  assert.deepEqual(liveTagLabels(['Miscellaneous', 'Music', 'Undefined', 'Arts & Theatre'], 'sv'), ['Musik', 'Arts & Theatre']);
});

