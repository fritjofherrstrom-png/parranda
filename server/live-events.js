const { diffIsoDatesInDays } = require("./lib/iso-date");

const TURISMO_ROMA_BASE_URL = "https://www.turismoroma.it";
const ROMA_LIVE_URL = `${TURISMO_ROMA_BASE_URL}/en/romalive`;
const MAX_PAGE_COUNT = 7;
const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;

let cache = {
  fetchedAt: 0,
  items: [],
};

let inFlight = null;
let geocodeCache = new Map();
let geocodeInFlight = new Map();
let legacyGeocodeQuery = null;

function getLegacyGeocodeQuery() {
  if (!legacyGeocodeQuery) {
    const { geocodeQuery } = require("./geocoding");
    legacyGeocodeQuery = geocodeQuery;
  }

  return legacyGeocodeQuery;
}

function decodeHtml(text) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return String(text || "").replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (match, entity) => {
      const normalized = entity.toLowerCase();

      if (named[normalized]) {
        return named[normalized];
      }

      if (normalized.startsWith("#x")) {
        const value = Number.parseInt(normalized.slice(2), 16);
        return Number.isNaN(value) ? match : String.fromCodePoint(value);
      }

      if (normalized.startsWith("#")) {
        const value = Number.parseInt(normalized.slice(1), 10);
        return Number.isNaN(value) ? match : String.fromCodePoint(value);
      }

      return match;
    },
  );
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html) {
  const decoded = decodeHtml(String(html || ""));

  return normalizeWhitespace(
    decoded
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function toAbsoluteUrl(url) {
  if (!url) {
    return null;
  }

  try {
    return new URL(url, TURISMO_ROMA_BASE_URL).toString();
  } catch (_error) {
    return null;
  }
}

function parseIsoDate(text) {
  const match = String(text || "").match(/(\d{2})[-/](\d{2})[-/](\d{4})/);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function extract(block, pattern) {
  return block.match(pattern)?.[1] || "";
}

function durationDays(startDate, endDate) {
  if (!startDate || !endDate) {
    return null;
  }

  const diff = diffIsoDatesInDays(startDate, endDate);

  if (diff == null || Number.isNaN(diff)) {
    return null;
  }

  return diff + 1;
}

function parsePageCount(html) {
  const pageNumbers = [...html.matchAll(/href="\/en\/romalive\?page=(\d+)"/g)].map(
    (match) => Number(match[1]),
  );

  if (!pageNumbers.length) {
    return 1;
  }

  return Math.min(Math.max(...pageNumbers) + 1, MAX_PAGE_COUNT);
}

function buildCorpus(event) {
  return normalizeWhitespace(
    `${event.title} ${event.type} ${event.venue} ${event.address} ${event.summary}`.toLowerCase(),
  );
}

function inferEventTags(event) {
  const corpus = buildCorpus(event);
  const tags = new Set();

  if (
    /(museum|museo|exhibition|gallery|galleria|cinema|theater|theatre|teatro|festival|concert|opera|art|culture)/.test(
      corpus,
    )
  ) {
    tags.add("kultur");
  }

  if (/(church|basilica|chapel|cathedral|pantheon|santa |san )/.test(corpus)) {
    tags.add("kyrkor");
    tags.add("kultur");
  }

  if (/(pizza|food|market|ristorante|trattoria|dining|taste|tasting)/.test(corpus)) {
    tags.add("mat");
  }

  if (/(wine|vino|vin|enoteca|cellar|cantina|sommelier|vineyard)/.test(corpus)) {
    tags.add("vin");
    tags.add("mat");
  }

  if (/(beer|birra|brew|brewery|pub)/.test(corpus)) {
    tags.add("öl");
    tags.add("nattliv");
  }

  if (/(cocktail|mixology|speakeasy|bar crawl|drink)/.test(corpus)) {
    tags.add("cocktail");
    tags.add("nattliv");
  }

  if (/(night|nightlife|club|dj|party|live music|concert|aperitif|aperitivo|festival)/.test(corpus)) {
    tags.add("nattliv");
  }

  if (/(terrace|sunset|panorama|view|belvedere|rooftop|outdoor)/.test(corpus)) {
    tags.add("utsikt");
  }

  if (/(district|quartiere|trastevere|testaccio|ostiense|pigneto|borgo|prati|monti)/.test(corpus)) {
    tags.add("hidden gems");
  }

  return [...tags];
}

function scoreLiveEvent(event, { preferences = [], optimizerMode = null, modifier = null } = {}) {
  const tags = inferEventTags(event);
  const tagSet = new Set(tags);
  let score = 0;

  preferences.forEach((preference) => {
    if (tagSet.has(preference)) {
      score += 5;
    }
  });

  const optimizerWeights = {
    "bar-hop": ["nattliv", "öl", "vin", "cocktail"],
    "pizza-freak": ["mat"],
    "wine-crawl": ["vin", "mat", "kultur"],
    "cocktail-night": ["cocktail", "nattliv"],
    "church-crawl": ["kyrkor", "kultur"],
    "sunset-spots": ["utsikt", "kultur"],
  };

  (optimizerWeights[optimizerMode] || []).forEach((tag) => {
    if (tagSet.has(tag)) {
      score += 3;
    }
  });

  const modifierWeights = {
    evening: ["nattliv", "vin", "cocktail"],
    culture: ["kultur", "kyrkor"],
    low_key: ["vin", "kultur"],
    party: ["nattliv", "cocktail", "öl"],
  };

  (modifierWeights[modifier] || []).forEach((tag) => {
    if (tagSet.has(tag)) {
      score += 2;
    }
  });

  const spanDays = durationDays(event.start_date, event.end_date);
  if (spanDays !== null) {
    if (spanDays <= 4) {
      score += 3;
    } else if (spanDays <= 10) {
      score += 2;
    } else if (spanDays <= 30) {
      score += 1;
    }
  }

  if (event.buy_url) {
    score += 1;
  }

  if (/(birthday|anniversary|special|festival|premiere)/i.test(event.title)) {
    score += 1;
  }

  return {
    score,
    tags,
  };
}

function buildMatchReason(
  event,
  tags,
  { preferences = [], optimizerMode = null, modifier = null } = {},
) {
  const matchedPreferences = preferences.filter((preference) => tags.includes(preference));
  const reasonParts = [];

  if (matchedPreferences.length) {
    reasonParts.push(`Matchar extra bra för ${matchedPreferences.join(", ")}.`);
  }

  const spanDays = durationDays(event.start_date, event.end_date);
  if (spanDays !== null && spanDays <= 4) {
    reasonParts.push("Det här är ett kort livefönster under just de här dagarna.");
  }

  if (optimizerMode && tags.length) {
    const optimizerCopy = {
      "bar-hop": "bar-hop",
      "pizza-freak": "pizza freak",
      "wine-crawl": "wine crawl",
      "cocktail-night": "cocktail night",
      "church-crawl": "church crawl",
      "sunset-spots": "sunset spots",
    };

    if (optimizerCopy[optimizerMode]) {
      reasonParts.push(`Passar ovanligt fint ihop med ditt läge ${optimizerCopy[optimizerMode]}.`);
    }
  }

  const modifierCopy = {
    evening: "mer kväll",
    culture: "mer kultur",
    low_key: "mer low-key",
    party: "mer party",
  };

  if (modifier && modifierCopy[modifier]) {
    reasonParts.push(`Det här eventet väger upp extra bra när du valt ${modifierCopy[modifier]}.`);
  }

  if (!reasonParts.length && event.buy_url) {
    reasonParts.push("Går att göra konkret direkt eftersom officiell biljettlänk finns.");
  }

  if (!reasonParts.length) {
    reasonParts.push("Bra som bonuslager ovanpå rutten om du vill väva in något officiellt samma dag.");
  }

  return reasonParts.join(" ");
}

function parseLiveEventBlocks(html) {
  return html
    .split(/<div class="views-row\b/i)
    .slice(1)
    .map((block) => {
      const relativeUrl = extract(
        block,
        /<div class="news_titolo"[\s\S]*?<a href="([^"]+)">[\s\S]*?<\/a>/i,
      );
      const title = stripTags(
        extract(
          block,
          /<div class="news_titolo"[\s\S]*?<a href="[^"]+">([\s\S]*?)<\/a>/i,
        ),
      );

      if (!relativeUrl || !title) {
        return null;
      }

      const start_date = parseIsoDate(
        stripTags(extract(block, /class="date-display-start">([\s\S]*?)<\/span>/i)),
      );
      const end_date =
        parseIsoDate(
          stripTags(extract(block, /class="date-display-end">([\s\S]*?)<\/span>/i)),
        ) || start_date;

      const type = stripTags(
        extract(block, /<div class="news_tipo">[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/i),
      );
      const venue = stripTags(
        extract(
          block,
          /<div class="news_sedi">[\s\S]*?<div class="field-content">([\s\S]*?)<\/div>\s*<\/div>/i,
        ),
      );
      const address = stripTags(extract(block, /<div class="news_indirizzo">([\s\S]*?)<\/div>/i));
      const summary = stripTags(
        extract(block, /<div class="news_text">[\s\S]*?<div class="field-content">([\s\S]*?)<\/div><\/div>/i),
      );
      const buy_url = toAbsoluteUrl(
        extract(block, /class="news_button_acquista" href="([^"]+)"/i),
      );
      const image_url = toAbsoluteUrl(
        extract(block, /<div class="news_image">[\s\S]*?<img [^>]*src="([^"]+)"/i),
      );

      return {
        id: relativeUrl.replace(/^\/+/, "").replace(/[^\w-]+/g, "-").toLowerCase(),
        title,
        url: toAbsoluteUrl(relativeUrl),
        start_date,
        end_date,
        type: type || "Event",
        venue: venue || "Event venue",
        address: address || "",
        summary,
        buy_url,
        image_url,
        source_label: "Turismo Roma",
      };
    })
    .filter(Boolean);
}

