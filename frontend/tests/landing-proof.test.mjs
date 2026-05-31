import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = new URL('../src/pages/landing-proof.astro', import.meta.url);

test('Astro landing proof keeps the migration contract explicit', async () => {
  const source = await readFile(page, 'utf8');

  assert.match(source, /Astro landing proof/);
  assert.match(source, /href="\/barcelona\?planner=open"/);
  assert.match(source, /href="\/rome\?planner=open"/);
  assert.doesNotMatch(source, /from ['"]@astrojs\/preact['"]/);
  assert.doesNotMatch(source, /client:(load|idle|visible|only)/);
});
