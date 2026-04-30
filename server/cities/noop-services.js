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

  return {
    getCityPulse(dateString) {
      return {
        date: dateString || null,
        weekday_label: null,
        date_label: null,
        headline: `${cityLabel} just nu`,
        subhead: "Ingen lokal edition finns ännu för den här stub-staden.",
        note: "Neutral fallback tills staden får ett riktigt editorial-lager.",
        footer_note: null,
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
