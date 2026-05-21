/**
 * Live events generator — city-agnostic.
 *
 * Runs for every city that exposes a fetchLiveEventsForDates() adapter.
 * Reads context.events (already fetched by the engine) and emits
 * `live_event_nearby` RawSignals.
 *
 * Events that have already finished (end_date strictly before the city's
 * current date) are dropped. Future-dated events with start_date > today
 * are also skipped — the engine deals with one date at a time.
 *
 * The generator is conservative: max 2 events per call, sorted by feed
 * order (the city's normalizer is expected to apply quality scoring).
 */

const { normalizeLanguage } = require("../../ui-i18n");

const MAX_EVENTS_PER_PULSE = 2;

const EVENT_KIND_TAXONOMY = [
  ["music", { sv: "Konsert", en: "Concert" }],
  ["exhibition", { sv: "Utställning", en: "Exhibition" }],
  ["market", { sv: "Marknad", en: "Market" }],
  ["nattliv", { sv: "Nattliv", en: "Nightlife" }],
  ["mat", { sv: "Matevent", en: "Food event" }],
  ["civic", { sv: "Föreläsning", en: "Talk" }],
  ["family", { sv: "Familjeevent", en: "Family event" }],
  ["community", { sv: "Lokalt event", en: "Local event" }],
  ["kultur", { sv: "Kulturevent", en: "Cultural event" }],
];
const EVENT_KIND_GENERIC = { sv: "Liveevent", en: "Live event" };

const VIBE_BY_TAG = {
  kultur: "curious",
  kyrkor: "curious",
  "hidden gems": "curious",
  nattliv: "buzzy",
  cocktail: "buzzy",
  öl: "buzzy",
  vin: "romantic",
  utsikt: "romantic",
  mat: "slow",
};

function liveEventsGenerator(context) {
  const events = Array.isArray(context?.events) ? context.events : [];
  if (events.length === 0) return [];

  const todayIso = context.cityNow?.isoDate || context.date;
  const cityLabel = context.city?.label || "";
  const lang = normalizeLanguage(context.lang);
  const out = [];

  for (const event of events) {
    if (!event || !event.title) continue;
    if (eventHasFinished(event, todayIso)) continue;
    if (eventStartsAfterToday(event, todayIso)) continue;

    out.push(buildLiveEventSignal(event, context.date, cityLabel, lang));
    if (out.length >= MAX_EVENTS_PER_PULSE) break;
  }

  return out;
}

liveEventsGenerator.generatorId = "live-events";

function eventHasFinished(event, todayIso) {
  if (!todayIso) return false;
  const end = event.end_date || event.start_date;
  if (!end) return false;
  return String(end) < String(todayIso);
}

function eventStartsAfterToday(event, todayIso) {
  if (!todayIso) return false;
  const start = event.start_date;
  if (!start) return false;
  return String(start) > String(todayIso);
}

function buildLiveEventSignal(event, date, cityLabel, lang) {
  const where =
    [event.venue, event.address].filter(Boolean).join(" • ") ||
    cityLabel ||
    "";
  const matchesVibes = [
    ...new Set(
      (event.match_tags || []).map((tag) => VIBE_BY_TAG[tag]).filter(Boolean),
    ),
  ];

  return {
    id: `official-${event.id}`,
    type: "live_event_nearby",
    level: "venue",
    title: event.title,
    native_title: event.title,
    source_language: event.source_language || null,
    safe_headline: buildLiveEventSafeHeadline(event, cityLabel, lang),
    area: where,
    where,
    when: buildLiveEventWhen(event, date, lang),
    blurb: buildLiveEventBlurb(event, cityLabel, lang),
    reason: buildLiveEventReason(event, lang),
    why_it_matters: buildLiveEventReason(event, lang),
    kind: buildLiveEventKind(event, lang),
    kindLabel: deriveEventKindLabel(event, lang),
    matches_vibes: matchesVibes,
    official_event_id: event.id,
    lat: typeof event.lat === "number" ? event.lat : null,
    lng: typeof event.lng === "number" ? event.lng : null,
    score: 6,
    source: {
      kind: "live_feed",
      label: event.source_label || event.provider || null,
      url: event.source_url || event.url || undefined,
      id: event.source_id || event.provider || undefined,
    },
    trust_level: "official",
    freshness: "today",
  };
}

