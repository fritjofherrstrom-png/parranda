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

const { sanitizeTrustedSpatialScope } = require("../place-candidates/spatial-scope");
const { parsePlaceRef, linkRefFor } = require("../place-candidates/place-ref");

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

// One trusted place became the anchor: its coordinates, private discovery
// context and scope, and the public intake block the response carries.
function anchoredOn(best, { mode, placeQuery, selectionId, candidatesConsidered }) {
  const lat = Number(best.lat);
  const lng = Number(best.lng);
  const placeRef = linkRefFor(best);
  return {
    anchor: { lat, lng },
    placeContext: trustedPlaceContext(best.admin_context),
    spatialScope: sanitizeTrustedSpatialScope(best.spatial_scope),
    intake: intake(mode, placeQuery, {
      status: "resolved",
      candidates_considered: candidatesConsidered,
      resolved: {
        ...(selectionId ? { selection_id: selectionId } : {}),
        ...(placeRef ? { place_ref: placeRef } : {}),
        label: best.label || null,
        lat,
        lng,
        confidence: best.confidence ?? null,
        provenance: best.provenance || null,
        attribution: typeof best.attribution === "string" && best.attribution.trim() ? best.attribution.trim() : null,
        license: typeof best.license === "string" && best.license.trim() ? best.license.trim() : null,
        timezone: typeof best.timezone === "string" && best.timezone.trim() ? best.timezone.trim() : null,
      },
    }),
  };
}

/**
 * A link names its place by OSM identity (`place_ref`). When the field is
 * present it is the only authority: validated first, never repaired, never
 * replaced by free text, and in conflict with any other anchor that names
 * something else. The caller supplies an identifier; the geography comes from
 * a receipt this server signed for the same identity, or from the server's
 * own lookup of it.
 */
async function resolvePlaceRefIntake({ coords, explicitCoordinatesPresent, placeQuery, placeRef, placeResolver, placeLanguage, placeSelection, placeSelectionStore }) {
  const blocked = (blocker, fields = {}) => ({
    anchor: null,
    placeContext: null,
    intake: intake("place", placeQuery, { blockers: [blocker], ...fields }),
  });
  const ref = parsePlaceRef(placeRef);
  if (!ref) return blocked("place_ref_invalid");
  // A position and an identity are two anchors. This first version refuses to
  // choose between them; position-only requests keep their own path.
  if (explicitCoordinatesPresent || (coords !== null && coords !== undefined)) return blocked("place_ref_conflict");

  // A receipt binds by the identity it signed, not by the (possibly
  // translated) text it was issued for. A valid receipt for another place is a
  // conflict; an invalid or expired one contributes nothing, not even geography.
  if (placeSelection !== undefined) {
    const receipt = placeSelectionStore?.read(placeSelection);
    if (receipt && receipt.osm_ref !== ref.osmRef) return blocked("place_ref_conflict");
    if (receipt && receipt.osm_class !== undefined && !linkRefFor(receipt)) return blocked("place_ref_unsupported");
    // Older v1 receipts lack class evidence: revalidate this exact ref, never
    // reuse their geography or silently lose the response's place_ref.
    if (receipt && linkRefFor(receipt) && isValidCoordinate(Number(receipt.lat), Number(receipt.lng))) {
      return anchoredOn(receipt, { mode: "place", placeQuery, selectionId: placeSelection, candidatesConsidered: 1 });
    }
  }

  if (typeof placeResolver?.lookupRef !== "function") return blocked("place_ref_unavailable");
  let outcome;
  try {
    outcome = await placeResolver.lookupRef(ref.ref, { language: placeLanguage });
  } catch (_error) {
    outcome = { status: "unavailable" };
  }
  const found = outcome?.status === "resolved" ? outcome.candidate : null;
  if (found && found.osm_ref === ref.osmRef && isStrongConfidence(found.confidence) &&
      isValidCoordinate(Number(found.lat), Number(found.lng))) {
    const selectionId = placeSelectionStore ? placeSelectionStore.issue(found, placeQuery || found.label) : null;
    return anchoredOn(found, { mode: "place", placeQuery, selectionId, candidatesConsidered: 1 });
  }
  const status = ["unsupported", "not_found"].includes(outcome?.status) ? outcome.status : "unavailable";
  // A failed read never starts another provider search: it would spend the
  // same shared cooldown. Only a confirmed absence may offer free-text
  // choices, and a choice is never made for the reader.
  if (status !== "not_found" || !placeQuery || typeof placeResolver !== "function") return blocked(`place_ref_${status}`);
  let resolved = [];
  try {
    resolved = await placeResolver(placeQuery, { language: placeLanguage });
  } catch (_error) {
    resolved = [];
  }
  const strong = (Array.isArray(resolved) ? resolved : []).filter((candidate) => candidate && isStrongConfidence(candidate.confidence));
  return blocked("place_ref_not_found", {
    candidates_considered: strong.length,
    candidates: strong.slice(0, 5).map((candidate) => placeChoice(candidate, placeQuery, placeSelectionStore)),
  });
}

function placeChoice(candidate, placeQuery, placeSelectionStore) {
  const placeRef = linkRefFor(candidate);
  return {
    label: candidate.label || null,
    confidence: candidate.confidence ?? null,
    provenance: candidate.provenance || null,
    attribution: typeof candidate.attribution === "string" ? candidate.attribution : null,
    license: typeof candidate.license === "string" ? candidate.license : null,
    ...(placeRef ? { place_ref: placeRef } : {}),
    ...(placeSelectionStore ? { selection_id: placeSelectionStore.issue(candidate, placeQuery || candidate.label) } : {}),
  };
}

