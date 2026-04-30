function toCandidate(item, source = "catalog") {
  return {
    id: item.id,
    label: item.name,
    lat: item.lat,
    lng: item.lng,
    type: item.kind,
    area: item.area,
    source,
  };
}

function buildGeocodeQuery(options = {}) {
  const {
    items = [],
    findByName = () => null,
    searchLabel = "",
    countryLabel = "",
    defaultAreaLabel = searchLabel || "Unknown area",
    userAgent = "Parranda/1.0 (route-planner)",
  } = options;

  return async function geocodeQuery(query) {
    const trimmed = String(query || "").trim();

    if (!trimmed) {
      return [];
    }

    const exact = findByName(trimmed);
    if (exact) {
      return [toCandidate(exact)];
    }

    const normalized = trimmed.toLowerCase();
    const localMatches = items
      .filter(
        (item) =>
          item.name.toLowerCase().includes(normalized) ||
          (item.searchTerms || []).some((term) => term.toLowerCase().includes(normalized)),
      )
      .slice(0, 5)
      .map((item) => toCandidate(item));

    if (localMatches.length) {
      return localMatches;
    }

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set(
      "q",
      [trimmed, searchLabel, countryLabel].filter(Boolean).join(", "),
    );
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");

    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Geocoding failed with status ${response.status}`);
    }

    const results = await response.json();

    return results.map((result, index) => ({
      id: `nominatim-${index}`,
      label: result.display_name,
      lat: Number(result.lat),
      lng: Number(result.lon),
      type: result.type || "place",
      area: defaultAreaLabel,
      source: "nominatim",
    }));
  };
}

let legacyRomeGeocodeQuery = null;

function getLegacyRomeGeocodeQuery() {
  if (!legacyRomeGeocodeQuery) {
    const { allItems, findItemByName } = require("./catalog");
    legacyRomeGeocodeQuery = buildGeocodeQuery({
      items: allItems,
      findByName: findItemByName,
      searchLabel: "Rome",
      countryLabel: "Italy",
      defaultAreaLabel: "Rom",
      userAgent: "Parranda Rome/1.0 (legacy-route-planner)",
    });
  }

  return legacyRomeGeocodeQuery;
}

async function geocodeQuery(query) {
  return getLegacyRomeGeocodeQuery()(query);
}

module.exports = {
  buildGeocodeQuery,
  geocodeQuery,
};
