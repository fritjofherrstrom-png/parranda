import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { pinGroupLabel, screenPinPresentation } from '../src/lib/route-map-presentation.mjs';

// ui.tsx is TypeScript with JSX; bundle it once to call buttonClass for real.
const uiBundle = await build({ entryPoints: [fileURLToPath(new URL('../src/components/shared/ui.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent' });
const uiFile = join(mkdtempSync(join(tmpdir(), 'parranda-ui-')), 'ui.mjs');
writeFileSync(uiFile, uiBundle.outputFiles[0].text);
const { buttonClass } = await import(pathToFileURL(uiFile).href);

// Zoomed out, a day's stops fall within a few pixels. The old layout moved
// each number to the nearest free spot however far away, so a Stockholm day
// showed stop 5 over Vaxholm and the numbers jumped as the zoom changed.
const VIEW = { width: 341, height: 190, keepouts: [
  { left: 8, top: 8, right: 52, bottom: 96 },     // zoom buttons
  { left: 290, top: 8, right: 334, bottom: 52 },  // expand
  { left: 150, top: 168, right: 341, bottom: 190 }, // attribution
] };
const drawn = (pins) => pins.map((p) => ({ members: p.members.join(','), d: Math.hypot(p.shift_x_px, p.shift_y_px) }));

test('stops apart keep their own pins at their own coordinates', () => {
  const pins = screenPinPresentation([{ x: 80, y: 120 }, { x: 200, y: 60 }, { x: 260, y: 140 }], VIEW);
  assert.deepEqual(drawn(pins), [{ members: '0', d: 0 }, { members: '1', d: 0 }, { members: '2', d: 0 }]);
});

test('close stops spread a short way and never overlap; far shifts are not allowed', () => {
  // The 320px fixture day: five stops about 20px apart on a diagonal.
  const points = [0, 1, 2, 3, 4].map((k) => ({ x: 120 + k * 20, y: 140 - k * 14 }));
  const pins = screenPinPresentation(points, VIEW);
  assert.equal(pins.length, 5, 'every stop keeps its own number');
  for (const pin of pins) assert.ok(Math.hypot(pin.shift_x_px, pin.shift_y_px) <= 72, `${pin.members} moved too far`);
  for (let i = 0; i < pins.length; i++) for (let j = 0; j < i; j++) {
    assert.ok(Math.abs(pins[i].x - pins[j].x) >= 48 || Math.abs(pins[i].y - pins[j].y) >= 48, 'targets do not overlap');
  }
});

test('stops on one spot at this zoom share one pin at their centre', () => {
  // Measured: the Stockholm day four zoom steps out.
  const points = [{ x: 186, y: 92 }, { x: 183, y: 90 }, { x: 187, y: 86 }, { x: 192, y: 89 }, { x: 190, y: 97 }];
  const pins = screenPinPresentation(points, VIEW);
  assert.equal(pins.length, 1);
  assert.deepEqual(pins[0].members, [0, 1, 2, 3, 4]);
  assert.ok(Math.hypot(pins[0].x - 187.6, pins[0].y - 90.8) < 1, 'the group pin sits where its stops are');
  assert.equal(pinGroupLabel(pins[0].members), '1–5');
});

test('a close pair fans out with its own numbers, as on a fitted phone map', () => {
  // Two stops 89 m apart are about 11px apart on the 320px collapsed map.
  const pins = screenPinPresentation([{ x: 90, y: 120 }, { x: 170, y: 100 }, { x: 175, y: 111 }, { x: 260, y: 120 }], VIEW);
  assert.deepEqual(pins.map((p) => p.members.join()), ['0', '1', '2', '3']);
  assert.ok(pins.every((p) => Math.hypot(p.shift_x_px, p.shift_y_px) <= 60));
});

test('a stop that cannot be shown near its place joins its nearest pin, not a far corner', () => {
  const points = [{ x: 170, y: 95 }, { x: 175, y: 120 }, { x: 205, y: 95 }, { x: 200, y: 122 }, { x: 188, y: 108 }];
  const pins = screenPinPresentation(points, VIEW);
  for (const pin of pins) {
    const cx = pin.members.reduce((s, i) => s + points[i].x, 0) / pin.members.length;
    const cy = pin.members.reduce((s, i) => s + points[i].y, 0) / pin.members.length;
    assert.ok(Math.hypot(pin.x - cx, pin.y - cy) <= 72, `pin ${pin.members} is drawn near its stops`);
  }
  assert.equal(pins.flatMap((p) => p.members).sort().join(), '0,1,2,3,4', 'every stop is in exactly one pin');
});

test('at the fitted zoom and closer every stop keeps its own number', () => {
  // The map groups only once the reader zooms out past its own fit.
  const blob = [{ x: 186, y: 92 }, { x: 183, y: 90 }, { x: 187, y: 86 }, { x: 192, y: 89 }, { x: 190, y: 97 }];
  const pins = screenPinPresentation(blob, { ...VIEW, grouping: false });
  assert.deepEqual(pins.map((p) => p.members.join()), ['0', '1', '2', '3', '4']);
  const source = readFileSync(new URL('../src/components/planner/RouteMap.tsx', import.meta.url), 'utf8');
  assert.match(source, /const grouping = typeof map\.getZoom === "function" && map\.getZoom\(\) < fitted - 0\.05;/);
  assert.match(source, /if \(fitted\) fitted\.current = view\.zoom;\s*map\.jumpTo/);
});

test('a pin keeps its last spot while it is still free, so it does not jump as the map moves', () => {
  const points = [{ x: 150, y: 100 }, { x: 180, y: 100 }];
  const first = screenPinPresentation(points, VIEW);
  const previous = new Map(first.map((p) => [p.members.join(','), { dx: p.shift_x_px, dy: p.shift_y_px }]));
  // The map moved two pixels; the second stop's last spot is still free.
  const moved = screenPinPresentation(points.map((p) => ({ x: p.x + 2, y: p.y })), { ...VIEW, previous });
  assert.deepEqual(moved.map((p) => [p.shift_x_px, p.shift_y_px]), first.map((p) => [p.shift_x_px, p.shift_y_px]));
});

test('stops outside the view are not pulled into it or into a group', () => {
  const pins = screenPinPresentation([{ x: -80, y: 50 }, { x: 150, y: 100 }], VIEW);
  assert.deepEqual(pins.map((p) => [p.members.join(), Boolean(p.offscreen), p.shift_x_px]), [['0', true, 0], ['1', false, 0]]);
});

test('invalid input fails closed', () => {
  assert.equal(screenPinPresentation(null, VIEW), null);
  assert.equal(screenPinPresentation([{ x: NaN, y: 1 }], VIEW), null);
  assert.equal(screenPinPresentation([{ x: 20, y: 20 }], { width: 40, height: 40 }), null);
});

test('group labels name every stop compactly', () => {
  assert.equal(pinGroupLabel([0, 1]), '1,2');
  assert.equal(pinGroupLabel([0, 1, 2, 4]), '1–3,5');
  assert.equal(pinGroupLabel([1, 3]), '2,4');
});

test('the map uses the bounded pins, and a group pin is a named control that zooms in', () => {
  const source = readFileSync(new URL('../src/components/planner/RouteMap.tsx', import.meta.url), 'utf8');
  assert.match(source, /screenPinPresentation\(points,/);
  assert.doesNotMatch(source, /screenMarkerPresentation\(/);
  assert.match(source, /element\.setAttribute\("role", "button"\)[\s\S]{0,200}Zoom in to separate them/);
  assert.match(source, /map\.fitBounds\(bounds/);
  assert.match(source, /focusAfterSplitRef\.current = group\.members\[0\]/);
  const css = readFileSync(new URL('../src/styles/tailwind.css', import.meta.url), 'utf8');
  assert.match(css, /\.route-map-frame \.maplibregl-marker\.route-map-group \{\s*pointer-events: auto;/);
});

test('a button that aligns its own content does not also get justify-center', () => {
  assert.doesNotMatch(buttonClass('dashed', 'min-h-12 w-full justify-between px-4'), /justify-center/);
  assert.match(buttonClass('primary', 'min-h-11 px-4'), /justify-center/);
});
