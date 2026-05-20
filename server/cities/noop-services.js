const { translate } = require("../ui-i18n");

function createNoopLiveEventsService() {
  return async function fetchLiveEventsForDates(dates = []) {
    const safeDates = Array.isArray(dates) ? dates : [];

    return safeDates.reduce((accumulator, date) => {
      accumulator[date] = [];
      return accumulator;
    }, {});
  };
}

function createNoopEditorialService(options = {}) {
  const cityLabel = options.cityLabel || "Staden";

  return {
    getCityPulse(dateString, context = {}) {
      const lang = context.lang || "sv";

      return {
        date: dateString || null,
        weekday_label: null,
        date_label: null,
        headline: translate(lang, "pulse.emptyHardHeadline", { city: cityLabel }, cityLabel),
        subhead: translate(lang, "pulse.emptyHardSubhead", { city: cityLabel }, ""),
        note: null,
        footer_note: null,
        _noop: true,
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
