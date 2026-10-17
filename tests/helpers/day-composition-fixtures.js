'use strict';
const { composeAgnosticRouteOutput } = require('../../server/planner/agnostic-route-output');

const anchor = { lat: 55.6, lng: 13 };
function record(id, type, index = 0, extra = {}) {
  return {
    id, name: id, type, lat: anchor.lat + index * 0.00015, lng: anchor.lng,
    tags: [],
    sources: [
      { provider: 'osm', family: 'map', tier: 'inferred', url: `https://www.openstreetmap.org/node/${id}` },
      { provider: 'wikidata', family: 'open_knowledge', tier: 'inferred', url: `https://www.wikidata.org/wiki/${id}` },
    ],
    ...extra,
  };
}
function rows(prefix, type, count = 6, offset = 0) {
  return Array.from({ length: count }, (_, index) => record(`${prefix}-${index}`, type, index + offset));
}
async function compose(records, preferences, options = {}) {
  const output = await composeAgnosticRouteOutput({
    coords: anchor, baselineResult: { days: [] }, externalRequested: true,
    openDataLoader: async () => structuredClone(records),
    date: '2026-10-22', todayIsoDate: '2026-10-16',
    trustedTimezone: 'Europe/Stockholm', timezone: 'Europe/Stockholm',
    clock: () => new Date('2026-10-16T08:00:00Z'),
    weatherProvider: async () => ({ condition: 'sun', source: 'controlled', stale: false }),
    synthesizeVia: 'engine', distanceMode: 'no_limit', dayRhythm: 'full',
    preferences, ...options,
  });
  const route = output.result.days[0]?.primary_route;
  return { ...output, route, stops: route?.main_stops || [] };
}
module.exports = { anchor, record, rows, compose };
