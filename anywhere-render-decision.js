/**
 * Honest classifier for the `/labs/anywhere` any-place alpha surface.
 *
 * SHARED MODULE — loaded by both:
 *   - the browser (`index.html` <script src="/anywhere-render-decision.js"> → window.AnywhereRenderDecision)
 *   - Node tests   (`tests/anywhere-render-decision.test.js` → require("../anywhere-render-decision"))
 *
 * The whole point: a freeform place must NEVER be shown a fallback baseline city
 * day dressed up as that place's success. The agnostic engine only marks a day as
 * the typed place's day when it actually composed/promoted one; otherwise `days`
 * stay baseline. This module reads ONLY the trustworthy day-level markers and
 * decides one of three honest states — and, crucially, hands back a SAFE response
 * whose `days` are emptied for anything that is not a real composed day, so the
 * render path can never put baseline city cards under the typed place.
 *
 * It returns a status ENUM (never user-facing copy and never internal readiness
 * tokens) that the UI maps to neutral, localized strings. So the honesty rule is
 * unit-testable without a DOM and without brittle copy-string matching: tests
 * assert the status + the safe `days` length.
 *
 *   composed       → the agnostic engine produced/promoted a day FOR the typed
 *                    place. Render the day + the district panel.
 *   structure_only → no composed day, but Parranda understood the place's
 *                    STRUCTURE (place_structure present). Render the district
 *                    panel only — this is NOT a finished route and must not claim
 *                    "your day is ready" or show day cards.
 *   unavailable    → neither. Render the honest "couldn't compose here yet" state.
 */
(function attach(globals) {
  "use strict";

  // The ONLY trustworthy "this day belongs to the typed place" signals, all set by
  // the agnostic-route-output experiment on the day object (never on a citypack
  // baseline day): a replaced day carries `experimental_agnostic_route_applied`,
  // a synthesized day carries `experimental_agnostic_day` / the experiment source.
  function isAgnosticAppliedDay(day) {
    if (!day || typeof day !== "object") return false;
    return (
      day.experimental_agnostic_route_applied === true ||
      day.experimental_agnostic_day === true ||
      day.source === "agnostic_route_output_experiment"
    );
  }

  // ONLY structure derived for the freeform place's own trusted anchor counts.
  // A recognized-city baseline (e.g. when the place resolved ambiguously and the
  // request fell back) also carries a `place_structure`, but it belongs to the
  // fallback city — never to the typed place — so it must NOT be shown here. The
  // `agnostic_anchor` provenance is the discriminator the server stamps.
  function hasValidPlaceStructure(response) {
    var ps = response && response.place_structure;
    return Boolean(
      ps &&
        typeof ps === "object" &&
        ps.provenance === "agnostic_anchor" &&
        ps.district_day &&
        typeof ps.district_day === "object" &&
        (Number(ps.area_count) > 0 || (Array.isArray(ps.areas) && ps.areas.length > 0)),
    );
  }

  // The typed place's label, taken only from neutral, non-citypack fields.
  function resolvePlaceLabel(response, fallbackPlace) {
    if (response && typeof response === "object") {
      if (typeof response.resolved_place_label === "string" && response.resolved_place_label.trim()) {
        return response.resolved_place_label.trim();
      }
      var intake = response.agnostic_route_output_experiment && response.agnostic_route_output_experiment.intake;
      var resolvedLabel = intake && intake.resolved && intake.resolved.label;
      if (typeof resolvedLabel === "string" && resolvedLabel.trim()) return resolvedLabel.trim();
    }
    return typeof fallbackPlace === "string" ? fallbackPlace.trim() : "";
  }

  /**
   * @param {object} response  the /api/route-recommendations response
   * @param {object} [opts]    { place } the raw typed place, used only as a label fallback
   * @returns {{ status: "composed"|"structure_only"|"unavailable", hasStructure: boolean, placeLabel: string }}
   */
  function classifyAnywhereResult(response, opts) {
    var place = opts && typeof opts.place === "string" ? opts.place : "";
    var days = response && Array.isArray(response.days) ? response.days : [];
    var composed = days.length > 0 && isAgnosticAppliedDay(days[0]);
    var hasStructure = hasValidPlaceStructure(response);
    var status = composed ? "composed" : hasStructure ? "structure_only" : "unavailable";
    return { status: status, hasStructure: hasStructure, placeLabel: resolvePlaceLabel(response, place) };
  }

  /**
   * Gate the DATA, not just the status message. For anything that is not a real
   * composed day, return a response clone whose `days` are emptied (so the day
   * cards can never render a baseline city day under the typed place) while
   * `place_structure` is preserved for the district panel.
   */
  function safeResponseFor(response, classification) {
    var cls = classification || classifyAnywhereResult(response);
    if (cls.status === "composed") return response;
    var safe = {};
    for (var key in response) {
      if (Object.prototype.hasOwnProperty.call(response, key)) safe[key] = response[key];
    }
    safe.days = [];
    return safe;
  }

  /**
   * A resolved place can still hit a transient trusted-source failure (for
   * example a cold Overpass request timing out). That is materially different
   * from a proven empty source or an unresolved/ambiguous place: one bounded
   * retry may recover the same request without weakening any honesty gate.
   *
   * Keep this decision in the shared module so every frontend uses the exact
   * server evidence rather than guessing from an empty route.
   */
  function shouldRetryTransientSource(response, classification) {
    var cls = classification || classifyAnywhereResult(response);
    if (!response || cls.status !== "unavailable") return false;
    var experiment = response.agnostic_route_output_experiment;
    var intake = experiment && experiment.intake;
    var sourceStatus = experiment && experiment.source_status;
    return Boolean(
      intake &&
        intake.status === "resolved" &&
        sourceStatus &&
        sourceStatus.status === "error_failed_closed",
    );
  }

  var api = {
    classifyAnywhereResult: classifyAnywhereResult,
    safeResponseFor: safeResponseFor,
    shouldRetryTransientSource: shouldRetryTransientSource,
    isAgnosticAppliedDay: isAgnosticAppliedDay,
    hasValidPlaceStructure: hasValidPlaceStructure,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    globals.AnywhereRenderDecision = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