function overlapsDate(event, date) {
  if (!event.start_date && !event.end_date) {
    return false;
  }

  const startDate = event.start_date || event.end_date;
  const endDate = event.end_date || event.start_date;

  return date >= startDate && date <= endDate;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => normalizeWhitespace(value)))];
}

function buildEventLocationQueries(event) {
  const venue = normalizeWhitespace(event.venue);
  const address = normalizeWhitespace(event.address);
  const title = normalizeWhitespace(event.title);

  return uniqueStrings([
    venue && address ? `${venue}, ${address}, Rome, Italy` : null,
    venue ? `${venue}, Rome, Italy` : null,
    address ? `${address}, Rome, Italy` : null,
    venue && address ? `${address}, ${venue}, Rome, Italy` : null,
    title && venue ? `${title}, ${venue}, Rome, Italy` : null,
    title ? `${title}, Rome, Italy` : null,
  ]);
}

async function geocodeEventLocation(event, geocodeQuery = getLegacyGeocodeQuery()) {
  const queries = buildEventLocationQueries(event);
  const cacheKey = queries.join(" | ").toLowerCase();

  if (!cacheKey) {
    return null;
  }

  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  if (geocodeInFlight.has(cacheKey)) {
    return geocodeInFlight.get(cacheKey);
  }

  const lookup = (async () => {
    for (const query of queries) {
      try {
        const candidates = await geocodeQuery(query);
        const candidate = candidates.find(
          (item) => typeof item.lat === "number" && typeof item.lng === "number",
        );

        if (candidate) {
          const result = {
            lat: candidate.lat,
            lng: candidate.lng,
            geocode_label: candidate.label,
            geocode_source: candidate.source || "geocoding",
          };
          geocodeCache.set(cacheKey, result);
          return result;
        }
      } catch (_error) {
        // Try next query variant before giving up.
      }
    }

    geocodeCache.set(cacheKey, null);
    return null;
  })().finally(() => {
    geocodeInFlight.delete(cacheKey);
  });

  geocodeInFlight.set(cacheKey, lookup);
  return lookup;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "RomaRadar/1.0 (live-events)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Live events failed with status ${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function dedupeEvents(events) {
  return [...new Map(events.map((event) => [event.url || event.id, event])).values()];
}

