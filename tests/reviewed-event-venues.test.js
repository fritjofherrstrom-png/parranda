"use strict";
const assert=require("node:assert/strict"),test=require("node:test");
const {REGISTRY_SCHEMA,buildVenueRegistry,lookupReviewedVenue,reviewedVenueResolution,trustedReviewedVenueResolution}=require("../server/pulse-sources/reviewed-event-venues");
const address={country:"DK",postal_code:"1172",street:"Krystalgade 15"};
const row={...address,lat:55.680876,lng:12.573653,geometry_source:"nominatim_osm",license:"ODbL",attribution:"© OpenStreetMap contributors",
  osm_ref:"node/340526209",match:"house_number_and_postcode",source_ids:["source-a"]};
const registry=rows=>buildVenueRegistry({schema:REGISTRY_SCHEMA,venues:rows});

test("conflicting points for the same published address remain ambiguous in either order",()=>{
  const other={...row,lat:55.69,lng:12.58,osm_ref:"node/other"};
  for(const rows of [[row,other],[other,row]])assert.equal(lookupReviewedVenue(registry(rows),address),null);
});
test("registry identity binds an address to its reviewed publisher",()=>{
  const r=registry([row]);
  assert.ok(lookupReviewedVenue(r,{...address,source_id:"source-a"}));
  assert.equal(lookupReviewedVenue(r,{...address,source_id:"unrelated-source"}),null);
});
test("missing numeric geometry or empty attribution never becomes a registry point",()=>{
  for(const change of [{lat:null},{lng:""},{license:""},{attribution:""},{geometry_source:""}])
    assert.equal(lookupReviewedVenue(registry([{...row,...change}]),address),null);
});
test("registry provenance survives JSON cache replay and rejects changed coordinates or publisher",()=>{
  const r=registry([row]),entry=lookupReviewedVenue(r,address);
  const proof=JSON.parse(JSON.stringify(reviewedVenueResolution(entry)));
  const context={registry:r,lat:row.lat,lng:row.lng,sourceId:"source-a"};
  assert.ok(trustedReviewedVenueResolution(proof,context));
  assert.equal(trustedReviewedVenueResolution(proof,{...context,lat:55.1}),null);
  assert.equal(trustedReviewedVenueResolution(proof,{...context,sourceId:"unrelated-source"}),null);
  assert.equal(trustedReviewedVenueResolution({...proof,license:"Invented licence"},context),null);
});
