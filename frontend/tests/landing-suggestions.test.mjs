import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPlanner} from './helpers/planner-harness.mjs';
import {LAST_KEY} from '../src/lib/anywhere-storage.mjs';
const choice=(title='Harbour Quarter',context='First City · Country')=>({title,context,query:`${title}, ${context.replace(' · ', ', ')}`,selection_id:`signed-choice-${context}`,attribution:'© OpenStreetMap contributors',license:'ODbL'});
const mount=options=>mountPlanner({entry:'components/LandingHero.tsx',url:'http://localhost/?lang=en',...options});
async function type(h,value) {
 await h.act(()=>{const input=h.document.querySelector('#landingCity');Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new h.window.Event('input',{bubbles:true}));});
}
async function key(h,key) {await h.act(()=>h.document.querySelector('#landingCity').dispatchEvent(new h.window.KeyboardEvent('keydown',{key,bubbles:true})));}
test('two-character East Asian search waits for IME completion and keeps the short Latin guard',async()=>{
 const h=await mount();try {
  const input=h.document.querySelector('#landingCity');
  await h.act(()=>input.dispatchEvent(new h.window.CompositionEvent('compositionstart',{bubbles:true})));
  await type(h,'京都');await h.clock.advance(250);
  assert.equal(h.fetchMock.calls.length,0,'an unfinished IME must not search');
  await h.act(()=>input.dispatchEvent(new h.window.CompositionEvent('compositionend',{bubbles:true})));
  await h.clock.advance(200);assert.equal(h.fetchMock.calls.length,1);assert.equal(h.fetchMock.calls[0].body.query,'京都');
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'ready',choices:[choice('京都市','Japan')]});
  assert.equal(h.document.querySelector('[role=option]').textContent,'京都市Japan');
  await type(h,'ha');await h.clock.advance(250);assert.equal(h.fetchMock.calls.length,1);
 }finally{await h.unmount();}
});
test('typing debounces suggestions attached to a combobox; keyboard choice fills the field',async()=>{
 const h=await mount({injected:{__PARRANDA_CITIES__:{rome:{key:'rome',label:'Rome'}}}});try {
  assert.equal([...h.document.querySelectorAll('a')].some(link=>new URL(link.href).searchParams.has('city')),false);
  const input=h.document.querySelector('#landingCity');assert.equal(input.getAttribute('role'),'combobox');
  await type(h,'ha');await h.clock.advance(250);assert.equal(h.fetchMock.calls.length,0);
  await type(h,'har');await h.clock.advance(199);assert.equal(h.fetchMock.calls.length,0);
  await h.clock.advance(1);assert.equal(h.fetchMock.calls.length,1);assert.equal(h.fetchMock.calls[0].body.query,'har');
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'ready',choices:[choice(),choice('Harbour Quarter','Second City · Country')]});
  assert.equal(h.document.querySelectorAll('[role=option]').length,2);assert.match(h.text(),/First City · Country/);
  await key(h,'ArrowDown');await key(h,'Enter');assert.equal(input.value,choice().query);assert.equal(h.document.querySelector('[role=listbox]'),null);
  await h.act(()=>h.document.querySelector('form').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(JSON.parse(h.window.sessionStorage.getItem('parranda:place-choice')).selection,choice().selection_id);
 }finally{await h.unmount();}
});
test('an older response cannot replace the current query; Escape dismisses pending results',async()=>{
 const h=await mount();try {
  await type(h,'har');await h.clock.advance(200);const old=h.fetchMock.calls[0];
  await type(h,'new');await h.clock.advance(200);const current=h.fetchMock.calls[1];
  await h.fetchMock.respond(current,{status:'ready',choices:[choice('New Quarter')]});
  await h.fetchMock.respond(old,{status:'ready',choices:[choice('Old Quarter')]});
  assert.match(h.text(),/New Quarter/);assert.doesNotMatch(h.text(),/Old Quarter/);
  await type(h,'next');await h.clock.advance(200);await key(h,'Escape');
  await h.fetchMock.respond(h.fetchMock.calls[2],{status:'ready',choices:[choice('Next Quarter')]});
  assert.equal(h.document.querySelector('[role=listbox]'),null);
 }finally{await h.unmount();}
});
test('only saved receipts provide context; unavailable lookup still permits free text',async()=>{
 const h=await mount({storage:{[LAST_KEY]:{inputs:{placeSelection:'previous-receipt'}}}});try{
  await type(h,'har');await h.clock.advance(200);
  assert.equal(h.fetchMock.calls[0].body.context_selection,'previous-receipt');
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'unavailable',choices:[]});
  await h.clock.advance(1000);
  assert.equal(h.fetchMock.calls.length,2);
  await h.fetchMock.respond(h.fetchMock.calls[1],{status:'unavailable',choices:[]});
  assert.match(h.text(),/You can still search/);assert.equal(h.document.querySelector('#landingCity').value,'har');
 }finally{await h.unmount();}
});