/**
 * Resolve the trusted coordinate anchor for the agnostic route experiment.
 *
 * @returns {Promise<{ anchor: {lat:number,lng:number}|null, intake: object }>}
 */
async function resolveAgnosticIntake({
  coords = null,
  explicitCoordinatesPresent = false,
  placeQuery = null,
  placeResolver = null,
  placeLanguage = null,
  placeSelection,
  placeSelectionStore = null,
  placeContextSelection = null,
  placeBias = null,
  placeRef,
} = {}) {
  // 0. A link's OSM identity, when present, is resolved on its own terms
  // before the legacy coordinate/receipt/free-text chain below.
  if (placeRef !== undefined) {
    return resolvePlaceRefIntake({ coords, explicitCoordinatesPresent, placeQuery, placeRef, placeResolver, placeLanguage, placeSelection, placeSelectionStore });
  }

  // 1. Explicit valid coordinates always win. The place-search function is
  // never called. A separately trusted reverse-context method may enrich only
  // locality/region metadata; it cannot move or invalidate the explicit anchor.
  if (coords && isValidCoordinate(coords.lat, coords.lng)) {
    let coordinateContext = null;
    if (typeof placeResolver?.resolveCoordinates === "function") {
      try {
        coordinateContext = await placeResolver.resolveCoordinates(
          { lat: coords.lat, lng: coords.lng },
          { language: placeLanguage },
        );
      } catch (_error) {
        coordinateContext = null;
      }
    }
    const placeContext = trustedPlaceContext(coordinateContext?.admin_context);
    const spatialScope = sanitizeTrustedSpatialScope(coordinateContext?.spatial_scope);
    return {
      anchor: { lat: coords.lat, lng: coords.lng },
      placeContext,
      spatialScope,
      intake: intake("coordinates", placeQuery, {
        status: "resolved",
        resolved: {
          label: typeof coordinateContext?.label === "string" && coordinateContext.label.trim()
            ? coordinateContext.label.trim()
            : null,
          lat: coords.lat,
          lng: coords.lng,
          confidence: "explicit",
          provenance: "explicit_request_coordinates",
          context_provenance: typeof coordinateContext?.provenance === "string"
            ? coordinateContext.provenance
            : null,
          attribution: typeof coordinateContext?.attribution === "string"
            ? coordinateContext.attribution
            : null,
          license: typeof coordinateContext?.license === "string"
            ? coordinateContext.license
            : null,
          timezone: typeof coordinateContext?.timezone === "string" && coordinateContext.timezone.trim()
            ? coordinateContext.timezone.trim()
            : null,
        },
      }),
    };
  }

  // 2. No coordinates and no place — nothing to anchor on. Aligns with the
  //    #259 "no usable coordinates" outcome.
  if (!placeQuery) {
    return { anchor: null, placeContext: null, intake: intake("none", null, { blockers: ["missing_or_invalid_coordinates"] }) };
  }

  // Selected identity may come only from a receipt issued by this server.
  // Explicit coordinates above remain authoritative, including with a token.
  const hasSelection = placeSelection !== undefined;
  const selected = hasSelection ? placeSelectionStore?.read(placeSelection, placeQuery) : null;
  const selectionInvalid = hasSelection && !selected;
  const previous = placeContextSelection ? placeSelectionStore?.read(placeContextSelection) : null;
  const near = previous || (placeBias && isValidCoordinate(placeBias.lat, placeBias.lng) ? placeBias : null);
  const candidateChoice = candidate => placeChoice(candidate, placeQuery, placeSelectionStore);

  // 3. Freeform place → trusted server resolver ONLY.
  if (!selected && typeof placeResolver !== "function") {
    return { anchor: null, placeContext: null, intake: intake("place", placeQuery, { blockers: [selectionInvalid ? "place_selection_invalid" : "place_resolver_unavailable"] }) };
  }

  let resolved;
  try {
    resolved = selected ? [selected] : await placeResolver(placeQuery, { language: placeLanguage, ...(near ? { near: { lat: near.lat, lng: near.lng } } : {}) });
  } catch (_error) {
    return { anchor: null, placeContext: null, intake: intake("place", placeQuery, { blockers: [selectionInvalid ? "place_selection_invalid" : "place_resolver_error"] }) };
  }

  const candidates = Array.isArray(resolved) ? resolved : resolved && typeof resolved === "object" ? [resolved] : [];
  if (!candidates.length) {
    return { anchor: null, placeContext: null, intake: intake("place", placeQuery, { blockers: [selectionInvalid ? "place_selection_invalid" : "place_not_resolved"] }) };
  }

  const strong = candidates.filter((candidate) => candidate && isStrongConfidence(candidate.confidence));

  if (selectionInvalid) {
    return { anchor: null, placeContext: null, intake: intake("place", placeQuery, {
      candidates_considered: candidates.length,
      candidates: strong.slice(0, 5).map(candidateChoice),
      blockers: ["place_selection_invalid"],
    }) };
  }

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
        candidates: strong.slice(0, 5).map(candidateChoice),
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
    // Private server-side collection scope. Only the injected resolver can mint
    // it; public request fields are never consulted.
    spatialScope: sanitizeTrustedSpatialScope(best.spatial_scope),
    intake: intake("place", placeQuery, {
      status: "resolved",
      candidates_considered: candidates.length,
      resolved: {
        ...(placeSelectionStore ? { selection_id: selected ? placeSelection : placeSelectionStore.issue(best, placeQuery) } : {}),
        ...(linkRefFor(best) ? { place_ref: linkRefFor(best) } : {}),
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