function buildLiveEventSafeHeadline(event, cityLabel, lang) {
  // A human, UI-language headline composed from kindLabel + venue/city.
  // Used by the masthead when the raw provider title is foreign-language
  // or too long to be a clean H1. Never includes the provider/source name
  // — that belongs in chip metadata, not in the page headline.
  const isEnglish = normalizeLanguage(lang) === "en";
  const kindLabel = deriveEventKindLabel(event, lang);
  const venue = (event?.venue || "").trim();
  const city = (cityLabel || "").trim();

  if (venue) {
    return isEnglish ? `${kindLabel} at ${venue}` : `${kindLabel} på ${venue}`;
  }
  if (city) {
    return isEnglish ? `${kindLabel} in ${city}` : `${kindLabel} i ${city}`;
  }
  return kindLabel;
}

function buildLiveEventWhen(event, date, lang) {
  const isEnglish = normalizeLanguage(lang) === "en";
  if (event.start_date && event.end_date && event.start_date === event.end_date) {
    return event.start_date === date ? (isEnglish ? "Today" : "I dag") : event.start_date;
  }
  if (event.start_date === date) {
    return isEnglish ? "Starts today" : "Börjar i dag";
  }
  if (event.end_date === date) {
    return isEnglish ? "Running today" : "Pågår i dag";
  }
  return event.start_date || event.end_date || (isEnglish ? "Right now" : "Just nu");
}

function buildLiveEventBlurb(event, cityLabel, lang) {
  const isEnglish = normalizeLanguage(lang) === "en";
  const summary = compactText(event.summary || event.raw_summary);
  const venue = event.venue || event.address || "";

  if (summary && !isEventSourceLanguageForeign(event, lang)) {
    return summary;
  }

  const kindLabel = deriveEventKindLabel(event, lang);
  if (venue) {
    return isEnglish
      ? `${kindLabel} at ${venue}.`
      : `${kindLabel} på ${venue}.`;
  }
  const sourceLabel =
    event.source_label || (isEnglish ? "an official source" : "en officiell källa");
  return isEnglish
    ? `${kindLabel} from ${sourceLabel} in ${cityLabel || "the city"}.`
    : `${kindLabel} från ${sourceLabel} i ${cityLabel || "staden"}.`;
}

function buildLiveEventReason(event, lang) {
  const isEnglish = normalizeLanguage(lang) === "en";
  const sourceLabel =
    event.source_label || (isEnglish ? "an official source" : "en officiell källa");
  return isEnglish
    ? `Official source signal from ${sourceLabel}. Useful when you want today’s plan to include something actually happening now.`
    : `Officiell källsignal från ${sourceLabel}. Bra när du vill att dagens plan ska kunna fånga något som faktiskt händer nu.`;
}

function buildLiveEventKind(event, lang) {
  const isEnglish = normalizeLanguage(lang) === "en";
  const sourceLabel = event.source_label || event.provider || "";
  const kindLabel = deriveEventKindLabel(event, lang);
  const primary = kindLabel || (isEnglish ? "Official live" : "Officiellt live");
  return [primary, sourceLabel].filter(Boolean).join(" · ");
}

function deriveEventKindLabel(event, lang) {
  const isEnglish = normalizeLanguage(lang) === "en";
  const tags = event?.match_tags || [];
  for (const [tag, labels] of EVENT_KIND_TAXONOMY) {
    if (tags.includes(tag)) {
      return isEnglish ? labels.en : labels.sv;
    }
  }
  return isEnglish ? EVENT_KIND_GENERIC.en : EVENT_KIND_GENERIC.sv;
}

function isEventSourceLanguageForeign(event, lang) {
  const sourceLang = (event?.source_language || "").toLowerCase();
  if (!sourceLang) return false;
  return sourceLang !== normalizeLanguage(lang);
}

function compactText(text, maxLength = 220) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, maxLength);
  const sentenceEnd = Math.max(
    clipped.lastIndexOf("."),
    clipped.lastIndexOf("!"),
    clipped.lastIndexOf("?"),
  );
  const boundary = sentenceEnd >= 80 ? sentenceEnd + 1 : clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > 80 ? boundary : maxLength).trim()}...`;
}

module.exports = liveEventsGenerator;
module.exports.deriveEventKindLabel = deriveEventKindLabel;
module.exports.VIBE_BY_TAG = VIBE_BY_TAG;