test('a transient unavailable response retries once and shows real suggestion rows without another keystroke',async()=>{
 const h=await mount();try{
  await type(h,'har');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'unavailable',choices:[]});
  await h.clock.advance(999);assert.equal(h.fetchMock.calls.length,1);
  await h.clock.advance(1);assert.equal(h.fetchMock.calls.length,2);
  assert.equal(h.fetchMock.calls[1].body.query,'har');
  await h.fetchMock.respond(h.fetchMock.calls[1],{status:'ready',choices:[choice()]});
  assert.match(h.text(),/Harbour Quarter/);assert.equal(h.document.querySelectorAll('[role=option]').length,1);
  await h.clock.advance(10000);assert.equal(h.fetchMock.calls.length,2,'no background retry after success');
 }finally{await h.unmount();}
});

test('persistent failure stops automatic retries and offers a same-query retry without submitting the day',async()=>{
 const h=await mount({storage:{[LAST_KEY]:{inputs:{placeSelection:'previous-receipt'}}}});try{
  await type(h,'har');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'unavailable',choices:[]});
  await h.clock.advance(1000);assert.equal(h.fetchMock.calls.length,2);
  assert.equal(h.fetchMock.calls[1].body.retry,undefined,'an automatic retry does not claim to be the reader');
  await h.fetchMock.respond(h.fetchMock.calls[1],{status:'unavailable',choices:[]});
  await h.clock.advance(10000);assert.equal(h.fetchMock.calls.length,2);
  const retry=[...h.document.querySelectorAll('button')].find(b=>b.textContent==='Try again');
  assert.ok(retry,'a terminal failure must provide an actionable recovery');
  assert.equal(retry.type,'button');
  await h.act(()=>retry.click());await h.clock.advance(200);
  assert.equal(h.fetchMock.calls.length,3);assert.equal(h.fetchMock.calls[2].body.query,'har');
  assert.equal(h.fetchMock.calls[2].body.context_selection,'previous-receipt');
  assert.equal(h.fetchMock.calls[2].body.retry,true,'the reader’s own retry asks even a resting provider');
  assert.equal(h.document.activeElement.id,'landingCity');
  await h.fetchMock.respond(h.fetchMock.calls[2],{status:'ready',choices:[choice()]});
  assert.equal(h.document.querySelectorAll('[role=option]').length,1);
  assert.ok(h.fetchMock.calls.every(c=>c.url.startsWith('/api/place-suggestions')),'retry must not compose or navigate');
 }finally{await h.unmount();}
});

test('a resting provider is not retried automatically, yet the reader can still try again',async()=>{
 const h=await mount();try{
  await type(h,'har');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'unavailable',choices:[],retryable:false});
  await h.clock.advance(5000);assert.equal(h.fetchMock.calls.length,1,'the server said a retry cannot help');
  assert.match(h.text(),/Suggestions are unavailable/);
  assert.ok([...h.document.querySelectorAll('button')].find(b=>b.textContent==='Try again'));
 }finally{await h.unmount();}
});

