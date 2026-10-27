'use strict';

// Closed, source-derived constructions; deliberately not a copy of a producer
// graph and not an interpreter for discovery/ALLOWLIST.json.
const { isRealIsoDate } = require('./requested-dates');
const { isDeepStrictEqual, types: { isProxy } } = require('node:util');
const { normalizeSelectedDayHoursFact } = require('../place-candidates/opening-hours');
const { occurrenceDate, liveOccurrenceId } = require('./live-occurrence-choice');
const { eventOccurrenceForDate } = require('../candidates/evening-event-weave');
const { parsePlaceRef } = require('../place-candidates/place-ref');
const MAX_BYTES = 1048576;
// Additional projector policy, NOT source cardinality caps. Refuse, never cut.
const MAX_NODES = 100000;
const MAX_DEPTH = 64;
const own = (value, key) => {
  if (isProxy(value)) throw new Error('proxy');
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return { present: false };
  if (!Object.hasOwn(descriptor, 'value')) throw new Error('accessor');
  return { present: true, value: descriptor.value };
};
const rule = (type, required = false, nullable = false) => ({ type, required, nullable });
const r = type => rule(type, true);
const o = type => rule(type);
const n = type => rule(type, false, true);
const array = (item, min = 0, max = Infinity) => ({ item, min, max });
const enumeration = (...values) => ({ values });
const fields = {
  LiveChoice: { occurrence_id: r('liveId'), action: r(enumeration('keep','remove','replace')) },
  RequestEdit: { version: r(enumeration(1)), action: r(enumeration('remove','replace')), candidate_id: r('editId'),
    retained_candidate_ids: r(array('editId',0,6)), target_stop_count: r('count'), slot_index: r('count'),
    replacement_preference: rule(enumeration('food','culture','views','fika','nightlife','green','second_hand'),true,true),
    removed_candidate_ids: r(array('editId',0,12)), preserve_retained: o('bool'), release_extent: o('bool') },
  AcknowledgedIntent: { dateIso: r('date'), place: r('label500'), placeLabel: r('label500'), placeRef: r('placeRef'), mode: r(enumeration('typed')),
    selected: r(array(enumeration('food','culture','views','fika','nightlife','green','second_hand'),0,7)),
    preferencePriority: o(array(enumeration('food','culture','views','fika','nightlife','green','second_hand'),0,7)),
    walkKey: r(enumeration('calm','balanced','full','free')), dayEdit: o('RequestEdit'), excludedCandidateIds: r(array('editId',0,53)),
    pinnedCandidateIds: r(array('candidateInputId',0,12)), liveEventChoices: r(array('LiveChoice',0,52)) },
  InputIntent: { dateIso: r('date'), preferences: r(array(enumeration('food','culture','views','fika','nightlife','green','second_hand'),0,7)),
    preferencePriority: r(array(enumeration('food','culture','views','fika','nightlife','green','second_hand'),0,7)),
    dayRhythm: r(enumeration('calm','balanced','full','free')), excludedCandidateIds: r(array('editId',0,53)),
    pinnedCandidateIds: r(array('candidateInputId',0,12)), liveEventChoices: r(array('LiveChoice',0,52)), dayEdit: rule('RequestEdit',true,true) },
  Point: { lat: r('lat'), lng: r('lng') },
  RoutePoint: { lat: r('lat'), lng: r('lng'), label: n('string'), role: o('string') },
  Trust: { source_tier: r('string'), confidence: r('string'), human_verified: r('bool'), freshness: r('string') },
  TrustSummary: { source_tiers: r(array('string')), confidence: r('string'), human_verified: r('bool'), freshness: r('string') },
  PlaceDetails: { kind: o('string'), address: o('address') },
  HoursWindow: { opens: r('clock'), closes: r('closingClock') },
  SelectedHours: { status: r(enumeration('known','closed','unknown')), all_day: r('bool'), windows: r(array('HoursWindow',0,4)),
    date: o('date'), timezone: o('timezone'), source_url: o('shortUrl'), observed_at: o('instant'),
    ordinary_status: o('string'), ordinary_windows: o(array('HoursWindow',0,4)), uncertainty: o('string') },
  StopSource: { kind: n('string'), label: n('string'), category: n('string'), url: n('url'),
    link_kind: n(enumeration('page','site_home')), link_host: n('string') },
  Attribution: { label: n('string'), url: n('url'), license: n('string') },
  Provenance: { attribution: o(array('Attribution')) },
  TimeWindow: { label: o('string'), kind: r(enumeration('daily','continuous','all_day','occurrences','period')), starts_at: n('instant'), ends_at: n('instant'),
    starts_on: n('date'), ends_on: n('date'), local_start: n('clock'), local_end: n('clock'), timezone: n('string'),
    dates: o(array('date',0,60)), all_day_explicit: o('bool'), spans_midnight: o('bool') },
  Recurrence: { rule: o('string'), label: o('string'), timezone: o('string'), occurrence_status: o(enumeration('unconfirmed')) },
  CalendarFact: { kind: r(enumeration('public_holiday')), scope: r(enumeration('national','regional','local')), country_code: r('string'),
    area: r('string'), temporal_scope: r(enumeration('full_day','half_day')), flags: r(array(enumeration('Recommended','Provisional','OneTime','Exception'),0,4)) },
  EventSource: { identity: n('string'), family: n('string'), type: n('string'), provider_id: n('string'), occurrence_id: n('string'),
    attribution: n('string'), license: n('string'), label: n('string'), url: n('url'), tier: n('string'), confidence: n('string') },
  Event: { id: r('nonblank'), title: r('string'), place: n('string'), address: n('string'), source_provider_id: n('string'), source_series_id: n('id200'),
    source_occurrence_id: n('id200'), source_label: n('string'), source_url: n('url'), source_link_kind: n(enumeration('page','site_home')),
    source_link_host: n('string'), timezone: n('string'), starts_at: n('instant'), ends_at: n('instant'), starts_on: n('date'), ends_on: n('date'),
    occurrence_date: n('date'), live_occurrence_id: n('liveId'), live_choice_eligible: o('bool'), time_window: n('TimeWindow'), recurrence: n('recurrence'),
    calendar_fact: n('CalendarFact'), sources: o(array('EventSource')), tags: o(array('string')), live_proximity: n('string'),
    geographic_relevance: n('string'), source_scope_verified: o('bool'), anchor_distance_km: n('nonnegative'), lat: n('lat'), lng: n('lng'),
    display_group_kind: n(enumeration('source_program')), occurrences: o(array('Event')), preference_match: n(enumeration('strong','partial','none','unrequested')),
    requested_preferences: n(array('string')), matched_preferences: n(array('string')), partial_preferences: n(array('string')),
    missing_preferences: o(array('string')), highlight_reason: n('string'), license: n('string'), trust_level: n('string'), timing_relevance: n('string') },
  Stop: { id: r('editId'), place_id: n('string'), candidate_id: n('string'), label: r('label500'), name: n('string'),
    is_live_event: o('bool'), event_id: n('string'), live_occurrence_id: n('liveId'), live_choice_eligible: o('bool'),
    starts_at: n('instant'), ends_at: n('instant'), starts_on: n('date'), ends_on: n('date'), occurrence_date: n('date'), time_window: n('TimeWindow'), timezone: n('string'),
    lat: r('lat'), lng: r('lng'), type: n('string'), area: n('string'), address: n('string'), daypart: n('string'),
    covered_preferences: n(array('string')), partial_preferences: n(array('string')), missing_preferences: n(array('string')),
    source: n('StopSource'), trust: n('Trust'), provisional: o('bool'), origin: n('string'), website: n('shortUrl'),
    place_details: n('PlaceDetails'), selected_day_hours: n('SelectedHours'), provenance: n('Provenance') },
  Leg: { from_label: n('string'), to_label: n('string'), distance_km: n('nonnegative'), estimated_walk_minutes: n('nonnegative') },
  PrimaryRoute: { id: n('string'), main_stops: r(array('Stop',1)), map_route_points: r(array('RoutePoint')),
    map_path_points: r(array('Point')), legs: r(array('Leg')), estimated_km: rule('nonnegative',true,true),
    routing_source: n('string'), route_shape: n('string'), public_route_scope: n('string'), caveats: n(array('string')),
    anchored_to_local_time: o('bool'), trust_summary: n('TrustSummary'), credibility_tier: n('string') },
  WeatherObserved: { condition: n('string'), max_temp: n('number'), apparent_temp_max: n('number'), precipitation_probability_max: n('number'),
    precipitation_sum: n('number'), wind_speed_max: n('number') },
  WeatherProvenance: { provider_id: n('string'), role: n('string'), signal_type: n('string'), signal_kind: n('string'), confidence: n('string'),
    source: n('string'), stale: o('bool'), observed: n('WeatherObserved') },
  WeatherRead: { provenance: r('WeatherProvenance') },
  Dayflow: { weather: n('WeatherRead') },
  Day: { date: r('date'), primary_route: rule('PrimaryRoute',true,true), experimental_agnostic_route_applied: o('bool'),
    experimental_agnostic_day: o('bool'), source: o('string'), manual_empty_day: o('bool'), dayflow_context: n('Dayflow') },
  IntakeResolved: { label: r('label500'), place_ref: r('placeRef'), confidence: r('string'), provenance: n('string'), attribution: n('string'),
    license: n('string'), timezone: n('string') },
  Intake: { mode: r(enumeration('place')), status: r(enumeration('resolved')), resolved: r('IntakeResolved') },
  Promotion: { readiness: r('string'), promote: r('bool'), qualifying_caps: r(array('string')), disqualifying_caps: r(array('string')),
    unmet_requested_intents: r(array('string')), reasons: r(array('string')), blocked_caps: r(array('string')) },
  Eligibility: { eligible: r('bool'), blockers: o(array('string')), caveats: o(array('string')) },
  CacheAge: { served_stale: r(enumeration(true)), stale_age_seconds: rule('nonnegative',true,true), refresh_reason: n('loaderToken') },
  SourceCompletion: { status: r(enumeration('partial','complete')), reason: n('loaderToken'), pending: n('nonnegative'), completed: n('nonnegative'), failed: n('nonnegative') },
  Collection: { cache: n('CacheAge'), source_completion: n('SourceCompletion'), selection_reason: n('loaderToken'),
    primary_collection: n('loaderToken'), primary_collection_reason: n('loaderToken') },
  SourceStatus: { status: r('string'), error: n('loaderToken'), collection: n('Collection') },
  ContextTime: { timezone: n('string'), timezone_known: o('bool'), timezone_source: n('string'), timezone_trust: n('string'), status: n('string'),
    now: n('localDateTime'), time_band: n('string'), requested_date_is_today: n('bool') },
  ContextWeatherProvenance: { signal_type: o('string'), source: o('string'), stale: o('bool') },
  ContextWeatherRead: { provenance: o('ContextWeatherProvenance') },
  ContextWeather: { status: o('string'), read: n('ContextWeatherRead') },
  Context: { status: o('string'), time: o('ContextTime'), weather: o('ContextWeather') },
  Coverage: { requested_preferences: r(array('string')), covered_preferences: r(array('string')), partial_preferences: r(array('string')), missing_preferences: r(array('string')) },
  Negotiation: { status: r('string'), route_present: r('bool'), preference_coverage: r('Coverage'), tradeoffs: o(array('string')), reasons: o(array('string')) },
  PinRefusal: { id: r('string'), reason: rule('pinReason',true,true) },
  PinnedOutcome: { requested_count: r('count'), honored_count: r('count'), unhonored_count: r('count'), unhonored: r(array('PinRefusal',0,12)) },
  LiveChoiceOutcome: { requested_count: r('count'), ignored_other_day_count: r('count'), honored_count: r('count'), remove_requested: r('bool'),
    unhonored: r(array('PinRefusal',0,52)) },
  EditOutcome: { version: r(enumeration(1)), action: r(enumeration('replace','remove')), status: r(enumeration('applied','refused')), reason: r('string'),
    candidate_id: r('editId'), target_stop_count: r('count'), actual_stop_count: r('count'), retained_candidate_ids: r(array('editId',0,6)),
    unavailable_retained_candidate_ids: r(array('editId',0,6)), replacement_candidate_id: rule('editId',true,true), result_candidate_ids: r(array('editId',0,6)) },
  Experiment: { synthesized_via: r(enumeration('agnostic_compose_engine')), route_mutation: r('bool'), manual_edit_published: o('bool'),
    intake: r('Intake'), promotion: r('Promotion'), eligibility: r('Eligibility'), source_status: o('SourceStatus'), context: o('Context'),
    constraint_negotiation: o('Negotiation'), day_edit: o('EditOutcome'), pinned_candidates: o('PinnedOutcome'), live_event_choices: o('LiveChoiceOutcome') },
  Candidate: { id: r('nonblank'), place_id: n('string'), candidate_id: n('string'), name: r('string'), lat: r('lat'), lng: r('lng'),
    address: n('string'), area: n('string'), type: n('string'), chain: o('bool'), local_feel_rank: n('number'),
    commitment_eligible: o('bool'), selected_day_hours: n('SelectedHours') },
  Area: { center: n('Point'), daypart_hint: n('string'), covers: o(array('string')), partial_covers: o(array('string')),
    stop_names: o(array('string',0,4)), stop_ids: o(array('string')), stops: o(array('Candidate')) },
  DistrictLeg: { distance_km: n('nonnegative') },
  EveningEvent: { id: n('string'), title: n('string'), place: n('string'), starts_at: n('instant'), ends_at: n('instant'), starts_on: n('date'), ends_on: n('date'),
    time_window: n('TimeWindow'), occurrence_date: n('date'), timezone: n('string'), source_label: n('string'), source_url: n('url'),
    source_link_kind: n(enumeration('page','site_home')), source_link_host: n('string'), license: n('string'), woven_into_route: o('bool'),
    route_leg_km: n('nonnegative'), route_leg_minutes: n('nonnegative'), live_occurrence_id: n('liveId'), live_choice_eligible: o('bool') },
  DistrictDay: { areas: o(array('Area',0,3)), legs: o(array('DistrictLeg',0,2)), covered_intents: o(array('string')),
    partial_intents: o(array('string')), missing_intents: o(array('string')), evening_event: n('EveningEvent') },
  PlaceStructure: { provenance: r(enumeration('agnostic_anchor')), area_count: r('count'), district_day: r('DistrictDay') },
  FeedProfile: { reviewed_at: n('instant'), qualified_at: n('instant'), expires_at: n('instant') },
  Feed: { label: n('string'), license: n('string'), status: n('string'), reason: n('healthReason'), reviewed_source_health: n('string'),
    qualified_source_health: n('string'), runtime_trust: n('string'), source_profile: n('FeedProfile') },
  LiveHealth: { status: r(enumeration('failed','healthy','partial','pending','unavailable','uncovered')),
    result: r(enumeration('empty','events_found','pending','unavailable','unknown')), reasons: r(array('healthReason')),
    selected_source_count: r('count'), responding_source_count: r('count'), event_bearing_source_count: r('count'), empty_source_count: r('count'),
    failed_source_count: r('count'), unavailable_source_count: r('count'), raw_event_count: r('count'), normalized_event_count: r('count'),
    out_of_period_event_count: r('count'), accepted_event_count: r('count'), surfaced_event_count: r('count'), rejected_event_count: r('count') },
  Rejection: { reason: r('healthReason'), count: r('count') },
  QueryTranche: { query_count: r('count'), novel_source_identity_count: r('count'), untrustworthy_query_count: r('count') },
  DiscoverySearch: { status: r('string'), generated_query_count: o('count'), skipped_query_count: o('count'), expansion_round_count: o('count'),
    novel_source_identity_count: o('count'), stop_reason: o('healthReason'), represented_query_families: o(array('healthReason',0,8)),
    query_tranches: o(array('QueryTranche',0,8)), queried_count: r('count'), responding_query_count: r('count'), failed_query_count: r('count'),
    degraded_query_count: r('count'), result_count: r('count'), seed_count: r('count'), retry_recommended: r('bool') },
  DiscoveryScout: { status: r('string'), inspected_source_count: r('count'), blocked_source_count: r('count'), failed_source_count: r('count') },
  DiscoveryQualification: { status: r('string'), candidate_count: r('count'), qualified_candidate_count: r('count') },
  DiscoveryHealth: { contract: o(enumeration('source_discovery_health_v1')), status: r('string'), reasons: o(array('healthReason')), observed_at: n('instant'),
    search: o('DiscoverySearch'), scout: o('DiscoveryScout'), qualification: o('DiscoveryQualification') },
  Acquisition: { source_health: r('LiveHealth'), rejection_summary: o(array('Rejection')), discovery_health: o('DiscoveryHealth') },
  BrowseBucket: { ranked_event_count: r('count'), highlight_count: r('count'), more_count: r('count'), hidden_count: r('count'), more: r(array('Event',0,18)) },
  Browse: { contract: r(enumeration('live_event_browse_v1')), max_rows_per_bucket: r(enumeration(24)), tonight: r('BrowseBucket'), this_week: r('BrowseBucket') },
  LiveEvents: { selected_date: o('date'), coverage: r(enumeration('covered','uncovered','unavailable')), pending: o('bool'), feed: n('Feed'),
    feeds: o(array('Feed')), acquisition: r('Acquisition'), tonight: r(array('Event',0,6)), this_week: r(array('Event',0,6)), browse: o('Browse') },
  Result: { days: r(array('Day',1,1)), place_structure: o('PlaceStructure'), live_events: o('LiveEvents'), agnostic_route_output_experiment: r('Experiment') },
};

