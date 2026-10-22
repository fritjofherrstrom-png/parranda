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
  await h.fetchMock.respond(h.fetchMock.calls[1],{status:'unavailable',choices:[]});
  await h.clock.advance(10000);assert.equal(h.fetchMock.calls.length,2);
  const retry=[...h.document.querySelectorAll('button')].find(b=>b.textContent==='Try again');
  assert.ok(retry,'a terminal failure must provide an actionable recovery');
  assert.equal(retry.type,'button');
  await h.act(()=>retry.click());await h.clock.advance(200);
  assert.equal(h.fetchMock.calls.length,3);assert.equal(h.fetchMock.calls[2].body.query,'har');
  assert.equal(h.fetchMock.calls[2].body.context_selection,'previous-receipt');
  assert.equal(h.document.activeElement.id,'landingCity');
  await h.fetchMock.respond(h.fetchMock.calls[2],{status:'ready',choices:[choice()]});
  assert.equal(h.document.querySelectorAll('[role=option]').length,1);
  assert.ok(h.fetchMock.calls.every(c=>c.url.startsWith('/api/place-suggestions')),'retry must not compose or navigate');
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
