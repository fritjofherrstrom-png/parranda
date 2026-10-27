'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createOvertureSource,OVERTURE_ATTRIBUTION_URL}=require('../server/place-candidates/overture-source');
const {createOpenDataLoader}=require('../server/place-candidates/open-data-loader');
const {publicSourceUrlsForRecords}=require('../server/place-candidates/source-url-evidence');

test('actual Overture factory can retain public attribution and website without granting a JSON clone authority',async()=>{
  const source=createOvertureSource({releaseResolver:async()=> '2026-08-19.0',queryRows:async()=>[{
    id:'10000000-0000-0000-0000-000000000001',name:'Source cafe',category:'cafe',category_hierarchy:['cafe'],
    confidence:0.998,operating_status:'open',websites:['https://cafe.example.org/'],brand:null,
    licenses:['CDLA-Permissive-2.0'],lat:55.6801,lng:14.23,
  }]});
  const records=await source({lat:55.68,lng:14.23});assert.equal(records.length,1);
  assert.deepEqual([...publicSourceUrlsForRecords(records)].sort(),[OVERTURE_ATTRIBUTION_URL,'https://cafe.example.org/'].sort());
  assert.equal(publicSourceUrlsForRecords(structuredClone(records)).size,0);
  records[0].website='https://other.example.org/';assert.equal(publicSourceUrlsForRecords(records).size,0,'changed original destination invalidates the whole record witness');
});

test('actual OSM transport factory retains its two source links and public website, without upgrading source evidence',async()=>{
  const source=createOpenDataLoader({endpoint:'https://overpass.example.org/api/interpreter',fetcher:async()=>({ok:true,status:200,json:async()=>({elements:[{
    type:'node',id:1234,lat:55.6801,lon:14.23,tags:{name:'Source cafe',amenity:'cafe',wikidata:'Q1234',website:'https://cafe.example.org/'},
  }]})})});
  const records=await source({lat:55.68,lng:14.23});assert.equal(records.length,1);
  assert.deepEqual([...publicSourceUrlsForRecords(records)].sort(),['https://www.openstreetmap.org/node/1234','https://www.wikidata.org/wiki/Q1234','https://cafe.example.org/'].sort());
  assert.equal(records[0].sources[0].tier,'inferred');
  assert.equal(publicSourceUrlsForRecords(structuredClone(records)).size,0);
});
