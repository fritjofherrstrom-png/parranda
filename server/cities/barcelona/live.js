const { liveSources } = require("./sources");

const OPEN_DATA_AGENDA_SOURCE_ID = "barcelona-open-data-agenda";
const OPEN_DATA_AGENDA_JSON_URL =
  "https://opendata-ajuntament.barcelona.cat/data/dataset/a25e60cd-3083-4252-9fce-81f733871cb1/resource/da9e71de-0f8e-417d-928a-56380bfd0231/download";
const OPEN_DATA_AGENDA_EVENT_URL = "https://guia.barcelona.cat/ca/detall";
const FETCH_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 30 * 60 * 1000;

let cache = {
  fetchedAt: 0,
  items: [],
};
let inFlight = null;

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html) {
  return normalizeWhitespace(
    String(html || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function toIsoDate(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function toDateValue(value) {
  const date = toIsoDate(value);
  return date ? Date.parse(`${date}T00:00:00Z`) : null;
}

function overlapsDate(event, date) {
  const startDate = event.start_date || event.end_date;
  const endDate = event.end_date || event.start_date;
  return Boolean(startDate && endDate && date >= startDate && date <= endDate);
}

function firstArrayItem(value) {
  return Array.isArray(value) && value.length ? value[0] : null;
}

function readProviderCoordinates(address) {
  const latLngCoordinates = address.location_4326?.geometries?.[0]?.coordinates;
  if (
    Array.isArray(latLngCoordinates) &&
    typeof latLngCoordinates[0] === "number" &&
    typeof latLngCoordinates[1] === "number"
  ) {
    // Open Data BCN publishes location_4326 as [lat, lng].
    return {
      lat: latLngCoordinates[0],
      lng: latLngCoordinates[1],
    };
  }

  const lngLatCoordinates = address.location_4326_latlon?.geometries?.[0]?.coordinates;
  if (
    Array.isArray(lngLatCoordinates) &&
    typeof lngLatCoordinates[0] === "number" &&
    typeof lngLatCoordinates[1] === "number"
  ) {
    // Despite the field name, the provider publishes location_4326_latlon as [lng, lat].
    return {
      lat: lngLatCoordinates[1],
      lng: lngLatCoordinates[0],
    };
  }

  return {
    lat: null,
    lng: null,
  };
}

function normalizeAddress(address) {
  if (!address || typeof address !== "object") {
    return {};
  }

  const streetNumber =
    address.street_number_1 ||
    address.start_street_number ||
    address.street_number ||
    "";
  const addressParts = [address.address_name, streetNumber].filter(Boolean);
  const coordinates = readProviderCoordinates(address);

  return {
    venue:
      address.place ||
      address.related_entity_data?.name ||
      address.address_name ||
      "Barcelona venue",
    address: normalizeWhitespace(addressParts.join(", ")),
    lat: coordinates.lat,
    lng: coordinates.lng,
  };
}

function normalizeCategory(record) {
  const classification = firstArrayItem(record.classifications_data);
  const secondary = firstArrayItem(record.secondary_filters_data);
  return (
    classification?.name ||
    secondary?.name ||
    record.type_name ||
    record.core_type_name ||
    "Agenda"
  );
}

function buildSearchCorpus(record) {
  return normalizeWhitespace(
    [
      record.name,
      record.body,
      normalizeCategory(record),
      ...(record.classifications_data || []).map((entry) => entry.name),
      ...(record.secondary_filters_data || []).map((entry) => entry.name),
      firstArrayItem(record.addresses)?.place,
      firstArrayItem(record.addresses)?.district_name,
      firstArrayItem(record.addresses)?.neighborhood_name,
    ].join(" "),
  ).toLowerCase();
}

function buildTagCorpus(record) {
  return normalizeWhitespace(
    [
      record.name,
      normalizeCategory(record),
      ...(record.classifications_data || []).map((entry) => entry.name),
      ...(record.secondary_filters_data || []).map((entry) => entry.name),
      firstArrayItem(record.addresses)?.place,
      firstArrayItem(record.addresses)?.district_name,
      firstArrayItem(record.addresses)?.neighborhood_name,
    ].join(" "),
  ).toLowerCase();
}

function inferBarcelonaTags(record) {
  const corpus = buildTagCorpus(record);
  const tags = new Set();

  if (/(concert|música|music|òpera|opera|teatre|theatre|exposici|exhibit|museu|museum|cinema|cultura|festival|espectacle|balls)/i.test(corpus)) {
    tags.add("kultur");
  }
  if (/(concert|música|music|òpera|opera|jazz|flamenc|havaner|dj|rock)/i.test(corpus)) {
    tags.add("music");
  }
  if (/(exposici|exhibit|gallery|galeria|museu|museum)/i.test(corpus)) {
    tags.add("exhibition");
  }
  if (/(^|\b)(taller|tallers|workshop|curs|cursos|curso|classe|laboratori)(\b|$)/i.test(corpus)) {
    tags.add("workshop");
  }
  if (/(mercat|market|gastronom|food|cuina|tast|degustaci|wine|beer|cervesa|bravas|menjar|menjars)/i.test(corpus)) {
    tags.add("mat");
  }
  if (/(mercat|market|fira|mostra de comerç|vintage|segona mà|second.hand|encants)/i.test(corpus)) {
    tags.add("market");
  }
  if (/(^|\b)(vi|wine|celler|vin)(\b|$)/i.test(corpus)) {
    tags.add("vin");
  }
  if (/(nit|night|dj|club|party|festa|concert|live|rock)/i.test(corpus)) {
    tags.add("nattliv");
  }
  if (/(platja|beach|litoral|coast|moll|marítim|maritima)/i.test(corpus)) {
    tags.add("coast");
  }
  if (/(infant|family|familiar|children|kids|nens|nenes)/i.test(corpus)) {
    tags.add("family");
  }
  if (/(barri|community|comunit|centre cívic|centres civics|festa major|popular|veïnal|veinal|mostra de comerç)/i.test(corpus)) {
    tags.add("community");
  }
  if (/(xerrada|col.loqui|col·loqui|conferència|conferencia|presentaci|lectura|debat)/i.test(corpus)) {
    tags.add("civic");
  }

  return [...tags];
}

function evaluateOpenDataAgendaRecord(record) {
  if (!record || typeof record !== "object") {
    return { accepted: false, score: 0, reasons: ["invalid-record"], tags: [] };
  }

  const title = normalizeWhitespace(record?.name);
  const startMs = toDateValue(record?.start_date);
  const endMs = toDateValue(record?.end_date) || startMs;
  const category = normalizeCategory(record);
  const corpus = buildSearchCorpus(record);
  const tags = inferBarcelonaTags(record);
  const reasons = [];

  if (record.status && record.status !== "published") {
    return { accepted: false, score: 0, reasons: ["not-published"], tags };
  }
  if (record.core_type && record.core_type !== "event") {
    return { accepted: false, score: 0, reasons: ["not-event"], tags };
  }
  if (!title || !startMs) {
    return { accepted: false, score: 0, reasons: ["missing-title-or-date"], tags };
  }

  const durationDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
  let score = 10;

  if (durationDays <= 2) {
    score += 6;
    reasons.push("short-window");
  } else if (durationDays <= 14) {
    score += 3;
    reasons.push("fresh-window");
  } else if (durationDays > 60) {
    score -= 5;
    reasons.push("long-running");
  }

  const routeUsefulTags = tags.filter((tag) =>
    ["kultur", "music", "exhibition", "market", "mat", "vin", "nattliv", "coast", "community"].includes(tag),
  );
  score += routeUsefulTags.length * 2;

  if (/(concert|espectacle|festival|festa major|mercat|fira|projecci|itinerari|recorregut|degustaci|exposici)/i.test(corpus)) {
    score += 4;
    reasons.push("city-rhythm");
  }
  if (/(patis oberts|patis bressol|casal infantil|actes per nens|actes per nenes|ludoteca)/i.test(corpus)) {
    score -= 18;
    reasons.push("family-infrastructure-noise");
  }
  if (/(concursos, premis|convocatòria|subvenci|tràmit|licitaci|inscripcions?)/i.test(corpus)) {
    score -= 18;
    reasons.push("admin-or-listing-noise");
  }
  if (category === "Agenda" || category === "Puntual") {
    score -= 2;
    reasons.push("generic-category");
  }

  return {
    accepted: score >= 8,
    score,
    reasons,
    tags,
  };
}

function buildSourceUrl(record) {
  if (!record?.register_id) {
    return OPEN_DATA_AGENDA_EVENT_URL;
  }

  return `${OPEN_DATA_AGENDA_EVENT_URL}/${encodeURIComponent(record.register_id)}`;
}

function normalizeOpenDataAgendaRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const title = normalizeWhitespace(record.name);
  const startDate = toIsoDate(record.start_date);
  const endDate = toIsoDate(record.end_date) || startDate;

  if (!title || !startDate) {
    return null;
  }

  const address = normalizeAddress(firstArrayItem(record.addresses));
  const summary = stripTags(record.body).slice(0, 320);
  const category = normalizeCategory(record);
  const source = liveSources.find((entry) => entry.id === OPEN_DATA_AGENDA_SOURCE_ID);
  const quality = evaluateOpenDataAgendaRecord(record);

  return {
    id: `barcelona-open-data-${record.register_id || title}`
      .toLowerCase()
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, ""),
    source_id: OPEN_DATA_AGENDA_SOURCE_ID,
    source_label: "Open Data BCN",
    source_url: source?.sourceUrl || OPEN_DATA_AGENDA_JSON_URL,
    url: buildSourceUrl(record),
    source_language: "ca",
    title,
    start_date: startDate,
    end_date: endDate,
    type: category,
    provider_category: category,
    venue: address.venue,
    address: address.address,
    summary,
    raw_summary: summary,
    buy_url: null,
    image_url: record.image_data?.url || null,
    lat: address.lat,
    lng: address.lng,
    geocode_label: address.venue,
    geocode_source: "provider",
    match_tags: quality.tags,
  };
}

function normalizeOpenDataAgendaEvents(records = []) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .map((record, index) => ({
      index,
      record,
      quality: evaluateOpenDataAgendaRecord(record),
    }))
    .filter((entry) => entry.quality.accepted)
    .sort((a, b) => b.quality.score - a.quality.score || a.index - b.index)
    .map((entry) => normalizeOpenDataAgendaRecord(entry.record))
    .filter(Boolean);
}

async function fetchJson(url = OPEN_DATA_AGENDA_JSON_URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Parranda Barcelona/1.0 (official-live-source)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Barcelona live source failed with status ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadOpenDataAgendaEvents(fetcher = fetchJson) {
  if (cache.fetchedAt && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.items;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      const records = await fetcher();
      const items = normalizeOpenDataAgendaEvents(records);

      if (Array.isArray(records)) {
        cache = {
          fetchedAt: Date.now(),
          items,
        };
      }

      return items;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

async function fetchLiveEventsForDates(dates, context = {}) {
  if (!Array.isArray(dates) || !dates.length) {
    return {};
  }

  try {
    const events = await loadOpenDataAgendaEvents(context.fetchOpenDataAgendaEvents);
    const usedEventIds = new Set();
    const byDate = {};

    for (const date of dates) {
      byDate[date] = events
        .filter((event) => overlapsDate(event, date))
        .filter((event) => {
          if (usedEventIds.has(event.id)) {
            return false;
          }
          usedEventIds.add(event.id);
          return true;
        })
        .slice(0, 3);
    }

    return byDate;
  } catch (_error) {
    return Object.fromEntries(dates.map((date) => [date, []]));
  }
}

function resetBarcelonaLiveEventsCache() {
  cache = {
    fetchedAt: 0,
    items: [],
  };
  inFlight = null;
}

module.exports = {
  evaluateOpenDataAgendaRecord,
  fetchLiveEventsForDates,
  normalizeOpenDataAgendaRecord,
  normalizeOpenDataAgendaEvents,
  resetBarcelonaLiveEventsCache,
};
