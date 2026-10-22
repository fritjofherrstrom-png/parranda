"use strict";

const { buildAgnosticCityContext } = require('../candidates/agnostic-context');
const { buildEligibleCandidatePool } = require('../candidates/candidate-pool');
const { normalizeUserIntents, matchCandidateToIntent } = require('../candidates/intent-vocabulary');
const { resolveCandidateDayHours } = require('../place-candidates/opening-hours-calendar');
const { operatorClosureForWindow } = require('../place-candidates/operator-visit-evidence');
const { evaluateOpeningHoursForWindow, buildLocalDayAvailabilityWindow } = require('../place-candidates/opening-hours');
const { admitExperimentalInferredExternalCandidate, MIN_VIABLE_GEOCODED_STOPS } = require('./agnostic-route-output');
const { resolveAgnosticCandidateReachPolicy, distanceKm } = require('./candidate-reach-policy');
const { resolveWalkableMicroBase } = require('./walkable-micro-base');

// A partial source snapshot may end the acquisition wait only when it contains
// plausible route supply, not merely geocoded/type-matching diagnostics. Reuse
// the composer's normalization, identity and admission gates. This is a lower
// bound for readiness, never a route guarantee: final composition still owns
// walking and publication checks, and reads the current trusted clock again.
function assessPlannerSourceSnapshot({ records, request, independentSupply = [], selectedDate, excludedIds = [], context = null }) {
  const excluded = new Set(excludedIds);
  const kept = rows => (Array.isArray(rows) ? rows : []).filter(row => !excluded.has(String(row?.id || '')));
  const preferences = request.requestedIntents || [];
  const intents = normalizeUserIntents(preferences).intents;
  const origin = snapshotOrigin(records, request, excludedIds);
  const city = buildAgnosticCityContext({ ...origin, todayIsoDate: selectedDate });
  // No invented "now" or timezone. The trusted context uses the same remaining
  // local-day window as composition; without it only full-day closures apply.
  const day = new Date(`${selectedDate}T00:00:00Z`);
  const availabilityWindow = context?.timezoneKnown
    ? buildLocalDayAvailabilityWindow({ requestedDate: selectedDate, nowLocalIso: context.now }) : null;
  const window = availabilityWindow || { weekday: day.getUTCDay(), startMinute: 0, endMinute: 1440 };
  const result = buildEligibleCandidatePool(city, {
    date: selectedDate, preferences, origin, include_external_candidates: 1,
  }, {
    curated_candidates: kept(independentSupply),
    external_provider: { dataset: kept(records) },
    resolveNowContext: () => ({ date: selectedDate, hour: null, weekday: null, now_iso: null }),
    resolveTimeBand: () => null,
    experimentalAdmitCandidate: admitExperimentalInferredExternalCandidate,
    evaluateCandidateAvailability: ({ candidate }) => {
      const calendar = resolveCandidateDayHours(candidate, { date: selectedDate,
        timezone: context?.timezoneKnown ? context.contextBlock?.time?.timezone : null,
        availabilityWindow,
        now: Number.isFinite(context?.calendarObservedNow) ? context.calendarObservedNow : NaN,
      });
      if (calendar) return { eligible: calendar.eligible, reason: calendar.reason,
        status: calendar.status === 'unknown' ? 'unknown' : calendar.eligible ? 'available_in_window' : 'closed_for_window' };
      return operatorClosureForWindow(candidate, window) || evaluateOpeningHoursForWindow(candidate.opening_hours, window);
    },
  });
  const reach = resolveAgnosticCandidateReachPolicy({
    anchorMode: request.anchorMode, spatialScope: request.spatialScope,
    dayRhythm: request.dayRhythm, preferences, availabilityWindow,
  });
  const usable = result.pool.map(entry => entry.candidate).filter(candidate =>
    Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng) &&
    (!reach || distanceKm(origin, candidate) <= reach.max_origin_distance_km) &&
    (!intents.length || intents.some(intent => matchCandidateToIntent(candidate, intent).level === 'strong')));
  const hasUsableSupply = usable.length >= MIN_VIABLE_GEOCODED_STOPS;
  return { hasUsableSupply, ready: hasUsableSupply && intents.every(intent =>
    usable.some(candidate => matchCandidateToIntent(candidate, intent).level === 'strong')) };
}

function snapshotOrigin(records, request, excludedIds) {
  const excluded = new Set(excludedIds);
  return resolveWalkableMicroBase({
    origin: {lat:request.lat,lng:request.lng},
    records: (Array.isArray(records) ? records : []).filter(row=>!excluded.has(String(row?.id || ''))),
    requestedIntents: request.requestedIntents, anchorMode: request.anchorMode,
    spatialScope: request.spatialScope, loaderMetadata: records?.loader_metadata,
  }).anchor;
}

function createPlannerSnapshotAssessor({ selectedDate, excludedIds = [], resolveContext }) {
  return async (records, request, independentSupply) => {
    const options={records,request,independentSupply,selectedDate,excludedIds};
    const preliminary=assessPlannerSourceSnapshot(options);
    // Do not fetch weather/time to rescue rows that cannot pass place admission.
    if (!preliminary.hasUsableSupply) return preliminary;
    const context=await resolveContext({coords:snapshotOrigin(records,request,excludedIds),date:selectedDate});
    return assessPlannerSourceSnapshot({...options,context});
  };
}

// For identical coordinates/date/timezone, readiness and final composition read
// the same request-owned weather acquisition, including failure. Neither retries it. Composition
// still resolves time afresh rather than reusing an earlier "now" snapshot.
function memoizePlannerWeather(provider) {
  const reads=new Map();
  return args=>{
    const key=JSON.stringify(args);
    if(!reads.has(key)) reads.set(key,Promise.resolve().then(()=>provider(args)));
    return reads.get(key);
  };
}

module.exports = { assessPlannerSourceSnapshot, createPlannerSnapshotAssessor, memoizePlannerWeather };
