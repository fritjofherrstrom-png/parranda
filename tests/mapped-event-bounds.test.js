"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createMappedEventSourceProvider}=require("../server/pulse-sources/mapped-event-source-provider");
const collect=fetcher=>createMappedEventSourceProvider({endpoint:"https://calendar.example/events",wireProfile:"dpl_cms_events_v1",
  timezone:"Europe/Copenhagen",maxBytes:1024,fetcher}).create().collect({date:"2026-10-13"});
test("oversized streaming calendars are cancelled at the byte bound without unrestricted text buffering",async()=>{
  let reads=0,cancelled=0,texts=0;
  const result=await collect(async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>{texts++;return" ".repeat(5000)+"[]";},
    body:{getReader:()=>({read:async()=>{reads++;return{done:false,value:new Uint8Array(700)};},cancel:async()=>{cancelled++;}})}}));
  assert.equal(result.collection_status.reason,"source_payload_invalid");
  assert.equal(texts,0,"native streams never call unrestricted response.text()");
  assert.equal(reads,2);
  assert.equal(cancelled,1);
});
test("an excessive declared length is rejected and cancelled before any body read",async()=>{
  let reads=0,cancelled=0;
  const result=await collect(async()=>({ok:true,status:200,headers:{get:name=>name==="content-length"?"5000":null},
    body:{cancel:async()=>{cancelled++;}},text:async()=>{reads++;return" ".repeat(5000)+"[]";}}));
  assert.equal(result.collection_status.reason,"source_payload_invalid");
  assert.equal(reads,0);
  assert.equal(cancelled,1);
});
