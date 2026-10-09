'use strict';
// Immutable-release metadata only; no place rows or request verdicts are cached.
const ROOT='https://stac.overturemaps.org/';
const MAX_ITEMS=64,MAX_BYTES=256*1024,MAX_DOCUMENT_BYTES=64*1024;
const releasePattern=/^\d{4}-\d{2}-\d{2}\.\d+$/;
function validBbox(b){return Array.isArray(b)&&b.length===4&&b.every(v=>typeof v==='number'&&Number.isFinite(v))&&Math.abs(b[0])<=180&&Math.abs(b[2])<=180&&Math.abs(b[1])<=90&&Math.abs(b[3])<=90&&b[1]<=b[3];}
function lonRanges(lo,hi){return lo<=hi?[[lo,hi]]:[[lo,180],[-180,hi]];}
function windowBboxes({lat,lng,radiusKm}){
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||!Number.isFinite(radiusKm)||radiusKm<=0||radiusKm>5)throw new Error('invalid_overture_window');
 // Round outward beyond the SQL's 7 decimal places, never lose a boundary row.
 const dy=radiusKm/110.574+1e-7,dx=radiusKm/(111.32*Math.max(0.01,Math.abs(Math.cos(lat*Math.PI/180))))+1e-7;
 const south=Math.max(-90,lat-dy),north=Math.min(90,lat+dy),lo=lng-dx,hi=lng+dx;
 if(lo < -180)return [[lo+360,south,180,north],[-180,south,hi,north]];
 if(hi > 180)return [[lo,south,180,north],[-180,south,hi-360,north]];
 return [[lo,south,hi,north]];
}
function overlaps(item,window){return item[1]<=window[3]&&item[3]>=window[1]&&lonRanges(item[0],item[2]).some(([lo,hi])=>lo<=window[2]&&hi>=window[0]);}
function canonicalAsset(item,release){
 const prefix=`s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/`;
 const aws=item?.assets?.aws;let href=aws?.alternate?.s3?.href;
 if(!href){const httpsPrefix=`https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/${release}/theme=places/type=place/`;if(typeof aws?.href!=='string'||!aws.href.startsWith(httpsPrefix))throw new Error('invalid_overture_asset');href=prefix+aws.href.slice(httpsPrefix.length);}
 if(typeof href!=='string'||!href.startsWith(prefix)||!new RegExp(`^part-${item.id}-[A-Za-z0-9_-]+\\.zstd\\.parquet$`).test(href.slice(prefix.length)))throw new Error('invalid_overture_asset');
 return href;
}
function createOvertureAssetResolver({fetcher=globalThis.fetch,timeoutMs=5000}={}){
 const cache=new Map();
 async function manifest(release,signal,deadlineMs){
  if(signal?.aborted || (Number.isFinite(deadlineMs)&&Date.now()>=deadlineMs))throw new Error('overture_cancelled');
  if(cache.has(release))return cache.get(release);
  const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,Math.min(5000,Math.max(1,timeoutMs),Number.isFinite(deadlineMs)?Math.max(1,deadlineMs-Date.now()):5000));let bytes=0;
  async function read(url){
   const response=await fetcher(url,{signal:controller.signal,redirect:'error',headers:{Accept:'application/json'}});
   if(!response?.ok)throw new Error('overture_stac_unavailable');
   let text;
   if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;try{for(;;){if(controller.signal.aborted)throw new Error('overture_cancelled');const {done,value}=await reader.read();if(done)break;size+=value.byteLength;bytes+=value.byteLength;if(size>MAX_DOCUMENT_BYTES||bytes>MAX_BYTES)throw new Error('overture_stac_too_large');chunks.push(Buffer.from(value));}text=Buffer.concat(chunks).toString('utf8');}finally{await reader.cancel().catch(()=>{});}}
   else {text=await response.text();const size=Buffer.byteLength(text);bytes+=size;if(size>MAX_DOCUMENT_BYTES||bytes>MAX_BYTES)throw new Error('overture_stac_too_large');}
   if(controller.signal.aborted)throw new Error('overture_cancelled');return JSON.parse(text);
  }
  try{
   const collection=await read(`${ROOT}${release}/places/place/collection.json`);
   if(collection.id!=='place'||!Array.isArray(collection.links)||collection.links.some(l=>l.rel==='next'))throw new Error('incomplete_overture_stac');
   const links=collection.links.filter(l=>l.rel==='item');
   if(!links.length||links.length>MAX_ITEMS)throw new Error('incomplete_overture_stac');
   const seen=new Set(),entries=[];
   for(const link of links){const prefix=`${ROOT}${release}/places/place/`;const tail=typeof link.href==='string'&&link.href.startsWith(prefix)?link.href.slice(prefix.length):'';const match=tail.match(/^(\d{5})\/\1\.json$/);if(!match||seen.has(match[1]))throw new Error('invalid_overture_stac_link');seen.add(match[1]);entries.push({id:match[1],url:link.href});}
   const items=new Array(entries.length);let cursor=0;
   await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{for(;;){const n=cursor++;if(n>=entries.length)return;const entry=entries[n],item=await read(entry.url);if(item.id!==entry.id||!validBbox(item.bbox))throw new Error('invalid_overture_stac_item');items[n]=Object.freeze({bbox:Object.freeze([...item.bbox]),path:canonicalAsset(item,release)});}}));
   if(controller.signal.aborted||signal?.aborted||(Number.isFinite(deadlineMs)&&Date.now()>=deadlineMs))throw new Error('overture_cancelled');
   const result=Object.freeze(items);cache.set(release,result);while(cache.size>2)cache.delete(cache.keys().next().value);return result;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
 }
 return async request=>{
  if(!releasePattern.test(request.release)||request.signal?.aborted)throw new Error('invalid_overture_release');
  const windows=windowBboxes(request),items=await manifest(request.release,request.signal,request.deadlineMs);
  if(request.signal?.aborted)throw new Error('overture_cancelled');
  return [...new Set(items.filter(item=>windows.some(w=>overlaps(item.bbox,w))).map(item=>item.path))];
 };
}
module.exports={createOvertureAssetResolver,windowBboxes,overlaps};