test('rows from the offline register credit GeoNames, not OpenStreetMap',async()=>{
 const h=await mount();try{
  await type(h,'har');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'ready',choices:[{...choice(),attribution:'GeoNames',license:'CC-BY-4.0'}]});
  const footer=h.document.querySelector('a[href="https://www.geonames.org/"]');
  assert.equal(footer?.textContent,'GeoNames (CC BY 4.0)');
  assert.equal(h.document.querySelector('a[href="https://www.openstreetmap.org/copyright"]'),null);
 }finally{await h.unmount();}
});

test('changing the query cancels its scheduled retry and a late retry body cannot publish stale choices',async()=>{
 const h=await mount();try{
  await type(h,'old');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'unavailable',choices:[]});
  await type(h,'new');await h.clock.advance(1000);
  assert.equal(h.fetchMock.calls.length,2);assert.equal(h.fetchMock.calls[1].body.query,'new');
  await h.fetchMock.respond(h.fetchMock.calls[1],{status:'unavailable',choices:[]});
  await h.clock.advance(1000);assert.equal(h.fetchMock.calls.length,3);
  const stale=h.fetchMock.calls[2];
  await h.fetchMock.respond(stale,{status:'ready',choices:[choice('Stale Quarter')]},200,{deferBody:true});
  await type(h,'latest');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[3],{status:'ready',choices:[choice('Latest Quarter')]});
  await h.act(()=>stale.releaseBody());
  assert.match(h.text(),/Latest Quarter/);assert.doesNotMatch(h.text(),/Stale Quarter/);
 }finally{await h.unmount();}
});

test('a hung request keeps its existing deadline and can be explicitly retried with a fresh controller',async()=>{
 const h=await mount();try{
  await type(h,'har');await h.clock.advance(200);await h.clock.advance(6000);
  assert.equal(h.fetchMock.calls[0].aborted,true);assert.match(h.text(),/You can still search/);
  const retry=[...h.document.querySelectorAll('button')].find(b=>b.textContent==='Try again');assert.ok(retry);
  await h.act(()=>retry.click());await h.clock.advance(200);
  assert.equal(h.fetchMock.calls.length,2);assert.equal(h.fetchMock.calls[1].aborted,false);
  await h.fetchMock.respond(h.fetchMock.calls[1],{status:'ready',choices:[choice()]});
  assert.equal(h.document.querySelectorAll('[role=option]').length,1);
 }finally{await h.unmount();}
});

test('ready-empty results are not retried and busy responses retain their one-retry limit',async()=>{
 const h=await mount();try{
  await type(h,'empty');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'ready',choices:[]});
  await h.clock.advance(10000);assert.equal(h.fetchMock.calls.length,1);
  assert.doesNotMatch(h.text(),/Try again|unavailable/);
  await type(h,'busy');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[1],{status:'busy',choices:[],retry_after_ms:1000},429);
  await h.clock.advance(1000);assert.equal(h.fetchMock.calls.length,3);
  await h.fetchMock.respond(h.fetchMock.calls[2],{status:'busy',choices:[],retry_after_ms:1000},429);
  await h.clock.advance(10000);assert.equal(h.fetchMock.calls.length,3);
  assert.match(h.text(),/Try again/);
 }finally{await h.unmount();}
});

test('a same-name region is marked so it cannot read as a duplicate of the city', async () => {
 const h=await mount({url:'http://localhost/?lang=sv'});try {
  await type(h,'Lisbon');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'ready',choices:[{...choice('Lisbon','Portugal'),kind:'settlement'},{...choice('Lisbon','Portugal'),selection_id:'signed-region',kind:'region'}]});
  const rows=[...h.document.querySelectorAll('[role=option]')].map(row=>row.textContent);
  assert.deepEqual(rows,['LisbonPortugal','LisbonRegion · Portugal']);
 }finally{await h.unmount();}
});

