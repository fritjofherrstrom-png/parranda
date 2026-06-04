/**
 * Candidate Intelligence Spine — Entity Safety / Dedupe v1 (#238).
 *
 * Once the open-data loader can return external records, the same real-world
 * place can arrive twice: once curated (citypack) and once external (OSM /
 * Wikidata). They must not compete as two separate moves.
 *
 * This module resolves IDENTITY (not ranking — #235 already owns comparable-fit
 * priority). It runs on the collected candidate set BEFORE gates/fit, and:
 *
 *   - merges a confidently-matching external record INTO its curated twin: the
 *     curated candidate stays canonical and user-facing, and ABSORBS the
 *     external's evidence + attribution. External corroboration makes curated
 *     knowledge stronger, it does not fight it.
 *   - suppresses the external duplicate from the candidate set (recorded for
 *     inspect, attribution preserved on the canonical candidate).
 *   - dedupes external-vs-external the same way (keeps the stronger record).
 *   - NEVER merges curated-vs-curated (both are trusted truth).
 *   - keeps candidates SEPARATE whenever identity is uncertain — a false merge
 *     (hiding a real option, misattributing evidence) is worse than a false
 *     separate. Generic names and multi-match ambiguity stay separate.
 *
 * Matching is conservative and requires CORROBORATING signals (geo AND name,
 * or a hard shared id) — never geo alone or name alone.
 *
 * Pure / side-effect free. Returns a new candidate list; inputs are not mutated.
 */

const { deriveEvidenceFromPlaceCandidate } = require("./evidence");

// Thresholds — intentionally tight. Tune up (looser) only with evidence.
const GEO_MERGE_M = 75; // close enough to be the same place, with a name match
const GEO_TIGHT_M = 30; // very close: exact normalized name is enough
const GEO_HARD_ID_M = 500; // sanity bound when a shared wikidata id is present
const NAME_SIM_MIN = 0.6; // max(token Jaccard, distinctive-token Jaccard)
const COORD_CONFLICT_M = 100; // curated vs external coords farther apart than this
// are flagged as a conflict (kept curated, never silently overwritten)

// Tokens stripped before computing "distinctive" name overlap: articles +
// generic category nouns across the languages Parranda touches. A name with no
// distinctive token left (e.g. "The Bar", "Cafe") is treated as generic and
// will not merge on geo+name alone.
const GENERIC_NAME_TOKENS = new Set([
  // articles / connectors
  "the", "a", "an", "la", "le", "il", "lo", "gli", "los", "las", "el", "der",
  "die", "das", "den", "det", "en", "ett", "of", "de", "di", "da", "del", "dei",
  // category nouns
  "bar", "pub", "cafe", "caffe", "kafe", "cafeteria", "restaurant", "ristorante",
  "trattoria", "osteria", "pizzeria", "pizza", "bakery", "forno", "museo",
  "museum", "gallery", "galleria", "market", "mercato", "mercat", "marknad",
  "shop", "store", "butik", "boutique", "viewpoint", "mirador", "belvedere",
  "terrazza", "park", "parco", "parc", "garden", "giardino", "jardin", "beach",
  "playa", "spiaggia", "strand", "lido", "church", "chiesa", "iglesia",
  "basilica", "hotel", "hostal",
]);

// Coarse category buckets. Two candidates may only merge when their buckets are
// compatible (equal, or either unknown). Prevents a co-located restaurant and
// viewpoint with similar names from merging.
const CATEGORY_BUCKETS = {
  viewpoint: "scenic", "rooftop-bar": "scenic", promenade: "scenic", park: "scenic",
  garden: "scenic", bridge: "scenic", castle: "scenic", landmark: "scenic",
  restaurant: "food", pizza: "food", "street-food": "food", bakery: "food",
  trattoria: "food", cafe: "food", "café": "food",
  bar: "bars", "wine-bar": "bars", "cocktail-bar": "bars",
  market: "market", event_market: "market",
  museum: "culture", church: "culture", gallery: "culture", library: "culture",
  beach: "swimming",
  shop: "shopping", "vintage-shop": "shopping",
};

