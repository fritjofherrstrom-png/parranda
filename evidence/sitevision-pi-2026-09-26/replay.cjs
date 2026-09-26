#!/usr/bin/env node
// Usage: node replay.cjs /path/to/checkout /path/to/521-checkout
const fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(process.argv[2]||'');const ref=path.resolve(process.argv[3]||repo);
if(!process.argv[2])throw new Error('Pass checkout path; optionally pass #521 reference checkout');
const root=__dirname;const mod=require(path.join(repo,'server/pulse-sources/sitevision-calendar-provider.js'));
const reference=require(path.join(ref,'server/pulse-sources/sitevision-calendar-provider.js'));
(async()=>{let output=[];for(const name of ['simrishamn','malmo']){
 const endpoint=name==='simrishamn'?'https://www.simrishamn.se/evenemangskalender':'https://malmo.se/evenemangskalender';
 const listing=fs.readFileSync(path.join(root,'fixtures',name+'-listing.html'),'utf8');
 const rows=reference.extractSitevisionCalendarEvents(listing,{baseUrl:endpoint,date:'2026-09-26',timezone:'Europe/Stockholm'}).slice(0,8);
 const pages=new Map([[endpoint,listing],...rows.map((r,i)=>[r.source_url,fs.readFileSync(path.join(root,'fixtures',`${name}-${i}.html`),'utf8')])]);
 const fetcher=async u=>({ok:pages.has(u),status:pages.has(u)?200:404,text:async()=>pages.get(u)||''});
 const direct=rows.map((r,i)=>{const d=mod.extractSitevisionEventDetail(pages.get(r.source_url),{sourceUrl:r.source_url,expectedDate:r.listing_date,expectedTitle:r.title,timezone:'Europe/Stockholm'});return{index:i,title:r.title,listing_date:r.listing_date,lat:d.lat??null,lng:d.lng??null,detail_venue:d.place_context??null}});
 const collected=await mod.createSitevisionCalendarProvider({endpoint,baseUrl:endpoint,timezone:'Europe/Stockholm',limit:8,detailLimit:8,fetcher}).create({key:name}).collect({date:'2026-09-26'});
 const events=collected.time_sensitive_events||[];
 output.push({name,detailPins:direct.filter(x=>x.lat!=null&&x.lng!=null).length,providerRows:events.length,providerPins:events.filter(x=>x.lat!=null&&x.lng!=null).length,direct,events});
}console.log(JSON.stringify(output,null,2))})().catch(e=>{console.error(e);process.exitCode=1});
