'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseSelectedPlaceContactHours:parse}=require('../server/place-candidates/selected-place-contact-hours');
const owner=fs.readFileSync(path.join(__dirname,'fixtures/selected-place-visit-hours/centralkonditoriet-owner-structure.html'),'utf8');
const record={id:'overture-76e7b96c-ee58-47de-9bd5-e84b080c1e86',name:'Centralkonditoriet',type:'cafe',lat:59.856815338134766,lng:17.64398193359375,website:'http://www.centralkonditoriet.com/'};
const sourceUrl='https://centralkonditoriet.com/';
const read=(html=owner,row=record,url=sourceUrl)=>parse(html,row,{sourceUrl:url});
const page=(hours='Monday-Friday: 08:00-17:00<br>Saturday: 09:00-14:00<br>Sunday: closed')=>`<html><head><title>Juniper Bakery Lund</title></head><body><header><h1><a href="https://owner.example/">Juniper Bakery Lund</a></h1></header><main><article><h1>Welcome to Juniper Bakery in Lund!</h1></article><article><header><h2>Contact us</h2></header><div><h1>Get in touch</h1><h2>Visit us at Oak Street 4 in Lund.</h2><p><strong>Opening hours</strong><br>${hours}</p></div></article></main><footer><p><strong>Address</strong><br>Oak Street 4 Lund</p></footer></body></html>`;
const other={name:'Juniper Bakery',type:'bakery',website:'https://owner.example/'};
const generic=(html=page(),row=other)=>read(html,row,'https://owner.example/');
test('owner structural fixture produces ordinary week and retains holiday uncertainty despite dated old news',()=>{
 const fact=read(); assert.ok(fact);
 assert.deepEqual(fact.rules,[{week:{Mo:[{opens:'06:30',closes:'18:00'}],Tu:[{opens:'06:30',closes:'18:00'}],We:[{opens:'06:30',closes:'18:00'}],Th:[{opens:'06:30',closes:'18:00'}],Fr:[{opens:'06:30',closes:'18:00'}],Sa:[{opens:'09:00',closes:'15:30'}],Su:[]}}]);
 assert.deepEqual(fact.unresolved,[{reason:'holiday_condition'},{reason:'special_hours'}]);
 assert.deepEqual(fact.overrides,[]);assert.equal(fact.visit_function,'general_visit');assert.equal(fact.source_relation,'entry');
 assert.equal(fact.entry_url,sourceUrl);assert.equal(fact.source_url,sourceUrl);
 assert.deepEqual(Object.keys(fact).sort(),['entry_url','source_url','source_relation','visit_function','rules','overrides','unresolved'].sort());
});
test('generic English contact paragraph uses the same bounded identity contract',()=>{assert.ok(generic());assert.deepEqual(generic().rules[0].week.Su,[])});
test('identity is independent of domain and a name prefix never identifies another branch',()=>{
 for(const html of [page().replace('Welcome to Juniper Bakery in Lund','Welcome to Juniper Bakery Annex in Lund'),page().replace('<title>Juniper Bakery Lund','<title>Another Bakery Lund'),page().replace('href="https://owner.example/"','href="https://owner.example/annex"'),page().replace('Oak Street 4 in Lund','Birch Street 4 in Lund')])assert.equal(generic(html),null);
 assert.equal(generic(page(),{...other,name:'Juniper'}),null);
 assert.equal(read(owner,record,'https://centralkonditoriet.com/other'),null);
 assert.equal(read(owner,record,sourceUrl+'?x=1'),null);
 assert.equal(read(owner,record,'https://elsewhere.example/'),null);
});
test('a supplied source address cannot disagree with owner scope',()=>{
 assert.ok(read(owner,{...record,source_address:'Vretgränd 16 753 22 Uppsala'}));
 assert.equal(read(owner,{...record,source_address:'Vretgränd 18 753 22 Uppsala'}),null);
 assert.ok(read(owner,{...record,source_address:{street:'Vretgränd',house_number:'16'}}));
 assert.equal(read(owner,{...record,source_address:{street:'Vretgränd',house_number:'18'}}),null);
});
test('conflicting marked owner hours are unknown; duplicate equal rules are one fact',()=>{
 assert.equal(read(owner.replace('Måndag—fredag: 06:30-18:00 <br>Lördag: 09:00-15:30','Måndag—fredag: 06:30-18:00 <br>Lördag: 09:00-15:00')),null);
 assert.equal(read(owner.replace('Vretgränd 16 753 22 Uppsala','Other Street 8 Uppsala')),null);
});
test('partial week, unsupported conditions, service hours and multiple contact sections stay unknown',()=>{
 for(const html of [page('Monday-Friday 08:00-17:00'),page().replace('Opening hours','Telephone hours'),page().replace('Opening hours','Guided tours opening hours'),page().replace('Contact us','Cafe opening hours'),page().replace('</main>',page().match(/<article><header>[\s\S]*?<\/article>/)[0]+'</main>'),page('Monday-Friday 08:00-17:00<br>Saturday 09:00-14:00<br>Sunday closed<br>By appointment only')])assert.equal(generic(html),null);
 assert.equal(generic(page(),{...other,type:'museum'}),null,'cafe/bakery service cannot be borrowed for a museum');
});
test('hidden identity or hours and oversized/deep documents are rejected',()=>{
 assert.equal(generic(page().replace('<h1>Welcome','<h1 hidden>Welcome')),null);
 assert.equal(generic(page().replace('<p><strong>Opening','<p aria-hidden="true"><strong>Opening')),null);
 assert.equal(generic(' '.repeat(512*1024)+page()),null);
 assert.equal(generic('<div>'.repeat(65)+page()+'</div>'.repeat(65)),null);
});
test('contact-local conditions and service headings cannot silently disappear',()=>{
 assert.equal(generic(page().replace('<p><strong>Opening hours','<h3>Guided tours</h3><p><strong>Opening hours')),null);
 assert.equal(generic(page().replace('</div></article>','<p>Closed during renovation</p></div></article>')),null);
 assert.equal(generic(page().replace('Oak Street 4 in Lund','Oak Street 40 in Lund')),null);
 assert.equal(generic(page().replace('<main>','<main>'+ '<i></i>'.repeat(12001))),null);
});
test('identity comparison preserves letters rather than folding accents into a different name',()=>{
 assert.equal(generic(page(),{...other,name:'Jüniper Bakery'}),null);
});

// Reviewed visibility and condition boundaries: visible labels cannot authorize
// a hidden schedule, and a sibling closure cannot be ignored by tag choice.
test('hidden child times and visible non-paragraph closure remain unknown',()=>{
 const hours='Monday-Friday: 08:00-17:00<br>Saturday: 09:00-14:00<br>Sunday: closed';
 for(const attribute of ['hidden','aria-hidden="true"']) assert.equal(generic(page(`<span ${attribute}>${hours}</span>`)),null);
 for(const tag of ['div','span']) assert.equal(generic(page().replace('</div></article>',`<${tag}>Closed until further notice</${tag}></div></article>`)),null);
});
