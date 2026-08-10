"use strict";

/**
 * Trusted any-place Blitz orchestration.
 *
 * This is intentionally a compact next-move decision, not a route or a second
 * candidate pipeline. It resolves one trusted anchor, reads the shared
 * candidate spine, and may let one already-normalized Live event interrupt the
 * place choice when it is close, salient, and happening now or very soon.
 * Public request fields can express only place/coordinates and preferences;
 * providers, resolved time, candidates, and events enter through injected
 * server seams.
 */

const { buildBlitzDecision } = require("./blitz-engine");
const { buildAgnosticCityContext } = require("./candidates/agnostic-context");
const { haversineKm } = require("./candidates/area-intelligence");
const { getIsoWeekday } = require("./lib/iso-date");
const { resolveAgnosticIntake } = require("./planner/agnostic-place-intake");
const { resolveAgnosticContext } = require("./planner/agnostic-route-context");
const {
  shapeCollectedLiveEvents,
  unavailableLiveEvents,
} = require("./place-candidates/live-event-query");

const CONTRACT = "anywhere_contextual_blitz_v1";
const MAX_IMMEDIATE_EVENT_KM = 2;
const MAX_EVENT_START_MINUTES = 90;
const MIN_EVENT_SALIENCE = 6;

function serverInstant(clock) {
  let raw = null;
  try {
    raw = typeof clock === "function"
      ? clock()
      : clock && typeof clock.now === "function"
        ? clock.now()
        : new Date();
  } catch (_error) {
    raw = new Date();
  }
  const date = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function uniqueTokens(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function localDateFromContext(context, fallbackDate) {
  const localNow = context?.contextBlock?.time?.now;
  return typeof localNow === "string" && /^\d{4}-\d{2}-\d{2}T/.test(localNow)
    ? localNow.slice(0, 10)
    : fallbackDate;
}

async function resolveTrustedBlitzContext({
  anchor,
  intake,
  weatherProvider,
  instant,
  lang,
}) {
  const utcDate = instant.toISOString().slice(0, 10);
  const options = {
    coords: anchor,
    trustedTimezone: intake?.resolved?.timezone || null,
    weatherProvider,
    clock: () => new Date(instant.getTime()),
    lang,
    cityLabel: intake?.resolved?.label || "Nearby",
  };
  let context = await resolveAgnosticContext({ ...options, date: utcDate });
  const localDate = localDateFromContext(context, utcDate);
  if (localDate !== utcDate) {
    context = await resolveAgnosticContext({ ...options, date: localDate });
  }
  return { ...context, date: localDate };
}

function loaderResult(records) {
  const status = typeof records?.loader_status === "string" ? records.loader_status : null;
  if (status === "error_failed_closed") {
    return { dataset: null, status: "trusted_loader_failed" };
  }
  if (!Array.isArray(records) || records.length === 0) {
    return { dataset: null, status: "no_usable_trusted_records" };
  }
  return { dataset: records, status: `loaded:${records.length}` };
}

async function loadTrustedCandidates(openDataLoader, { anchor, anchorMode, spatialScope, requestedIntents }) {
  if (typeof openDataLoader !== "function") {
    return { dataset: null, status: "no_trusted_loader" };
  }
  try {
    return loaderResult(await openDataLoader({
      ...anchor,
      requestedIntents,
      anchorMode,
      spatialScope,
    }));
  } catch (_error) {
    return { dataset: null, status: "trusted_loader_failed" };
  }
}

function eventDistance(anchor, event) {
  if (!Number.isFinite(event?.lat) || !Number.isFinite(event?.lng)) return null;
  const distance = haversineKm(anchor, { lat: event.lat, lng: event.lng }) * 1.18;
  return Number.isFinite(distance) ? Number(distance.toFixed(2)) : null;
}

function eventStartMinutes(event, instant) {
  if (String(event?.timing_relevance || "").toLowerCase() === "now") return 0;
  const start = new Date(event?.starts_at || "");
  if (Number.isNaN(start.getTime())) return null;
  return Math.round((start.getTime() - instant.getTime()) / 60000);
}

function isTrustedLiveOption(event) {
  if (!event || typeof event !== "object") return false;
  if (!Number.isFinite(event.lat) || !Number.isFinite(event.lng)) return false;
  if (!(event.title || event.id)) return false;
  if (!event.source_url && !event.source_label) return false;
  if (event.cultural_tier === "administrative") return false;
  return event.route_eligible !== false;
}

function formatLiveMove(event, anchor, instant) {
  const distanceKm = eventDistance(anchor, event);
  const startMinutes = eventStartMinutes(event, instant);
  return {
    kind: "live_event",
    candidate_id: event.id ? `live-event:${event.id}` : null,
    event_id: event.id || null,
    title: event.title || null,
    lat: event.lat,
    lng: event.lng,
    starts_at: event.starts_at || null,
    ends_at: event.ends_at || null,
    starts_on: event.starts_on || null,
    ends_on: event.ends_on || null,
    time_window: event.time_window || null,
    timezone: event.timezone || null,
    timing_relevance: event.timing_relevance || null,
    distance_km: distanceKm,
    walking_minutes: Number.isFinite(distanceKm) ? Math.max(2, Math.round(distanceKm * 12)) : null,
    starts_in_minutes: Number.isFinite(startMinutes) && startMinutes >= 0 ? startMinutes : null,
    salience_score: Number.isFinite(event.salience_score) ? event.salience_score : null,
    preference_score: Number.isFinite(event.preference_score) ? event.preference_score : null,
    source: {
      label: event.source_label || null,
      url: event.source_url || null,
      type: event.source_type || null,
    },
    reasons: uniqueTokens([
      String(event.timing_relevance || "").toLowerCase() === "now" ? "event_happening_now" : "event_starting_soon",
      event.highlight_reason === "local_serendipity" ? "local_serendipity" : null,
      Number(event.preference_score) > 0 ? "matches_preferences" : null,
    ]),
  };
}

function liveOptions(liveEvents, anchor, instant) {
  return (Array.isArray(liveEvents?.tonight) ? liveEvents.tonight : [])
    .filter(isTrustedLiveOption)
    .map((event) => formatLiveMove(event, anchor, instant));
}

function selectImmediateLiveMove(options) {
  return options.find((move) => {
    const immediate = move.timing_relevance === "now" ||
      (Number.isFinite(move.starts_in_minutes) &&
        move.starts_in_minutes >= 0 &&
        move.starts_in_minutes <= MAX_EVENT_START_MINUTES);
    const salient = Number(move.salience_score) >= MIN_EVENT_SALIENCE;
    return immediate && salient && Number.isFinite(move.distance_km) && move.distance_km <= MAX_IMMEDIATE_EVENT_KM;
  }) || null;
}

function formatCandidateMove(move) {
  return move ? { kind: "place", ...move } : null;
}

function baseResponse({ intake, anchor = null, context = null, sourceHealth = null, loaderStatus = null }) {
  return {
    contract: CONTRACT,
    engine: "candidate-spine-live-blitz-v1",
    route_mutation: false,
    day_anchor_mutation: false,
    intake,
    context: {
      anchor,
      date: context?.date || null,
      timezone: context?.contextBlock?.time?.timezone || null,
      timezone_source: context?.contextBlock?.time?.timezone_source || null,
      time_band: context?.timeBand || null,
      time_status: context?.contextBlock?.time?.status || "timezone_unavailable",
      source_health: sourceHealth,
      candidate_loader: loaderStatus,
    },
  };
}

async function buildAnywhereBlitzDecision({
  coords = null,
  placeQuery = null,
  placeResolver = null,
  openDataLoader = null,
  eventSupply = null,
  weatherProvider = null,
  clock = null,
  preferences = [],
  intentKeys = [],
  memory = null,
  lang = "en",
} = {}) {
  const resolved = await resolveAgnosticIntake({
    coords,
    placeQuery,
    placeResolver,
    placeLanguage: lang,
  });
  if (!resolved.anchor) {
    return {
      ...baseResponse({ intake: resolved.intake }),
      status: "blocked",
      best_move: null,
      backup_option: null,
      live_option: null,
      reasons: uniqueTokens(resolved.intake?.blockers),
    };
  }

  const instant = serverInstant(clock);
  const trustedContext = await resolveTrustedBlitzContext({
    anchor: resolved.anchor,
    intake: resolved.intake,
    weatherProvider,
    instant,
    lang,
  });
  const candidateLoad = await loadTrustedCandidates(openDataLoader, {
    anchor: resolved.anchor,
    anchorMode: resolved.intake?.mode || "unknown",
    spatialScope: resolved.spatialScope,
    requestedIntents: [...preferences, ...intentKeys],
  });
  const cityConfig = buildAgnosticCityContext({
    label: resolved.intake?.resolved?.label || placeQuery || "Nearby",
    lat: resolved.anchor.lat,
    lng: resolved.anchor.lng,
    timezone: trustedContext.contextBlock?.time?.timezone || "UTC",
    todayIsoDate: trustedContext.date,
  });
  const trustedNowContext = () => ({
    date: trustedContext.date,
    hour: trustedContext.hour,
    weekday: getIsoWeekday(trustedContext.date),
    now_iso: trustedContext.now,
  });
  const candidateDecision = await buildBlitzDecision(
    cityConfig,
    {
      candidate_mode: 1,
      include_external_candidates: 1,
      origin: resolved.anchor,
      date: trustedContext.date,
      ...(trustedContext.now ? { now: trustedContext.now } : {}),
      ...(trustedContext.weather ? { weather: trustedContext.weather } : {}),
      preferences,
      intent_keys: intentKeys,
      memory,
      lang,
    },
    {
      ...(candidateLoad.dataset ? { external_provider: { dataset: candidateLoad.dataset } } : {}),
      resolveNowContext: trustedNowContext,
      resolveTimeBand: () => trustedContext.timeBand,
    },
  );

  let liveEvents = unavailableLiveEvents("event_supply_not_configured");
  if (typeof eventSupply === "function") {
    try {
      liveEvents = shapeCollectedLiveEvents(await eventSupply({
        anchor: resolved.anchor,
        placeContext: resolved.placeContext,
        placeLabel: resolved.intake?.resolved?.label || placeQuery || null,
        spatialScope: resolved.spatialScope,
        now: instant.toISOString(),
        preferences,
      })) || unavailableLiveEvents("event_supply_invalid_result", "failed");
    } catch (_error) {
      liveEvents = unavailableLiveEvents("event_supply_failed", "failed");
    }
  }

  const eventOptions = liveOptions(liveEvents, resolved.anchor, instant);
  const immediateEvent = selectImmediateLiveMove(eventOptions);
  const candidateMove = formatCandidateMove(candidateDecision.best_move);
  const candidateBackup = formatCandidateMove(candidateDecision.backup_option);
  const bestMove = immediateEvent || candidateMove;
  const backupOption = immediateEvent ? candidateMove : candidateBackup;

  return {
    ...baseResponse({
      intake: resolved.intake,
      anchor: resolved.anchor,
      context: trustedContext,
      sourceHealth: liveEvents.acquisition?.source_health || null,
      loaderStatus: candidateLoad.status,
    }),
    status: bestMove ? "available" : "blocked",
    best_move: bestMove,
    backup_option: backupOption,
    live_option: eventOptions[0] || null,
    confidence: immediateEvent
      ? { level: "medium", label: "source_backed_live", note: "A nearby source-backed event is happening now or starting soon." }
      : candidateDecision.confidence,
    reasons: uniqueTokens([
      immediateEvent ? "live_event_interrupt" : candidateMove ? "candidate_spine_move" : null,
      !candidateMove ? candidateDecision.reason : null,
      candidateLoad.status,
    ]),
  };
}

module.exports = {
  CONTRACT,
  MAX_EVENT_START_MINUTES,
  MAX_IMMEDIATE_EVENT_KM,
  MIN_EVENT_SALIENCE,
  buildAnywhereBlitzDecision,
  selectImmediateLiveMove,
};