function resolveCandidateIdentity(candidates, { now = null } = {}) {
  const input = Array.isArray(candidates) ? candidates : [];
  // Curated first so externals merge INTO curated, deterministically.
  const ordered = [...input].sort((a, b) => curatedRank(b) - curatedRank(a));

  const survivors = [];
  const merges = [];
  let ambiguousKept = 0;

  for (const candidate of ordered) {
    const matchIndexes = [];
    for (let i = 0; i < survivors.length; i += 1) {
      const verdict = matchIdentity(survivors[i].candidate, candidate);
      if (verdict.same) matchIndexes.push({ i, verdict });
    }

    if (matchIndexes.length === 0) {
      survivors.push({ candidate });
      continue;
    }

    if (matchIndexes.length > 1) {
      // Matches more than one existing place → ambiguous. Keep separate rather
      // than guess which one it belongs to.
      survivors.push({ candidate });
      ambiguousKept += 1;
      merges.push({
        duplicate_id: candidate.id,
        into_id: null,
        decision: "kept_separate_ambiguous",
        reason: "matched_multiple",
        match_count: matchIndexes.length,
      });
      continue;
    }

    const { i, verdict } = matchIndexes[0];
    const existing = survivors[i].candidate;
    const canonical = chooseCanonical(existing, candidate);
    const duplicate = canonical === existing ? candidate : existing;
    const reconciliation = reconcileFields(canonical, duplicate);
    survivors[i] = { candidate: mergeInto(canonical, duplicate, { now }) };
    merges.push({
      duplicate_id: duplicate.id,
      duplicate_origin: originOf(duplicate),
      into_id: canonical.id,
      into_origin: originOf(canonical),
      decision: "merged",
      confidence: verdict.confidence,
      signals: verdict.signals,
      reconciled_fields: reconciliation.reconciliation.filled,
      conflicts: reconciliation.reconciliation.conflicts,
    });
  }

  const mergedRecords = merges.filter((m) => m.decision === "merged");
  return {
    candidates: survivors.map((s) => s.candidate),
    merges,
    summary: {
      input_count: input.length,
      output_count: survivors.length,
      merged_count: mergedRecords.length,
      ambiguous_kept_separate: ambiguousKept,
      reconciled_count: mergedRecords.filter((m) => m.reconciled_fields.length > 0).length,
      conflict_count: mergedRecords.filter((m) => m.conflicts.length > 0).length,
    },
  };
}

/**
 * Decide whether two candidates are the same real-world place.
 * @returns {{ same: boolean, confidence: string|null, signals: object, reason: string }}
 */
