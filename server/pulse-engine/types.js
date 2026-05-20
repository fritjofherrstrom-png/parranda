/**
 * Pulse Engine — type definitions (JSDoc).
 *
 * The engine ingests city context + inputs, runs registered generators,
 * normalizes their output, ranks the result, and returns a stable
 * PulseSignal[] consumed by the city page, Blitz, and (later) Planner.
 *
 * A signal exists only if it can be honestly produced from real data or
 * a clear editorial rule. No fake precision.
 */

/**
 * @typedef {(
 *   | "golden_hour"
 *   | "evening_window"
 *   | "crowd_warning"
 *   | "live_event_nearby"
 *   | "weather_shift"
 *   | "market_timing"
 *   | "opening_risk"
 *   | "good_now_worse_later"
 *   | "near_route"
 *   | "local_timing_advice"
 * )} SignalType
 */

/**
 * @typedef {("city" | "neighborhood" | "venue")} SignalLevel
 */

/**
 * @typedef {("editorial" | "live_feed" | "weather" | "catalog" | "computed")} SignalSourceKind
 */

/**
 * @typedef {("verified" | "official" | "editorial" | "inferred")} TrustLevel
 */

/**
 * @typedef {("live" | "today" | "this_week" | "evergreen")} Freshness
 */

/**
 * @typedef {Object} SignalSource
 * @property {SignalSourceKind} kind
 * @property {string} [id]    Provider id, e.g. "opendata-bcn"
 * @property {string} [url]   Source URL when relevant
 * @property {string} [label] Short label shown in UI when source helps the user
 */

/**
 * @typedef {Object} SignalTimeWindow
 * @property {string}   [starts_at]  ISO timestamp in city tz
 * @property {string}   [ends_at]    ISO timestamp in city tz
 * @property {number[]} [weekdays]   0..6
 * @property {[number, number]} [hours] [from, to] in city local hours
 */

/**
 * @typedef {Object} SignalAction
 * @property {"open_place" | "open_event" | "build_day" | "external"} kind
 * @property {string} target  place_query | event_id | wildcard_id | url
 * @property {string} label   Localized button text
 */

/**
 * Route-hints kept on a signal so the Planner can use them as scoring
 * nudges. Pulse signals NEVER become route stops.
 *
 * @typedef {Object} RouteHints
 * @property {string[]} [preferred_tags]
 * @property {string[]} [avoid_tags]
 * @property {string[]} [preferred_area_tokens]
 * @property {string[]} [avoid_area_tokens]
 * @property {string[]} [preferred_macros]
 * @property {string[]} [avoid_macros]
 * @property {string[]} [preferred_vibes]
 * @property {string[]} [avoid_vibes]
 * @property {Object<string, number>} [modifier_bias]
 */

/**
 * The normalized signal every surface consumes.
 *
 * @typedef {Object} PulseSignal
 * @property {string}      id
 * @property {string}      city
 * @property {SignalType}  type
 * @property {SignalLevel} level
 * @property {string}      title
 * @property {string}      [area]
 * @property {string[]}    [area_tokens]
 * @property {string}      reason
 * @property {string}      [blurb]
 * @property {SignalTimeWindow} [time_window]
 * @property {SignalSource} source
 * @property {TrustLevel}  trust_level
 * @property {Freshness}   freshness
 * @property {string}      [related_stop_id]
 * @property {string}      [related_route_id]
 * @property {string}      [linked_wildcard_id]
 * @property {SignalAction} [action]
 * @property {RouteHints}  [route_hints]
 * @property {number}      score
 * @property {string[]}    [matches_vibes]
 * @property {string}      [kind]         Legacy human label kept for UI flexibility
 * @property {string}      [kindLabel]    Legacy human label kept for UI flexibility
 * @property {string}      [when]         Legacy time-string kept for backward render
 * @property {string}      [where]        Legacy area-string kept for backward render
 * @property {string}      [why_it_matters] Legacy alias for reason
 * @property {string}      [signal_label] Localized chip label (sv|en) resolved server-side
 * @property {string}      [official_event_id]
 * @property {string}      [place_query]
 */

/**
 * A generator may emit a partial shape; normalize() fills in defaults
 * (id, city, score, freshness, trust_level when omitted).
 *
 * @typedef {Partial<PulseSignal> & { title: string, type: SignalType }} RawSignal
 */

/**
 * @typedef {Object} EngineContext
 * @property {Object} city            City config (key, label, timezone, center, catalog)
 * @property {string} date            ISO date in city-local tz (YYYY-MM-DD)
 * @property {Date}   now             Actual moment, kept as Date object (UTC); use cityNow for tz-aware reads
 * @property {Object} cityNow         { year, month, day, weekday, hour, minute, isoDate } in city tz
 * @property {string} timezone        IANA tz string for the city
 * @property {{lat: number, lng: number}} center
 * @property {Object} [weather]       Normalized weather payload (for the date)
 * @property {any[]}  [events]        City's normalized live events for the date
 * @property {string} lang            UI language: "sv" | "en"
 */

/**
 * Signal generator contract.
 *
 * @typedef {(context: EngineContext) => (RawSignal[] | Promise<RawSignal[]>)} SignalGenerator
 */

module.exports = {};
