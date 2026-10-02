import test from 'node:test';
import assert from 'node:assert/strict';
import * as presentation from '../src/lib/route-map-presentation.mjs';

test('screen-space placement separates dense and coincident numbered stops without moving coordinates', () => {
  assert.equal(typeof presentation.screenMarkerPresentation, 'function');
  const { screenMarkerPresentation } = presentation;
  const points = [{x:180,y:70},{x:192,y:78},{x:206,y:82},{x:206,y:82},{x:220,y:85},{x:222,y:88}];
  const original = JSON.stringify(points);
  const keepouts = [{left:0,top:0,right:35,bottom:65},{left:235,top:0,right:294,bottom:55},{left:130,top:172,right:294,bottom:190}];
  const offsets = screenMarkerPresentation(points,{width:294,height:190,keepouts});
  assert.equal(offsets.length,points.length);
  const placed=points.map((p,i)=>({x:p.x+offsets[i].shift_x_px,y:p.y+offsets[i].shift_y_px}));
  for(let i=0;i<placed.length;i++) {
    const p=placed[i];assert.ok(p.x>=22&&p.x<=272&&p.y>=22&&p.y<=168);
    for(const box of keepouts) assert.ok(p.x+22<=box.left||p.x-22>=box.right||p.y+22<=box.top||p.y-22>=box.bottom);
    for(let j=0;j<i;j++) assert.ok(Math.hypot(p.x-placed[j].x,p.y-placed[j].y)>=48-0.001);
  }
  assert.equal(JSON.stringify(points),original);
  assert.deepEqual(screenMarkerPresentation(points,{width:294,height:190,keepouts}),offsets);
});

test('invalid or impossible screen layouts fail closed with bounded work', () => {
  assert.equal(presentation.screenMarkerPresentation(null,{width:320,height:190}),null);
  assert.equal(presentation.screenMarkerPresentation([{x:NaN,y:10}],{width:320,height:190}),null);
  assert.equal(presentation.screenMarkerPresentation([{x:20,y:20}],{width:40,height:40}),null);
  assert.equal(presentation.screenMarkerPresentation([{x:20,y:20}],{width:320,height:190,keepouts:null}),null);
});