function matchIdentity(a, b) {
  // Never collapse two curated truths.
  if (a.city_pack_owned === true && b.city_pack_owned === true) {
    return no("both_curated");
  }

  const wa = wikidataIdOf(a);
  const wb = wikidataIdOf(b);
  const dist = distanceM(a, b);

  // Hard identity: a shared Wikidata entity IS the same place by definition.
  if (wa && wb && wa === wb) {
    if (dist === null || dist <= GEO_HARD_ID_M) {
      return yes("hard_wikidata", { wikidata: wa, distance_m: round(dist) });
    }
    return no("wikidata_match_but_geo_far");
  }

  // Category compatibility gate.
  const bucketA = CATEGORY_BUCKETS[String(a.type || "").toLowerCase()] || null;
  const bucketB = CATEGORY_BUCKETS[String(b.type || "").toLowerCase()] || null;
  if (bucketA && bucketB && bucketA !== bucketB) {
    return no("category_mismatch", { bucket_a: bucketA, bucket_b: bucketB });
  }

  // Geo is required — without coordinates on both sides we cannot confirm
  // identity, so we keep them separate.
  if (dist === null) return no("no_coordinates_to_confirm");

  const distinctA = distinctiveTokens(a.label);
  const distinctB = distinctiveTokens(b.label);

  // Generic-name guard: if either name has no distinctive token left (e.g.
  // "Cafe", "The Bar"), geo + name is NOT enough — a piazza can hold several
  // adjacent generic-named places. Such candidates merge ONLY via a hard shared
  // id (handled above), otherwise they stay separate.
  if (distinctA.size === 0 || distinctB.size === 0) {
    return no("generic_name_no_distinctive_token", { distance_m: round(dist) });
  }

  const sim = nameSimilarity(a.label, b.label);
  const distinctiveOverlap = intersectionSize(distinctA, distinctB);

  if (dist <= GEO_MERGE_M && sim >= NAME_SIM_MIN && distinctiveOverlap >= 1) {
    return yes("geo_name", { distance_m: round(dist), name_similarity: round2(sim), distinctive_overlap: distinctiveOverlap });
  }
  if (dist <= GEO_TIGHT_M && normalizeName(a.label) === normalizeName(b.label)) {
    return yes("tight_exact", { distance_m: round(dist) });
  }

  return no("below_thresholds", { distance_m: round(dist), name_similarity: round2(sim), distinctive_overlap: distinctiveOverlap });
}

function chooseCanonical(a, b) {
  // Curated always canonical over external.
  if (a.city_pack_owned === true && b.city_pack_owned !== true) return a;
  if (b.city_pack_owned === true && a.city_pack_owned !== true) return b;
  // External vs external: keep the one with more evidence, then stable by id.
  const ea = evidenceCount(a);
  const eb = evidenceCount(b);
  if (ea !== eb) return ea > eb ? a : b;
  return String(a.id) <= String(b.id) ? a : b;
}

function mergeInto(canonical, duplicate, { now = null } = {}) {
  const canonicalEvidence = evidenceOf(canonical, now);
  const duplicateEvidence = evidenceOf(duplicate, now);
  const evidence = dedupeEvidence([...canonicalEvidence, ...duplicateEvidence]);

  const mergedFrom = [
    ...(Array.isArray(canonical.merged_from) ? canonical.merged_from : []),
    {
      id: duplicate.id,
      origin: originOf(duplicate),
      provider_id: duplicate.provider_id || null,
      source_family: duplicate.source_family || null,
      label: duplicate.label || null,
    },
  ];

  // Canonical keeps its identity/taste fields (curated truth wins). It gains the
  // absorbed evidence ledger, a merged_from trail, and a bounded field
  // reconciliation: only SAFE missing/conflicting operational fields are
  // touched (v2: coordinates). Label/type/tags are always preserved.
  const { patch, reconciliation } = reconcileFields(canonical, duplicate);
  const prior = canonical.reconciliation || { filled: [], conflicts: [] };
  const merged = { ...canonical, ...patch, evidence, merged_from: mergedFrom };

  const filled = [...prior.filled, ...reconciliation.filled];
  const conflicts = [...prior.conflicts, ...reconciliation.conflicts];
  if (filled.length || conflicts.length) {
    merged.reconciliation = { filled, conflicts };
  }
  return merged;
}

/**
 * Bounded field reconciliation: enrich a curated candidate from its merged
 * external twin WITHOUT touching curated identity/taste.
 *   - missing curated coordinates → filled from the external twin
 *   - close coordinates → curated kept (no change)
 *   - far coordinates → curated kept, conflict exposed for inspect
 *   - label / type / tags → always preserved (never reconciled in v2)
 *
 * @returns {{ patch: object, reconciliation: { filled: string[], conflicts: object[] } }}
 */
