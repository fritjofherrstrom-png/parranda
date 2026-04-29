const express = require("express");
const path = require("path");
const { getCityConfig, normalizeCityKey } = require("./cities");
const { generateRecommendations } = require("./route-engine");
const { diversifyRecommendationDays } = require("./route-diversity");

const pulseVibeByTag = {
  kultur: "curious",
  kyrkor: "curious",
  "hidden gems": "curious",
  nattliv: "buzzy",
  cocktail: "buzzy",
  öl: "buzzy",
  vin: "romantic",
  utsikt: "romantic",
  mat: "slow",
};

function getCitySearchLabel(cityConfig) {
  return cityConfig?.searchLabel || cityConfig?.label || "Rome";
}

function buildExternalSearchUrl(label, cityConfig) {
  return `https://www.google.com/search?q=${encodeURIComponent(
    `${label} ${getCitySearchLabel(cityConfig)}`,
  )}`;
}

function buildExternalMapUrl(label, cityConfig) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${label} ${getCitySearchLabel(cityConfig)}`,
  )}`;
}

function buildOfficialPulseWhen(event, date) {
  if (event.start_date && event.end_date && event.start_date === event.end_date) {
    return event.start_date === date ? "I dag" : event.start_date;
  }

  if (event.start_date === date) {
    return "Börjar i dag";
  }

  if (event.end_date === date) {
    return "Pågår i dag";
  }

  return event.start_date || event.end_date || "Just nu";
}

function buildOfficialPulseItem(event, date, cityConfig) {
  const where =
    [event.venue, event.address].filter(Boolean).join(" • ") ||
    cityConfig?.editorialAreaLabel ||
    cityConfig?.label ||
    "Rom";
  const matchesVibes = [...new Set((event.match_tags || []).map((tag) => pulseVibeByTag[tag]).filter(Boolean))];

  return {
    id: `official-${event.id}`,
    level: "venue",
    kind: "Officiellt live",
    title: event.title,
    where,
    when: buildOfficialPulseWhen(event, date),
    blurb:
      event.summary ||
      `Officiellt live-event i ${cityConfig?.label || "Rom"} som kan ge dagen ett mer tidsbundet lager.`,
    why_it_matters:
      event.match_reason ||
      "Bra som live-bonus när du vill väva in något som faktiskt bara händer just nu.",
    matches_vibes: matchesVibes,
    official_event_id: event.id,
    lat: typeof event.lat === "number" ? event.lat : null,
    lng: typeof event.lng === "number" ? event.lng : null,
    priority: 6,
  };
}

function buildApp() {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.resolve(__dirname, "..")));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/places/search", (request, response) => {
    const cityConfig = getCityConfig(request.query.city);
    const { allItems } = cityConfig.catalog;
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

    response.json({ city: cityConfig.key, items });
  });

  app.get("/api/place-details", (request, response) => {
    const cityConfig = getCityConfig(request.query.city);
    const { allItems, findItemByName } = cityConfig.catalog;
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
        city: cityConfig.key,
        item: {
          id: `editorial-${query.toLowerCase().replace(/\s+/g, "-")}`,
          label: query,
          type: "editorial mention",
          area: cityConfig.editorialAreaLabel || cityConfig.label || "Rom",
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
          external_search_url: buildExternalSearchUrl(query, cityConfig),
          external_map_url: buildExternalMapUrl(query, cityConfig),
        },
      });
      return;
    }

    response.json({
      city: cityConfig.key,
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
        external_search_url: buildExternalSearchUrl(found.name, cityConfig),
        external_map_url: buildExternalMapUrl(found.name, cityConfig),
      },
    });
  });

  app.get("/api/city-pulse", async (request, response) => {
    try {
      const cityConfig = getCityConfig(request.query.city);
      const date = String(request.query.date || "").trim() || cityConfig.todayIsoDate();
      const pulse = cityConfig.services.getCityPulse(date);
      const [liveEventsByDate, weatherByDate] = await Promise.all([
        cityConfig.services.fetchLiveEventsForDates([pulse.date], {}),
        cityConfig.services.fetchWeatherForDates([pulse.date], cityConfig.center).catch(() => ({})),
      ]);
      const officialEvents = (liveEventsByDate[pulse.date] || []).slice(0, 2);
      const officialPulseItems = officialEvents
        .slice(0, 1)
        .map((event) => buildOfficialPulseItem(event, pulse.date, cityConfig));

      response.json({
        city: cityConfig.key,
        ...pulse,
        items: [...(pulse.items || []), ...officialPulseItems],
        official_events: officialEvents,
        weather: weatherByDate[pulse.date] || null,
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
      const cityConfig = getCityConfig(request.body?.city);
      const candidates = await cityConfig.services.geocodeQuery(request.body?.query || "");
      response.json({ city: cityConfig.key, candidates });
    } catch (error) {
      response.status(502).json({
        error: "Geocoding failed",
        detail: error.message,
      });
    }
  });

  app.post("/api/route-recommendations", async (request, response) => {
    try {
      const city = normalizeCityKey(request.body?.city || "rome");
      const preferences = Array.isArray(request.body?.preferences)
        ? request.body.preferences
        : [];
      const payload = {
        city,
        dates: Array.isArray(request.body?.dates) ? request.body.dates : [],
        homeBase: request.body?.home_base,
        start: request.body?.start,
        end: request.body?.end,
        walkingKmTarget: Number(request.body?.walking_km_target || 8),
        legPacing: request.body?.leg_pacing || "balanced",
        preferences,
        optimizerMode: request.body?.optimizer_mode || null,
        distanceMode: request.body?.distance_mode || "soft_target",
        budgetTier: request.body?.budget_tier || "standard",
        modifier: request.body?.modifier || null,
      };

      const result = diversifyRecommendationDays(await generateRecommendations(payload));
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
