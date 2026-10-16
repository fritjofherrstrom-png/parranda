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

test('the sheet announces its tags in text, not with aria-label on a span', () => {
  const sheet = readFileSync(new URL('../src/components/planner/LiveSheet.tsx', import.meta.url), 'utf8');
  assert.match(sheet, /liveTagLabels\(liveEventTags\(ev\), lang\)/);
  assert.doesNotMatch(sheet, /<span aria-label=\{t\("Taggar", "Tags"\)\}/);
  assert.match(sheet, /<span className="sr-only">\{t\("Taggar: ", "Tags: "\)\}<\/span>/);
});