function reconcileFields(canonical, duplicate) {
  const patch = {};
  const filled = [];
  const conflicts = [];

  const canHas = hasCoords(canonical);
  const dupHas = hasCoords(duplicate);

  if (!canHas && dupHas) {
    patch.lat = duplicate.lat;
    patch.lng = duplicate.lng;
    filled.push("coordinates");
  } else if (canHas && dupHas) {
    const d = haversineM(canonical.lat, canonical.lng, duplicate.lat, duplicate.lng);
    if (d > COORD_CONFLICT_M) {
      conflicts.push({
        field: "coordinates",
        kept: "curated",
        curated: { lat: canonical.lat, lng: canonical.lng },
        external: { lat: duplicate.lat, lng: duplicate.lng },
        distance_m: round(d),
      });
    }
  }

  return { patch, reconciliation: { filled, conflicts } };
}

// --- evidence helpers ------------------------------------------------------

function evidenceOf(candidate, now) {
  if (Array.isArray(candidate.evidence) && candidate.evidence.length) {
    return candidate.evidence;
  }
  return deriveEvidenceFromPlaceCandidate(candidate, { observed_at: now });
}

function evidenceCount(candidate) {
  return Array.isArray(candidate.evidence) ? candidate.evidence.length : 0;
}

function dedupeEvidence(evidence) {
  const seen = new Set();
  const out = [];
  for (const item of evidence) {
    const ref = item.source_ref || {};
    const key = `${item.claim_type}|${ref.provider_id || ""}|${ref.source_family || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// --- name + geo signals ----------------------------------------------------

function normalizeName(value) {
  return String(value === undefined || value === null ? "" : value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nameTokens(value) {
  const normalized = normalizeName(value);
  return normalized ? new Set(normalized.split(" ")) : new Set();
}

function distinctiveTokens(value) {
  const tokens = nameTokens(value);
  const out = new Set();
  for (const token of tokens) {
    if (!GENERIC_NAME_TOKENS.has(token) && token.length > 1) out.add(token);
  }
  return out;
}

function nameSimilarity(a, b) {
  const allA = nameTokens(a);
  const allB = nameTokens(b);
  const distA = distinctiveTokens(a);
  const distB = distinctiveTokens(b);
  return Math.max(jaccard(allA, allB), jaccard(distA, distB));
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  const inter = intersectionSize(a, b);
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function intersectionSize(a, b) {
  let count = 0;
  for (const value of a) if (b.has(value)) count += 1;
  return count;
}

function distanceM(a, b) {
  if (!hasCoords(a) || !hasCoords(b)) return null;
  return haversineM(a.lat, a.lng, b.lat, b.lng);
}

function hasCoords(c) {
  return Number.isFinite(c?.lat) && Number.isFinite(c?.lng);
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// --- identity helpers ------------------------------------------------------

function wikidataIdOf(candidate) {
  const direct = String(candidate.wikidata || candidate.wikidata_id || "").trim();
  if (/^Q\d+$/.test(direct)) return direct;
  const known = String(candidate.known_place_id || "").trim();
  if (/^Q\d+$/.test(known)) return known;
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
  for (const item of evidence) {
    const url = item.source_ref?.url || "";
    const match = String(url).match(/wikidata\.org\/wiki\/(Q\d+)/i);
    if (match) return match[1];
  }
  return null;
}

function curatedRank(candidate) {
  return candidate.city_pack_owned === true ? 1 : 0;
}

function originOf(candidate) {
  if (candidate.candidate_origin) return candidate.candidate_origin;
  return candidate.city_pack_owned ? "curated_catalog" : "external_open";
}

function yes(confidence, signals = {}) {
  return { same: true, confidence, signals, reason: confidence };
}

function no(reason, signals = {}) {
  return { same: false, confidence: null, signals, reason };
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function round2(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

module.exports = {
  GEO_MERGE_M,
  GEO_TIGHT_M,
  NAME_SIM_MIN,
  COORD_CONFLICT_M,
  resolveCandidateIdentity,
  matchIdentity,
  reconcileFields,
  normalizeName,
  distinctiveTokens,
  nameSimilarity,
  wikidataIdOf,
};
