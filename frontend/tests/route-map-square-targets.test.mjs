import test from 'node:test';
import assert from 'node:assert/strict';
import { screenMarkerPresentation } from '../src/lib/route-map-presentation.mjs';

test('diagonal 44px square touch targets cannot overlap even when circular discs clear', () => {
  const points = [{x:100,y:100},{x:135,y:135}];
  const before = structuredClone(points);
  const offsets = screenMarkerPresentation(points,{width:390,height:300});
  assert.ok(offsets);
  const placed=points.map((p,i)=>({x:p.x+offsets[i].shift_x_px,y:p.y+offsets[i].shift_y_px}));
  assert.ok(Math.abs(placed[0].x-placed[1].x)>=48 || Math.abs(placed[0].y-placed[1].y)>=48,
    'full square footprints plus 4px gap must be separated on at least one axis');
  assert.deepEqual(points,before,'authoritative projected coordinates stay unchanged');
  assert.deepEqual(screenMarkerPresentation(points,{width:390,height:300}),offsets);
});
