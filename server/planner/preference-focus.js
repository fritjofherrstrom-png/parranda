const { normalizeUserIntents, matchCandidateToIntent, CANONICAL_INTENTS } = require("../candidates/intent-vocabulary");

// Explicit preferences define the union of allowed primary experiences. Fit
// already judged by the candidate spine is authoritative, including an empty
// verdict. Only catalog items without fit metadata use the shared vocabulary.
// Partial matches remain partial (e.g. a park for views); generic shopping never
// becomes second hand. This helper does not admit candidates through trust gates.
function matchesPreferenceFocus(candidate, preferences = [], pinnedIds = []) {
  if (pinnedIds.includes(candidate?.id || candidate?.candidate_id)) return true;
  const requested = normalizeUserIntents(Array.isArray(preferences) ? preferences : []).intents;
  if (!requested.length) return true;
  const fit = preferenceFit(candidate);
  return requested.some((intent) => [...fit.coveredPreferences, ...fit.partialPreferences].includes(intent));
}

function preferenceFit(candidate) {
  const covered = candidate?.coveredPreferences ?? candidate?.covered_preferences;
  const partial = candidate?.partialPreferences ?? candidate?.partial_preferences;
  if (Array.isArray(covered) || Array.isArray(partial)) return {
    coveredPreferences: normalizeUserIntents(Array.isArray(covered) ? covered : []).intents,
    partialPreferences: normalizeUserIntents(Array.isArray(partial) ? partial : []).intents,
  };
  const item = { ...candidate, type: candidate?.type || candidate?.kind };
  const matches = Object.keys(CANONICAL_INTENTS).map((intent) => [intent, matchCandidateToIntent(item, intent).level]);
  // Normalized cultural event anchors have no stable-place type. Their explicit
  // source classification supplies culture fit, not trust or route eligibility.
  // An authoritative spine verdict above (including empty) always takes priority.
  if (candidate?.cultural_tier === "cultural") {
    const culture = matches.find(([intent]) => intent === "museums");
    if (culture) culture[1] = "strong";
  }
  return {
    coveredPreferences: matches.filter(([, level]) => level === "strong").map(([intent]) => intent),
    partialPreferences: matches.filter(([, level]) => level === "weak").map(([intent]) => intent),
  };
}

module.exports = { matchesPreferenceFocus, preferenceFit };
