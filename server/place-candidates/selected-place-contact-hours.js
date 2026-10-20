'use strict';
const {parse}=require('parse5');
const DAYS=['Mo','Tu','We','Th','Fr','Sa','Su'];
const DAY_NAMES=['mandag(?:ar)?|monday','tisdag(?:ar)?|tuesday','onsdag(?:ar)?|wednesday','torsdag(?:ar)?|thursday','fredag(?:ar)?|friday','lordag(?:ar)?|saturday','sondag(?:ar)?|sunday'];
const DAY_PATTERN=DAY_NAMES.map(x=>`(?:${x})`).join('|');
const fold=x=>String(x||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[–—−]/g,'-').replace(/\s+/g,' ').trim();
const exact=x=>String(x||'').normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim();
const attr=(n,k)=>n.attrs?.find(x=>x.name===k)?.value||'';
const within=(n,p)=>{for(;n;n=n.parentNode)if(n===p)return true;return false};
function rootUrl(value){try{const u=new URL(value);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||/^(?:https?:\/\/)[^/]*:/i.test(value))return null;u.protocol='https:';u.hostname=u.hostname.replace(/^www\./,'');return u.toString()}catch{return null}}
function view(html){
 if(typeof html!=='string'||Buffer.byteLength(html)>512*1024)return null;
 const doc=parse(html),nodes=[],texts=new Map(),stack=[[doc,0,false]];let count=0;
 while(stack.length){const [n,d,hidden]=stack.pop();if(d>64||++count>12000)return null;
 const excluded=hidden||['script','style','template','noscript','form','svg'].includes(n.tagName)||n.attrs?.some(a=>a.name==='hidden'||(a.name==='aria-hidden'&&a.value==='true'));
 if(!excluded)nodes.push(n);for(let i=(n.childNodes||[]).length-1;i>=0;i--)stack.push([n.childNodes[i],d+1,excluded]);}
 for(let i=nodes.length-1;i>=0;i--){const n=nodes[i];texts.set(n,n.nodeName==='#text'?n.value:(n.childNodes||[]).map(c=>texts.get(c)||'').join(n.tagName==='p'||/^h[1-6]$/.test(n.tagName)?'':' '));}
 return {nodes,text:n=>(texts.get(n)||'').replace(/\s+/g,' ').trim()};
}
function paragraphLines(n,visible){const lines=[''];const walk=x=>{if(!visible.has(x))return;if(x.nodeName==='#text')lines[lines.length-1]+=x.value;else if(x.tagName==='br')lines.push('');else for(const c of x.childNodes||[])walk(c)};walk(n);return lines.map(fold).filter(Boolean)}
function clock(value){const m=value.match(/^(\d{1,2})[:.](\d{2})$/);if(!m)return null;const h=+m[1],min=+m[2];return h<=24&&min<60&&!(h===24&&min)?`${String(h).padStart(2,'0')}:${m[2]}`:null}
function schedule(p,visible){
 const lines=paragraphLines(p,visible);if(!/^(?:oppettider|opening hours)$/.test(lines.shift()||''))return null;
 const week={},unresolved=new Set();
 for(const line of lines){
  if(/^(?:storhelger|special holidays|special hours):\s*(?:se nyhetssidan|se nyheter|see news)$/.test(line)){unresolved.add('special_hours');continue;}
  const match=line.match(new RegExp(`^(${DAY_PATTERN})(?:(?:\\s*(?:-|till|to)\\s*)(${DAY_PATTERN}))?(?:\\s*(?:/|och|and)\\s*(rodadagar|roda dagar|helgdagar|holidays))?\\s*:?\\s*(.+)$`));
  if(!match)return null;
  const day=x=>DAY_NAMES.findIndex(y=>new RegExp(`^(?:${y})$`).test(x));const start=day(match[1]),end=match[2]?day(match[2]):start;
  if(start<0||end<start)return null;
  const body=match[4];let windows=[];
  if(!/^(?:stangt|closed)$/.test(body)){
   for(const segment of body.split(/\s*,\s*/)){
    const times=segment.match(/^(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})$/);if(!times)return null;
    const opens=clock(times[1]),closes=clock(times[2]);if(!opens||!closes||opens>=closes||windows.length>=4||windows.some(w=>opens<w.closes))return null;windows.push({opens,closes});}
  }
  if(match[3]){if(windows.length)return null;unresolved.add('holiday_condition');}
  for(let i=start;i<=end;i++){if(week[DAYS[i]])return null;week[DAYS[i]]=windows.map(w=>({...w}));}
 }
 return DAYS.every(d=>Object.hasOwn(week,d))?{week,unresolved:[...unresolved]}:null;
}
/** Closed root-page contact proof; unrelated news and SEO prose are not schedule facts. */
function parseSelectedPlaceContactHours(html,record,{sourceUrl}={}){
 const entry=rootUrl(record?.website),source=rootUrl(sourceUrl),v=view(html);
 if(!entry||source!==entry||!v||typeof record.name!=='string'||!record.name.trim())return null;
 const {nodes,text}=v,mains=nodes.filter(n=>n.tagName==='main');if(mains.length!==1)return null;
 const welcomes=nodes.filter(n=>/^h[1-6]$/.test(n.tagName)&&within(n,mains[0])&&/^(?:valkommen till oss pa |welcome to )/.test(fold(text(n))));
 if(welcomes.length!==1)return null;
 const welcome=text(welcomes[0]).match(/^(?:Välkommen till oss på |Welcome to )(.+?) (?:i|in) ([\p{L} .'-]+)!?$/u);
 if(!welcome||exact(welcome[1])!==exact(record.name))return null;
 const locality=welcome[2].replace(/!$/,'').trim(),alias=`${welcome[1]} ${locality}`;
 const titles=nodes.filter(n=>n.tagName==='title');
 if(titles.length!==1||exact(text(titles[0])).replace(/^-\s*/,'')!==exact(alias))return null;
 if(!nodes.some(n=>n.tagName==='a'&&exact(text(n))===exact(alias)&&rootUrl(attr(n,'href'))===entry))return null;
 if(record.type==='museum'&&/\b(?:cafe|bakery|bageri|konditori)\b/.test(fold(record.name)))return null;
 const contacts=nodes.filter(n=>n.tagName==='article'&&within(n,mains[0])&&nodes.some(h=>/^h[1-6]$/.test(h.tagName)&&within(h,n)&&/^(?:kontakta oss|contact us)$/.test(fold(text(h)))));
 if(contacts.length!==1)return null;const contact=contacts[0];
 const addresses=nodes.filter(n=>n.tagName==='p'&&(n.childNodes||[]).some(c=>c.tagName==='strong'&&/^(?:adress|address)$/.test(fold(text(c)))));
 if(addresses.length!==1)return null;
 const address=text(addresses[0]).replace(/^(?:Adress|Address)\s*/,'').trim();
 const parts=address.match(/^(.+?\s+\d+[\p{L}]?)(?:\s+\d{3}\s?\d{2})?\s+(.+)$/u);
 if(!parts||exact(parts[2])!==exact(locality))return null;
 const contactText=exact(text(contact));
 if(!contactText.includes(exact(parts[1])+' ')||!contactText.includes(exact(locality)))return null;
 if(record.source_address!==undefined){
  const supplied=record.source_address;
  if(typeof supplied==='string'){if(exact(supplied)!==exact(address))return null;}
  else if(!supplied||typeof supplied!=='object'||typeof supplied.street!=='string'||!['string','number'].includes(typeof supplied.house_number)||exact(`${supplied.street} ${supplied.house_number}`)!==exact(parts[1]))return null;
 }
 const marked=nodes.filter(n=>n.tagName==='p'&&(n.childNodes||[]).some(c=>c.tagName==='strong'&&/^(?:oppettider|opening hours)$/.test(fold(text(c)))));
 const primary=marked.filter(n=>within(n,contact));if(primary.length!==1)return null;
 const visible=new Set(nodes);
 const parsed=schedule(primary[0],visible);if(!parsed)return null;
 // A paragraph label scopes the schedule, but a competing service heading or
 // current closure in this same contact article must not be discarded.
 for(const n of nodes){
  if(!within(n,contact)||within(n,primary[0]))continue;
  const value=fold(text(n));
  if(/^h[1-6]$/.test(n.tagName)&&/\b(?:guided tours?|visningar|telephone hours|telefontider|goods intake|inlamning)\b/.test(value))return null;
  if(n.tagName==='p'&&/\b(?:closed|stangt|renovation|helgdagar|holidays)\b/.test(value))return null;
 }
 const conditions=text(contact).replace(text(primary[0]),' ');
 if(/\b(?:closed|stangt|renovation|helgdagar|holidays)\b/.test(fold(conditions)))return null;
 if(record.type==='museum'&&/\b(?:cafe|bakery|bageri|konditori)\b/.test(contactText))return null;
 const reasons=new Set(parsed.unresolved);
 for(const block of marked){if(block===primary[0])continue;
  const footer=nodes.find(n=>n.tagName==='footer'&&within(block,n));
  if(!footer||!within(addresses[0],footer))return null;
  const duplicate=schedule(block,visible);if(!duplicate||JSON.stringify(duplicate.week)!==JSON.stringify(parsed.week))return null;
  for(const reason of duplicate.unresolved)reasons.add(reason);
 }
 return {entry_url:entry,source_url:source,source_relation:'entry',visit_function:'general_visit',rules:[{week:parsed.week}],overrides:[],unresolved:[...reasons].map(reason=>({reason}))};
}
module.exports={parseSelectedPlaceContactHours};
