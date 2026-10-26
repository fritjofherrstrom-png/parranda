import { buildSavedEntry } from './anywhere-storage.mjs';
import { anchorKey } from './recompose-retention.mjs';
import { buildCommitmentSnapshot, readCommitmentSnapshot } from './commitment-snapshot.mjs';
import { normalizeDayEdit, normalizePreferencePriority } from '../../../shared/planner-intent.mjs';
import { isLiveOccurrenceId } from './live-stop-choice.mjs';
import { validPlaceRef } from './anywhere-share.mjs';

export const MAX_PUBLISHED_DAY_BYTES = 1048576;
const REF = /^[a-f0-9]{48}$/;
const PREFS = ['food','culture','views','fika','nightlife','green','second_hand'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const requireValue = condition => { if (!condition) throw new Error('published_day_unavailable'); };
const keys = (v, allowed, required = allowed) => object(v) && Object.keys(v).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(v,k));
const realDate = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && !v.startsWith('0000') && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const instant = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(v) && realDate(v.slice(0,10)) && Number.isFinite(Date.parse(v));
const string = (v,max = 200) => typeof v === 'string' && !!v && v === v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const list = (v, max, valid) => Array.isArray(v) && v.length <= max && new Set(v).size === v.length && v.every(valid);
function lifetime(v,now) {
  return instant(v?.created_at) && instant(v?.expires_at) && Date.parse(v.created_at) <= now && Date.parse(v.expires_at) > now && Date.parse(v.expires_at) > Date.parse(v.created_at);
}
export function readyPublishedDay(value, now = Date.now()) {
  return keys(value,['version','state','ref','created_at','expires_at']) && value.version === 1 && value.state === 'ready' && typeof value.ref === 'string' && REF.test(value.ref) && lifetime(value,now) ? value : null;
}
export function publishedDayHref(ref, lang) {
  return typeof ref === 'string' && REF.test(ref) && ['en','sv'].includes(lang) ? `/anywhere?snapshot=${ref}&lang=${lang}` : null;
}
function boundedGraph(value) {
  let count = 0;
  function visit(v,depth) {
    requireValue(++count <= 100000 && depth <= 64);
    if (v && typeof v === 'object') for (const [key,child] of Object.entries(v)) {
      requireValue(!['__proto__','constructor','prototype','live_completion','planner_lifecycle','selection_id','place_selection'].includes(key));
      visit(child,depth+1);
    }
  }
  visit(value,0);
  requireValue(new TextEncoder().encode(JSON.stringify(value)).length <= MAX_PUBLISHED_DAY_BYTES);
}

