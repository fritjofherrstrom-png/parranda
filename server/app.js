const fs = require("node:fs");
const express = require("express");
const path = require("path");
const { resolveCityConfig } = require("./cities");
const { buildBlitzDecision } = require("./blitz-engine");
const { generateRecommendations } = require("./route-engine");
const { diversifyRecommendationDays } = require("./route-diversity");

const appRoot = path.resolve(__dirname, "..");
const appShellTemplate = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");

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

function humanizeCityKey(cityKey) {
  const normalized = String(cityKey || "").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.toLowerCase() === "rome") {
    return "Rom";
  }

  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function resolveRequestCity(city) {
  const resolution = resolveCityConfig(city);

  return {
    cityConfig: resolution.cityConfig,
    requestedCity: resolution.requestedKey,
    cityFallbackUsed: resolution.fallbackUsed,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serializeInlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const supportedLanguages = new Set(["sv", "en"]);

function normalizeLanguage(value) {
  const lang = String(value || "").trim().toLowerCase().split("-")[0];
  return supportedLanguages.has(lang) ? lang : "sv";
}

const shellHtmlTranslations = {
  en: [
    ["PLANERA", "PLAN"],
    ["Bas", "Base"],
    ["Tempo", "Pace"],
    ["Känsla", "Mood"],
    ["Jag vill styra själv", "Manual controls"],
    ["Senaste plan", "Latest plan"],
    ["Fortsätt med senaste plan", "Continue latest plan"],
    ["Inte nu", "Not now"],
    ["Blitz nästa drag", "Blitz next move"],
    ["Vald plats", "Selected place"],
    ["Min plats", "My location"],
    ["Kör Blitz", "Run Blitz"],
    ["Nytt förslag", "New idea"],
    ["Installera appen", "Install app"],
    ["Stadsdelar", "Districts"],
    ["Karta", "Map"],
    ["Passar din dag", "Near your route"],
    ["Laddar dagens live-lager...", "Loading today’s live layer..."],
    ["Se dagens live", "See today’s live"],
    ["§ PLANERARE", "§ PLANNER"],
    ["Planera dagen", "Plan the day"],
    [
      "Välj datum och känsla. Parranda kan välja start och slut åt dig, eller så styr du själv.",
      "Choose dates and mood. Parranda can choose start and end for you, or you can control them yourself.",
    ],
    ["Låt Parranda välja", "Let Parranda choose"],
    ["Snabbast: välj datum, känsla och eventuell plats där du bor.", "Fastest: choose dates, mood, and optionally where you’re staying."],
    ["Stäng", "Close"],
    ["DET VIKTIGASTE", "THE ESSENTIALS"],
    ["Parranda väljer start och slut", "Parranda chooses start and end"],
    [
      "Datum, känsla och gånglängd räcker. Lägg till hotell eller område bara om det hjälper.",
      "Dates, mood, and walking length are enough. Add a hotel or area only if it helps.",
    ],
    ["Från datum", "From date"],
    ["Till datum", "To date"],
    ["Avstånd", "Distance"],
    ["Ungefärlig längd", "Approximate length"],
    ["Spelar ingen roll", "Flexible"],
    ["Gånglängd i km", "Walking length in km"],
    ["Ungefärlig gånglängd. Parranda kan justera om dagen blir tydligt bättre.", "Approximate walking length. Parranda can adjust if it makes the day clearly better."],
    ["Vad vill du ha mer av längs vägen?", "What do you want more of along the way?"],
    ["Mat &amp; dryck", "Food &amp; drink"],
    ["Kultur", "Culture"],
    ["Utsikt", "Views"],
    ["Kvällsliv", "Nightlife"],
    ["Historia", "History"],
    ["Grönt &amp; promenad", "Green walks"],
    ["DÄR DU BOR", "WHERE YOU’RE STAYING"],
    [
      "Hotell eller område är valfritt. Parranda använder det som mjuk kontext,\n                          inte som exakt startpunkt.",
      "Hotel or area is optional. Parranda uses it as soft context,\n                          not as an exact starting point.",
    ],
    ["Valfritt", "Optional"],
    ["Hotell eller område", "Hotel or area"],
    ["Parranda väljer", "Parranda chooses"],
    ["Välj område", "Choose area"],
    ["Hotell/adress", "Hotel/address"],
    ["Lämna öppet om du vill att Parranda väljer en naturlig utgångspunkt själv.", "Leave it open if you want Parranda to choose a natural starting area."],
    ["Skriv hotell, adress eller område", "Enter hotel, address, or area"],
    ["t.ex. hotellet, Trastevere eller nära Termini", "e.g. your hotel, Trastevere, or near Termini"],
    ["Använd plats från kartan", "Use map place"],
    ["Använd min plats", "Use my location"],
    ["MANUELL START OCH SLUT", "MANUAL START AND END"],
    ["Använd bara om du vill låsa var dagen börjar eller slutar.", "Use only if you want to lock where the day starts or ends."],
    ["Parranda väljer start och slut om du lämnar detta öppet.", "Parranda chooses start and end if you leave this open."],
    ["STARTA HÄR", "START HERE"],
    ["Startpunkt", "Start point"],
    ["Egen plats", "Custom place"],
    ["Parranda väljer en smart öppning om du inte låser den själv.", "Parranda chooses a smart opening if you do not lock it yourself."],
    ["Välj startområde", "Choose start area"],
    ["Skriv startplats", "Enter start place"],
    ["t.ex. Piazza Trilussa eller Termini", "e.g. Piazza Trilussa or Termini"],
    ["SLUTA HÄR", "END HERE"],
    ["Slutpunkt", "End point"],
    ["Parranda väljer ett tydligt avslut om du inte låser slutpunkten.", "Parranda chooses a clear ending if you do not lock it yourself."],
    ["Välj slutområde", "Choose end area"],
    ["Skriv slutplats", "Enter end place"],
    ["t.ex. Piazza Navona eller Ostiense", "e.g. Piazza Navona or Ostiense"],
    ["Sätt kartplats som slut", "Set map place as end"],
    ["Prisnivå", "Price level"],
    ["Budgetsmart", "Budget smart"],
    ["Max promenad mellan stopp", "Max walk between stops"],
    ["Kort", "Short"],
    ["Balans", "Balanced"],
    ["Spelar mindre roll", "Flexible"],
    ["Balans håller benen rimliga utan att bli onödigt strikt.", "Balanced keeps walking reasonable without getting too strict."],
    ["Planera min dag", "Plan my day"],
    ["Nollställ val", "Reset choices"],
    ["Live-läget är inte tillgängligt just nu. Appen visar därför ett tydligt fallback-läge.", "Live mode is not available right now. The app is showing a clear fallback state."],
    ["JUST NU", "RIGHT NOW"],
    ["Aktuellt i staden", "Current in the city"],
    ["Aktuellt nära rutten eller i resten av staden, utan att ta över planeringen.", "Current signals near your route or around the city, without taking over the plan."],
    ["Staden • i dag", "City • today"],
    ["Laddar signaler...", "Loading signals..."],
    ["Väder", "Weather"],
    ["Väder laddas...", "Loading weather..."],
    ["Klädråd", "What to wear"],
    ["Parranda väger in temperatur och kvällsluft när editionen laddas.", "Parranda weighs temperature and evening air as the edition loads."],
    ["Var", "Where"],
    ["När", "When"],
    ["Nivå", "Level"],
    ["Dagens tidslinje", "Today’s timeline"],
    ["Tidslinje laddas...", "Loading timeline..."],
    ["LIVE är ett smart lager ovanpå planner-flödet, inte en separat startpunkt.", "LIVE is a smart layer on top of planning, not a separate starting point."],
    ["Dagens puls påverkar route plannern redan. Här kan du se varför.", "Today’s pulse already informs the planner. Here you can see why."],
    ["Hidden mentions", "Hidden mentions"],
    ["Barer du inte ska missa", "Bars not to miss"],
    ["Visa i appen", "Show in app"],
    ["Ren guide", "Clean guide"],
    ["Öppna dagens rutt", "Open today’s route"],
    ["Din huvudrutt", "Main route"],
    ["Rutt i ordning", "Route order"],
    ["Live som passar dagen", "Live that fits the day"],
    ["Visa alternativa upplägg", "Show alternatives"],
    ["Andra sätt att lägga upp samma dag", "Other ways to plan the same day"],
    ["Din dag", "Your day"],
    ["PARRANDA GUIDE", "PARRANDA GUIDE"],
    ["Varför den här rutten valdes", "Why this route was chosen"],
    ["Huvudrutt", "Main route"],
    ["Spara som PDF", "Save as PDF"],
    ["Dela guide", "Share guide"],
    ["Öppna gångrutt", "Open walking route"],
    ["PLATSINFO", "PLACE INFO"],
    ["Visa på kartan i appen", "Show on map in app"],
    ["Sätt som start", "Set as start"],
    ["Sätt som mål", "Set as end"],
    ["Planera härifrån", "Plan from here"],
    ["Google-info", "Google info"],
  ],
};

function applyShellHtmlTranslations(html, lang) {
  if (lang !== "en") {
    return html;
  }

  return shellHtmlTranslations.en.reduce(
    (nextHtml, [source, target]) => nextHtml.split(source).join(target),
    html,
  );
}

function resolveShellMode(cityConfig, cityFallbackUsed) {
  if (cityConfig?.visibility === "internal") {
    return "internal-preview";
  }

  if (cityFallbackUsed) {
    return "fallback-preview";
  }

  return "curated-public";
}

function buildShellCopy(shellMode, options = {}) {
  const cityLabel = options.displayLabel || "Staden";
  const lang = normalizeLanguage(options.lang);

  if (shellMode === "fallback-preview") {
    if (lang === "en") {
      return {
        brandSubtitle: "City preview with honest fallback",
        eyebrow: `${cityLabel.toLocaleUpperCase("en-US")} · PREVIEW`,
        heroHeadline: `${cityLabel} is still being prepared.`,
        heroLead: "Parranda shows an honest preview until this city has its own curated pack.",
        heroLiveLabel: "Pulse",
        plannerTitle: "Planner preview",
        plannerSummary: `${cityLabel} does not have its own planner mode yet. Parranda shows an honest shell and waits for curated content until the city is truly supported.`,
        plannerCtaLabel: "See planner preview",
        plannerMicrocopy: "Curated content comes later.",
        wildcardLabel: "CITY STATUS",
        wildcardTitle: `${cityLabel} is still being prepared`,
        wildcardSummary:
          "Parranda shows the shell and city-core foundation, without mixing in Rome districts or fallback ideas as if this city were already curated.",
        wildcardMeta: "No public city launch yet.",
        wildcardTag1: cityLabel,
        wildcardTag2: "Preparing",
        wildcardTag3: "Neutral shell",
        wildcardActionsHidden: "hidden",
      };
    }

    return {
      brandSubtitle: "City preview med ärlig fallback",
      eyebrow: `${cityLabel.toLocaleUpperCase("sv-SE")} · PREVIEW`,
      heroHeadline: `${cityLabel} förbereds fortfarande.`,
      heroLead: "Parranda visar ett ärligt preview-läge tills staden har ett eget kuraterat pack.",
      heroLiveLabel: "Pulse",
      plannerTitle: "Planner-preview",
      plannerSummary: `${cityLabel} har ännu inte ett eget planner-läge. Parranda visar därför en ärlig shell och väntar med kuraterat innehåll tills staden stöds på riktigt.`,
      plannerCtaLabel: "Se planner-preview",
      plannerMicrocopy: "Curated innehåll kommer senare.",
      wildcardLabel: "CITY-STATUS",
      wildcardTitle: `${cityLabel} förbereds fortfarande`,
      wildcardSummary:
        "Parranda visar shellen och city-core-grunden, men blandar inte in Rome-kvarter eller fallback-idéer som om staden redan vore kurerad.",
      wildcardMeta: "Ingen publik city-lansering än.",
      wildcardTag1: cityLabel,
      wildcardTag2: "Förbereds",
      wildcardTag3: "Neutral shell",
      wildcardActionsHidden: "hidden",
    };
  }

  if (shellMode === "internal-preview") {
    if (lang === "en") {
      return {
        brandSubtitle: "Internal city-core preview",
        eyebrow: `${cityLabel.toLocaleUpperCase("en-US")} · INTERNAL PREVIEW`,
        heroHeadline: `${cityLabel} is running in preview.`,
        heroLead: "Planner, shell, and city-core can be tested here without Rome-curated layers.",
        heroLiveLabel: "Pulse",
        plannerTitle: "Internal planner preview",
        plannerSummary: `${cityLabel} is an internal preview. Planner and city-core can be tested, while curated districts and wildcard ideas are intentionally off here.`,
        plannerCtaLabel: "Open preview",
        plannerMicrocopy: "Internal verification, not a public city.",
        wildcardLabel: "INTERNAL STUB",
        wildcardTitle: `${cityLabel} is running in preview`,
        wildcardSummary:
          "This mode proves that a second city can live on city-core without importing Rome modules or Rome fallback.",
        wildcardMeta: "Internal verification • not a product city.",
        wildcardTag1: cityLabel,
        wildcardTag2: "Internal",
        wildcardTag3: "City-core",
        wildcardActionsHidden: "hidden",
      };
    }

    return {
      brandSubtitle: "Intern city-core-preview",
      eyebrow: `${cityLabel.toLocaleUpperCase("sv-SE")} · INTERN PREVIEW`,
      heroHeadline: `${cityLabel} kör i preview.`,
      heroLead: "Planner, shell och city-core går att prova här utan Rome-curated lager.",
      heroLiveLabel: "Pulse",
      plannerTitle: "Intern planner-preview",
      plannerSummary: `${cityLabel} är en intern preview. Planner och city-core går att testa, men kuraterade kvarter och wildcard-idéer är avsiktligt avstängda här.`,
      plannerCtaLabel: "Öppna preview",
      plannerMicrocopy: "Intern verifiering, inte publik stad.",
      wildcardLabel: "INTERN STUB",
      wildcardTitle: `${cityLabel} kör i preview`,
      wildcardSummary:
        "Det här läget finns för att bevisa att en andra stad kan leva ovanpå city-core utan att importera Rome-moduler eller Rome-fallback.",
      wildcardMeta: "Intern verifiering • inte en produktstad.",
      wildcardTag1: cityLabel,
      wildcardTag2: "Intern",
      wildcardTag3: "City-core",
      wildcardActionsHidden: "hidden",
    };
  }

  if (lang === "en") {
    return {
      brandSubtitle: "Curated city days with more feeling than checklist",
      eyebrow: "",
      heroHeadline: "Plan the day.",
      heroLead: "Blitz is there when you are already out and just want the next move.",
      heroLiveLabel: "Pulse",
      plannerTitle: "Build a day in the city",
      plannerSummary: "Choose a date and mood. Parranda builds the route.",
      plannerCtaLabel: "Plan the day",
      plannerMicrocopy: "Keep it light or add more control in the next step.",
      wildcardLabel: "BLITZ",
      wildcardTitle: "Next move, right now",
      wildcardSummary: "Place, time, and today’s signals are weighed together.",
      wildcardMeta: "Place • time • today’s signals.",
      wildcardTag1: "Now",
      wildcardTag2: "Place",
      wildcardTag3: "Reroll",
      wildcardActionsHidden: "",
    };
  }

  return {
    brandSubtitle: "Kuraterade stadsdagar med mer känsla än kölista",
    eyebrow: "",
    heroHeadline: "Planera dagen.",
    heroLead: "Blitz finns när du redan är ute och bara vill veta nästa drag.",
    heroLiveLabel: "Pulse",
    plannerTitle: "Bygg en dag i staden",
    plannerSummary: "Välj datum och känsla. Parranda sätter ihop rutten.",
    plannerCtaLabel: "Planera dagen",
    plannerMicrocopy: "Håll det lätt eller styr mer i nästa steg.",
    wildcardLabel: "BLITZ",
    wildcardTitle: "Nästa drag, just nu",
    wildcardSummary: "Plats, tid och dagens signaler vägs in.",
    wildcardMeta: "Plats • tid • dagens signaler.",
    wildcardTag1: "Nu",
    wildcardTag2: "Plats",
    wildcardTag3: "Reroll",
    wildcardActionsHidden: "",
  };
}

function buildShellMeta(cityConfig, options = {}) {
  const cityLabel = options.displayLabel || cityConfig?.label || "Staden";
  const citySearchLabel = options.searchLabel || cityLabel || getCitySearchLabel(cityConfig);
  const lang = normalizeLanguage(options.lang);

  if (options.shellMode === "fallback-preview") {
    if (lang === "en") {
      return {
        title: `Parranda | ${cityLabel} preview`,
        metaDescription: `${cityLabel} is shown in preview while Parranda prepares the city’s own curated layer. Shell and city-core are in place; local content comes later.`,
        ogTitle: `Parranda | ${cityLabel} preview`,
        ogDescription: `${cityLabel} is a preview mode in Parranda. Shell and city-core are in place; curated content comes later.`,
        twitterTitle: `Parranda | ${cityLabel} preview`,
        twitterDescription: `${cityLabel} is shown in preview while Parranda prepares the city’s own curated layer.`,
        cityMapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${citySearchLabel} hidden gems`,
        )}`,
      };
    }

    return {
      title: `Parranda | ${cityLabel} preview`,
      metaDescription: `${cityLabel} visas i preview medan Parranda förbereder stadens eget curated-lager. Shell och city-core är på plats, men lokalt innehåll kommer senare.`,
      ogTitle: `Parranda | ${cityLabel} preview`,
      ogDescription: `${cityLabel} är ett preview-läge i Parranda. Shell och city-core är på plats, men curated innehåll kommer senare.`,
      twitterTitle: `Parranda | ${cityLabel} preview`,
      twitterDescription: `${cityLabel} visas i preview medan Parranda förbereder stadens eget curated-lager.`,
      cityMapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${citySearchLabel} hidden gems`,
      )}`,
    };
  }

  if (options.shellMode === "internal-preview") {
    if (lang === "en") {
      return {
        title: `Parranda | ${cityLabel} internal preview`,
        metaDescription: `${cityLabel} is an internal city-core preview for verifying shell, planner, and fallback behavior without Rome content.`,
        ogTitle: `Parranda | ${cityLabel} internal preview`,
        ogDescription: `${cityLabel} is an internal preview mode in Parranda for verifying city-core and planner without a public launch.`,
        twitterTitle: `Parranda | ${cityLabel} internal preview`,
        twitterDescription: `${cityLabel} is an internal city-core preview, not a public product city.`,
        cityMapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          `${citySearchLabel} hidden gems`,
        )}`,
      };
    }

    return {
      title: `Parranda | ${cityLabel} internal preview`,
      metaDescription: `${cityLabel} är en intern city-core-preview för att verifiera shell, planner och fallback-beteenden utan Rome-innehåll.`,
      ogTitle: `Parranda | ${cityLabel} internal preview`,
      ogDescription: `${cityLabel} är ett internt preview-läge i Parranda för att verifiera city-core och planner utan publik lansering.`,
      twitterTitle: `Parranda | ${cityLabel} internal preview`,
      twitterDescription: `${cityLabel} är en intern city-core-preview och inte en publik produktstad.`,
      cityMapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${citySearchLabel} hidden gems`,
      )}`,
    };
  }

  if (lang === "en") {
    return {
      title: `Parranda | Personal City Guide for ${cityLabel}`,
      metaDescription: `Parranda builds walkable, locally curated days in ${cityLabel} around place, taste, pace, and mood.`,
      ogTitle: `Parranda | Personal City Guide for ${cityLabel}`,
      ogDescription: `A personal city guide for ${cityLabel} with a planner, local routes, and days that feel more thoughtful than touristy.`,
      twitterTitle: `Parranda | Personal City Guide for ${cityLabel}`,
      twitterDescription: `Parranda builds walkable, locally curated days in ${cityLabel} around place, taste, pace, and mood.`,
      cityMapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${citySearchLabel} hidden gems`,
      )}`,
    };
  }

  return {
    title: `Parranda | Personlig City Guide för ${cityLabel}`,
    metaDescription: `Parranda bygger promenadvänliga och lokalt kuraterade dagar i ${cityLabel} utifrån plats, smak, tempo och stämning.`,
    ogTitle: `Parranda | Personlig City Guide för ${cityLabel}`,
    ogDescription: `En personlig city guide för ${cityLabel} med planner, lokala stråk och dagar som känns mer genomtänkta än turistiga.`,
    twitterTitle: `Parranda | Personlig City Guide för ${cityLabel}`,
    twitterDescription: `Parranda bygger promenadvänliga och lokalt kuraterade dagar i ${cityLabel} utifrån plats, smak, tempo och stämning.`,
    cityMapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${citySearchLabel} hidden gems`,
    )}`,
  };
}

function renderAppShell({ cityConfig, requestedCity, cityFallbackUsed, lang = "sv" }) {
  const uiLang = normalizeLanguage(lang);
  const requestedLabel = cityFallbackUsed ? humanizeCityKey(requestedCity) : "";
  const displayLabel = requestedLabel || cityConfig.label;
  const searchLabel = requestedLabel || getCitySearchLabel(cityConfig);
  const shellMode = resolveShellMode(cityConfig, cityFallbackUsed);
  const shellCopy = buildShellCopy(shellMode, {
    displayLabel,
    lang: uiLang,
  });
  const meta = buildShellMeta(cityConfig, {
    displayLabel,
    searchLabel,
    shellMode,
    lang: uiLang,
  });
  const bootstrap = {
    key: cityConfig.key,
    label: cityConfig.label,
    displayLabel,
    visibility: cityConfig.visibility || "public",
    timezone: cityConfig.timezone,
    locale: cityConfig.locale,
    currency: cityConfig.currency,
    searchLabel,
    requestedKey: requestedCity,
    fallbackUsed: cityFallbackUsed,
    lang: uiLang,
  };

  const replacements = {
    "__PARRANDA_LANG__": escapeHtml(uiLang),
    "__PARRANDA_UI_LANG__": escapeHtml(uiLang),
    "__PARRANDA_OG_LOCALE__": uiLang === "en" ? "en_US" : "sv_SE",
    "__PARRANDA_TITLE__": escapeHtml(meta.title),
    "__PARRANDA_META_DESCRIPTION__": escapeHtml(meta.metaDescription),
    "__PARRANDA_OG_TITLE__": escapeHtml(meta.ogTitle),
    "__PARRANDA_OG_DESCRIPTION__": escapeHtml(meta.ogDescription),
    "__PARRANDA_TWITTER_TITLE__": escapeHtml(meta.twitterTitle),
    "__PARRANDA_TWITTER_DESCRIPTION__": escapeHtml(meta.twitterDescription),
    "__PARRANDA_CITY_KEY__": escapeHtml(cityConfig.key),
    "__PARRANDA_CITY_LABEL__": escapeHtml(displayLabel),
    "__PARRANDA_CITY_MAP_URL__": escapeHtml(meta.cityMapUrl),
    "__PARRANDA_BRAND_SUBTITLE__": escapeHtml(shellCopy.brandSubtitle),
    "__PARRANDA_CITY_EYEBROW__": escapeHtml(shellCopy.eyebrow),
    "__PARRANDA_HERO_HEADLINE__": escapeHtml(shellCopy.heroHeadline),
    "__PARRANDA_HERO_LEAD__": escapeHtml(shellCopy.heroLead),
    "__PARRANDA_HERO_LIVE_LABEL__": escapeHtml(shellCopy.heroLiveLabel),
    "__PARRANDA_PLANNER_TITLE__": escapeHtml(shellCopy.plannerTitle),
    "__PARRANDA_PLANNER_SUMMARY__": escapeHtml(shellCopy.plannerSummary),
    "__PARRANDA_PLANNER_CTA_LABEL__": escapeHtml(shellCopy.plannerCtaLabel),
    "__PARRANDA_PLANNER_MICROCOPY__": escapeHtml(shellCopy.plannerMicrocopy),
    "__PARRANDA_WILDCARD_LABEL__": escapeHtml(shellCopy.wildcardLabel),
    "__PARRANDA_WILDCARD_TITLE__": escapeHtml(shellCopy.wildcardTitle),
    "__PARRANDA_WILDCARD_SUMMARY__": escapeHtml(shellCopy.wildcardSummary),
    "__PARRANDA_WILDCARD_META__": escapeHtml(shellCopy.wildcardMeta),
    "__PARRANDA_WILDCARD_TAG_1__": escapeHtml(shellCopy.wildcardTag1),
    "__PARRANDA_WILDCARD_TAG_2__": escapeHtml(shellCopy.wildcardTag2),
    "__PARRANDA_WILDCARD_TAG_3__": escapeHtml(shellCopy.wildcardTag3),
    "__PARRANDA_WILDCARD_ACTIONS_HIDDEN__": shellCopy.wildcardActionsHidden,
    "__PARRANDA_CITY_BOOTSTRAP__": serializeInlineJson(bootstrap),
  };

  const renderedShell = Object.entries(replacements).reduce(
    (html, [token, replacement]) => html.split(token).join(replacement),
    appShellTemplate,
  );

  return applyShellHtmlTranslations(renderedShell, uiLang);
}

function inferShellCity(request) {
  const pathSegments = String(request.path || "")
    .split("/")
    .filter(Boolean);
  const pathKey = pathSegments[0] && !pathSegments[0].includes(".") ? pathSegments[0] : null;

  return request.query?.city || pathKey || null;
}

function buildApp() {
  const app = express();

  app.use(express.json());
  app.get(["/", "/index.html"], (request, response) => {
    const cityResolution = {
      ...resolveRequestCity(inferShellCity(request)),
      lang: normalizeLanguage(request.query?.lang),
    };
    response.type("html").send(renderAppShell(cityResolution));
  });

  app.use(express.static(appRoot, { index: false }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/places/search", (request, response) => {
    const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.query.city);
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

    response.json({
      city: cityConfig.key,
      requested_city: requestedCity,
      city_fallback_used: cityFallbackUsed,
      items,
    });
  });

  app.get("/api/place-details", (request, response) => {
    const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.query.city);
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
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
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
      requested_city: requestedCity,
      city_fallback_used: cityFallbackUsed,
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
      const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.query.city);
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
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
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
      const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.body?.city);
      const candidates = await cityConfig.services.geocodeQuery(request.body?.query || "");
      response.json({
        city: cityConfig.key,
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
        candidates,
      });
    } catch (error) {
      response.status(502).json({
        error: "Geocoding failed",
        detail: error.message,
      });
    }
  });

  app.post("/api/route-recommendations", async (request, response) => {
    try {
      const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.body?.city);
      const city = cityConfig.key;
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
      response.json({
        ...result,
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
      });
    } catch (error) {
      response.status(500).json({
        error: "Route recommendation failed",
        detail: error.message,
      });
    }
  });

  app.post("/api/blitz", async (request, response) => {
    try {
      const { cityConfig, requestedCity, cityFallbackUsed } = resolveRequestCity(request.body?.city);
      const result = await buildBlitzDecision(cityConfig, {
        date: request.body?.date,
        now: request.body?.now,
        origin: request.body?.origin || request.body?.selected_origin || request.body?.start || null,
        mode: request.body?.mode || "auto",
        intent_keys: Array.isArray(request.body?.intent_keys) ? request.body.intent_keys : [],
        preferences: Array.isArray(request.body?.preferences) ? request.body.preferences : [],
        memory: request.body?.memory,
        previous_route: request.body?.previous_route,
      });

      response.json({
        ...result,
        requested_city: requestedCity,
        city_fallback_used: cityFallbackUsed,
      });
    } catch (error) {
      response.status(500).json({
        error: "Blitz failed",
        detail: error.message,
      });
    }
  });

  app.use((request, response) => {
    if (request.path.startsWith("/api/")) {
      response.status(404).json({ error: "Not found" });
      return;
    }

    const cityResolution = {
      ...resolveRequestCity(inferShellCity(request)),
      lang: normalizeLanguage(request.query?.lang),
    };
    response.type("html").send(renderAppShell(cityResolution));
  });

  return app;
}

module.exports = {
  buildApp,
};
