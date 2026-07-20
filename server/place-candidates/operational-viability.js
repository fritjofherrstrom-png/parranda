/**
 * Operational-place viability is separate from place existence.
 *
 * A map node can prove that a venue was mapped without proving that a
 * restaurant, cafe, bar, shop, market, museum, or gallery is still operating.
 * Hard lifecycle evidence blocks route use. Softer source-owned signals only
 * rank an operational place ahead of an otherwise-equivalent unknown one; they
 * never upgrade source confidence or claim that the place is open right now.
 */

const OPERATIONAL_PLACE_TYPES = new Set([
  "restaurant",
  "street-food",
  "cafe",
  "bar",
  "market",
  "vintage-shop",
  "museum",
  "gallery",
]);

const STATUS_RANK = Object.freeze({
  not_applicable: 0,
  verified_active: 0,
  corroborated_active: 0,
  source_indicated_active: 1,
  unknown: 2,
  inactive: 3,
});

function evaluateOperationalViability({ candidate = {}, derived = {} } = {}) {
  const explicitStatus = normalizeStatus(candidate.operational_status);
  const explicitReasons = normalizeReasons(candidate.operational_reasons);
  const operationalType = OPERATIONAL_PLACE_TYPES.has(normalizeType(candidate.type));

  if (explicitStatus === "inactive" || (operationalType && isExplicitlyClosedSchedule(candidate.opening_hours))) {
    return result(
      "inactive",
      false,
      [
        "operational_place_inactive",
        ...(isExplicitlyClosedSchedule(candidate.opening_hours)
          ? ["operational_schedule_explicitly_closed"]
          : []),
        ...explicitReasons,
      ],
      operationalType,
    );
  }

  if (!operationalType) {
    return result("not_applicable", true, ["operational_check_not_required"], false);
  }

  if (candidate?.trust?.human_verified === true || candidate.city_pack_owned === true) {
    return result("verified_active", true, ["operational_place_human_verified"], true);
  }

  if (Number(derived.provenance_diversity || 0) >= 2) {
    return result("corroborated_active", true, ["operational_place_corroborated"], true);
  }

  const sourceSignals = [];
  if (explicitStatus === "source_indicated_active") {
    sourceSignals.push(...explicitReasons);
  }
  if (hasText(candidate.opening_hours) && !isExplicitlyClosedSchedule(candidate.opening_hours)) {
    sourceSignals.push("operational_opening_hours_present");
  }
  if (isHttpUrl(candidate.website)) {
    sourceSignals.push("operational_website_present");
  }
  if (sourceSignals.length) {
    return result("source_indicated_active", true, sourceSignals, true);
  }

  return result("unknown", true, ["operational_status_unknown"], true);
}

function operationalViabilityRank(value) {
  const status = normalizeStatus(
    value?.operational?.status ||
      value?.operational_viability?.status ||
      value?.status,
  );
  return STATUS_RANK[status] ?? STATUS_RANK.not_applicable;
}

function result(status, routeEligible, reasons, operationalType) {
  return {
    status,
    rank: STATUS_RANK[status],
    route_eligible: routeEligible === true,
    operational_type: operationalType === true,
    reasons: [...new Set(normalizeReasons(reasons))],
  };
}

function normalizeStatus(value) {
  const token = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, token) ? token : "";
}

function normalizeReasons(values) {
  const list = Array.isArray(values) ? values : [values];
  return list
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => /^[a-z0-9_:-]{1,80}$/.test(value));
}

function normalizeType(value) {
  return String(value || "").trim().toLowerCase();
}

function isExplicitlyClosedSchedule(value) {
  return /^(?:closed|off)$/i.test(String(value || "").trim());
}

function isHttpUrl(value) {
  if (!hasText(value)) return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch (_error) {
    return false;
  }
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  OPERATIONAL_PLACE_TYPES,
  STATUS_RANK,
  evaluateOperationalViability,
  operationalViabilityRank,
};