/** Consume server AcknowledgedIntent; never treat it as an existing SavedEntry. */
export function parsePublishedDay(value, { ref, decision, now = Date.now() } = {}) {
  try {
    boundedGraph(value);
    requireValue(keys(value,['version','ref','created_at','expires_at','language','intent','result']) && value.version === 1 && REF.test(ref) && value.ref === ref && lifetime(value,now) && ['en','sv'].includes(value.language));
    const i = value.intent, r = value.result;
    const required = ['dateIso','place','placeLabel','placeRef','mode','selected','walkKey','excludedCandidateIds','pinnedCandidateIds','liveEventChoices'];
    requireValue(keys(i,[...required,'preferencePriority','dayEdit'],required) && i.mode === 'typed' && realDate(i.dateIso) && string(i.place,500) && i.place === i.placeLabel && typeof i.placeRef === 'string' && validPlaceRef(i.placeRef) === i.placeRef);
    requireValue(list(i.selected,7,p => PREFS.includes(p)) && ['calm','balanced','full','free'].includes(i.walkKey));
    requireValue(i.preferencePriority === undefined || (Array.isArray(i.preferencePriority) && i.preferencePriority.length > 0 && same(normalizePreferencePriority(i.preferencePriority,i.selected),i.preferencePriority)));
    requireValue(i.dayEdit === undefined || (i.dayEdit?.action === 'remove' && same(normalizeDayEdit(i.dayEdit),i.dayEdit)));
    requireValue(list(i.pinnedCandidateIds,12,id => string(id,64) && /^[a-z0-9][a-z0-9_:.-]*$/i.test(id) && !id.startsWith('live:')) && list(i.excludedCandidateIds,53,id => string(id) && !id.startsWith('live:')));
    requireValue(Array.isArray(i.liveEventChoices) && i.liveEventChoices.length <= 52 && new Set(i.liveEventChoices.map(c => c?.occurrence_id)).size === i.liveEventChoices.length && i.liveEventChoices.every(c => keys(c,['occurrence_id','action']) && isLiveOccurrenceId(c.occurrence_id) && ['keep','remove','replace'].includes(c.action)));
    requireValue(keys(r,['days','place_structure','live_events','agnostic_route_output_experiment'],['days','agnostic_route_output_experiment']) && Array.isArray(r.days) && r.days.length === 1 && r.days[0].date === i.dateIso);
    const e = r.agnostic_route_output_experiment, day = r.days[0], resolved = e?.intake?.resolved;
    requireValue(e?.synthesized_via === 'agnostic_compose_engine' && e.route_mutation === true && e.eligibility?.eligible === true && e.intake?.mode === 'place' && e.intake.status === 'resolved' && resolved?.label === i.placeLabel && resolved.place_ref === i.placeRef && ['explicit','high','medium'].includes(resolved.confidence?.toLowerCase()));
    requireValue(!r.live_events || (r.live_events.pending !== true && (!r.live_events.selected_date || r.live_events.selected_date === i.dateIso)));
    const cls = decision.classifyAnywhereResult(r,{place:i.place});
    requireValue(decision.isComposedStatus(cls.status) || cls.status === 'edited_empty');
    const stops = day.primary_route?.main_stops || [];
    requireValue(Array.isArray(stops) && new Set(stops.map(s => s.id)).size === stops.length && stops.every(s => string(s.id) && string(s.label,500) && typeof s.lat === 'number' && Number.isFinite(s.lat) && Math.abs(s.lat) <= 90 && typeof s.lng === 'number' && Number.isFinite(s.lng) && Math.abs(s.lng) <= 180 && !i.excludedCandidateIds.includes(s.id)));
    if (cls.status === 'edited_empty') requireValue(i.dayEdit?.target_stop_count === 0 && day.primary_route === null && day.manual_empty_day === true && e.manual_edit_published === true);
    else requireValue(stops.length > 0 && e.promotion?.promote === true && !day.manual_empty_day);
    if (i.dayEdit) {
      const edit = e.day_edit;
      requireValue(edit?.version === 1 && ['remove','replace'].includes(edit.action) && edit.status === 'applied' &&
        edit.candidate_id === i.dayEdit.candidate_id && edit.target_stop_count === stops.length &&
        edit.actual_stop_count === stops.length && same(edit.result_candidate_ids,stops.map(s => s.id)) &&
        same(i.dayEdit.retained_candidate_ids,stops.map(s => s.id)) && i.dayEdit.target_stop_count === stops.length &&
        Array.isArray(edit.retained_candidate_ids) && edit.retained_candidate_ids.every(id=>stops.some(s=>s.id===id)) &&
        Array.isArray(edit.unavailable_retained_candidate_ids) && edit.unavailable_retained_candidate_ids.length === 0 &&
        (edit.action === 'remove' ? edit.replacement_candidate_id === null : stops.some(s=>s.id===edit.replacement_candidate_id)) &&
        [i.dayEdit.candidate_id,...i.dayEdit.removed_candidate_ids].every(id=>i.excludedCandidateIds.includes(id)) &&
        !stops.some(s => [i.dayEdit.candidate_id,...i.dayEdit.removed_candidate_ids].includes(s.id)));
    } else requireValue(!e.day_edit);
    const entries = Object.create(null), labels = new Map();
    const remember = (row,label) => { for (const id of [row.id,row.place_id,row.candidate_id,row.live_occurrence_id]) if (id && !labels.has(id)) labels.set(id,label); };
    for (const s of stops) remember(s,s.label || s.name);
    for (const area of r.place_structure?.district_day?.areas || []) for (const s of area.stops || []) remember(s,s.name);
    const event = row => { remember(row,row.title); for (const child of row.occurrences || []) event(child); };
    for (const row of [...(r.live_events?.tonight||[]),...(r.live_events?.this_week||[]),...(r.live_events?.browse?.tonight?.more||[]),...(r.live_events?.browse?.this_week?.more||[])]) event(row);
    const add = (id,kind,liveAction) => {
      requireValue(!Object.hasOwn(entries,id) && string(id,128));
      const label = labels.get(id) || ''; requireValue(label.length <= 120 && label === label.trim());
      entries[id] = {kind,label,...(liveAction ? {liveAction} : {})};
    };
    for (const id of i.pinnedCandidateIds) add(id,'pin');
    for (const id of i.excludedCandidateIds) add(id,'exclude');
    for (const c of i.liveEventChoices.filter(c => c.occurrence_id.slice(5,15) === i.dateIso)) {
      add(c.occurrence_id,c.action === 'keep' ? 'pin' : 'exclude',c.action === 'keep' ? null : c.action);
      requireValue(c.action === 'keep' || !stops.some(s => s.live_occurrence_id === c.occurrence_id));
    }
    const appliedPins = Object.entries(entries).filter(([,v]) => v.kind === 'pin').map(([id,v]) => ({id,...v}));
    const pins = e.pinned_candidates;
    const missingPins = i.pinnedCandidateIds.filter(id => !stops.some(s => s.id === id));
    requireValue(keys(pins,['requested_count','honored_count','unhonored_count','unhonored']) && pins.requested_count === i.pinnedCandidateIds.length && pins.honored_count === i.pinnedCandidateIds.length - missingPins.length && pins.unhonored_count === missingPins.length && Array.isArray(pins.unhonored) && same(pins.unhonored.map(v=>v.id),missingPins));
    if (i.liveEventChoices.length) {
      const active = i.liveEventChoices.filter(c=>c.occurrence_id.slice(5,15) === i.dateIso);
      const absent = active.filter(c=>c.action === 'keep' && !stops.some(s=>s.is_live_event === true && s.live_choice_eligible === true && s.live_occurrence_id === c.occurrence_id));
      const live = e.live_event_choices;
      requireValue(keys(live,['requested_count','ignored_other_day_count','remove_requested','honored_count','unhonored']) && live.requested_count === active.length && live.ignored_other_day_count === i.liveEventChoices.length-active.length && live.remove_requested === active.some(c=>c.action === 'remove') && live.honored_count === active.filter(c=>c.action === 'keep').length-absent.length && Array.isArray(live.unhonored) && same(live.unhonored.map(v=>v.id),absent.map(c=>c.occurrence_id)));
    } else requireValue(!e.live_event_choices);
    const refusals = [...pins.unhonored,...(e.live_event_choices?.unhonored||[])];
    requireValue(refusals.every(v => appliedPins.some(p => p.id === v.id) && (v.reason === null || (typeof v.reason === 'string' && /^[a-z][a-z_]{0,63}$/.test(v.reason)))));
    const inputs = { city:null, place:i.place, placeLabel:i.placeLabel, placeRef:i.placeRef, mode:'typed', selected:i.selected, walkKey:i.walkKey, dayOffset:0, ...(i.preferencePriority ? {preferencePriority:i.preferencePriority} : {}), ...(i.dayEdit ? {dayEdit:i.dayEdit} : {}) };
    const entry = buildSavedEntry({ place:i.place, placeLabel:i.placeLabel, label:i.placeLabel, dateIso:i.dateIso, savedAt:value.created_at, safeResponse:decision.safeResponseFor(r,cls), classification:cls, inputs });
    entry.commitments = buildCommitmentSnapshot({anchorKey:anchorKey(inputs), dayKey:entry.id, entries, appliedPins, refusals});
    if (Object.keys(entries).length) {
      const ledger = readCommitmentSnapshot(entry.commitments,{anchorKey:anchorKey(inputs),dayKey:entry.id});
      requireValue(ledger.applies && same(Object.entries(ledger.entries),Object.entries(entries)) && ledger.appliedPins.length === appliedPins.length && ledger.refusals.length === refusals.filter(f => f.reason).length);
    }
    return { entry, publication:{version:1,state:'ready',ref,created_at:value.created_at,expires_at:value.expires_at} };
  } catch { return null; }
}

/** Bound the actual stream, not an optional/untrusted Content-Length. */
export async function readPublishedDay(response, options) {
  requireValue(response.ok);
  const length = response.headers?.get?.('content-length');
  requireValue(length == null || (/^\d+$/.test(length) && Number(length) <= MAX_PUBLISHED_DAY_BYTES));
  const signal = options?.signal;
  const check = () => requireValue(!signal?.aborted);
  let text;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = []; let size = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort',abort,{once:true});
    try {
      for (;;) {
        check(); const {done,value} = await reader.read(); check();
        if (done) break;
        size += value.byteLength;
        requireValue(size <= MAX_PUBLISHED_DAY_BYTES); chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
      text = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    } finally { signal?.removeEventListener('abort',abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else if (response.text) text = await response.text();
  else text = JSON.stringify(await response.json()); // bounded older transport adapters
  check(); requireValue(new TextEncoder().encode(text).length <= MAX_PUBLISHED_DAY_BYTES);
  const parsed = parsePublishedDay(JSON.parse(text),options); requireValue(parsed); return parsed;
}
