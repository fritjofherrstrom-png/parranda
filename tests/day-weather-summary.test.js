const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDayWeatherSummary } = require('../server/planner/day-weather-summary');

const DATE = '2026-10-29';
const WEATHER = { maxTemp: 11.6, rawCode: 95, source: 'open-meteo', fetched_at: '2026-10-29T10:00:00Z', stale: false };

test('a selected-day summary keeps the forecast high and distinguishes thunderstorms', () => {
  assert.deepEqual(buildDayWeatherSummary(WEATHER, DATE), {
    date: DATE, max_temp: 11.6, condition: 'thunderstorm', source: 'open-meteo',
    fetched_at: '2026-10-29T10:00:00Z', stale: false,
  });
});

test('ordinary weather, zero and negative forecast highs remain displayable', () => {
  for (const [rawCode, condition] of [[0,'sun'], [2,'partly_cloudy'], [3,'clouds'], [45,'fog'], [53,'rain'], [71,'snow'], [99,'thunderstorm']]) {
    assert.equal(buildDayWeatherSummary({ ...WEATHER, rawCode, maxTemp: 0 }, DATE).condition, condition);
  }
  assert.equal(buildDayWeatherSummary({ ...WEATHER, maxTemp: 0 }, DATE).max_temp, 0);
  assert.equal(buildDayWeatherSummary({ ...WEATHER, maxTemp: -8.2 }, DATE).max_temp, -8.2);
});

test('stale, missing, malformed or differently dated weather never becomes a fresh day summary', () => {
  for (const weather of [null, {}, { ...WEATHER, stale: true }, { ...WEATHER, maxTemp: null }, { ...WEATHER, maxTemp: '12' }, { ...WEATHER, date: '2026-10-30' }]) {
    assert.equal(buildDayWeatherSummary(weather, DATE), null);
  }
  assert.equal(buildDayWeatherSummary(WEATHER, '2026-02-30'), null);
});
