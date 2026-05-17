const sourceOwnedFields = [
  "title",
  "venue",
  "address",
  "start_date",
  "end_date",
  "source_url",
  "provider_category",
  "source_language",
  "raw_summary",
];

const parrandaOwnedFields = [
  "route_fit",
  "tags_intents",
  "why_it_matters",
  "match_reason",
  "pulse_wrapper_prose",
  "editorial_grouping",
];

const liveSources = [
  {
    id: "barcelona-open-data-agenda",
    sourceType: "official_open_data",
    sourceUrl: "https://opendata-ajuntament.barcelona.cat/data/en/dataset/agenda-diaria",
    status: "active",
    supportedLanguages: ["ca", "es", "en"],
    updateCadence: "daily",
    sourceOwnedFields,
    parrandaOwnedFields,
    qualityFlags: ["official_city_source", "broad_feed", "needs_quality_filter"],
    parsingRisk: "medium",
    intendedUse: "live",
  },
  {
    id: "generalitat-agenda-cultural",
    sourceType: "official_culture_agenda",
    sourceUrl: "https://agenda.cultura.gencat.cat/",
    status: "candidate",
    supportedLanguages: ["ca", "es"],
    updateCadence: "daily",
    sourceOwnedFields,
    parrandaOwnedFields,
    qualityFlags: ["official_regional_source", "needs_barcelona_filter"],
    parsingRisk: "medium",
    intendedUse: "live",
  },
];

const pulseSources = [
  {
    id: "mercats-barcelona",
    sourceType: "official_market_site",
    sourceUrl: "https://ajuntament.barcelona.cat/mercats/ca",
    status: "candidate",
    supportedLanguages: ["ca", "es"],
    updateCadence: "weekly",
    sourceOwnedFields,
    parrandaOwnedFields,
    qualityFlags: ["market_rhythm", "needs_exact_activity_endpoint"],
    parsingRisk: "review-needed",
    intendedUse: "pulse",
  },
  {
    id: "centres-civics-barcelona",
    sourceType: "official_civic_culture_site",
    sourceUrl: "https://www.barcelona.cat/centrescivics/ca",
    status: "candidate",
    supportedLanguages: ["ca", "es"],
    updateCadence: "weekly",
    sourceOwnedFields,
    parrandaOwnedFields,
    qualityFlags: ["neighborhood_culture", "needs_signal_filter"],
    parsingRisk: "review-needed",
    intendedUse: "pulse",
  },
  {
    id: "barcelona-venue-calendars-review",
    sourceType: "venue_calendar_review_set",
    sourceUrl: "https://www.salarazzmatazz.com/en/agenda",
    status: "candidate",
    supportedLanguages: ["ca", "es", "en"],
    updateCadence: "weekly",
    sourceOwnedFields,
    parrandaOwnedFields,
    qualityFlags: ["venue_programming", "fragmented_sources", "manual_review_first"],
    parsingRisk: "high",
    intendedUse: "both",
  },
];

module.exports = {
  liveSources,
  pulseSources,
};
