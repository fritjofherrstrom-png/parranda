const express = require("express");
const path = require("path");
const { allItems, findItemByName } = require("./catalog");
const { geocodeQuery } = require("./geocoding");
const { generateRecommendations } = require("./route-engine");
const { fetchLiveEventsForDates } = require("./live-events");
const { getCityPulse, getRomeTodayIsoDate } = require("./editorial-calendar");

function buildApp() {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, "..")));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/places/search", (request, response) => {
    const query = String(request.query.q || "").trim().toLowerCase();
    const items = allItems
      .filter((item) => {
        if (!query) {
          return true;
        }

        return (
          item.name.toLowerCase().includes(query) ||
          item.searchTerms.some((term) => term.toLowerCase().includes(query)) ||
          item.tags.some((tag) => tag.toLowerCase().includes(query))
        );
      })
      .slice(0, query ? 20 : 30)
      .map((item) => ({
        id: item.id,
        label: item.name,
        type: item.kind,
        area: item.area,
        lat: item.lat,
        lng: item.lng,
        tags: item.tags,
        vibe: item.vibe,
        price_level: item.priceLevel,
      }));

    response.json({ items });
  });

  app.get("/api/place-details", (request, response) => {
    const query = String(request.query.q || request.query.id || "").trim();

    if (!query) {
      response.status(400).json({ error: "Missing query" });
      return;
    }

    const found =
      findItemByName(query) ||
      allItems.find((item) => item.name.toLowerCase().includes(query.toLowerCase()));

    if (!found) {
      response.json({
        item: {
          id: `editorial-${query.toLowerCase().replace(/\s+/g, "-")}`,
          label: query,
          type: "editorial mention",
          area: "Rom",
          summary:
            "Det här är just nu en redaktionell mention i appen. Intern fullprofil saknas ännu, men du kan hoppa vidare till Google eller kartan.",
          vibe: "redaktionell bonusnotis",
          price_level: null,
          best_time: null,
          group_size: null,
          booking_required: false,
          opening_summary: null,
          long_description:
            "Vi har ännu inte byggt en full intern profil för den här mentionen, men den är med för att den hjälper dig att göra dagen bättre.",
          perfect_for: [],
          feature_notes: [],
          happy_hour_note: null,
          tags: [],
          external_search_url: `https://www.google.com/search?q=${encodeURIComponent(
            `${query} Rome`,
          )}`,
          external_map_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            `${query} Rome`,
          )}`,
        },
      });
      return;
    }

    response.json({
      item: {
        id: found.id,
        label: found.name,
        type: found.kind,
        area: found.area,
        lat: found.lat,
        lng: found.lng,
        summary: found.vibe,
        vibe: found.vibe,
        price_level: found.priceLevel,
        best_time: found.bestTime,
        group_size: found.groupSize,
        booking_required: found.bookingRequired,
        opening_summary: found.openingSummary,
        long_description: found.longDescription,
        perfect_for: found.perfectFor,
        feature_notes: found.featureNotes,
        happy_hour_note: found.happyHourNote,
        tags: found.tags,
        external_search_url: `https://www.google.com/search?q=${encodeURIComponent(
          `${found.name} Rome`,
        )}`,
        external_map_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${found.name} Rome`,
        )}`,
      },
    });
  });

  app.get("/api/city-pulse", async (request, response) => {
    try {
      const date = String(request.query.date || "").trim() || getRomeTodayIsoDate();
      const pulse = getCityPulse(date);
      const liveEventsByDate = await fetchLiveEventsForDates([pulse.date], {});

      response.json({
        ...pulse,
        official_events: (liveEventsByDate[pulse.date] || []).slice(0, 2),
      });
    } catch (error) {
      response.status(500).json({
        error: "City pulse failed",
        detail: error.message,
      });
    }
  });

  app.post("/api/geocode", async (request, response) => {
    try {
      const candidates = await geocodeQuery(request.body?.query || "");
      response.json({ candidates });
    } catch (error) {
      response.status(502).json({
        error: "Geocoding failed",
        detail: error.message,
      });
    }
  });

  app.post("/api/route-recommendations", async (request, response) => {
    try {
      const preferences = Array.isArray(request.body?.preferences)
        ? request.body.preferences
        : [];
      const payload = {
        dates: Array.isArray(request.body?.dates) ? request.body.dates : [],
        start: request.body?.start,
        end: request.body?.end,
        walkingKmTarget: Number(request.body?.walking_km_target || 8),
        preferences,
        optimizerMode: request.body?.optimizer_mode || null,
        distanceMode: request.body?.distance_mode || "soft_target",
        budgetTier: request.body?.budget_tier || "standard",
        modifier: request.body?.modifier || null,
      };

      const result = await generateRecommendations(payload);
      response.json(result);
    } catch (error) {
      response.status(500).json({
        error: "Route recommendation failed",
        detail: error.message,
      });
    }
  });

  app.use((request, response) => {
    if (request.path.startsWith("/api/")) {
      response.status(404).json({ error: "Not found" });
      return;
    }

    response.sendFile(path.resolve(__dirname, "..", "index.html"));
  });

  return app;
}

module.exports = {
  buildApp,
};
