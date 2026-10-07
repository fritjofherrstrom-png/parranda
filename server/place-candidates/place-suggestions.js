'use strict';

// Photon supports search-as-you-type. Public Nominatim must never serve this lane.
const {createHash}=require('node:crypto');
const {createSourceCache}=require('./source-cache');
const {sanitizeTrustedSpatialScope}=require('./spatial-scope');
const {isValidCoordinate}=require('../planner/agnostic-place-intake');
const DEFAULT_ENDPOINT='https://photon.komoot.io/api/';
const LAYERS=['city','district','locality','county','state','country'];
const KINDS={city:'settlement',district:'district',locality:'settlement',county:'region',state:'region',country:'region'};
const compact=value=>typeof value==='string' ? value.trim().replace(/\s+/g,' ').slice(0,160) : '';

function mapFeature(feature) {
 const p=feature?.properties;
 const coordinates=feature?.geometry?.coordinates;
 if(feature?.geometry?.type!=='Point'||!Array.isArray(coordinates)||coordinates.length!==2||!isValidCoordinate(coordinates[1],coordinates[0]))return null;
 const layer=p?.type || ({city:'city',town:'city',village:'city',hamlet:'locality',suburb:'district',neighbourhood:'district',quarter:'district',borough:'district',municipality:'city',county:'county',state:'state',country:'country'})[p?.osm_value];
 const osmType=({N:'node',W:'way',R:'relation'})[p?.osm_type];
 const title=compact(p?.name);
 if(!title||!LAYERS.includes(layer)||!osmType||!/^\d+$/.test(String(p.osm_id))||!['place','boundary'].includes(p.osm_key))return null;
 const local=compact(p.city)||compact(p.county)||compact(p.state);
 const country=compact(p.country);
 const distinct=values=>[...new Map(values.filter(x=>x&&x.toLowerCase()!==title.toLowerCase()).map(x=>[x.toLowerCase(),x])).values()];
 const qualifiers=distinct([local,compact(p.state),country]);
 const hierarchy=distinct([compact(p.city),compact(p.county),compact(p.state),country]);
 const query=[title,...hierarchy].join(', ');
 if(query.length>200)return null;
 const candidate={label:query,lat:coordinates[1],lng:coordinates[0],confidence:'medium',provenance:'photon_osm',osm_ref:`${osmType}/${p.osm_id}`,attribution:'© OpenStreetMap contributors',license:'ODbL',admin_context:{locality:compact(p.city)||null,county:compact(p.county)||null,region:compact(p.state)||null,country:country||null,country_code:compact(p.countrycode).toLowerCase()||null}};
 if(Array.isArray(p.extent)&&p.extent.length===4) {
  const [west,north,east,south]=p.extent;
  const scope=sanitizeTrustedSpatialScope({source:'photon_bounds',kind:KINDS[layer],bounds:{west,north,east,south}});
  if(scope)candidate.spatial_scope=scope;
 }
 return {title,context:qualifiers.join(' · '),query,kind:KINDS[layer],candidate};
}

function createPlaceSuggestions({endpoint=DEFAULT_ENDPOINT,fetcher=globalThis.fetch,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),minIntervalMs=750,timeoutMs=2500}={}) {
 const cache=createSourceCache({namespace:'place-suggestions-v1',ttlMs:60*60*1000,maxEntries:256,now});
 let pending=0,lastStarted=0,tail=Promise.resolve();
 async function acquire(query,context) {
  if(pending>=4)return {status:'busy',choices:[],retry_after_ms:1000};
  pending++;
  const work=tail.catch(()=>{}).then(async()=>{
   const wait=Math.max(0,lastStarted+minIntervalMs-now());if(wait)await sleep(wait);lastStarted=now();
   const controller=new AbortController();let timer;
   try {
    const url=new URL(endpoint);url.searchParams.set('q',query);url.searchParams.set('limit','8');
    LAYERS.forEach(layer=>url.searchParams.append('layer',layer));
    // The public index only supports these languages; others use local names.
    if(['en','de','fr'].includes(context.language))url.searchParams.set('lang',context.language);
    if(context.near){url.searchParams.set('lat',String(context.near.lat));url.searchParams.set('lon',String(context.near.lng));url.searchParams.set('zoom','12');}
    const result=await Promise.race([
     (async()=>{
      const r=await fetcher(url.toString(),{headers:{'User-Agent':'Parranda/1.0 (+https://github.com/fritjofherrstrom-png/parranda)'},signal:controller.signal});
      if(r.status===429)return {status:'busy',choices:[],retry_after_ms:1000};
      if(!r.ok)return {status:'unavailable',choices:[]};
      const data=await r.json();if(!Array.isArray(data?.features))return {status:'unavailable',choices:[]};
      const seen=new Set();const choices=[];
      for(const feature of data.features.slice(0,30)) {
       const choice=mapFeature(feature);if(!choice||seen.has(choice.candidate.osm_ref))continue;
       seen.add(choice.candidate.osm_ref);choices.push(choice);if(choices.length===5)break;
      }
      return {status:'ready',choices};
     })(),
     new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({status:'unavailable',choices:[]});},timeoutMs);}),
    ]);
    return result;
   }catch(_){return {status:'unavailable',choices:[]};}finally{clearTimeout(timer);pending--;}
  });
  tail=work.then(()=>{},()=>{});return work;
 }
 return async function suggestions(raw,{language,near}={}) {
  const query=typeof raw==='string'?raw.trim().replace(/\s+/g,' '):'';
  if(query.length<3||query.length>200)return {status:'ready',choices:[]};
  const context={language:/^[a-z]{2}$/.test(language||'')?language:null,near:near&&isValidCoordinate(near.lat,near.lng)?{lat:Math.round(near.lat*100)/100,lng:Math.round(near.lng*100)/100}:null};
  const key=createHash('sha256').update(JSON.stringify([endpoint,query.toLowerCase(),context])).digest('hex');
  return cache.get(key,()=>acquire(query,context),{shouldStore:value=>value.status==='ready'});
 };
}
function resolveDefaultPlaceSuggestions(env=process.env) {
 if(['disabled','0','false'].includes(String(env.PARRANDA_PLACE_SUGGESTIONS||'').toLowerCase()))return null;
 return createPlaceSuggestions({endpoint:env.PARRANDA_PLACE_SUGGESTIONS_ENDPOINT||DEFAULT_ENDPOINT});
}
module.exports={createPlaceSuggestions,resolveDefaultPlaceSuggestions,mapFeature};