test('a registered-city suggestion carries its qualified choice into shared any-place intake', async () => {
 const h=await mount({injected:{__PARRANDA_CITIES__:{rome:{key:'rome',label:'Rome'}}}});try {
  const selected={...choice('Rome','Lazio · Italy'),city_key:'rome'};
  await type(h,'rom');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'ready',choices:[selected]});
  await key(h,'ArrowDown');await key(h,'Enter');
  await h.act(()=>h.document.querySelector('form').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true})));
  const carried=JSON.parse(h.window.sessionStorage.getItem('parranda:place-choice'));
  assert.equal(carried?.selection,selected.selection_id);
  assert.equal(carried?.place,selected.query,'receipt stays bound to the full selected query');
 }finally{await h.unmount();}
});
test('Enter with suggestions shown but none highlighted searches the typed text, never the first row',async()=>{
 const h=await mount();try {
  await type(h,'Harbour Quarter');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'ready',choices:[choice(),choice('Harbour Quarter','Second City · Country')]});
  assert.equal(h.document.querySelectorAll('[role=option]').length,2);
  await key(h,'Enter');
  assert.equal(h.document.querySelector('#landingCity').value,'Harbour Quarter','an unhighlighted Enter does not fill a row');
  await h.act(()=>h.document.querySelector('form').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(h.window.sessionStorage.getItem('parranda:place-choice'),null,'the server resolves the typed name and asks when it is ambiguous');
 }finally{await h.unmount();}
});
test('editing the text after choosing a row drops that chosen identity',async()=>{
 const h=await mount();try {
  await type(h,'Harbour Quarter');await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0],{status:'ready',choices:[choice()]});
  await key(h,'ArrowDown');await key(h,'Enter');
  await type(h,`${choice().query} North`);
  await h.act(()=>h.document.querySelector('form').dispatchEvent(new h.window.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(h.window.sessionStorage.getItem('parranda:place-choice'),null,'a changed name never travels with the old selection');
 }finally{await h.unmount();}
});

test('pressing Build my day keeps the open suggestion layout stable until activation', async () => {
 const h = await mount();
 try {
  await type(h, 'Harbour Quarter');
  await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0], {status:'ready', choices:[choice()]});
  const input = h.document.querySelector('#landingCity');
  const submit = h.document.querySelector('button[type=submit]');
  await h.act(() => input.focus());
  assert.ok(h.document.querySelector('[role=listbox]'));
  // Browsers focus a pressed submit button before pointer-up. On mobile the
  // resulting blur used to remove the in-flow list and move the button away
  // from the pointer, so the click never reached the form. jsdom has no layout;
  // model only that native focus default, then check the real component state.
  await h.act(() => {
   const press = new h.window.MouseEvent('pointerdown', {bubbles:true,cancelable:true,button:0});
   if (submit.dispatchEvent(press)) submit.focus();
  });
  assert.ok(h.document.querySelector('[role=listbox]'), 'the pointer target must not move before release');
  assert.equal(input.value, 'Harbour Quarter');
  assert.equal(h.window.sessionStorage.getItem('parranda:place-choice'), null, 'a pointer press must not silently choose the first result');
  // Keyboard focus still dismisses suggestions normally; the submit button
  // remains a standard button available to Tab and Enter.
  await h.act(() => submit.focus());
  assert.equal(h.document.querySelector('[role=listbox]'), null);
  assert.equal(h.document.activeElement, submit);
 } finally { await h.unmount(); }
});

// A press on the search icon or the field padding used to leave
// focus on the page. The box hands any
// press to the input without a blur in between, and the input fills its height.
test('a press anywhere on the search box focuses the field without a blur first', async () => {
 const h = await mount();
 try {
  const input = h.document.querySelector('#landingCity');
  const box = input.parentElement;
  const icon = box.querySelector('svg[aria-hidden=true]');
  assert.match(input.className, /(^|\s)self-stretch(\s|$)/, 'the input fills the box height so most taps land on it');
  await h.act(() => h.document.body.focus());
  for (const target of [icon, box]) {
   await h.act(() => input.blur());
   assert.notEqual(h.document.activeElement, input);
   let press;
   await h.act(() => { press = new h.window.MouseEvent('mousedown', {bubbles:true,cancelable:true,button:0}); target.dispatchEvent(press); });
   assert.equal(h.document.activeElement, input, 'the press focuses the real input');
   assert.equal(press.defaultPrevented, true, 'focus never leaves the field on its way to the input');
  }
  // A press on the input itself stays native: its caret placement and selection are the browser's.
  const own = new h.window.MouseEvent('mousedown', {bubbles:true,cancelable:true,button:0});
  await h.act(() => input.dispatchEvent(own));
  assert.equal(own.defaultPrevented, false);
  // Open suggestions survive a press on the box padding: there is no blur to dismiss them.
  await type(h, 'har'); await h.clock.advance(200);
  await h.fetchMock.respond(h.fetchMock.calls[0], {status:'ready', choices:[choice()]});
  assert.ok(h.document.querySelector('[role=listbox]'));
  await h.act(() => box.dispatchEvent(new h.window.MouseEvent('mousedown', {bubbles:true,cancelable:true,button:0})));
  assert.ok(h.document.querySelector('[role=listbox]'), 'a press on the padding does not dismiss the list');
  assert.equal(h.document.activeElement, input);
  // The Try again control sits outside the box and keeps its own click.
  assert.equal(box.querySelector('button'), null, 'no control inside the box is taken over by its press handler');
 } finally { await h.unmount(); }
});

