import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const { composeDistrictDay } = require('../../server/candidates/district-composition.js');
const temporary = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.candidate-areas-'));
const output = join(temporary, 'candidate-areas.mjs');
await build({
  stdin: { contents: `export { default } from './src/components/planner/CandidateAreas';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx' },
  bundle: true, outfile: output, format: 'esm', platform: 'neutral', jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
});
const CandidateAreas = (await import(output)).default;
test.after(() => rmSync(temporary, { recursive: true, force: true }));

const sourceRows = specs => specs.map((spec, i) => ({ id: `source-${i}`, name: `Source place ${i}`,
  type: 'museum', tags: [], lat: 50 + i * 0.00001, lng: 10, ...spec }));

async function mountAreas(t, day, lang = 'sv') {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  await act(() => root.render(React.createElement(CandidateAreas, {
    t: (sv, en) => lang === 'sv' ? sv : en, lang, map: null, structureOnly: true,
    areas: day.areas, missingIntents: day.missing_intents, mapsPlaceContext: 'Source fixture',
    expandedCandidateKey: null, setExpandedCandidateKey: () => {}, commitments: {},
    releaseCommitment: () => {}, commit: () => {},
  })));
  t.after(async () => {
    await act(() => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    dom.window.close();
  });
  return { container, window: dom.window };
}

test('the real candidate surface shows zero matches instead of eleven unrelated museum hits', async t => {
  const day = composeDistrictDay(sourceRows(Array.from({ length: 11 }, () => ({}))), { candidateSurface: true, intents: ['second_hand'] });
  const { container } = await mountAreas(t, day);
  assert.match(container.textContent, /0 matchningar/);
  assert.match(container.textContent, /Inga platser för: Second hand/);
  assert.doesNotMatch(container.textContent, /Source place|11 träffar/);
  assert.equal(container.querySelectorAll('li').length, 0);
});

test('missing preference explanation precedes the real matching candidate list', async t => {
  const day = composeDistrictDay(sourceRows([
    { name: 'Actual source cafe', type: 'cafe' }, {}, {},
  ]), { candidateSurface: true, intents: ['fika', 'second_hand'] });
  const { container, window } = await mountAreas(t, day);
  const missing = [...container.querySelectorAll('p')].find(node => /Inga platser för: Second hand/.test(node.textContent));
  const list = container.querySelector('ul');
  assert.ok(missing && list);
  assert.ok(missing.compareDocumentPosition(list) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    'the gap is visible before reading the matching places');
  assert.match(list.textContent, /Actual source cafe/);
  assert.doesNotMatch(list.textContent, /Source place/);
  assert.match(list.textContent, /1 träffar/);
});

test('weak scenic evidence is visibly partial in the mounted candidate area', async t => {
  const day = composeDistrictDay(sourceRows(Array.from({ length: 3 }, () => ({ type: 'park' }))), { candidateSurface: true, intents: ['views'] });
  const { container } = await mountAreas(t, day);
  assert.match(container.textContent, /Utsikt · delvis/);
  assert.doesNotMatch(container.textContent, /Ingen av kandidaterna täcker/);
  assert.match(container.textContent, /3 träffar/);
});

test('a real viewpoint has a full coverage chip and no partial claim', async t => {
  const day = composeDistrictDay(sourceRows(Array.from({ length: 3 }, () => ({ type: 'viewpoint' }))), { candidateSurface: true, intents: ['scenic'] });
  const { container } = await mountAreas(t, day, 'en');
  assert.match(container.textContent, /Views/);
  assert.doesNotMatch(container.textContent, /partial|None of these candidates/);
  assert.match(container.textContent, /3 places/);
});

test('an unfiltered request still shows a varied set of actual source candidates', async t => {
  const day = composeDistrictDay(sourceRows([{ type: 'museum' }, { type: 'cafe' }, { type: 'vintage-shop' }]), { candidateSurface: true });
  const { container } = await mountAreas(t, day);
  assert.equal(container.querySelectorAll('button').length, 3);
  assert.match(container.textContent, /Source place 0/);
  assert.match(container.textContent, /Source place 1/);
  assert.match(container.textContent, /Source place 2/);
  assert.match(container.textContent, /3 träffar/);
});
