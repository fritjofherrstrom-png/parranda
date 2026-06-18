(function () {
  "use strict";

  var Render = window.DogfoodRender;
  var rawI18n = window.__PARRANDA_I18N__ || {};
  var activeLang = window.__PARRANDA_LANGUAGE__ || rawI18n.fallbackLanguage || "en";
  var translations = rawI18n.translations || {};
  var i18n = {
    lang: activeLang,
    strings: Object.assign(
      {},
      translations[rawI18n.fallbackLanguage || "en"] || {},
      translations[activeLang] || {},
    ),
  };

  var copy = {
    en: {
      idle: "Enter a place to start the alpha flow.",
      loading: "Building an honest alpha day...",
      blocked: "Parranda could not build this day yet.",
      ready: "Alpha day built from source-backed signals.",
      thin: "Alpha day built, but coverage is thin.",
      routeHeading: "Experimental route",
      routeEmpty: "No route was produced. The blockers explain what is missing.",
      readinessHeading: "Readiness",
      sourcesHeading: "Sources and trust",
      contextHeading: "Weather, time and walking",
      blockersHeading: "Honest blockers",
      noBlockers: "No hard blockers were reported.",
      noSources: "No source-backed stops were selected.",
      noContext: "No weather or time context was available.",
      caveats: "Caveats",
      stops: "Stops",
      sourceBacked: "source-backed",
      experimental: "experimental",
      retry: "Try another place or add a more specific area.",
      placeMissing: "Add a place first.",
      requestFailed: "The alpha request failed safely. Try again in a moment.",
      walkingValidated: "Walking validation passed.",
      walkingHeuristic: "Walking is estimated heuristically.",
      weatherUsed: "Weather context shaped the selection.",
      timeUsed: "Local time shaped the selection.",
    },
    sv: {
      idle: "Skriv en plats för att starta alpha-flödet.",
      loading: "Bygger en ärlig alpha-dag...",
      blocked: "Parranda kunde inte bygga den här dagen ännu.",
      ready: "Alpha-dag byggd från källstödda signaler.",
      thin: "Alpha-dag byggd, men täckningen är tunn.",
      routeHeading: "Experimentell rutt",
      routeEmpty: "Ingen rutt kunde byggas. Blockers visar vad som saknas.",
      readinessHeading: "Readiness",
      sourcesHeading: "Källor och tillit",
      contextHeading: "Väder, tid och gång",
      blockersHeading: "Ärliga blockers",
      noBlockers: "Inga hårda blockers rapporterades.",
      noSources: "Inga källstödda stopp valdes.",
      noContext: "Ingen väder- eller tidskontext fanns tillgänglig.",
      caveats: "Caveats",
      stops: "Stopp",
      sourceBacked: "källstött",
      experimental: "experimentell",
      retry: "Prova en annan plats eller skriv ett mer specifikt område.",
      placeMissing: "Skriv en plats först.",
      requestFailed: "Alpha-anropet föll säkert. Försök igen om en stund.",
      walkingValidated: "Gångvalidering passerade.",
      walkingHeuristic: "Gången är heuristiskt uppskattad.",
      weatherUsed: "Väderkontext påverkade valet.",
      timeUsed: "Lokal tid påverkade valet.",
    },
  };

  function t(key) {
    return (copy[activeLang] && copy[activeLang][key]) || copy.en[key] || key;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function appendList(parent, className, items, renderItem) {
    var list = el("ul", className);
    items.forEach(function (item) {
      list.appendChild(renderItem(item));
    });
    parent.appendChild(list);
  }

  function normalizePlaceFromQuery() {
    var params = new URLSearchParams(window.location.search);
    return params.get("place") || window.__PARRANDA_ANYWHERE_PLACE__ || "";
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function buildPayload(place) {
    return {
      city: "anywhere-alpha",
      place: place,
      dates: [todayIso()],
      preferences: ["food", "coffee", "scenic"],
      walking_km_target: 7,
      distance_mode: "soft_target",
      include_external_candidates: 1,
    };
  }

  function setStatus(kind, message) {
    var node = $("anywhereStatus");
    if (!node) return;
    node.hidden = false;
    node.setAttribute("data-kind", kind || "info");
    clear(node);
    node.appendChild(el("p", "", message));
  }

  function buildI18n() {
    return {
      lang: activeLang,
      strings: i18n.strings || {},
    };
  }

  function renderReadiness(view) {
    var node = $("anywhereReadiness");
    clear(node);
    node.appendChild(el("h2", "", t("readinessHeading")));
    if (!view.calibration) {
      node.appendChild(el("p", "", t("routeEmpty")));
      return;
    }
    var badge = el("p", "anywhere-pill anywhere-pill--readiness");
    badge.textContent = [view.calibration.statusLabel, view.calibration.level].filter(Boolean).join(" · ");
    node.appendChild(badge);
    if (view.calibration.guide) node.appendChild(el("p", "", view.calibration.guide));
    if (view.calibration.summary) node.appendChild(el("p", "", view.calibration.summary));
    if (view.calibration.caps && view.calibration.caps.length) {
      node.appendChild(el("h3", "", t("caveats")));
      appendList(node, "anywhere-token-list", view.calibration.caps, function (cap) {
        return el("li", "", cap.caption);
      });
    }
  }

  function renderRoute(view) {
    var node = $("anywhereRoute");
    clear(node);
    node.appendChild(el("p", "anywhere-card__eyebrow", t("experimental")));
    node.appendChild(el("h2", "", t("routeHeading")));
    if (!view.route) {
      node.appendChild(el("p", "", t("routeEmpty")));
      node.appendChild(el("p", "anywhere-muted", t("retry")));
      return;
    }
    if (view.route.title) node.appendChild(el("h3", "anywhere-route-title", view.route.title));
    if (view.route.summary) node.appendChild(el("p", "", view.route.summary));
    var meta = el("div", "anywhere-route-meta");
    if (view.route.estimatedKm != null) meta.appendChild(el("span", "", view.route.estimatedKm + " km"));
    if (view.route.orderSource) meta.appendChild(el("span", "", view.route.orderSource));
    if (view.route.routingSource) meta.appendChild(el("span", "", view.route.routingSource));
    if (meta.childNodes.length) node.appendChild(meta);
    if (view.route.stops && view.route.stops.length) {
      node.appendChild(el("h3", "", t("stops")));
      appendList(node, "anywhere-stop-list", view.route.stops, function (stop, index) {
        var item = el("li", "anywhere-stop");
        item.appendChild(el("span", "anywhere-stop__num", index + 1));
        var body = el("span", "anywhere-stop__body");
        body.appendChild(el("strong", "", stop.label || stop.id || "Stop"));
        var detail = [stop.daypart, stop.role, stop.origin, stop.confidence].filter(Boolean).join(" · ");
        if (detail) body.appendChild(el("small", "", detail));
        item.appendChild(body);
        return item;
      });
    }
    if (view.route.caveats && view.route.caveats.length) {
      node.appendChild(el("h3", "", t("caveats")));
      appendList(node, "anywhere-token-list", view.route.caveats, function (caveat) {
        return el("li", "", caveat.caption);
      });
    }
  }

  function renderSources(view) {
    var node = $("anywhereSources");
    clear(node);
    node.appendChild(el("h2", "", t("sourcesHeading")));
    var stops = view.route && Array.isArray(view.route.stops) ? view.route.stops : [];
    var sourceStops = stops.filter(function (stop) {
      return stop.origin || stop.confidence;
    });
    if (!sourceStops.length) {
      node.appendChild(el("p", "", t("noSources")));
      if (view.intake && view.intake.resolved) {
        node.appendChild(el("p", "anywhere-muted", [
          view.intake.resolved.label,
          view.intake.resolved.provenance,
          view.intake.resolved.confidence,
        ].filter(Boolean).join(" · ")));
      }
      return;
    }
    appendList(node, "anywhere-source-list", sourceStops, function (stop) {
      return el("li", "", [stop.label, stop.origin || t("sourceBacked"), stop.confidence].filter(Boolean).join(" · "));
    });
  }

  function renderContext(view) {
    var node = $("anywhereContext");
    clear(node);
    node.appendChild(el("h2", "", t("contextHeading")));
    var wrote = false;
    if (view.walking) {
      wrote = true;
      node.appendChild(el("p", "", view.walking.valid ? t("walkingValidated") : t("walkingHeuristic")));
      var walkingMeta = [
        view.walking.totalWalkKm != null ? view.walking.totalWalkKm + " km" : null,
        view.walking.walkingSource,
        view.walking.fallbackUsed ? "fallback" : null,
      ].filter(Boolean).join(" · ");
      if (walkingMeta) node.appendChild(el("p", "anywhere-muted", walkingMeta));
    }
    if (view.context) {
      var influence = view.context.influence || {};
      var time = view.context.time || {};
      var weather = view.context.weather || {};
      if (time.timeBand || time.timezoneSource) {
        wrote = true;
        node.appendChild(el("p", "", [time.timeBand, time.timezoneSource].filter(Boolean).join(" · ")));
      }
      if (weather.read && weather.read.headline) {
        wrote = true;
        node.appendChild(el("p", "", weather.read.headline));
        if (weather.read.reason) node.appendChild(el("p", "anywhere-muted", weather.read.reason));
      }
      if (influence.weatherFedIntoSelection) {
        wrote = true;
        node.appendChild(el("p", "anywhere-muted", t("weatherUsed")));
      }
      if (influence.timeFedIntoSelection) {
        wrote = true;
        node.appendChild(el("p", "anywhere-muted", t("timeUsed")));
      }
    }
    if (!wrote) node.appendChild(el("p", "", t("noContext")));
  }

  function renderBlockers(view) {
    var node = $("anywhereBlockers");
    clear(node);
    node.appendChild(el("h2", "", t("blockersHeading")));
    if (!view.blockers || !view.blockers.length) {
      node.appendChild(el("p", "", t("noBlockers")));
      return;
    }
    appendList(node, "anywhere-token-list", view.blockers, function (blocker) {
      return el("li", "", blocker.caption);
    });
  }

  function renderResponse(data) {
    var result = $("anywhereResult");
    if (result) result.hidden = false;
    var view = Render && Render.buildExperimentView
      ? Render.buildExperimentView(data, buildI18n())
      : { route: null, blockers: [], calibration: null };
    renderRoute(view);
    renderReadiness(view);
    renderSources(view);
    renderContext(view);
    renderBlockers(view);
    if (view.route) {
      setStatus(view.calibration && view.calibration.status === "thin_usable" ? "thin" : "ready", view.calibration && view.calibration.status === "thin_usable" ? t("thin") : t("ready"));
    } else {
      setStatus("blocked", t("blocked"));
    }
  }

  async function runAlpha(place) {
    var trimmed = String(place || "").trim();
    if (!trimmed) {
      setStatus("blocked", t("placeMissing"));
      return;
    }
    setStatus("loading", t("loading"));
    var params = new URLSearchParams(window.location.search);
    params.set("place", trimmed);
    params.set("planner", "open");
    params.set("lang", activeLang);
    window.history.replaceState(null, "", "/labs/anywhere?" + params.toString());
    try {
      var response = await fetch("/api/route-recommendations?lang=" + encodeURIComponent(activeLang) + "&experimental_agnostic_route_output=1&include_external_candidates=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(trimmed)),
      });
      var data = await response.json();
      renderResponse(data);
    } catch (_error) {
      setStatus("blocked", t("requestFailed"));
    }
  }

  var form = $("anywhereForm");
  var placeInput = $("anywherePlace");
  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      runAlpha(placeInput ? placeInput.value : "");
    });
  }

  var initialPlace = normalizePlaceFromQuery();
  if (placeInput && initialPlace) placeInput.value = initialPlace;
  var query = new URLSearchParams(window.location.search);
  if (initialPlace && query.get("planner") === "open") {
    runAlpha(initialPlace);
  } else {
    setStatus("idle", t("idle"));
  }
})();
