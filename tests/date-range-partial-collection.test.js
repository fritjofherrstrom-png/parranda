'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createDateRangeListingProvider}=require('../server/pulse-sources/date-range-listing-provider');
const row='<div class="views-row"><div class="news_titolo"><a href="/en/event/verified">Verified concert</a></div><span class="date-display-start">08/10/2026</span><span class="date-display-end">08/10/2026</span><div class="news_sedi"><div class="field-content">Source Hall</div></div>';
const first=row+'<a href="/en/romalive?page=1">Next</a>';
test('later page byte-budget exhaustion preserves already parsed dated rows with truncated status',async()=>{
 let calls=0;
 const provider=createDateRangeListingProvider({adapter:'tourism_listing',endpoint:'https://www.turismoroma.it/en/romalive',label:'Turismo Roma',timezone:'Europe/Rome',fetcher:async()=>({ok:true,text:async()=>++calls===1?first+' '.repeat(650000):' '.repeat(650000)})});
 const result=await provider.create().collect({date:'2026-10-08'});
 assert.equal(result.time_sensitive_events.length,1);
 assert.equal(result.time_sensitive_events[0].title,'Verified concert');
 assert.equal(result.collection_status.status,'ok');
 assert.equal(result.collection_status.reason,'source_collection_truncated');
 assert.equal(calls,2);
});
