import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPlanner} from './helpers/planner-harness.mjs';

// Live's aside row looks exactly like Blitz's row, so the whole row opens the
// Live sheet as Blitz's does: the pill's ::after layer stretches over the row,
// and the focus ring stays on the pill. The panel card keeps its plain pill.
const props = (overrides = {}) => ({
 t:(sv,en)=>en, lang:'en', mode:'typed', anchorLabel:'Lund', liveEvents:null, liveDayLabel:'Wed 7 Oct',
 showDay:false, dayflow:null, clothing:null, wovenNames:[], includedInRoute:'', pulseState:'populated',
 liveFailure:null, liveFailureSentence:()=>'', pulseBuckets:{tonight:[],thisWeek:[]}, showExplore:true,
 pulseSources:null, liveSheetTriggerRef:{current:null}, openLiveSheet:()=>{}, ...overrides,
});
const stretched = /(^|\s)after:absolute(\s|$)/;
const mount = p => mountPlanner({entry:'components/planner/LiveCard.tsx', url:'http://localhost/anywhere?lang=en', props:p});

test('the aside row is one target: the pill stretches over the relative row', async () => {
 let opened = 0;
 const h = await mount(props({openLiveSheet:()=>{opened++;}}));
 try {
  const section = h.document.querySelector('section');
  const button = section.querySelector('button');
  assert.match(section.className, /(^|\s)relative(\s|$)/, 'the row contains the stretched layer');
  assert.match(button.className, stretched);
  assert.match(button.className, /after:inset-0/);
  assert.match(button.className, /after:rounded-parranda-btn/);
  assert.match(button.className, /after:content-\[''\]/);
  assert.doesNotMatch(button.className, /(^|\s)relative(\s|$)/, 'a positioned pill would trap its own layer');
  assert.doesNotMatch(button.className, /scale/, 'a scaled pill would contain the layer and shrink the target mid-press');
  assert.match(section.className, /hover:bg-parranda-fill-strong/, 'the row answers the pointer like Blitz');
  assert.equal(section.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]').length, 1,
   'nothing else in the row is interactive, so the layer covers no other control');
  await h.act(() => button.click());
  assert.equal(opened, 1);
 } finally { await h.unmount(); }
});

test('the panel card keeps a plain pill, never a stretched layer over its body', async () => {
 const h = await mount(props({clothing:{headline:'Cool evening', advice:'Bring a layer'}}));
 try {
  const button = h.document.querySelector('section button');
  assert.ok(button);
  assert.doesNotMatch(button.className, stretched, 'the panel holds other controls; only the aside row is one target');
  assert.match(button.className, /active:scale-\[0\.97\]/, 'the panel pill keeps its press give');
 } finally { await h.unmount(); }
});
