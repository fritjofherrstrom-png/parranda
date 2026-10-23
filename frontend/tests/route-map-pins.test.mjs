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

// A pin covers its own place: it may move at most half its 22px radius, and a
// group pin sits on the centre of the stops it names (Stockholm, 2026-10-22:
// numbers had floated off their stops and stayed off them while zooming).
const onItsPlace = (pins, points) => pins.forEach((pin) => {
  const cx = pin.members.reduce((s, i) => s + points[i].x, 0) / pin.members.length;
  const cy = pin.members.reduce((s, i) => s + points[i].y, 0) / pin.members.length;
  assert.ok(Math.hypot(pin.x - cx, pin.y - cy) <= 11, `pin ${pin.members} is on its place`);
});

test('close stops share pins on their places instead of numbers spread away from them', () => {
  // The 320px fixture day: five stops about 20px apart on a diagonal.
  const points = [0, 1, 2, 3, 4].map((k) => ({ x: 120 + k * 20, y: 140 - k * 14 }));
  const pins = screenPinPresentation(points, VIEW);
  onItsPlace(pins, points);
  assert.equal(pins.flatMap((p) => p.members).sort().join(), '0,1,2,3,4', 'every stop is in exactly one pin');
  assert.ok(pins.length < 5, 'stops that cannot be shown apart share a pin');
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

test('a close pair shares one pin; stops far enough apart keep their own numbers', () => {
  // Two stops 89 m apart are about 11px apart on the 320px collapsed map.
  const close = [{ x: 90, y: 120 }, { x: 170, y: 100 }, { x: 175, y: 111 }, { x: 260, y: 120 }];
  const pins = screenPinPresentation(close, VIEW);
  assert.deepEqual(pins.map((p) => p.members.join()), ['0', '1,2', '3']);
  onItsPlace(pins, close);
  const apart = [{ x: 90, y: 120 }, { x: 170, y: 100 }, { x: 225, y: 100 }, { x: 290, y: 120 }];
  assert.deepEqual(screenPinPresentation(apart, VIEW).map((p) => [p.members.join(), p.shift_x_px, p.shift_y_px]),
    [['0', 0, 0], ['1', 0, 0], ['2', 0, 0], ['3', 0, 0]]);
});

test('a stop under a map control keeps its place rather than being pushed away', () => {
  const points = [{ x: 30, y: 50 }, { x: 200, y: 100 }];
  const pins = screenPinPresentation(points, VIEW);
  assert.deepEqual(pins.map((p) => [p.members.join(), p.x, p.y]), [['0', 30, 50], ['1', 200, 100]]);
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

test('the map groups at every zoom and creates every pin on its own stop', () => {
  const source = readFileSync(new URL('../src/components/planner/RouteMap.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /grouping/, 'no zoom-dependent switch back to unbounded spreading');
  assert.doesNotMatch(source, /routeMarkerPresentation/, 'pins are not fanned out on creation');
  assert.match(source, /const shiftX = 0;\s*const shiftY = 0;/);
  assert.match(source, /marks\.push\(\{ lat: stop\.lat, lng: stop\.lng, radius: MARKER_RADIUS \}\)/, 'the view is fitted to the stops themselves');
});

test('a stop panned out of view is not pinned to the edge, at any zoom', () => {
  // Seen in the Simulator: dragging the map moved the stops north of the view,
  // and their numbers stayed along the top edge over Årsta.
  const points = [{ x: 150, y: -300 }, { x: 200, y: -280 }, { x: 180, y: 100 }];
  const pins = screenPinPresentation(points, VIEW);
  assert.deepEqual(pins.map((p) => [p.members.join(), Boolean(p.offscreen), p.y]), [['0', true, -300], ['1', true, -280], ['2', false, 100]]);
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

test('fully visible anchors are not nudged into clipped discs or touch targets', () => {
  const points = [{ x: 258, y: 100 }, { x: 298, y: 100 }];
  const pins = screenPinPresentation(points, { width: 320, height: 200, keepouts: [] });
  assert.ok(pins);
  onItsPlace(pins, points);
  for (const pin of pins) {
    assert.ok(pin.x >= 22 && pin.x <= 298 && pin.y >= 22 && pin.y <= 178,
      `pin ${pin.members} at ${pin.x},${pin.y} clips its 44px touch target`);
  }
  assert.deepEqual(points, [{ x: 258, y: 100 }, { x: 298, y: 100 }]);
});

test('a naturally edge-clipped stop is not pulled into a distant group', () => {
  const points = [{ x: 1, y: 100 }, { x: 200, y: 100 }];
  assert.deepEqual(screenPinPresentation(points, { width: 320, height: 200 }).map(p => [p.members, p.x, p.y]),
    [[[0], 1, 100], [[1], 200, 100]]);
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
  assert.match(source, /element\.setAttribute\("role", "button"\)/);
  assert.match(source, /element\.setAttribute\("aria-label", accessibleName\)/);
  assert.match(source, /Zoom in to separate them/);
  assert.match(source, /Inspect the stops in this group/);
  assert.match(source, /map\.easeTo\(\{ center: bounds\.getCenter\(\), zoom, duration/);
  assert.match(source, /focusAfterSplitRef\.current = group\.members\[0\]/);
  const css = readFileSync(new URL('../src/styles/tailwind.css', import.meta.url), 'utf8');
  assert.match(css, /\.route-map-frame \.maplibregl-marker\.route-map-group \{\s*pointer-events: auto;/);
});

test('a button that aligns its own content does not also get justify-center', () => {
  assert.doesNotMatch(buttonClass('dashed', 'min-h-12 w-full justify-between px-4'), /justify-center/);
  assert.match(buttonClass('primary', 'min-h-11 px-4'), /justify-center/);
});