// A lookup that answers within 300ms shows nothing new; one still pending says
// so where the rows will appear. It is the same live region the screen reader
// already heard, made visible, so nothing is announced twice.
test('a slow lookup becomes visible after 300ms and gives way to its rows', async () => {
 const h = await mount();
 try {
  const status = () => h.document.querySelector('[role=status]');
  const visible = () => !/(^|\s)sr-only(\s|$)/.test(status().className);
  assert.equal(h.document.querySelectorAll('[role=status]').length, 1);
  await h.act(() => h.document.querySelector('#landingCity').focus());
  await type(h, 'har'); await h.clock.advance(200);
  assert.equal(h.fetchMock.calls.length, 1);
  assert.equal(status().textContent, 'Finding places …', 'screen readers still hear the lookup at once');
  assert.equal(visible(), false);
  await h.clock.advance(299);
  assert.equal(visible(), false, 'no flash for a lookup answered within 300ms');
  await h.clock.advance(1);
  assert.equal(visible(), true, 'a pending lookup is visible after 300ms');
  assert.equal(status().textContent, 'Finding places …');
  assert.match(status().className, /(^|\s)sm:absolute(\s|$)/, 'from sm up it floats where the rows appear, so the page below does not move');
  assert.match(status().className, /sm:pointer-events-none/, 'it never catches a press meant for what lies under it');
  assert.match(status().className, /(^|\s)sm:top-full(\s|$)/, 'from sm up it floats where the popover list opens');
  assert.match(status().className, /(^|\s)max-sm:sr-only(\s|$)/, 'on a phone the live region stays sr-only; the box shows its own label');
  assert.equal(h.document.querySelectorAll('[role=status]').length, 1, 'one live region, never two announcements');
  await h.fetchMock.respond(h.fetchMock.calls[0], {status:'ready', choices:[choice()]});
  assert.equal(visible(), false, 'the rows replace the wait');
  assert.equal(status().textContent, '');
  assert.equal(h.document.querySelectorAll('[role=option]').length, 1);

  // A fast answer never shows the line.
  await type(h, 'fast'); await h.clock.advance(200); await h.clock.advance(150);
  await h.fetchMock.respond(h.fetchMock.calls[1], {status:'ready', choices:[]});
  await h.clock.advance(1000);
  assert.equal(visible(), false);
 } finally { await h.unmount(); }
});

