/**
 * What the published day did with the walking length the user chose, in the
 * reader's words — for the line beside the day's distance.
 *
 * Reads stable published fields only, never agnostic_route_output_experiment:
 *   - `primary_route.walking_target_fit`: the server's verdict on the route the
 *     client received (target, estimate, band status), stamped after any
 *     evening weave;
 *   - `primary_route.live_event_stop`: a woven evening event's leg and the day
 *     before it was added, so extra distance is attributed, never guessed;
 *   - `pulse_route_interrupt`: an evening event the route did NOT take, with
 *     the measured cost of taking it.
 *
 * The band itself (0.6–1.18× the target) lives on the server and is not
 * recomputed here. A day inside the band gets no sentence: the distance line
 * already says everything true about it.
 */

import { WALK_PRESETS } from "./anywhere-payload.mjs";
import { walkingDistanceLabel } from "./route-context-view.mjs";

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function positive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * "Lagom (~6 km)" for a preset target, "ditt gångmål (~8 km)" otherwise.
 *
 * @param {number} targetKm
 * @param {"sv"|"en"} lang
 */
export function walkingTargetLabel(targetKm, lang = "en") {
  const distance = `~${walkingDistanceLabel(targetKm, lang)}`;
  const preset = WALK_PRESETS.find((entry) => entry.km === targetKm);
  if (preset) return `${lang === "sv" ? preset.name.sv : preset.name.en} (${distance})`;
  return lang === "sv" ? `ditt gångmål (${distance})` : `your walking target (${distance})`;
}

/**
 * @param {{ route?: object|null, interrupt?: object|null, lang?: "sv"|"en" }} [input]
 * @returns {string[]} zero, one or two sentences, in reading order
 */
export function walkingTargetNotes({ route = null, interrupt = null, lang = "en" } = {}) {
  const t = (sv, en) => (lang === "sv" ? sv : en);
  const km = (value) => walkingDistanceLabel(value, lang);
  const notes = [];

  const fit = route && route.walking_target_fit;
  const estimated = finite(fit && fit.estimated_km);
  const target = positive(fit && fit.target_km);
  const status = fit && fit.status;
  if (estimated !== null && target !== null) {
    const label = walkingTargetLabel(target, lang);
    if (status === "longer_than_requested_band") {
      // Only the event's own contribution is named: the day with it minus
      // the day before it, as the server recorded them.
      const stop = route.live_event_stop;
      const base = finite(stop && stop.base_estimated_km);
      const added = base === null ? null : Number((estimated - base).toFixed(1));
      notes.push(
        added !== null && added > 0
          ? t(
              `≈ ${km(estimated)} — längre än ${label}; kvällens evenemang lägger till ${km(added)}.`,
              `≈ ${km(estimated)} — longer than ${label}; the evening event adds ${km(added)}.`,
            )
          : t(`≈ ${km(estimated)} — längre än ${label}.`, `≈ ${km(estimated)} — longer than ${label}.`),
      );
    } else if (status === "shorter_than_requested_band") {
      notes.push(t(`≈ ${km(estimated)} — kortare än ${label}.`, `≈ ${km(estimated)} — shorter than ${label}.`));
    }
  }

  // An evening event the route did not take. Only the server's suggestion
  // counts, and only with a measured walk; its reason decides the sentence.
  const suggested = interrupt && interrupt.status === "suggested" && interrupt.route_mutation === false;
  const title = text(suggested && interrupt.event && interrupt.event.title);
  const impact = (suggested && interrupt.walking_impact) || {};
  const legKm = finite(impact.leg_km);
  const reasons = suggested && Array.isArray(interrupt.reasons) ? interrupt.reasons : [];
  if (title && legKm !== null) {
    const wouldBe = finite(impact.estimated_km);
    const wanted = positive(impact.walking_target_km);
    const autoLimit = positive(impact.auto_weave_limit_km);
    if (reasons.includes("exceeds_requested_walking_target") && wouldBe !== null && wanted !== null) {
      const label = walkingTargetLabel(wanted, lang);
      notes.push(
        t(
          `Kvällens evenemang ingår inte i rutten: ${title} ligger ${km(legKm)} från sista stoppet och skulle göra dagen ≈ ${km(wouldBe)}, längre än ${label}.`,
          `The evening event isn't in the route: ${title} is ${km(legKm)} from the last stop and would make the day ≈ ${km(wouldBe)}, longer than ${label}.`,
        ),
      );
    } else if (reasons.includes("outside_auto_weave_limit") && autoLimit !== null) {
      notes.push(
        t(
          `Kvällens evenemang ingår inte i rutten: ${title} ligger ${km(legKm)} från sista stoppet, längre än de ${km(autoLimit)} som Parranda lägger till av sig själv.`,
          `The evening event isn't in the route: ${title} is ${km(legKm)} from the last stop, more than the ${km(autoLimit)} Parranda adds on its own.`,
        ),
      );
    }
  }
  return notes;
}
