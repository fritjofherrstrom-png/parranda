'use strict';

const { isRealIsoDate } = require('./requested-dates');

/** A small selected-day forecast, separate from weather's composition signal. */
function buildDayWeatherSummary(weather, date) {
  if (!isRealIsoDate(date) || !weather || weather.stale || !Number.isFinite(weather.maxTemp)) return null;
  if (weather.date && weather.date !== date) return null;
  const code = weather.rawCode;
  let condition = null;
  if ([0, 1].includes(code)) condition = 'sun';
  else if (code === 2) condition = 'partly_cloudy';
  else if (code === 3) condition = 'clouds';
  else if ([45, 48].includes(code)) condition = 'fog';
  else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) condition = 'rain';
  else if ([71, 73, 75, 77, 85, 86].includes(code)) condition = 'snow';
  else if ([95, 96, 99].includes(code)) condition = 'thunderstorm';
  // Older trusted providers carry only the coarse condition. Do not guess a
  // raw-code-specific condition from a general weather explanation.
  else if (['sun', 'clouds', 'rain', 'mixed'].includes(weather.condition)) condition = weather.condition;
  return {
    date,
    max_temp: weather.maxTemp,
    condition,
    source: typeof weather.source === 'string' && weather.source.trim() ? weather.source.trim() : null,
    fetched_at: typeof weather.fetched_at === 'string' && Number.isFinite(Date.parse(weather.fetched_at)) ? weather.fetched_at : null,
    stale: false,
  };
}

module.exports = { buildDayWeatherSummary };
