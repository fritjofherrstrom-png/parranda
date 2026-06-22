/**
 * Cultural-relevance salience for Pulse signals.
 *
 * A live feed (a city events calendar, a venue programme) mixes culturally
 * relevant happenings — concerts, exhibitions, performances, festivals, markets,
 * screenings — with administrative/civic notices — council and committee
 * meetings, municipal agendas, budget hearings. Timing/confidence/coordinate
 * salience alone treats a council meeting like a concert, so a bureaucratic
 * notice can headline the "live nearby" experience. This classifier lets the
 * ranking prefer culturally relevant signals and downrank administrative noise,
 * and lets the masthead avoid headlining a council meeting as a live experience.
 *
 * It is deliberately GENERIC and multilingual (no city names, no per-city
 * branches) and CONSERVATIVE: a signal is only "administrative" when it clearly
 * reads as a civic/admin notice AND carries no cultural cue; cultural cues win
 * ambiguous cases so real culture is never wrongly demoted; everything else is
 * "neutral" and unaffected.
 */

// Cultural cues — concerts, exhibitions, performances, festivals, markets,
// screenings, art/music/dance, workshops/readings. English + Greek + Swedish
// roots (lowercased, accent-tolerant where the root is unambiguous).
const CULTURAL_PATTERNS = [
  // English
  /\b(concert|gig|live music|recital|opera|ballet|dance|performance|show|theatre|theater|play|exhibition|exhibit|gallery|museum|vernissage|screening|film|cinema|festival|fair|carnival|parade|workshop|reading|book launch|jazz|dj|club night|comedy|tasting|street food|food truck|art|music|culture|cultural)\b/i,
  // Greek
  /(συναυλ|έκθεσ|εκθεσ|φεστιβάλ|φεστιβαλ|παράστασ|παραστασ|θέατρ|θεατρ|μουσικ|τέχν|τεχν|χορ[όο]|όπερα|οπερα|προβολ|καρναβάλ|πανηγύρ|πανηγυρ|αγορά|αγορα)/i,
  // Swedish
  /\b(konsert|utställning|utstallning|festival|föreställning|forestallning|teater|musik|konst|dans|marknad|loppis|bio|vernissage)\b/i,
];

// Administrative/civic-notice cues — council/committee meetings, municipal
// agendas, budget hearings, procurement. The actual words a city calendar uses
// for the bureaucratic rows Pulse should not headline.
const ADMINISTRATIVE_PATTERNS = [
  // English
  /\b(city council|town council|council meeting|council session|committee|subcommittee|municipal|municipality|city assembly|plenary|board meeting|governing board|agenda|minutes|procurement|tender|public consultation|public hearing|zoning|ordinance|by-?law|annual general meeting|regular session|ordinary meeting|extraordinary meeting)\b/i,
  // Greek (συνεδρίαση = session/meeting; δημοτικό συμβούλιο = municipal council)
  /(συνεδρ[ίι]|δημοτικ[όο] συμβο[υύ]λ|δημοτικο[υύ] συμβουλ|συμβο[υύ]λιο|επιτροπ[ήη]|προϋπολογισμ|δημαρχ)/i,
  // Swedish
  /\b(kommunfullmäktige|kommunfullmaktige|kommunstyrelse|stadsfullmäktige|nämnd|namnd|sammanträde|sammantrade|protokoll)\b/i,
];

const CULTURAL_WEIGHT = 1.25;
const ADMINISTRATIVE_WEIGHT = 0.4;
const NEUTRAL_WEIGHT = 1;

function compact(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

// Build the text haystack from the fields that actually carry the happening's
// identity (its title and category cues), NOT generic blurb/source-label text
// that could false-match.
function salienceHaystack(signal) {
  if (!signal || typeof signal !== "object") return "";
  const parts = [
    signal.title,
    signal.native_title,
    signal.name,
    signal.kindLabel,
    signal.route_role_hint,
    ...(Array.isArray(signal.tags) ? signal.tags : []),
    ...(Array.isArray(signal.intents) ? signal.intents : []),
    ...(Array.isArray(signal.matches_vibes) ? signal.matches_vibes : []),
    ...(signal.route_hints && Array.isArray(signal.route_hints.preferred_tags)
      ? signal.route_hints.preferred_tags
      : []),
  ];
  return compact(parts.map(compact).filter(Boolean).join(" ")).toLowerCase();
}

/**
 * Classify a Pulse signal (or a raw event) by cultural relevance.
 * @returns {{ tier: "cultural"|"administrative"|"neutral", weight: number, reasons: string[] }}
 */
function classifyCulturalSalience(signal) {
  const haystack = salienceHaystack(signal);
  if (!haystack) {
    return { tier: "neutral", weight: NEUTRAL_WEIGHT, reasons: [] };
  }

  const culturalHit = CULTURAL_PATTERNS.find((pattern) => pattern.test(haystack));
  if (culturalHit) {
    // Cultural cue wins ambiguous cases — never wrongly demote real culture.
    return { tier: "cultural", weight: CULTURAL_WEIGHT, reasons: ["cultural_cue"] };
  }

  const adminHit = ADMINISTRATIVE_PATTERNS.find((pattern) => pattern.test(haystack));
  if (adminHit) {
    return { tier: "administrative", weight: ADMINISTRATIVE_WEIGHT, reasons: ["administrative_notice"] };
  }

  return { tier: "neutral", weight: NEUTRAL_WEIGHT, reasons: [] };
}

module.exports = {
  classifyCulturalSalience,
  CULTURAL_WEIGHT,
  ADMINISTRATIVE_WEIGHT,
  NEUTRAL_WEIGHT,
};
