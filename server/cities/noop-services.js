function createNoopLiveEventsService() {
  return async function fetchLiveEventsForDates(dates = []) {
    return (dates || []).reduce((accumulator, date) => {
      accumulator[date] = [];
      return accumulator;
    }, {});
  };
}

function createNoopEditorialService(options = {}) {
  const cityLabel = options.cityLabel || "Staden";

  function getCopy(lang) {
    if (String(lang || "").toLowerCase() === "en") {
      return {
        headline: `${cityLabel} city-core is active`,
        subhead: `Curated ${cityLabel} Pulse is not ready yet.`,
        note: "No local editorial layer is shown until this city has a real citypack.",
        footer: "Preview/noop state: city identity is active, curated content comes later.",
      };
    }

    return {
      headline: `${cityLabel} city-core är aktivt`,
      subhead: `Kuraterad Pulse för ${cityLabel} är inte redo än.`,
      note: "Inget lokalt editorial-lager visas förrän staden har ett riktigt citypack.",
      footer: "Preview/noop-läge: city-identiteten är aktiv, kuraterat innehåll kommer senare.",
    };
  }

  return {
    getCityPulse(dateString, context = {}) {
      const copy = getCopy(context.lang);

      return {
        date: dateString || null,
        weekday_label: null,
        date_label: null,
        headline: copy.headline,
        subhead: copy.subhead,
        note: copy.note,
        footer_note: copy.footer,
        items: [],
        moments: [],
        official_events: [],
        wildcards: [],
      };
    },
    getDateSignals() {
      return [];
    },
  };
}

module.exports = {
  createNoopLiveEventsService,
  createNoopEditorialService,
};
