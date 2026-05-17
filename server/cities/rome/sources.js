const liveSources = [
  {
    id: "turismo-roma-live",
    sourceType: "official_city_live_html",
    sourceUrl: "https://www.turismoroma.it/en/romalive",
    status: "active",
    supportedLanguages: ["en"],
    updateCadence: "daily",
    sourceOwnedFields: [
      "title",
      "venue",
      "address",
      "start_date",
      "end_date",
      "source_url",
      "provider_category",
      "source_language",
      "raw_summary",
    ],
    parrandaOwnedFields: [
      "route_fit",
      "tags_intents",
      "match_reason",
      "pulse_wrapper_prose",
    ],
    qualityFlags: ["official_city_source", "rome_scoped", "html_parser"],
    parsingRisk: "medium",
    intendedUse: "live",
  },
];

module.exports = {
  liveSources,
  pulseSources: [],
};
