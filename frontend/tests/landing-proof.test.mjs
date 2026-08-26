import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildPlannerHref } from '../src/landing-contract.mjs';

const page = new URL('../src/pages/landing-proof.astro', import.meta.url);

test('Astro landing proof keeps the migration contract explicit', async () => {
  const source = await readFile(page, 'utf8');

  assert.match(source, /Astro landing proof/);
  assert.match(source, /routeProofs/);
  assert.equal(buildPlannerHref('barcelona'), '/anywhere?city=barcelona&place=Barcelona&planner=open&lang=en');
  assert.equal(buildPlannerHref('rome'), '/anywhere?city=rome&place=Rome&planner=open&lang=en');
  assert.doesNotMatch(source, /from ['"]@astrojs\/preact['"]/);
  assert.doesNotMatch(source, /client:(load|idle|visible|only)/);
});