test('the visible wait clears on blur and yields to the unavailable sentence', async () => {
 const h = await mount({url:'http://localhost/?lang=sv'});
 try {
  const input = h.document.querySelector('#landingCity');
  const status = () => h.document.querySelector('[role=status]');
  const visible = () => !/(^|\s)sr-only(\s|$)/.test(status().className);
  await h.act(() => input.focus());
  await type(h, 'har'); await h.clock.advance(200); await h.clock.advance(300);
  assert.equal(visible(), true);
  assert.equal(status().textContent, 'Söker platser …');
  await h.act(() => input.blur());
  assert.equal(visible(), false, 'leaving the field takes the wait with it');
  await h.clock.advance(1000);
  assert.equal(visible(), false, 'a still pending lookup does not bring it back');

  // A blur before 300ms keeps it from ever appearing.
  await h.act(() => input.focus());
  await type(h, 'hav'); await h.clock.advance(200);
  await h.act(() => input.blur());
  await h.clock.advance(400);
  assert.equal(visible(), false);

  // Unavailable wins: its own sentence, in flow, not the floating wait.
  await h.act(() => input.focus());
  await type(h, 'hal'); await h.clock.advance(200); await h.clock.advance(300);
  assert.equal(visible(), true);
  await h.clock.advance(6000);
  assert.match(status().textContent, /Förslag saknas just nu/);
  assert.doesNotMatch(status().className, /absolute/);
 } finally { await h.unmount(); }
});

// On a phone the wait used to be an opaque layer over the input's right end:
// it covered the end of a long query and the caret. Now it is an in-flow
// sibling after the input, so the input narrows, and a caret at the end is
// scrolled back into view. The live region stays the only role=status.
test('the phone wait narrows the input instead of covering the typed text', async () => {
 const h = await mount();
 try {
  const input = h.document.querySelector('#landingCity');
  const box = input.parentElement;
  const status = () => h.document.querySelector('[role=status]');
  const label = () => box.querySelector('[data-place-wait]');
  let scrolled = null;
  Object.defineProperty(input, 'scrollWidth', {configurable:true, get: () => 480});
  Object.defineProperty(input, 'scrollLeft', {configurable:true, get: () => scrolled ?? 0, set: value => { scrolled = value; }});
  const height = () => box.className.match(/min-h-\S+/g);
  const restHeight = height();
  await h.act(() => input.focus());
  await type(h, 'Sankt Petersburg Vasilyevsky'); await h.clock.advance(200);
  assert.equal(label(), null, 'nothing shows before the lookup has waited 300ms');
  await h.clock.advance(300);
  const wait = label();
  assert.ok(wait, 'a slow lookup shows the wait inside the box');
  assert.equal(wait.parentElement, box, 'it is a sibling in the field box');
  assert.equal(wait.previousElementSibling, input, 'it comes after the input, at its right end');
  assert.equal(wait.getAttribute('aria-hidden'), 'true', 'it is never announced: the live region already says it');
  assert.equal(wait.getAttribute('role'), null);
  for (const cls of ['shrink-0', 'sm:hidden', 'whitespace-nowrap']) assert.match(wait.className, new RegExp(`(^|\\s)${cls.replace(/[:.]/g, '\\$&')}(\\s|$)`), cls);
  assert.doesNotMatch(wait.className, /(^|\s)(absolute|fixed)(\s|$)/, 'in flow, so the input narrows instead of being painted over');
  assert.doesNotMatch(wait.className, /(^|\s)(animate-|bg-)/, 'no unguarded motion and no opaque fill over the text');
  assert.match(wait.className, /(^|\s)motion-safe:animate-panel-in(\s|$)/);
  assert.equal(wait.textContent, 'Finding …', 'a short phone label leaves the typed text more room');
  assert.equal(status().textContent, 'Finding places …', 'the live region keeps the full sentence');
  assert.equal(h.document.querySelectorAll('[role=status]').length, 1, 'one live region');
  assert.match(status().className, /(^|\s)max-sm:sr-only(\s|$)/);
  assert.deepEqual(height(), restHeight, 'the field keeps its height');
  assert.equal(scrolled, 480, 'a caret at the end is scrolled into view when the input narrows');
  assert.equal(input.selectionStart, input.value.length);
  // A press on the label goes to the box: it focuses the input without a blur.
  await h.act(() => input.blur());
  await h.act(() => input.focus());
  let press;
  await h.act(() => { press = new h.window.MouseEvent('mousedown', {bubbles:true,cancelable:true,button:0}); label().dispatchEvent(press); });
  assert.equal(press.defaultPrevented, true);
  assert.equal(h.document.activeElement, input);
  await h.fetchMock.respond(h.fetchMock.calls[0], {status:'ready', choices:[choice()]});
  assert.equal(label(), null, 'the rows replace the wait');

  // A caret moved back into the text is the reader's: it is left where it is.
  scrolled = null;
  await type(h, 'Sankt Petersburg Vasilyevsky I'); await h.clock.advance(200);
  await h.act(() => input.setSelectionRange(3, 3));
  await h.clock.advance(300);
  assert.ok(label());
  assert.equal(scrolled, null, 'a caret inside the text is not moved');
 } finally { await h.unmount(); }
});

