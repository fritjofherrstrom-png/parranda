const { allItems, findItemByName } = require("./catalog");

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

async function geocodeQuery(query) {
  const trimmed = String(query || "").trim();

  if (!trimmed) {
    return [];
  }

  const exact = findItemByName(trimmed);
  if (exact) {
    return [toCandidate(exact)];
  }

  const normalized = trimmed.toLowerCase();
  const localMatches = allItems
    .filter(
      (item) =>
        item.name.toLowerCase().includes(normalized) ||
        item.searchTerms.some((term) => term.toLowerCase().includes(normalized)),
    )
    .slice(0, 5)
    .map((item) => toCandidate(item));

  if (localMatches.length) {
    return localMatches;
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${trimmed}, Rome, Italy`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "RomaRadar/1.0 (route-planner)",
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
    area: "Rome",
    source: "nominatim",
  }));
}

module.exports = {
  geocodeQuery,
};
