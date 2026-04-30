const { fetchWeatherForDates } = require("../../weather");

const ROME_TIMEZONE = "Europe/Rome";
const ROME_CENTER = { lat: 41.8933, lng: 12.4964 };

function fetchRomeWeatherForDates(dates, anchor = ROME_CENTER) {
  return fetchWeatherForDates(dates, anchor, {
    timezone: ROME_TIMEZONE,
  });
}

module.exports = {
  ROME_TIMEZONE,
  ROME_CENTER,
  fetchRomeWeatherForDates,
};
