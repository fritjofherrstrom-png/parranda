import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

// Render the real map's HTML legend, not a browser's unavailable WebGL canvas.
// Import-only MapLibre/CSS stubs do not supply any of the asserted text/links.
const temp = await mkdtemp(fileURLToPath(new URL('./.walking-map-', import.meta.url)));
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/planner/RouteMap.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent',
  external: ['react', 'react/jsx-runtime'],
  plugins: [{ name: 'unloaded-map-imports', setup(build) {
    build.onResolve({ filter: /^maplibre-gl/ }, args => ({ path: args.path, namespace: 'unloaded' }));
    build.onLoad({ filter: /.*/, namespace: 'unloaded' }, () => ({ contents: 'export default {}; export const setWorkerUrl=()=>{};', loader: 'js' }));
  } }],
});
await writeFile(join(temp, 'map.mjs'), bundle.outputFiles[0].text);
const { default: RouteMap } = await import(pathToFileURL(join(temp, 'map.mjs')).href);
test.after(() => rm(temp, { recursive: true, force: true }));

const stops = [
  { id: 'a', label: 'First place', lat: 55.6, lng: 13 },
  { id: 'b', label: 'Second place', lat: 55.6002, lng: 13 },
];
const attribution = { label: 'FOSSGIS', url: 'https://routing.openstreetmap.de/about.html',
  fixMapUrl: 'https://www.openstreetmap.org/fixthemap' };
function rendered(geometry) {
  const html = renderToStaticMarkup(React.createElement(RouteMap, { hasPrimaryRoute: true, routeStops: stops,
    primaryRoute: { map_path_points: stops, ...geometry }, areas: [], routeContextSuggestions: [],
    showContext: false, sketch: true, still: true, heightClass: 'h-[190px]', t: (_, en) => en }));
  return new JSDOM(html).window.document.body;
}

test('explicit short pedestrian geometry names its route and supplies operator attribution and map correction', () => {
  const view = rendered({ geometry_source: 'osrm', geometry_mode: 'walking', geometry_attribution: attribution });
  assert.match(view.textContent, /Walking route/);
  const operator = view.querySelector(`a[href="${attribution.url}"]`);
  assert.ok(operator, 'the displayed walking geometry credits its provider');
  assert.equal(operator.textContent, 'FOSSGIS');
  assert.equal(view.querySelector(`a[href="${attribution.fixMapUrl}"]`)?.textContent, 'Fix the map');
});

test('heuristic geometry stays an explicitly pins-only overview even if it carries many points', () => {
  const view = rendered({ geometry_source: 'heuristic', geometry_attribution: attribution,
    map_path_points: Array.from({ length: 20 }, (_, i) => ({ lat: 55.6 + i * 0.00001, lng: 13 })) });
  assert.match(view.textContent, /Stop overview · walking path unavailable/);
  assert.doesNotMatch(view.textContent, /Walking route|FOSSGIS|Fix the map/);
});

test('walking attribution cannot turn an unsafe or credentialed URL into a link', () => {
  const view = rendered({ geometry_source: 'osrm', geometry_mode: 'walking',
    geometry_attribution: { label: 'Unsafe provider', url: 'javascript:alert(1)',
      fixMapUrl: 'https://user:secret@www.openstreetmap.org/fixthemap' } });
  assert.match(view.textContent, /Walking route/);
  assert.doesNotMatch(view.textContent, /Unsafe provider|Fix the map/);
  assert.equal(view.querySelector('a[href^="javascript:"]'), null);
});
