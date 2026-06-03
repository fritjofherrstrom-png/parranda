/**
 * Candidate Intelligence Spine — Agnostic context + honest confidence.
 *
 * Two small pieces that let candidate_mode Blitz behave honestly when there is
 * little or no curated citypack:
 *
 *  1. buildAgnosticCityContext — synthesize a MINIMAL city config from raw
 *     coordinates (no curated catalog). This is how "we are here now, no pack"
 *     enters the existing engine without a fourth pipeline: the candidate spine
 *     collects from providers exactly as it does for a real city, the curated
 *     catalog is simply empty, and external/source-backed candidates carry the
 *     load (when enabled with a trusted loader).
 *
 *  2. resolveAgnosticConfidence — label the decision's confidence HONESTLY so a
 *     thin/source-backed move never masquerades as full citypack confidence.
 *
 * Pure / side-effect free.
 */

/**
 * Minimal city config for a coordinates-only context. Shaped to satisfy the
 * candidate spine's needs (key, catalog.allItems, routing, todayIsoDate) and
 * nothing more — there is deliberately no curated catalog.
 */
function buildAgnosticCityContext({
  key = "agnostic-area",
  label = "Nearby",
  lat,
  lng,
  timezone = "UTC",
  todayIsoDate,
} = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("buildAgnosticCityContext requires finite lat/lng");
  }
  const isoToday =
    typeof todayIsoDate === "function"
      ? todayIsoDate
      : () => String(todayIsoDate || "").trim() || "1970-01-01";

  return {
    key,
    label,
    timezone,
    visibility: "agnostic",
    agnostic: true,
    center: { lat, lng },
    catalog: { allItems: [], routeTemplates: [] },
    routing: { areaDefinitions: {} },
    todayIsoDate: isoToday,
  };
}

/**
 * Honest confidence for a candidate-mode decision. Never claims more than the
 * evidence + curation supports.
 *
 * @param {object} params
 * @param {object|null} params.best  the chosen ranked entry ({candidate, derived})
 * @param {string} params.density    rich | thin | absent
 * @returns {{ level: string|null, label: string, note: string, catalog_density: string }}
 */
function resolveAgnosticConfidence({ best = null, density = "rich" } = {}) {
  if (!best || !best.candidate) {
    return {
      level: null,
      label: "no_usable_move",
      note: "No credible nearby candidate met the bar.",
      catalog_density: density,
    };
  }

  const curated = best.candidate.city_pack_owned === true;
  const existence = best.derived?.existence_confidence || "needs_review";
  const diversity = best.derived?.provenance_diversity ?? 0;

  let level;
  let note;
  if (curated) {
    level = density === "rich" ? "high" : "medium";
    note =
      density === "rich"
        ? "Curated Parranda pick in a well-mapped area."
        : "Curated Parranda pick, but the area is thinly mapped — fewer alternatives were considered.";
  } else {
    // Source-backed: only corroborated, existing candidates ever reach here
    // (gates require existence ≥ medium). Cap at medium — never citypack-high.
    const corroborated = diversity >= 2 || existence === "high";
    level = corroborated ? "medium" : "low";
    note = corroborated
      ? "Source-backed candidate corroborated across open sources — credible, not Parranda-verified."
      : "Source-backed candidate from limited evidence — offered honestly as a best guess.";
  }

  return { level, label: curated ? "curated" : "source_backed", note, catalog_density: density };
}

module.exports = {
  buildAgnosticCityContext,
  resolveAgnosticConfidence,
};
