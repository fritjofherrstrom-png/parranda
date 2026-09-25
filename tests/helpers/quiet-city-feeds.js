/**
 * Deterministic, empty stand-ins for the live event feeds the registered
 * Barcelona and Athens configs wire into Pulse (Open Data BCN, City of Athens,
 * Megaron).
 *
 * Tests that build those cities' Pulse for another reason (weather, computed
 * rhythm) must not read the real feeds: their contents change daily, and they
 * are unreachable offline. These fixtures answer with healthy, empty payloads,
 * so the providers still run but stay quiet. Any other URL throws, so a new
 * live call fails loudly instead of reaching the network.
 */

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json; charset=UTF-8" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function htmlResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "text/html; charset=UTF-8" },
    text: async () => body,
  };
}

function quietCityFeedFetch() {
  return async (url) => {
    const href = String(url);
    if (href.startsWith("https://opendata-ajuntament.barcelona.cat/data/api/action/datastore_search_sql")) {
      return jsonResponse({ success: true, result: { records: [] } });
    }
    if (href.startsWith("https://www.cityofathens.gr/wp-json/tribe/events/v1/events")) {
      return jsonResponse({ events: [] });
    }
    if (href === "https://www.megaron.gr/en/events-2/calendar/") {
      return htmlResponse("<html><body></body></html>");
    }
    throw new Error(`Unexpected live network in a quiet-feed test: ${href}`);
  };
}

// Wraps a test body: `test(name, withQuietCityFeeds(async () => { ... }))`.
function withQuietCityFeeds(fn) {
  return async (...args) => {
    const originalFetch = global.fetch;
    global.fetch = quietCityFeedFetch();
    try {
      return await fn(...args);
    } finally {
      global.fetch = originalFetch;
    }
  };
}

module.exports = {
  withQuietCityFeeds,
};
