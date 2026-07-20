/**
 * Agnostic place intake (#260) — freeform place query → trusted coordinate anchor.
 *
 * This is the intake half of the any-place engine. It resolves ONLY the request
 * context/anchor for the existing #259 agnostic route-output path. It must NOT
 * provide route candidates and MUST NOT satisfy route eligibility by itself:
 *
 *   place string
 *   -> server-injected placeResolver  (trusted, deterministic-in-tests)
 *   -> trusted coordinate anchor { lat, lng }
 *   -> existing #259 route-output path (still needs external opt-in + loader)
 *   -> route or honest blockers
 *
 * Trust boundary: the public payload may provide ONLY the query string
 * (`place` / `place_query` / `location_query`). It can never inject resolved
 * coordinates, confidence, provenance, resolver candidates, or route candidates.
 * Only the server-injected resolver's output is trusted.
 *
 * Fail-closed: every missing/invalid/ambiguous/low-confidence outcome returns
 * `anchor: null` plus an explicit blocker — never a guessed or fabricated anchor.
 * Low confidence fails closed in #260 (it is NOT a soft caveat here).
 *
 * Pure except for the awaited injected resolver. Deterministic given its inputs.
 */

// Confidence labels the resolver may return for a candidate. Anything outside
// this set (or a number below the threshold) is treated as too weak to anchor.
const STRONG_CONFIDENCE = new Set(["high", "medium"]);
const STRONG_NUMERIC_THRESHOLD = 0.5;
const PLACE_CONTEXT_FIELDS = ["locality", "municipality", "county", "region", "country", "country_code"];

/**
 * Read the freeform place query from the public request. ONLY the query string
 * is accepted — never trusted resolution fields. `city` is deliberately NOT
 * consulted here: it stays the citypack selector / fallback input.
 */
function parsePlaceQuery(request) {
  const body = request.body || {};
  const query = request.query || {};
  const raw =
    body.place ??
    query.place ??
    body.place_query ??
    query.place_query ??
    body.location_query ??
    query.location_query;

  // The public payload may provide ONLY a freeform query string. Do not coerce
  // objects/arrays into "[object Object]" and hand them to the trusted resolver.
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed || null;
}

function isStrongConfidence(confidence) {
  if (typeof confidence === "number") {
    return Number.isFinite(confidence) && confidence >= STRONG_NUMERIC_THRESHOLD;
  }
  return STRONG_CONFIDENCE.has(String(confidence ?? "").toLowerCase());
}

function isValidCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function intake(mode, query, fields = {}) {
  return {
    mode,
    query: query || null,
    status: "unresolved",
    resolved: null,
    candidates_considered: 0,
    blockers: [],
    ...fields,
  };
}

