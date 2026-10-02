"use strict";

// Bounded corroboration of an existing source-owned website, not place
// discovery or a general crawler. Payloads cannot select URLs or supply facts.
const dns = require('node:dns/promises');
const {createHash}=require('node:crypto');
const { parse } = require('parse5');
const { createSourceCache } = require('./source-cache');
const { publicAddressesForUrl, pinnedHttpsFetch } = require('./simpleview-europe-place-detail-source');
const MAX_CANDIDATES = 4;
const MAX_BYTES = 512 * 1024;
const TOTAL_MS = 6000;
const EXCLUDED_HOSTS = /(^|\.)(facebook|instagram|google|tripadvisor|yelp|tiktok)\./i;
const fold = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function sourceUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || url.search || EXCLUDED_HOSTS.test(url.hostname)) return null;
    url.protocol = 'https:'; url.hash = '';
    return url.toString();
  } catch { return null; }
}
function attr(node, name) { return node.attrs?.find(a => a.name === name)?.value || ''; }
function visible(node) {
  return !['script', 'style', 'nav', 'header', 'footer', 'form', 'noscript', 'template'].includes(node.tagName) &&
    !node.attrs?.some(a => a.name === 'hidden' || (a.name === 'aria-hidden' && a.value === 'true'));
}
function text(node) {
  if (!visible(node)) return '';
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(text).join(' ').replace(/\s+/g, ' ').trim();
}
function walk(node, fn) { fn(node); for (const child of node.childNodes || []) walk(child, fn); }