function budget(privacy) {
  let bytes = 0, nodes = 0;
  const active = new WeakSet();
  function charge(amount) { bytes += amount; if (bytes > MAX_BYTES) throw new Error('bytes'); }
  function string(value) {
    if (value.length > MAX_BYTES) throw new Error('string bytes');
    // Escaped JSON UTF-8 length, counted BEFORE allocating an escaped string.
    let size = 2;
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c === 34 || c === 92 || [8,9,10,12,13].includes(c)) size += 2;
      else if (c < 32) size += 6;
      else if (c < 128) size++;
      else if (c < 2048) size += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length && value.charCodeAt(i+1) >= 0xdc00 && value.charCodeAt(i+1) <= 0xdfff) { size += 4; i++; }
      else if (c >= 0xd800 && c <= 0xdfff) size += 6;
      else size += 3;
      if (size > MAX_BYTES - bytes) throw new Error('string bytes');
    }
    charge(size);
  }
  function url(value) {
    if (!/^https?:\/\//i.test(value) || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('url');
    const parsed = new URL(value);
    if (!['http:','https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error('url');
    // Native brand check and native exact membership; never invoke a supplied has.
    if (!Set.prototype.has.call(own(privacy,'publicSourceUrls').value, value)) throw new Error('unattested url');
  }
  function copy(type, value, depth = 0) {
    if (isProxy(value)) throw new Error('proxy');
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error('traversal policy');
    if (type === 'recurrence') type = typeof value === 'string' ? 'string' : 'Recurrence';
    if (typeof type === 'object' && type.values) {
      if (!type.values.includes(value)) throw new Error('enum');
      if (typeof value === 'string') string(value); else charge(String(value).length);
      return value;
    }
    if (typeof type === 'object' && type.item) {
      if (!Array.isArray(value) || value.length < type.min || value.length > type.max || value.length > MAX_NODES - nodes || value.length * 2 > MAX_BYTES - bytes) throw new Error('array');
      if (active.has(value)) throw new Error('cycle');
      active.add(value); charge(2);
      const result = [];
      for (let i = 0; i < value.length; i++) {
        const atom = own(value, String(i));
        if (!atom.present) throw new Error('sparse array');
        if (i) charge(1);
        result.push(copy(type.item, atom.value, depth + 1));
      }
      active.delete(value);
      return result;
    }
    if (Object.hasOwn(fields, type)) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || active.has(value)) throw new Error('object');
      active.add(value); charge(2);
      const result = {};
      let count = 0;
      for (const [key, spec] of Object.entries(fields[type])) {
        const atom = own(value, key);
        if (!atom.present) { if (spec.required) throw new Error('required '+type+'.'+key); continue; }
        if (count++) charge(1);
        string(key); charge(1);
        if (atom.value === null && spec.nullable) { charge(4); result[key] = null; }
        else result[key] = copy(spec.type, atom.value, depth + 1);
      }
      active.delete(value);
      validateObject(type,result);
      return result;
    }
    if (type === 'bool') { if (typeof value !== 'boolean') throw new Error('boolean'); charge(value ? 4 : 5); return value; }
    if (['number','nonnegative','count','lat','lng'].includes(type)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || (['nonnegative','count'].includes(type) && value < 0) ||
          (type === 'count' && !Number.isSafeInteger(value)) || (type === 'lat' && Math.abs(value)>90) || (type === 'lng' && Math.abs(value)>180)) throw new Error('number');
      charge(String(value).length); return value;
    }
    if (typeof value !== 'string') throw new Error('string');
    string(value);
    if (type === 'editId' && (!value || value.length > 200 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value))) throw new Error('edit id');
    // Match the actual recipient's identity contract before persistence; an
    // unreadable source value refuses optional sharing, never gets truncated.
    if (type === 'label500' && (!value || value.length > 500 || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value))) throw new Error('label');
    if (type === 'candidateInputId' && !/^[a-z0-9][a-z0-9_:.-]{0,63}$/i.test(value)) throw new Error('candidate id');
    if (type === 'id200' && value.length > 200) throw new Error('id200');
    if (type === 'liveId' && !occurrenceDate(value)) throw new Error('live id');
    if (type === 'pinReason' && (value.length > 64 || !/^[a-z][a-z_]*$/.test(value))) throw new Error('pin reason');
    if (type === 'healthReason' && !/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw new Error('health reason');
    if (type === 'date' && !isRealIsoDate(value)) throw new Error('date');
    if (type === 'placeRef' && !parsePlaceRef(value)) throw new Error('place ref');
    if (type === 'nonblank' && !value.trim()) throw new Error('blank');
    if (type === 'address' && (value.length > 160 || /[\u0000-\u001f\u007f]/.test(value))) throw new Error('address');
    if (type === 'timezone' && value.length > 80) throw new Error('timezone');
    if (type === 'loaderToken' && !/^[a-z0-9_:-]{1,80}$/.test(value)) throw new Error('loader token');
    if (type === 'instant' && (!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(value) || !isRealIsoDate(value.slice(0,10)) || !Number.isFinite(Date.parse(value)))) throw new Error('instant');
    if (type === 'localDateTime' && (!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value) || !isRealIsoDate(value.slice(0,10)))) throw new Error('local datetime');
    if (['clock','closingClock'].includes(type) && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value) && !(type === 'closingClock' && value === '24:00')) throw new Error('clock');
    if (type === 'shortUrl' && value.length > 2048) throw new Error('short url');
    if (type === 'url' || type === 'shortUrl' || /^(?:[a-z][a-z0-9+.-]*:\/\/|https?:|ftp:|file:|data:|javascript:|\/\/)/i.test(value)) url(value);
    return value;
  }
  return { copy, charge, string };
}
function validateObject(type,value) {
  const refuse = () => { throw new Error('correlated '+type); };
  if (type === 'Promotion') {
    const readiness = value.promote ? value.qualifying_caps.length ? 'promotable_limited' : 'promotable' : 'non_promotable';
    if (value.readiness !== readiness || !isDeepStrictEqual(value.blocked_caps,value.disqualifying_caps) ||
      (value.promote && value.disqualifying_caps.length) || (!value.promote && value.qualifying_caps.length)) refuse();
    for (const key of ['qualifying_caps','disqualifying_caps','unmet_requested_intents','reasons','blocked_caps'])
      if (new Set(value[key]).size !== value[key].length) refuse();
  }
  if (type === 'Eligibility' && value.eligible && value.blockers?.length) refuse();
  if (type === 'SelectedHours' && !isDeepStrictEqual(normalizeSelectedDayHoursFact(value),value)) refuse();
  if (['Event','EveningEvent','Stop','TimeWindow'].includes(type)) {
    if (value.starts_at && value.ends_at && Date.parse(value.ends_at) < Date.parse(value.starts_at)) refuse();
    if (value.starts_on && value.ends_on && value.ends_on < value.starts_on) refuse();
    if (value.live_choice_eligible === true && (!value.live_occurrence_id || !value.occurrence_date ||
      occurrenceDate(value.live_occurrence_id) !== value.occurrence_date)) refuse();
    if (type === 'Event') {
      if ((value.lat != null) !== (value.lng != null)) refuse();
      if (value.live_choice_eligible === true) {
        // Source-issued IDs bind to the selected-day session. Materialize only
        // to validate that identity; retain the original copied temporal facts.
        const occurrence = eventOccurrenceForDate(value, value.occurrence_date);
        if (!occurrence || liveOccurrenceId(occurrence) !== value.live_occurrence_id) refuse();
      }
    }
    if (type === 'TimeWindow' && value.kind === 'occurrences' && (!value.dates?.length ||
      new Set(value.dates).size !== value.dates.length || value.dates.some((date,i)=>i && date < value.dates[i-1]) ||
      value.starts_on !== value.dates[0] || value.ends_on !== value.dates[value.dates.length-1])) refuse();
  }
  if (type === 'PrimaryRoute') {
    const stops = value.main_stops;
    if (new Set(stops.map(stop=>stop.id)).size !== stops.length) refuse();
    if (value.public_route_scope === 'selected_stop_chain' && (value.map_route_points.length !== stops.length ||
      value.map_route_points.some((point,i)=>point.lat !== stops[i].lat || point.lng !== stops[i].lng ||
        point.label !== (stops[i].label || stops[i].name || null)))) refuse();
  }
  if (type === 'Coverage') {
    const requested = new Set(value.requested_preferences), seen = new Set();
    if (requested.size !== value.requested_preferences.length) refuse();
    for (const key of ['covered_preferences','partial_preferences','missing_preferences']) for (const id of value[key]) {
      if (!requested.has(id) || seen.has(id)) refuse(); seen.add(id);
    }
    if (seen.size !== requested.size) refuse();
  }
  if (type === 'BrowseBucket' && (value.more_count !== value.more.length ||
    value.ranked_event_count < value.highlight_count + value.more_count ||
    value.hidden_count < value.ranked_event_count - value.highlight_count - value.more_count)) refuse();
  if (type === 'LiveEvents') {
    const health = value.acquisition.source_health;
    const surfaced = value.tonight.length + value.this_week.length;
    if (health.surfaced_event_count !== surfaced || (health.result === 'empty' && (surfaced > 0 || health.accepted_event_count > 0))) refuse();
    if (value.browse) for (const key of ['tonight','this_week']) {
      const bucket = value.browse[key];
      if (bucket.highlight_count !== value[key].length || bucket.highlight_count + bucket.more_count > 24) refuse();
    }
  }
}
module.exports = { budget, MAX_BYTES, own };
