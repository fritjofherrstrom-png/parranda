/**
 * Pure render helpers for the agnostic-route-experiment dogfood page (#264).
 *
 * SHARED MODULE — loaded by both:
 *   - the browser (`dogfood.html` <script src="/dogfood-render.js"> → window.DogfoodRender)
 *   - Node tests   (`tests/dogfood.test.js` → require("../dogfood-render"))
 *
 * Tests cover the EXACT functions the browser uses; there is no test-only copy.
 *
 * Functions return plain values / fragment-spec objects (no DOM access here), so they
 * work identically in Node and in the browser. `dogfood.js` walks those structures
 * to assemble actual DOM nodes; tests assert against the strings/structs directly.
 *
 * Honesty contract:
 *   - never produces "best/optimal/fastest/shortest" or "eta" wording;
 *   - always labels the experimental output as experimental;
 *   - blocker captions are passed in via the i18n bootstrap; this module just maps tokens
 *     to keys and renders the result.
 */

(function attach(globals) {
  "use strict";

  // Every blocker token the backend can emit, mapped to its i18n key. If the backend
  // ever introduces a new token we don't know, the renderer surfaces the raw token
  // honestly (prefixed `dogfood.blocker.unknown`).
  var BLOCKER_KEYS = {
    // agnostic-route-output eligibility blockers
    external_candidates_not_requested: "dogfood.blocker.external_candidates_not_requested",
    no_trusted_loader: "dogfood.blocker.no_trusted_loader",
    no_anchor_for_trusted_fetch: "dogfood.blocker.no_anchor_for_trusted_fetch",
    loader_error: "dogfood.blocker.loader_error",
    no_usable_trusted_records: "dogfood.blocker.no_usable_trusted_records",
    insufficient_geocoded_candidates: "dogfood.blocker.insufficient_geocoded_candidates",
    incomplete_geometry: "dogfood.blocker.incomplete_geometry",
    weak_geometry: "dogfood.blocker.weak_geometry",
    // intake blockers (#260)
    missing_or_invalid_coordinates: "dogfood.blocker.missing_or_invalid_coordinates",
    place_resolver_unavailable: "dogfood.blocker.place_resolver_unavailable",
    place_resolver_error: "dogfood.blocker.place_resolver_error",
    place_not_resolved: "dogfood.blocker.place_not_resolved",
    low_confidence_place_resolution: "dogfood.blocker.low_confidence_place_resolution",
    ambiguous_place: "dogfood.blocker.ambiguous_place",
    invalid_resolved_coordinates: "dogfood.blocker.invalid_resolved_coordinates",
    // walking-validation blockers (#261)
    invalid_walking_coordinates: "dogfood.blocker.invalid_walking_coordinates",
    walking_route_unavailable: "dogfood.blocker.walking_route_unavailable",
    invalid_walking_leg_count: "dogfood.blocker.invalid_walking_leg_count",
    walking_validation_failed: "dogfood.blocker.walking_validation_failed",
    invalid_walking_path_points: "dogfood.blocker.invalid_walking_path_points",
    walking_budget_exceeded: "dogfood.blocker.walking_budget_exceeded",
    walking_leg_budget_exceeded: "dogfood.blocker.walking_leg_budget_exceeded",
  };

  // Caveats are non-blocking honesty tags. Same map-to-key pattern.
  var CAVEAT_KEYS = {
    experimental: "dogfood.caveat.experimental",
    walking_order_unvalidated: "dogfood.caveat.walking_order_unvalidated",
    no_walking_time: "dogfood.caveat.no_walking_time",
    no_opening_hours: "dogfood.caveat.no_opening_hours",
    heuristic_walking_estimate: "dogfood.caveat.heuristic_walking_estimate",
    walking_router_fallback_used: "dogfood.caveat.walking_router_fallback_used",
    below_planner_candidate_threshold: "dogfood.caveat.below_planner_candidate_threshold",
  };

  // i18n bootstrap is { lang, strings: { key: value } }. We never embed user-facing
  // copy in this module: callers pass an i18n object (the test stubs are tiny).
  function translate(i18n, key, fallback) {
    if (!i18n || !i18n.strings) return fallback || key;
    var value = i18n.strings[key];
    return typeof value === "string" && value.length ? value : (fallback || key);
  }

  function isString(value) {
    return typeof value === "string";
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  // Drop banned vocabulary from any string we render. Belt-and-braces: the backend
  // already sanitizes its own copy, but the dogfood is an honesty surface and we
  // do not want a future provenance/label leak to introduce comparative wording.
  // The regex is conservative — it removes only the exact words, not substrings.
  var BANNED = /\b(eta|best route|optimal|fastest|shortest)\b/gi;
  function sanitize(value) {
    if (!isString(value)) return value;
    return value.replace(BANNED, "[removed]");
  }

  // ----- Banner / disclosure -------------------------------------------------

  function buildBanner(i18n) {
    return {
      label: translate(i18n, "dogfood.banner.label", "Experimental"),
      title: translate(i18n, "dogfood.banner.title", "Experimental any-place route — not a finalized Parranda Planner day."),
      detail: translate(i18n, "dogfood.banner.detail", "This page exercises the experimental agnostic route engine and uses trusted source-backed candidates. Results may fail closed; honest blockers will be shown."),
    };
  }

  // ----- Blocker / caveat tiles ---------------------------------------------

  function blockerTile(token, i18n) {
    var key = BLOCKER_KEYS[token];
    var caption = key
      ? translate(i18n, key, token)
      : translate(i18n, "dogfood.blocker.unknown", token) + " (" + token + ")";
    return { token: token, caption: sanitize(caption) };
  }

  function caveatTile(token, i18n) {
    var key = CAVEAT_KEYS[token];
    var caption = key
      ? translate(i18n, key, token)
      : translate(i18n, "dogfood.caveat.unknown", token) + " (" + token + ")";
    return { token: token, caption: sanitize(caption) };
  }

  function collectBlockerTokens(experiment) {
    var tokens = [];
    if (!experiment) return tokens;
    var add = function (list) {
      if (!list) return;
      for (var i = 0; i < list.length; i += 1) {
        var t = list[i];
        if (isString(t) && tokens.indexOf(t) === -1) tokens.push(t);
      }
    };
    add(experiment.readiness_blockers);
    add(experiment.eligibility && experiment.eligibility.blockers);
    add(experiment.intake && experiment.intake.blockers);
    add(experiment.walking_validation && experiment.walking_validation.blockers);
    return tokens;
  }

  // ----- Intake summary -----------------------------------------------------

  function buildIntakeSummary(experiment, i18n) {
    var intake = experiment && experiment.intake;
    if (!intake) return null;
    var resolved = intake.resolved || null;
    var summary = {
      mode: intake.mode || "none",
      status: intake.status || "unresolved",
      query: isString(intake.query) ? intake.query : null,
      candidatesConsidered: isFiniteNumber(intake.candidates_considered) ? intake.candidates_considered : 0,
      resolved: null,
      ambiguousCandidates: [],
      modeLabel: translate(i18n, "dogfood.intake.mode." + (intake.mode || "none"), intake.mode || "none"),
      statusLabel: translate(i18n, "dogfood.intake.status." + (intake.status || "unresolved"), intake.status || "unresolved"),
    };
    if (resolved) {
      summary.resolved = {
        label: sanitize(isString(resolved.label) ? resolved.label : null),
        lat: isFiniteNumber(resolved.lat) ? resolved.lat : null,
        lng: isFiniteNumber(resolved.lng) ? resolved.lng : null,
        confidence: resolved.confidence == null ? null : String(resolved.confidence),
        provenance: isString(resolved.provenance) ? resolved.provenance : null,
        attribution: isString(resolved.attribution) ? sanitize(resolved.attribution) : null,
        license: isString(resolved.license) ? sanitize(resolved.license) : null,
        timezone: isString(resolved.timezone) ? resolved.timezone : null,
      };
    }
    if (Array.isArray(intake.candidates)) {
      summary.ambiguousCandidates = intake.candidates.map(function (candidate) {
        return {
          label: sanitize(isString(candidate.label) ? candidate.label : null),
          confidence: candidate.confidence == null ? null : String(candidate.confidence),
          provenance: isString(candidate.provenance) ? candidate.provenance : null,
        };
      });
    }
    return summary;
  }

  // ----- Trusted weather/time context ---------------------------------------

  function buildContextSummary(experiment, i18n) {
    var ctx = experiment && experiment.context;
    if (!ctx) return null;
    var weatherRead = ctx.weather && ctx.weather.read;
    var influence = ctx.influence || {};
    return {
      status: ctx.status || "unknown",
      statusLabel: translate(i18n, "dogfood.context.status." + (ctx.status || "unknown"), ctx.status || "unknown"),
      time: {
        timezoneKnown: Boolean(ctx.time && ctx.time.timezone_known),
        timezone: ctx.time && isString(ctx.time.timezone) ? ctx.time.timezone : null,
        timezoneSource: ctx.time && isString(ctx.time.timezone_source) ? ctx.time.timezone_source : null,
        timezoneTrust: ctx.time && isString(ctx.time.timezone_trust) ? ctx.time.timezone_trust : null,
        status: ctx.time && ctx.time.status ? ctx.time.status : null,
        now: ctx.time && isString(ctx.time.now) ? ctx.time.now : null,
        timeBand: ctx.time && isString(ctx.time.time_band) ? ctx.time.time_band : null,
      },
      weather: {
        status: ctx.weather && ctx.weather.status ? ctx.weather.status : "unknown",
        read: weatherRead
          ? {
              kind: isString(weatherRead.kind) ? weatherRead.kind : null,
              headline: sanitize(isString(weatherRead.headline) ? weatherRead.headline : null),
              reason: sanitize(isString(weatherRead.reason) ? weatherRead.reason : null),
              confidence: isString(weatherRead.confidence) ? weatherRead.confidence : null,
              provenance: weatherRead.provenance || null,
            }
          : null,
      },
      computedSignals: Array.isArray(ctx.computed_signals)
        ? ctx.computed_signals.map(function (signal) {
            return {
              type: isString(signal.type) ? signal.type : null,
              headline: sanitize(isString(signal.headline) ? signal.headline : null),
              source: isString(signal.source) ? signal.source : null,
            };
          })
        : [],
      live: ctx.live || { available: false, reason: "no_any_place_live_source" },
      influence: {
        weatherFedIntoSelection: Boolean(influence.weather_fed_into_selection),
        timeFedIntoSelection: Boolean(influence.time_fed_into_selection),
        weatherReasons: Array.isArray(influence.weather_fit_reasons) ? influence.weather_fit_reasons.slice() : [],
        timeReasons: Array.isArray(influence.time_fit_reasons) ? influence.time_fit_reasons.slice() : [],
      },
    };
  }

  // ----- Walking validation -------------------------------------------------

  function buildWalkingChecksSummary(experiment, i18n) {
    var validation = experiment && experiment.walking_validation;
    if (!validation) return null;
    var checks = validation.checks || {};
    return {
      valid: Boolean(validation.valid),
      stopCount: isFiniteNumber(checks.stop_count) ? checks.stop_count : null,
      legCount: isFiniteNumber(checks.leg_count) ? checks.leg_count : null,
      totalWalkKm: isFiniteNumber(checks.total_walk_km) ? checks.total_walk_km : null,
      maxLegKm: isFiniteNumber(checks.max_leg_km) ? checks.max_leg_km : null,
      totalEstimatedWalkMinutes: isFiniteNumber(checks.total_estimated_walk_minutes)
        ? checks.total_estimated_walk_minutes
        : null,
      totalBudgetKm: isFiniteNumber(checks.total_budget_km) ? checks.total_budget_km : null,
      maxLegBudgetKm: isFiniteNumber(checks.max_leg_budget_km) ? checks.max_leg_budget_km : null,
      walkingSource: isString(checks.walking_source) ? checks.walking_source : null,
      fallbackUsed: Boolean(checks.fallback_used),
      label: translate(i18n, "dogfood.walking.checks", "Walking validation"),
    };
  }

  // ----- Experimental route -------------------------------------------------

  function buildRouteSummary(response, i18n) {
    var experiment = response && response.agnostic_route_output_experiment;
    var mutated = Boolean(experiment && experiment.route_mutation);
    var day = response && response.days && response.days[0];
    var route = day && day.primary_route;
    if (!mutated || !route) return null;

    var stops = Array.isArray(route.main_stops)
      ? route.main_stops.map(function (stop) {
          return {
            id: stop.id || null,
            label: sanitize(isString(stop.label) ? stop.label : null),
            role: isString(stop.role) ? stop.role : null,
            origin: isString(stop.origin) ? stop.origin : null,
            confidence: stop.confidence == null ? null : String(stop.confidence),
            lat: isFiniteNumber(stop.lat) ? stop.lat : null,
            lng: isFiniteNumber(stop.lng) ? stop.lng : null,
          };
        })
      : [];

    var caveats = Array.isArray(route.caveats)
      ? route.caveats.map(function (token) { return caveatTile(token, i18n); })
      : [];

    return {
      title: sanitize(isString(route.title) ? route.title : null),
      summary: sanitize(isString(route.summary) ? route.summary : null),
      orderConfidence: isString(route.order_confidence) ? route.order_confidence : null,
      orderSource: isString(route.order_source) ? route.order_source : null,
      routingSource: isString(route.routing_source) ? route.routing_source : null,
      estimatedKm: isFiniteNumber(route.estimated_km) ? route.estimated_km : null,
      estimatedWalkMinutes: isFiniteNumber(route.estimated_walk_minutes) ? route.estimated_walk_minutes : null,
      stops: stops,
      caveats: caveats,
      // Geometry the dogfood map renderer consumes (and only this).
      mapPathPoints: Array.isArray(route.map_path_points) ? route.map_path_points.slice() : [],
      mapStops: stops.filter(function (s) { return s.lat != null && s.lng != null; }),
    };
  }

  // ----- Baseline-vs-experimental one-liner --------------------------------

  function buildBaselineDiff(experiment, i18n) {
    if (!experiment) return null;
    var hadBaseline = Boolean(experiment.baseline && experiment.baseline.had_primary_route);
    var mutation = Boolean(experiment.route_mutation);
    var key;
    if (mutation && hadBaseline) key = "dogfood.diff.replaced";
    else if (mutation && !hadBaseline) key = "dogfood.diff.synthesized";
    else key = "dogfood.diff.baseline_kept";
    return { key: key, caption: translate(i18n, key, key) };
  }

  // ----- Top-level builder --------------------------------------------------
  //
  // Produces a fully-structured render plan that `dogfood.js` walks to build DOM
  // and that tests inspect directly.
  function buildExperimentView(response, i18n) {
    var experiment = response && response.agnostic_route_output_experiment;
    var bannedCheck = scanForBannedWords(experiment);
    var view = {
      banner: buildBanner(i18n),
      hasExperiment: Boolean(experiment),
      routeMutation: Boolean(experiment && experiment.route_mutation),
      selectedVariant: experiment && experiment.selected_variant ? experiment.selected_variant : null,
      blockers: [],
      caveats: [],
      intake: null,
      context: null,
      walking: null,
      route: null,
      baselineDiff: null,
      bannedWordsFound: bannedCheck,
    };
    if (!experiment) return view;

    view.blockers = collectBlockerTokens(experiment).map(function (token) { return blockerTile(token, i18n); });
    view.caveats = Array.isArray(experiment.caveats)
      ? experiment.caveats.map(function (token) { return caveatTile(token, i18n); })
      : [];
    view.intake = buildIntakeSummary(experiment, i18n);
    view.context = buildContextSummary(experiment, i18n);
    view.walking = buildWalkingChecksSummary(experiment, i18n);
    view.route = buildRouteSummary(response, i18n);
    view.baselineDiff = buildBaselineDiff(experiment, i18n);
    return view;
  }

  // ----- Banned-vocabulary scan (test guard + runtime self-check) ----------
  //
  // Walks the entire experiment block as JSON and reports any banned token. Used
  // by tests to prove the dogfood surface never carries comparative claims, and
  // can be called at runtime to surface a self-check.
  function scanForBannedWords(experiment) {
    if (!experiment) return [];
    var blob;
    try { blob = JSON.stringify(experiment); } catch (_e) { return []; }
    blob = String(blob).toLowerCase();
    var hits = [];
    var words = ["eta", "best route", "optimal", "fastest", "shortest"];
    for (var i = 0; i < words.length; i += 1) {
      var w = words[i];
      var pattern = new RegExp("\\b" + w.replace(/\s+/g, "\\s+") + "\\b");
      if (pattern.test(blob)) hits.push(w);
    }
    return hits;
  }

  function flattenViewText(view) {
    if (!view) return "";
    var parts = [];
    var visit = function (value) {
      if (value == null) return;
      if (typeof value === "string") { parts.push(value); return; }
      if (typeof value === "number" || typeof value === "boolean") return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (typeof value === "object") {
        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i += 1) visit(value[keys[i]]);
      }
    };
    visit(view);
    return parts.join(" ");
  }

  var api = {
    BLOCKER_KEYS: BLOCKER_KEYS,
    CAVEAT_KEYS: CAVEAT_KEYS,
    translate: translate,
    sanitize: sanitize,
    buildBanner: buildBanner,
    blockerTile: blockerTile,
    caveatTile: caveatTile,
    collectBlockerTokens: collectBlockerTokens,
    buildIntakeSummary: buildIntakeSummary,
    buildContextSummary: buildContextSummary,
    buildWalkingChecksSummary: buildWalkingChecksSummary,
    buildRouteSummary: buildRouteSummary,
    buildBaselineDiff: buildBaselineDiff,
    buildExperimentView: buildExperimentView,
    scanForBannedWords: scanForBannedWords,
    flattenViewText: flattenViewText,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globals.DogfoodRender = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