async function loadAllLiveEvents() {
  if (cache.items.length && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.items;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = (async () => {
    try {
      const firstPageHtml = await fetchText(ROMA_LIVE_URL);
      const pageCount = parsePageCount(firstPageHtml);
      const extraPageIndexes = Array.from({ length: pageCount - 1 }, (_unused, index) => index + 1);
      const settledPages = await Promise.allSettled(
        extraPageIndexes.map((pageIndex) => fetchText(`${ROMA_LIVE_URL}?page=${pageIndex}`)),
      );

      const allHtml = [
        firstPageHtml,
        ...settledPages
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value),
      ];

      const items = dedupeEvents(
        allHtml.flatMap((html) => parseLiveEventBlocks(html)).filter((event) => event.start_date),
      );

      if (items.length) {
        cache = {
          fetchedAt: Date.now(),
          items,
        };
      }

      return cache.items;
    } catch (error) {
      if (cache.items.length) {
        return cache.items;
      }

      throw error;
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
    const geocodeQuery = context.geocodeQuery || getLegacyGeocodeQuery();
    const events = await loadAllLiveEvents();
    const usedEventIds = new Set();
    const byDate = {};

    for (const date of dates) {
      const ranked = events
        .filter((event) => overlapsDate(event, date))
        .map((event) => {
          const scoring = scoreLiveEvent(event, context);
          const reusedPenalty = usedEventIds.has(event.id) ? -4 : 0;

          return {
            event,
            score: scoring.score + reusedPenalty,
            tags: scoring.tags,
          };
        })
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }

          const leftDuration = durationDays(left.event.start_date, left.event.end_date) ?? 9999;
          const rightDuration = durationDays(right.event.start_date, right.event.end_date) ?? 9999;
          if (leftDuration !== rightDuration) {
            return leftDuration - rightDuration;
          }

          return left.event.title.localeCompare(right.event.title);
        })
        .slice(0, 3)
        .map((entry) => {
          usedEventIds.add(entry.event.id);
          return entry;
        });

      byDate[date] = await Promise.all(
        ranked.map(async (entry) => {
          const location = await geocodeEventLocation(entry.event, geocodeQuery);

          return {
            ...entry.event,
            lat: location?.lat ?? null,
            lng: location?.lng ?? null,
            geocode_label: location?.geocode_label ?? null,
            geocode_source: location?.geocode_source ?? null,
            match_tags: entry.tags,
            match_reason: buildMatchReason(entry.event, entry.tags, context),
          };
        }),
      );
    }

    return byDate;
  } catch (_error) {
    return Object.fromEntries(dates.map((date) => [date, []]));
  }
}

function resetLiveEventsCache() {
  cache = {
    fetchedAt: 0,
    items: [],
  };
  inFlight = null;
  geocodeCache = new Map();
  geocodeInFlight = new Map();
  legacyGeocodeQuery = null;
}

module.exports = {
  fetchLiveEventsForDates,
  parseLiveEventBlocks,
  scoreLiveEvent,
  resetLiveEventsCache,
};