const DAYS = { mandag:'Mo', tisdag:'Tu', onsdag:'We', torsdag:'Th', fredag:'Fr', lordag:'Sa', sondag:'Su', monday:'Mo', tuesday:'Tu', wednesday:'We', thursday:'Th', friday:'Fr', saturday:'Sa', sunday:'Su' };
const DAY = Object.keys(DAYS).join('|');
function parseHours(value) {
  const normalized = String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const pattern = new RegExp(`\\b(${DAY})(?:\\s*[-–—]\\s*(${DAY}))?\\s*:?\\s*(\\d{1,2})(?:[.:](\\d{2}))?\\s*[-–—]\\s*(\\d{1,2})(?:[.:](\\d{2}))?`, 'g');
  const parts = []; const covered=new Set(); const order=['Mo','Tu','We','Th','Fr','Sa','Su']; let m;
  if (/appointment|tidsbokning|efter överenskommelse/i.test(value)) return null;
  while ((m = pattern.exec(normalized))) {
    const open = Number(m[3])*60+Number(m[4]||0), close = Number(m[5])*60+Number(m[6]||0);
    if (open >= close || open >= 1440 || close > 1440 || Number(m[4]||0)>59 || Number(m[6]||0)>59) return null;
    const clock = minutes => `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
    let day=order.indexOf(DAYS[m[1]]), end=order.indexOf(DAYS[m[2]||m[1]]);
    for(let n=0;n<7;n++,day=(day+1)%7){if(covered.has(day))return null;covered.add(day);if(day===end)break}
    parts.push(`${DAYS[m[1]]}${m[2] ? '-'+DAYS[m[2]] : ''} ${clock(open)}-${clock(close)}`);
  }
  // Ambiguous duplicate day assertions must not get collapsed into one fact.
  if (parts.length === 0 || parts.length > 7 || new Set(parts.map(p=>p.split(' ')[0])).size !== parts.length) return null;
  return parts.join('; ');
}
function identityNames(html) {
  const result=[];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const root=JSON.parse(match[1]); const queue=[root];let count=0;
      while(queue.length && count++<100) {
        const v=queue.shift();if(!v||typeof v!=='object')continue;
        if (['WebSite','Organization','LocalBusiness'].includes(v['@type']) && typeof v.name==='string') result.push(v.name);
        if(Array.isArray(v['@graph']))queue.push(...v['@graph']);
      }
    } catch {}
  }
  return result;
}
// Negative evidence only: a complete, unambiguous weekly statement at the
// operator's sole mapped branch can disprove a visit on an explicitly closed
// weekday. It cannot corroborate existence, coordinates, or an open window.
function closedWeekdayEvidence(main, record, exactIdentity, url) {
  if (!exactIdentity || !main) return null;
  const branchLinks=[];
  walk(main,n=>{
    if(n.tagName!=='a')return;
    try {
      const link=new URL(attr(n,'href'));
      if(link.protocol==='https:' && /^(maps\.)?google\.[a-z.]+$/i.test(link.hostname) && link.searchParams.get('daddr'))branchLinks.push(link.searchParams.get('daddr'));
    } catch {}
  });
  const addressWords=value=>String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
  const addresses=[...new Set(branchLinks.map(addressWords))];
  if(addresses.length!==1)return null;
  if(record.source_address?.street && record.source_address?.house_number && !(addresses[0]+' ').startsWith(addressWords(record.source_address.street+' '+record.source_address.house_number)+' '))return null;
  const schedules=[];
  walk(main,n=>{
    if(n.tagName!=='p' || !visible(n))return;
    const value=text(n).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
    if(/appointment|tidsbokning|overenskommelse/.test(value))return;
    const pattern=new RegExp(`\\b(${DAY})\\s*[, :]*\\s*(closed|stangt|\\d{1,2}[.:]\\d{2}\\s*[-–—]\\s*\\d{1,2}[.:]\\d{2})(?=\\s|$)`,'g');
    const assertions=[...value.matchAll(pattern)];
    if(assertions.length!==7 || new Set(assertions.map(m=>DAYS[m[1]])).size!==7)return;
    let scope=n.parentNode;
    while(scope && scope!==main) {
      if(['div','section','article','li'].includes(scope.tagName) && text(scope).length<4000) {
        let ownsBranch=false;walk(scope,child=>{if(child.tagName==='a' && branchLinks.some(address=>{try{return new URL(attr(child,'href')).searchParams.get('daddr')===address}catch{return false}}))ownsBranch=true});
        if(ownsBranch)break;
      }
      scope=scope.parentNode;
    }
    if(!scope || scope===main)return;
    if(assertions.some(m=>!['closed','stangt'].includes(m[2])&&!parseHours(m[1]+' '+m[2])))return;
    const closed=assertions.filter(m=>['closed','stangt'].includes(m[2])).map(m=>DAYS[m[1]]);
    if(closed.length)schedules.push(closed);
  });
  if(schedules.length!==1)return null;
  return {status:'closed_weekdays',source_url:url,closed_weekdays:schedules[0],visit_function:'shopping_schedule',scope:'sole_operator_branch'};
}
function operatorClosureForWindow(candidate, {weekday}={}) {
  const fact=candidate?.operator_visit_evidence;
  if(fact?.status!=='closed_weekdays' || !Number.isInteger(weekday) || weekday<0 || weekday>6 || !fact.closed_weekdays?.includes(['Su','Mo','Tu','We','Th','Fr','Sa'][weekday]))return null;
  return {status:'closed_for_window',eligible:false,reason:'operator_closed_for_query_day',selected_day_hours:{status:'closed',all_day:false,windows:[]}};
}
function parseOperatorVisitEvidence(html, record, url) {
  const document=parse(String(html)); const units=[];walk(document,n=>{if(visible(n)&&n.tagName)units.push(n)});
  const descriptions=units.filter(n=>n.tagName==='meta' && ['description','og:description'].includes(attr(n,'name')||attr(n,'property'))).map(n=>attr(n,'content'));
  const categoryText=descriptions.join(' ');
  const sourceCategory=/\b(second[ -]?hand|vintage|reuse|resale|thrift|loppis)\b/i.test(categoryText)?'second_hand':/\b(antik(?:viteter)?|antiques)\b/i.test(categoryText)?'antiques':null;
  const operatorNames = [...identityNames(html), ...units.filter(n => n.tagName === 'meta' && attr(n, 'property') === 'og:site_name').map(n => attr(n, 'content'))];
  const genericNameWords = new Set(['second', 'hand', 'secondhand', 'vintage', 'reuse', 'resale', 'thrift', 'shop', 'store', 'butik', 'antik', 'antiques']);
  const brandWords = String(record.name || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3 && !genericNameWords.has(word));
  const operatorIdentity = brandWords.length > 0 && operatorNames.some(name => {
    const words = String(name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/);
    return brandWords.every(brand => words.some(word => word === brand || (brand.length >= 6 && word.startsWith(brand))));
  });
  const address=record.source_address;
  if(address?.street && address?.house_number) {
    const words = value => String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
    const wanted=words(address.street)+' '+words(address.house_number);
    const addressMatches = value => (' '+words(value)+' ').includes(' '+wanted+' ');
    const containers=new Set(['div','section','article','li']);
    const leafUnit=node=>containers.has(node.tagName) && !(node.childNodes||[]).some(child=>{
      let nested=false;walk(child,n=>{if(containers.has(n.tagName))nested=true});return nested;
    });
    const candidates=units.filter(leafUnit).map(n=>({n,t:text(n)})).filter(({t})=>t.length<4000 && addressMatches(t)).sort((a,b)=>a.t.length-b.t.length);
    for(const {t} of candidates) {
      const hours=parseHours(t);
      if(!hours || !sourceCategory || !operatorIdentity || !/\b(butiken|butik|store|shop)\b/i.test(t))continue;
      // One card's assertions only. Never borrow another branch's address or
      // opening hours from the enclosing store list.
      if((t.match(/(?:öppettider|opening hours)/gi)||[]).length!==1)continue;
      return {status:'confirmed_storefront',source_url:url,address:{...address},opening_hours:hours,visit_function:'shopping',source_category:sourceCategory};
    }
  }
  const main=units.find(n=>n.tagName==='main') || units.find(n=>n.tagName==='body');
  const content=text(main || document);
  const exactIdentity=identityNames(html).some(name=>fold(name)===fold(record.name));
  const closure=closedWeekdayEvidence(main,record,operatorNames.some(name=>fold(name)===fold(record.name)),url);
  if(closure)return closure;
  // Closed purpose vocabulary. Valuation/intake at an auction office is not
  // an antique-shopping visit, even when the business itself remains active.
  const valuation=/\b(värdering|valuation)\b/i.test(content), intake=/\b(inlämning|intake)\b/i.test(content);
  const office=/\b(kontor|office)\b|inför försäljning/i.test(content);
  const shopping=/\b(butik|butiken|shop|store|shopping)\b/i.test(content);
  if(exactIdentity && valuation && intake && office && !shopping) {
    const addresses=[];
    for (const node of units) {
      if (!/^h[1-6]$/.test(node.tagName) || !/^(adress|address)$/i.test(text(node))) continue;
      const siblings=node.parentNode?.childNodes||[];
      const next=siblings.slice(siblings.indexOf(node)+1).find(n=>n.tagName);
      const match=text(next||{}).match(/^([\p{L} .-]{3,80}?)\s+(\d{1,4}[a-z]?)(?=\s|,|$)/iu);
      if(match)addresses.push({street:match[1].trim(),house_number:match[2]});
    }
    const schedules=[];
    for(const node of units){
      if(!/^h[1-6]$/.test(node.tagName)||!/^(öppet|öppettider|opening hours)$/i.test(text(node)))continue;
      const siblings=node.parentNode?.childNodes||[];
      const next=siblings.slice(siblings.indexOf(node)+1).find(n=>n.tagName);
      const hours=parseHours(text(next||{}));if(hours)schedules.push(hours);
    }
    return {status:'non_shopping_visit',source_url:url,visit_function:'valuation_intake',opening_hours:schedules.length===1?schedules[0]:null,current_address:addresses.length===1?addresses[0]:null};
  }
  return {status:'unresolved',source_url:url};
}
function contactLink(html, root) {
  const doc=parse(html);const links=[];
  walk(doc,n=>{
    if(n.tagName!=='a')return;
    const label=text(n); const href=attr(n,'href');let url;
    try{url=new URL(href,root)}catch{return}
    if(url.origin!==new URL(root).origin || url.search || url.hash || !/^(?:våra butiker|butiker|öppettider|kontakt|contact|store finder|our stores|stores|opening hours)$/i.test(label))return;
    links.push({url:url.toString(),rank:/butik|store/i.test(label)?0:/öppet|opening/i.test(label)?1:2});
  });
  return links.sort((a,b)=>a.rank-b.rank || a.url.localeCompare(b.url))[0]?.url || null;
}

function createOperatorVisitEnricher({
  env=process.env,fetcher=pinnedHttpsFetch,resolveHost=dns.lookup,now=()=>Date.now(),
  cache=createSourceCache({namespace:'operator-visit-evidence-v3',dir:env.PARRANDA_CACHE_DIR,ttlMs:6*60*60*1000}),
  maxMs=TOTAL_MS,
}={}) {
  async function read(url, signal, deadline, outcomes, canonicalHop=false) {
    const remaining=deadline-now();if(remaining<=0 || signal?.aborted)return null;
    const addresses=await publicAddressesForUrl(url,url,resolveHost,Math.min(remaining,1500));if(!addresses || deadline-now()<=0 || signal?.aborted)return null;
    const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,Math.max(1,deadline-now()));const started=now();
    try {
      const response=await fetcher(url,{redirect:'manual',signal:controller.signal,validatedAddresses:addresses,headers:{'User-Agent':'Parranda/1.0 (bounded operator fact check)',Accept:'text/html'}});
      outcomes.push({url,status:response.status,elapsed_ms:now()-started});
      if([301,302,307,308].includes(response.status) && !canonicalHop) {
        let target;
        try{target=new URL(response.headers?.get?.('location'),url)}catch{}
        const original=new URL(url);
        await response.body?.cancel?.();
        // Only the operator's exact www/apex alias, same HTTPS path, no query,
        // credentials, port or second redirect. DNS is validated/pinned again.
        if(target && target.protocol==='https:' && !target.username && !target.password && !target.port && !target.search && !target.hash && target.pathname===original.pathname && target.hostname!==original.hostname && target.hostname.replace(/^www\./,'')===original.hostname.replace(/^www\./,''))return read(target.toString(),signal,deadline,outcomes,true);
        return null;
      }
      if(response.status!==200 || (response.url&&response.url!==url) || !/^(text\/html|application\/xhtml\+xml)/i.test(response.headers?.get?.('content-type')||'')) {await response.body?.cancel?.();return null}
      const declared=Number(response.headers?.get?.('content-length'));if(declared>MAX_BYTES){await response.body?.cancel?.();return null;}
      const reader=response.body?.getReader?.();if(!reader)return null;
      let size=0;const chunks=[];
      try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();return null}chunks.push(Buffer.from(value));}}finally{reader.releaseLock()}
      if(controller.signal.aborted||now()>deadline)return null;
      return {html:Buffer.concat(chunks).toString('utf8'),url};
    } catch {outcomes.push({url,status:'unavailable',elapsed_ms:now()-started});return null;}
    finally {clearTimeout(timer);signal?.removeEventListener('abort',abort)}
  }
  return async function enrichOperatorVisits(records, context={}) {
    if(!Array.isArray(records))return records;
    const deadline=Math.min(now()+maxMs,Number.isFinite(context.deadline)?context.deadline-5000:Infinity);
    const targets=records.filter(r=>r.type==='vintage-shop'&&sourceUrl(r.website)).slice(0,MAX_CANDIDATES);
    const facts=new Map();const outcomes=[];
    const pages=new Map();
    const page = url => {
      if(!pages.has(url))pages.set(url,read(url,context.signal,deadline,outcomes));
      return pages.get(url);
    };
    // Bounded two-wide acquisition; no unbounded request-time fan-out.
    let cursor=0;
    await Promise.all([0,1].map(async()=>{
      while(cursor<targets.length && now()<deadline && !context.signal?.aborted) {
        const record=targets[cursor++],url=sourceUrl(record.website);
        const key=createHash('sha256').update(JSON.stringify([url,record.name,record.source_address||null])).digest('hex');
        const fact=await cache.get(key,async()=>{
          const initial=await page(url);if(!initial)return null;
          let fact=parseOperatorVisitEvidence(initial.html,record,initial.url);
          if(fact.status==='unresolved') {
            const link=contactLink(initial.html,initial.url);
            if(link&&link!==initial.url){const next=await page(link);if(next)fact=parseOperatorVisitEvidence(next.html,record,next.url)}
          }
          return {...fact,observed_at:new Date(now()).toISOString()};
        },{signal:context.signal,shouldStore:v=>!!v && v.status!=='unresolved'}).catch(()=>null);
        facts.set(record.id,fact);
      }
    }));
    context.signal?.throwIfAborted();
    const output=records.map(record=>{
      const fact=facts.get(record.id) || [...facts.entries()].map(([id, f])=>({record:targets.find(t=>t.id===id),fact:f}))
        .find(({record:other,fact:f})=>f?.status==='non_shopping_visit' && fold(other.name)===fold(record.name) &&
          sourceUrl(other.website)===sourceUrl(record.website))?.fact;
      if(!fact||fact.status==='unresolved')return record;
      if(['non_shopping_visit','closed_weekdays'].includes(fact.status))return {...record,operator_visit_evidence:fact};
      return {...record,opening_hours:fact.opening_hours,operator_visit_evidence:fact,
        sources:[...(record.sources||[]),{provider:'operator-website',family:'official',tier:'official',url:fact.source_url,observed_at:fact.observed_at}],
      };
    });
    for(const name of ['loader_status','loader_error'])if(records[name]!==undefined)Object.defineProperty(output,name,{value:records[name]});
    Object.defineProperty(output,'loader_metadata',{value:{...(records.loader_metadata||{}),operator_evidence:{
      attempted:targets.length,confirmed:[...facts.values()].filter(f=>f?.status==='confirmed_storefront').length,
      excluded:[...facts.values()].filter(f=>['non_shopping_visit','closed_weekdays'].includes(f?.status)).length,
      outcomes, candidates:targets.map(t=>({id:t.id,status:facts.get(t.id)?.status||'not_observed'})),
    }}});
    return output;
  };
}
module.exports={createOperatorVisitEnricher,parseOperatorVisitEvidence,parseHours,contactLink,sourceUrl,operatorClosureForWindow};
