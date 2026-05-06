const VALID_AVAILABILITY_KINDS = new Set(["shop", "market", "event_market", "seasonal"]);
const VALID_DAY_SENSITIVITY = new Set(["low", "medium", "high"]);

function normalizeWeekdayArray(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6))].sort(
    (left, right) => left - right,
  );
}

function normalizeAvailability(rawAvailability) {
  if (!rawAvailability || typeof rawAvailability !== "object" || Array.isArray(rawAvailability)) {
    return null;
  }

  const kind = VALID_AVAILABILITY_KINDS.has(rawAvailability.kind) ? rawAvailability.kind : null;

  if (!kind) {
    return null;
  }

  return {
    kind,
    strongWeekdays: normalizeWeekdayArray(rawAvailability.strongWeekdays),
    weakWeekdays: normalizeWeekdayArray(rawAvailability.weakWeekdays),
    daySensitivity: VALID_DAY_SENSITIVITY.has(rawAvailability.daySensitivity)
      ? rawAvailability.daySensitivity
      : "low",
    note: typeof rawAvailability.note === "string" ? rawAvailability.note.trim() : "",
    verifyRecommended: rawAvailability.verifyRecommended === true,
  };
}

function summarizeAvailability(routeStops = [], weekday = null) {
  const availabilityStops = (routeStops || [])
    .map((stop) => ({
      stop,
      availability: normalizeAvailability(stop?.availability),
    }))
    .filter((entry) => entry.availability);

  const shopStops = availabilityStops.filter((entry) => entry.availability.kind === "shop");
  const marketStops = availabilityStops.filter((entry) => entry.availability.kind === "market");
  const eventMarketStops = availabilityStops.filter((entry) => entry.availability.kind === "event_market");
  const seasonalStops = availabilityStops.filter((entry) => entry.availability.kind === "seasonal");
  const marketStyleStops = [...marketStops, ...eventMarketStops];
  const strongDayStops = availabilityStops.filter((entry) =>
    entry.availability.strongWeekdays.includes(weekday),
  );
  const weakDayStops = availabilityStops.filter((entry) => entry.availability.weakWeekdays.includes(weekday));
  const strongMarketStops = marketStyleStops.filter((entry) => entry.availability.strongWeekdays.includes(weekday));
  const weakMarketStops = marketStyleStops.filter((entry) => entry.availability.weakWeekdays.includes(weekday));
  const mediumOrHighSensitivityStops = availabilityStops.filter((entry) =>
    ["medium", "high"].includes(entry.availability.daySensitivity),
  );
  const verifyRecommendedStops = availabilityStops.filter((entry) => entry.availability.verifyRecommended);
  const hasShopFallback = shopStops.length > 0;

  return {
    availabilityStops,
    shopStops,
    marketStops,
    eventMarketStops,
    seasonalStops,
    marketStyleStops,
    strongDayStops,
    weakDayStops,
    strongMarketStops,
    weakMarketStops,
    mediumOrHighSensitivityStops,
    verifyRecommendedStops,
    hasShopFallback,
    hasStrongMarketDay: strongMarketStops.length > 0,
    hasWeakMarketDay: weakMarketStops.length > 0,
    isMarketHeavy:
      marketStyleStops.length > 0 && marketStyleStops.length >= Math.max(shopStops.length, 1),
  };
}

module.exports = {
  normalizeAvailability,
  summarizeAvailability,
};