test('the Swedish phone wait label is short and the status keeps the sentence', async () => {
 const h = await mount({url:'http://localhost/?lang=sv'});
 try {
  const input = h.document.querySelector('#landingCity');
  await h.act(() => input.focus());
  await type(h, 'Sankt Petersburg'); await h.clock.advance(200); await h.clock.advance(300);
  assert.equal(input.parentElement.querySelector('[data-place-wait]').textContent, 'Söker …');
  assert.equal(h.document.querySelector('[role=status]').textContent, 'Söker platser …');
 } finally { await h.unmount(); }
});

// The 300ms timer used to show the wait only when the field had focus at
// that moment; focusing the field later in the same lookup showed nothing.
test('focusing the field during a lookup pending 300ms or more shows the wait', async () => {
 const h = await mount();
 try {
  const input = h.document.querySelector('#landingCity');
  const visible = () => !/(^|\s)(max-sm:)?sr-only(\s|$)/.test(h.document.querySelector('[role=status]').className);
  await h.act(() => input.focus());
  await type(h, 'har'); await h.clock.advance(200);
  await h.act(() => input.blur());
  await h.clock.advance(400);
  assert.equal(input.parentElement.querySelector('[data-place-wait]'), null, 'blurred: nothing shows');
  await h.act(() => input.focus());
  assert.ok(input.parentElement.querySelector('[data-place-wait]'), 'refocused while still pending: the wait shows at once');
  assert.match(h.document.querySelector('[role=status]').className, /(^|\s)sm:absolute(\s|$)/);
  // Refocusing before 300ms waits for the timer as usual.
  await type(h, 'hav'); await h.clock.advance(200);
  await h.act(() => input.blur());
  await h.clock.advance(100);
  await h.act(() => input.focus());
  assert.equal(input.parentElement.querySelector('[data-place-wait]'), null, 'no flash for a lookup younger than 300ms');
  await h.clock.advance(200);
  assert.ok(input.parentElement.querySelector('[data-place-wait]'));
  // An answered lookup does not leave the flag behind.
  await h.fetchMock.respond(h.fetchMock.calls[1], {status:'ready', choices:[]});
  await h.act(() => input.blur());
  await h.act(() => input.focus());
  assert.equal(input.parentElement.querySelector('[data-place-wait]'), null);
  assert.equal(visible(), false);
 } finally { await h.unmount(); }
});

// The side was measured when the wait line appeared and kept when it turned
// straight into the list. It is measured again when the list itself appears.
test('the list measures its side again when the wait hands over to it', async () => {
 const h = await mount();
 try {
  const input = h.document.querySelector('#landingCity');
  let rect = {top:100, bottom:160, left:0, right:300, width:300, height:60, x:0, y:100};
  input.getBoundingClientRect = () => rect;
  await h.act(() => input.focus());
  await type(h, 'har'); await h.clock.advance(200); await h.clock.advance(300);
  assert.match(h.document.querySelector('[role=status]').className, /(^|\s)sm:top-full(\s|$)/, 'room below: the wait opens below');
  // The field moved near the bottom of the viewport while the lookup ran.
  rect = {top:700, bottom:760, left:0, right:300, width:300, height:60, x:0, y:700};
  await h.fetchMock.respond(h.fetchMock.calls[0], {status:'ready', choices:[choice()]});
  const popover = h.document.querySelector('[role=listbox]').parentElement;
  assert.match(popover.className, /(^|\s)sm:bottom-full(\s|$)/, 'the list opens on the side that has room now');
  assert.doesNotMatch(popover.className, /(^|\s)sm:top-full(\s|$)/);
 } finally { await h.unmount(); }
});
