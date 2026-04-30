const { fetchLiveEventsForDates: fetchRomeLiveEvents } = require("../../live-events");
const { geocodeQuery } = require("./geocoding");

module.exports = {
  fetchLiveEventsForDates(dates, context = {}) {
    return fetchRomeLiveEvents(dates, {
      ...context,
      geocodeQuery,
    });
  },
};
