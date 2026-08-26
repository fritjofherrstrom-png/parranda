/**
 * Trust gate for rendering a recognized citypack response in the modern planner.
 * The URL may be edited by anyone, so a city day is accepted only when the
 * server confirms the exact requested identity and says no fallback was used.
 */
export function classifyCuratedCityResult(response, { city, label } = {}) {
  const expected = String(city || "").trim().toLowerCase();
  const actual = String(response?.city || "").trim().toLowerCase();
  const requested = String(response?.requested_city || "").trim().toLowerCase();
  const serverLabel = String(response?.city_label || "").trim();
  const stops = response?.days?.[0]?.primary_route?.main_stops;
  const exact = Boolean(expected) && actual === expected && requested === expected && response?.city_fallback_used === false;
  const composed = exact && Boolean(serverLabel) && Array.isArray(stops) && stops.length > 0;
  return {
    status: composed ? "composed" : "unavailable",
    hasStructure: Boolean(response?.place_structure?.district_day),
    placeLabel: exact && serverLabel ? serverLabel : String(label || expected || "").trim(),
    limitations: [],
  };
}

export function safeCuratedCityResponse(response, classification) {
  if (classification?.status === "composed") return response;
  return { ...(response && typeof response === "object" ? response : {}), days: [] };
}