function trustedPlaceContext(value) {
  if (!value || typeof value !== "object") return null;
  const out = {};
  for (const field of PLACE_CONTEXT_FIELDS) {
    const raw = value[field];
    if (typeof raw !== "string") continue;
    const text = raw.trim().replace(/\s+/g, " ");
    if (!text || text.length > 160) continue;
    if (field === "country_code" && !/^[a-z]{2}$/i.test(text)) continue;
    out[field] = field === "country_code" ? text.toLowerCase() : text;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Resolve the trusted coordinate anchor for the agnostic route experiment.
 *
 * @returns {Promise<{ anchor: {lat:number,lng:number}|null, intake: object }>}
 */
async function resolveAgnosticIntake({ coords = null, placeQuery = null, placeResolver = null } = {}) {
  // 1. Explicit valid coordinates always win — the resolver is never called.
  if (coords && isValidCoordinate(coords.lat, coords.lng)) {
    return {
      anchor: { lat: coords.lat, lng: coords.lng },
      placeContext: null,
      intake: intake("coordinates", placeQuery, {
        status: "resolved",
        resolved: {
          label: null,
          lat: coords.lat,
          lng: coords.lng,
          confidence: "explicit",
          provenance: "explicit_request_coordinates",
        },
      }),
    };
  }

  // 2. No coordinates and no place — nothing to anchor on. Aligns with the
  //    #259 "no usable coordinates" outcome.
  if (!placeQuery) {
    return { anchor: null, placeContext: null, intake: intake("none", null, { blockers: ["missing_or_invalid_coordinates"] }) };
  }

  // 3. Freeform place → trusted server resolver ONLY.
  if (typeof placeResolver !== "function") {
    return { anchor: null, placeContext: null, intake: intake("place", placeQuery, { blockers: ["place_resolver_unavailable"] }) };
  }

  let resolved;
  try {
    resolved = await placeResolver(placeQuery);
  } catch (_error) {
    return { anchor: null, placeContext: null, intake: intake("place", placeQuery, { blockers: ["place_resolver_error"] }) };
  }

  const candidates = Array.isArray(resolved) ? resolved : resolved && typeof resolved === "object" ? [resolved] : [];
  if (!candidates.length) {
    return { anchor: null, placeContext: null, intake: intake("place", placeQuery, { blockers: ["place_not_resolved"] }) };
  }

  const strong = candidates.filter((candidate) => candidate && isStrongConfidence(candidate.confidence));

  // 3a. Only weak candidates → fail closed (no soft caveat in #260).
  if (!strong.length) {
    return {
      anchor: null,
      placeContext: null,
      intake: intake("place", placeQuery, {
        candidates_considered: candidates.length,
        blockers: ["low_confidence_place_resolution"],
      }),
    };
  }

  // 3b. Two or more strong candidates → ambiguous; surface them, never guess.
  if (strong.length > 1) {
    return {
      anchor: null,
      placeContext: null,
      intake: intake("place", placeQuery, {
        candidates_considered: candidates.length,
        candidates: strong.slice(0, 5).map((candidate) => ({
          label: candidate.label || null,
          confidence: candidate.confidence ?? null,
          provenance: candidate.provenance || null,
        })),
        blockers: ["ambiguous_place"],
      }),
    };
  }

  // 3c. Exactly one strong candidate → validate its coordinates.
  const best = strong[0];
  const lat = Number(best.lat);
  const lng = Number(best.lng);
  if (!isValidCoordinate(lat, lng)) {
    return {
      anchor: null,
      placeContext: null,
      intake: intake("place", placeQuery, {
        candidates_considered: candidates.length,
        blockers: ["invalid_resolved_coordinates"],
      }),
    };
  }

  return {
    anchor: { lat, lng },
    // Private server-side discovery context. It is deliberately adjacent to,
    // not nested inside, the public intake block attached to API responses.
    placeContext: trustedPlaceContext(best.admin_context),
    intake: intake("place", placeQuery, {
      status: "resolved",
      candidates_considered: candidates.length,
      resolved: {
        label: best.label || null,
        lat,
        lng,
        confidence: best.confidence ?? null,
        provenance: best.provenance || null,
        // #263 — forward compact attribution/license when the resolver supplies
        // them (e.g. OSM/Nominatim → ODbL), so a downstream surface can honor the
        // source's attribution requirement. Absent for resolvers that omit them.
        attribution: typeof best.attribution === "string" && best.attribution.trim() ? best.attribution.trim() : null,
        license: typeof best.license === "string" && best.license.trim() ? best.license.trim() : null,
        // #262 — an optional trusted IANA timezone the resolver may supply. It is
        // validated downstream before any time-of-day signal runs; absent/invalid
        // → time signals are omitted honestly. The public payload cannot set this.
        timezone: typeof best.timezone === "string" && best.timezone.trim() ? best.timezone.trim() : null,
      },
    }),
  };
}

module.exports = {
  resolveAgnosticIntake,
  parsePlaceQuery,
  isValidCoordinate,
  isStrongConfidence,
};
