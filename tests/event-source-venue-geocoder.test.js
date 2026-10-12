"use strict";
const assert=require("node:assert/strict"),test=require("node:test");
const {matchNominatimAddressResults}=require("../scripts/resolve-event-source-venues");
const address={street:"Krystalgade 15",postal_code:"1172",country:"DK"};
const bbox=[12.45,55.61,12.73,55.74];
const point={lat:"55.680876",lon:"12.573653",osm_type:"node",osm_id:340526209,address:{house_number:"15",postcode:"1172",road:"Krystalgade",country_code:"dk"}};
test("geocoder requires the published street and country as well as house number, postcode and bounds",()=>{
  assert.equal(matchNominatimAddressResults([point],address,bbox).status,"resolved");
  for(const change of [{road:"Another street"},{country_code:"se"},{house_number:"16"},{postcode:"2200"}])
    assert.equal(matchNominatimAddressResults([{...point,address:{...point.address,...change}}],address,bbox).status,"unresolved");
});
test("two matching points remain ambiguous; duplicate observations do not manufacture a second point",()=>{
  assert.equal(matchNominatimAddressResults([point,{...point,osm_id:2,lat:"55.681"}],address,bbox).reason,"ambiguous");
  assert.equal(matchNominatimAddressResults([point,{...point}],address,bbox).status,"resolved");
});
